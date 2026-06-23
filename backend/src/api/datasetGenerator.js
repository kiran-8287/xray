// backend/src/api/datasetGenerator.js
import { renderSceneAsync } from "../lib/renderCanvas.js";
import { getRandomPositionInContainer, getRectCorners, getTransformedPolygon, isObjectInsideContainer } from "../lib/geometry.js";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Generate PNG collage image(s) and JSON annotations for a synthetic X‑ray export or batch generation.
 * @param {object} payload - The payload from the client.
 * @param {string} exportId - Unique identifier for the run.
 * @param {string} outDir - Directory to save generated assets.
 * @param {boolean} saveImages - Whether to save the generated PNG images (default true)
 * @returns {Promise<object>} - Object mapping combo IDs to their generated file paths and annotations.
 */
export async function generateDataset(payload, exportId, outDir, saveImages = true) {
  // Ensure the target directories exist
  const imagesDir = path.join(outDir, "images");
  const labelsDir = path.join(outDir, "labels");
  await fs.mkdir(imagesDir, { recursive: true });
  await fs.mkdir(labelsDir, { recursive: true });

  const generatedFiles = [];

  // 1. Check if this is a single custom workspace layout export
  if (payload.objects && Array.isArray(payload.objects)) {
    const bagObject = payload.objects.find(obj => obj.library === 'bag');
    let bagOrigin = { x: 0, y: 0 }; // default origin
    let bagCorners = [];
    let validRegionRelative = null;
    
    if (bagObject) {
      bagCorners = getRectCorners(
        { x: bagObject.transform.x, y: bagObject.transform.y },
        { width: bagObject.transform.width, height: bagObject.transform.height },
        bagObject.transform.rotation
      );
      // Find leftmost point of the bag as origin
      const origin = bagCorners.reduce((min, point) => point.x < min.x ? point : min, bagCorners[0]);
      bagOrigin = { x: origin.x, y: origin.y };
      
      // Calculate valid region points relative to bag origin
      if (bagObject.valid_region_points) {
        const validRegionPoints = Array.isArray(bagObject.valid_region_points) 
          ? bagObject.valid_region_points 
          : (bagObject.valid_region_points.simplifiedPoints || bagObject.valid_region_points.points || []);
        
        validRegionRelative = validRegionPoints.map(p => ({
          x: p.x - bagOrigin.x,
          y: p.y - bagOrigin.y
        }));
      }
    }

    if (saveImages) {
      const pngBuffer = await renderSceneAsync(payload.objects, 800, 600);
      const filename = `${exportId}.png`;
      const filepath = path.join(imagesDir, filename);
      await fs.writeFile(filepath, pngBuffer);
      
      generatedFiles.push({
        image: path.join("images", filename),
        label: path.join("labels", `${exportId}.json`)
      });
    } else {
      generatedFiles.push({
        label: path.join("labels", `${exportId}.json`)
      });
    }

    // Save JSON metadata/annotation for this single image
    const annotationData = {
      export_id: exportId,
      image_id: exportId,
      width: 800,
      height: 600,
      bag_origin: bagOrigin, // leftmost point of the bag as coordinate origin
      bag: bagObject ? {
        id: bagObject.id,
        name: bagObject.name,
        category: bagObject.library,
        pixel_value: bagObject.originalPixelValue,
        filepath: bagObject.filepath,
        pixel_data_path: bagObject.pixel_data_path || null,
        transform: bagObject.transform,
        corners: bagCorners,
        corners_relative_to_bag: bagCorners.map(c => ({ x: c.x - bagOrigin.x, y: c.y - bagOrigin.y }))
      } : null,
      valid_region: bagObject && bagObject.valid_region_points ? bagObject.valid_region_points : null,
      valid_region_relative_to_bag: validRegionRelative,
      objects: payload.objects.map(obj => {
        let polygon = [];
        const objCorners = getRectCorners(
          { x: obj.transform.x, y: obj.transform.y },
          { width: obj.transform.width, height: obj.transform.height },
          obj.transform.rotation
        );

        if (obj.polygonOutline && obj.polygonOutline.length >= 3) {
          polygon = getTransformedPolygon(
            { x: obj.transform.x, y: obj.transform.y },
            { width: obj.transform.width, height: obj.transform.height },
            obj.transform.rotation,
            obj.polygonOutline
          );
        } else {
          polygon = objCorners;
        }

        // Calculate bounding box
        const xs = polygon.map(p => p.x);
        const ys = polygon.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        // Calculate coordinates relative to bagOrigin
        const relativeCorners = objCorners.map(corner => ({
          x: corner.x - bagOrigin.x,
          y: corner.y - bagOrigin.y
        }));
        const relativePolygon = polygon.map(p => ({
          x: p.x - bagOrigin.x,
          y: p.y - bagOrigin.y
        }));

        return {
          id: obj.id,
          name: obj.name,
          category: obj.library,
          pixel_value: obj.originalPixelValue,
          filepath: obj.filepath,
          pixel_data_path: obj.pixel_data_path || null,
          transform: obj.transform,
          // Store 4 corner coordinates in both absolute and relative to bag origin
          corners: objCorners,
          corners_relative_to_bag: relativeCorners,
          layer: obj.layer,
          bbox: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            x_relative: minX - bagOrigin.x,
            y_relative: minY - bagOrigin.y
          },
          segmentation: polygon,
          segmentation_relative_to_bag: relativePolygon
        };
      })
    };

    await fs.writeFile(path.join(labelsDir, `${exportId}.json`), JSON.stringify(annotationData, null, 2), "utf8");

    return {
      type: "single",
      files: generatedFiles
    };
  }

  // 2. Otherwise, this is a batch/collage generation request
  const combinations = payload.combinations ?? [];
  const resolutionW = payload.resolutionWidth ?? 800;
  const resolutionH = payload.resolutionHeight ?? 600;

  for (let idx = 0; idx < combinations.length; idx++) {
    const combo = combinations[idx];
    const comboId = combo.id || `combo-${idx}-${Date.now()}`;

    // Reconstruct scene objects with random placements inside valid region
    const sceneObjects = [];
    let layer = 0;

    const bag = combo.bag;
    if (!bag) continue;

    // Place bag in center
    const bagWidth = resolutionW * 0.75;
    const bagHeight = resolutionH * 0.75;

    let bagOutline = null;
    if (bag.valid_region_points) {
      bagOutline = typeof bag.valid_region_points === 'string'
        ? JSON.parse(bag.valid_region_points)
        : bag.valid_region_points;
    }
    if (!bagOutline && bag.polygon_json) {
      bagOutline = typeof bag.polygon_json === 'string'
        ? JSON.parse(bag.polygon_json)
        : bag.polygon_json;
    }

    const bagObject = {
      id: bag.id,
      name: bag.name,
      library: bag.category,
      originalPixelValue: bag.pixel_value,
      currentPixelValue: bag.pixel_value,
      oldPixelValue: null,
      filepath: bag.filepath,
      pixel_data_path: bag.pixel_data_path || null,
      polygonOutline: bagOutline,
      valid_region_points: bag.valid_region_points,
      transform: {
        x: resolutionW / 2,
        y: resolutionH / 2,
        width: bagWidth,
        height: bagHeight,
        rotation: 0
      },
      layer: layer++
    };
    sceneObjects.push(bagObject);

    // Place other items
    const others = combo.others ?? [];
    for (let oIdx = 0; oIdx < others.length; oIdx++) {
      const item = others[oIdx];
      const w = item.width ? Math.round(item.width * 0.28) : 80;
      const h = item.height ? Math.round(item.height * 0.28) : 80;

      let itemOutline = null;
      if (item.polygon_json) {
        itemOutline = typeof item.polygon_json === 'string'
          ? JSON.parse(item.polygon_json)
          : item.polygon_json;
      }

      const pos = getRandomPositionInContainer(w, h, itemOutline, bagObject);
      sceneObjects.push({
        id: item.id,
        name: item.name,
        library: item.category,
        originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        oldPixelValue: null,
        filepath: item.filepath,
        pixel_data_path: item.pixel_data_path || null,
        polygonOutline: itemOutline,
        transform: {
          x: pos.x,
          y: pos.y,
          width: w,
          height: h,
          rotation: pos.rotation ?? Math.random() * 360
        },
        layer: layer++
      });
    }

    // Place threat
    const threat = combo.threat;
    let threatObject = null;
    if (threat) {
      const w = threat.width ? Math.round(threat.width * 0.28) : 90;
      const h = threat.height ? Math.round(threat.height * 0.28) : 45;

      let threatOutline = null;
      if (threat.polygon_json) {
        threatOutline = typeof threat.polygon_json === 'string'
          ? JSON.parse(threat.polygon_json)
          : threat.polygon_json;
      }

      const pos = getRandomPositionInContainer(w, h, threatOutline, bagObject);
      threatObject = {
        id: threat.id,
        name: threat.name,
        library: threat.category,
        originalPixelValue: threat.pixel_value,
        currentPixelValue: threat.pixel_value,
        oldPixelValue: null,
        filepath: threat.filepath,
        pixel_data_path: threat.pixel_data_path || null,
        polygonOutline: threatOutline,
        transform: {
          x: pos.x,
          y: pos.y,
          width: w,
          height: h,
          rotation: pos.rotation ?? Math.random() * 360
        },
        layer: layer++
      };
      sceneObjects.push(threatObject);
    }

    // Validate that all non-bag objects are inside the bag's valid placement region (if a bag exists)
    if (bagObject) {
      let outOfBounds = false;
      for (const obj of sceneObjects) {
        if (obj.library === 'bag') continue;
        try {
          if (!isObjectInsideContainer(obj, bagObject)) {
            outOfBounds = true;
            break;
          }
        } catch (err) {
          // On error, treat as out of bounds to be safe
          outOfBounds = true;
          break;
        }
      }
      if (outOfBounds) {
        // Skip this permutation entirely
        continue;
      }
    }

    if (saveImages) {
      // Render this combination
      const pngBuffer = await renderSceneAsync(sceneObjects, resolutionW, resolutionH);
      const filename = `${comboId}.png`;
      const filepath = path.join(imagesDir, filename);
      await fs.writeFile(filepath, pngBuffer);
      
      generatedFiles.push({
        comboId,
        image: path.join("images", filename),
        label: path.join("labels", `${comboId}.json`)
      });
    } else {
      generatedFiles.push({
        comboId,
        label: path.join("labels", `${comboId}.json`)
      });
    }

    // Get bag origin
    let bagOrigin = { x: 0, y: 0 };
    const currentBagObject = sceneObjects.find(obj => obj.library === 'bag');
    let bagCorners = [];
    let validRegionRelative = null;
    
    if (currentBagObject) {
      bagCorners = getRectCorners(
        { x: currentBagObject.transform.x, y: currentBagObject.transform.y },
        { width: currentBagObject.transform.width, height: currentBagObject.transform.height },
        currentBagObject.transform.rotation
      );
      const origin = bagCorners.reduce((min, point) => point.x < min.x ? point : min, bagCorners[0]);
      bagOrigin = { x: origin.x, y: origin.y };
      
      // Calculate valid region points relative to origin
      if (currentBagObject.valid_region_points) {
        const validRegionPoints = Array.isArray(currentBagObject.valid_region_points) 
          ? currentBagObject.valid_region_points 
          : (currentBagObject.valid_region_points.simplifiedPoints || currentBagObject.valid_region_points.points || []);
        
        validRegionRelative = validRegionPoints.map(p => ({
          x: p.x - bagOrigin.x,
          y: p.y - bagOrigin.y
        }));
      }
    }

    // Create JSON annotation metadata
    const annotationData = {
      export_id: exportId,
      image_id: comboId,
      width: resolutionW,
      height: resolutionH,
      bag_origin: bagOrigin,
      bag: bag ? {
        id: bag.id,
        name: bag.name,
        category: bag.category,
        pixel_value: bag.pixel_value,
        filepath: bag.filepath,
        pixel_data_path: bag.pixel_data_path || null,
        transform: currentBagObject.transform,
        corners: bagCorners,
        corners_relative_to_bag: bagCorners.map(c => ({ x: c.x - bagOrigin.x, y: c.y - bagOrigin.y }))
      } : null,
      valid_region: currentBagObject && currentBagObject.valid_region_points ? currentBagObject.valid_region_points : null,
      valid_region_relative_to_bag: validRegionRelative,
      has_threat: !!threat,
      threat_count: threat ? 1 : 0,
      threat_status: threat ? "threat_present" : "clean",
      placement_validity: (threat && currentBagObject && threatObject) ? (isObjectInsideContainer(threatObject, currentBagObject) ? "valid" : "out_of_bounds") : "valid",
      objects: sceneObjects.map(obj => {
        let polygon = [];
        const objCorners = getRectCorners(
          { x: obj.transform.x, y: obj.transform.y },
          { width: obj.transform.width, height: obj.transform.height },
          obj.transform.rotation
        );

        if (obj.polygonOutline && obj.polygonOutline.length >= 3) {
          polygon = getTransformedPolygon(
            { x: obj.transform.x, y: obj.transform.y },
            { width: obj.transform.width, height: obj.transform.height },
            obj.transform.rotation,
            obj.polygonOutline
          );
        } else {
          polygon = objCorners;
        }

        // Calculate bounding box
        const xs = polygon.map(p => p.x);
        const ys = polygon.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        // Calculate coordinates relative to bagOrigin
        const relativeCorners = objCorners.map(corner => ({
          x: corner.x - bagOrigin.x,
          y: corner.y - bagOrigin.y
        }));
        const relativePolygon = polygon.map(p => ({
          x: p.x - bagOrigin.x,
          y: p.y - bagOrigin.y
        }));

        return {
          id: obj.id,
          name: obj.name,
          category: obj.library,
          pixel_value: obj.originalPixelValue,
          filepath: obj.filepath,
          pixel_data_path: obj.pixel_data_path || null,
          transform: obj.transform,
          corners: objCorners,
          corners_relative_to_bag: relativeCorners,
          layer: obj.layer,
          bbox: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            x_relative: minX - bagOrigin.x,
            y_relative: minY - bagOrigin.y
          },
          segmentation: polygon,
          segmentation_relative_to_bag: relativePolygon
        };
      })
    };

    await fs.writeFile(path.join(labelsDir, `${comboId}.json`), JSON.stringify(annotationData, null, 2), "utf8");
  }

  // Also write a master manifest file
  const manifest = {
    exportId,
    createdAt: new Date().toISOString(),
    totalScans: generatedFiles.length,
    resolution: `${resolutionW}x${resolutionH}`,
    files: generatedFiles
  };
  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  return {
    type: "batch",
    files: generatedFiles,
    manifest: path.join("manifest.json")
  };
}
