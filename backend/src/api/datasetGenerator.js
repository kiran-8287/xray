// backend/src/api/datasetGenerator.js
import { renderSceneAsync } from "../lib/renderCanvas.js";
import { getRandomPositionInContainer, getRectCorners, getTransformedPolygon } from "../lib/geometry.js";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Generate PNG collage image(s) and JSON annotations for a synthetic X‑ray export or batch generation.
 * @param {object} payload - The payload from the client.
 * @param {string} exportId - Unique identifier for the run.
 * @param {string} outDir - Directory to save generated assets.
 * @returns {Promise<object>} - Object mapping combo IDs to their generated file paths and annotations.
 */
export async function generateDataset(payload, exportId, outDir) {
  // Ensure the target directories exist
  const imagesDir = path.join(outDir, "images");
  const labelsDir = path.join(outDir, "labels");
  await fs.mkdir(imagesDir, { recursive: true });
  await fs.mkdir(labelsDir, { recursive: true });

  const generatedFiles = [];

  // 1. Check if this is a single custom workspace layout export
  if (payload.objects && Array.isArray(payload.objects)) {
    const pngBuffer = await renderSceneAsync(payload.objects, 800, 600);
    const filename = `${exportId}.png`;
    const filepath = path.join(imagesDir, filename);
    await fs.writeFile(filepath, pngBuffer);

    // Save JSON metadata/annotation for this single image
    const annotationData = {
      image_id: exportId,
      filename,
      width: 800,
      height: 600,
      objects: payload.objects.map(obj => {
        let polygon = [];
        if (obj.polygonOutline && obj.polygonOutline.length >= 3) {
          polygon = getTransformedPolygon(
            { x: obj.transform.x, y: obj.transform.y },
            { width: obj.transform.width, height: obj.transform.height },
            obj.transform.rotation,
            obj.polygonOutline
          );
        } else {
          polygon = getRectCorners(
            { x: obj.transform.x, y: obj.transform.y },
            { width: obj.transform.width, height: obj.transform.height },
            obj.transform.rotation
          );
        }

        // Calculate bounding box
        const xs = polygon.map(p => p.x);
        const ys = polygon.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        return {
          id: obj.id,
          name: obj.name,
          category: obj.library,
          pixel_value: obj.originalPixelValue,
          transform: obj.transform,
          layer: obj.layer,
          bbox: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
          },
          segmentation: polygon
        };
      })
    };

    await fs.writeFile(path.join(labelsDir, `${exportId}.json`), JSON.stringify(annotationData, null, 2), "utf8");

    generatedFiles.push({
      image: path.join("images", filename),
      label: path.join("labels", `${exportId}.json`)
    });

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
      id: `bag-${bag.id}`,
      name: bag.name,
      library: bag.category,
      originalPixelValue: bag.pixel_value,
      currentPixelValue: bag.pixel_value,
      oldPixelValue: null,
      filepath: bag.filepath,
      polygonOutline: bagOutline,
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
        id: `other-${item.id}-${oIdx}`,
        name: item.name,
        library: item.category,
        originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        oldPixelValue: null,
        filepath: item.filepath,
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
      sceneObjects.push({
        id: `threat-${threat.id}`,
        name: threat.name,
        library: threat.category,
        originalPixelValue: threat.pixel_value,
        currentPixelValue: threat.pixel_value,
        oldPixelValue: null,
        filepath: threat.filepath,
        polygonOutline: threatOutline,
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

    // Render this combination
    const pngBuffer = await renderSceneAsync(sceneObjects, resolutionW, resolutionH);
    const filename = `${comboId}.png`;
    const filepath = path.join(imagesDir, filename);
    await fs.writeFile(filepath, pngBuffer);

    // Create JSON annotation metadata
    const annotationData = {
      image_id: comboId,
      filename,
      width: resolutionW,
      height: resolutionH,
      bag: {
        id: bag.id,
        name: bag.name,
        filepath: bag.filepath
      },
      has_threat: !!threat,
      threat_count: threat ? 1 : 0,
      objects: sceneObjects.map(obj => {
        let polygon = [];
        if (obj.polygonOutline && obj.polygonOutline.length >= 3) {
          polygon = getTransformedPolygon(
            { x: obj.transform.x, y: obj.transform.y },
            { width: obj.transform.width, height: obj.transform.height },
            obj.transform.rotation,
            obj.polygonOutline
          );
        } else {
          polygon = getRectCorners(
            { x: obj.transform.x, y: obj.transform.y },
            { width: obj.transform.width, height: obj.transform.height },
            obj.transform.rotation
          );
        }

        // Calculate bounding box
        const xs = polygon.map(p => p.x);
        const ys = polygon.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        return {
          id: obj.id,
          name: obj.name,
          category: obj.library,
          pixel_value: obj.originalPixelValue,
          transform: obj.transform,
          layer: obj.layer,
          bbox: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
          },
          segmentation: polygon
        };
      })
    };

    await fs.writeFile(path.join(labelsDir, `${comboId}.json`), JSON.stringify(annotationData, null, 2), "utf8");

    generatedFiles.push({
      comboId,
      image: path.join("images", filename),
      label: path.join("labels", `${comboId}.json`)
    });
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
