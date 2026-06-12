import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Item } from "../../types/library";
import type { StencilKind } from "../../stencils/types";
import type { SceneObject } from "../../types/customization";
import { getRandomPositionInContainer } from "../../lib/customizationHelpers";
import { drawXRayComposite } from "../../lib/xrayRenderer";

const PREVIEW_CANVAS_W = 400;
const PREVIEW_CANVAS_H = 300;

interface SyntheticPreviewProps {
  bag: Item;
  threat?: Item;
  others: Item[];
}

export default function SyntheticPreview({
  bag,
  threat,
  others,
}: SyntheticPreviewProps) {
  const objects = useMemo(() => {
    const newObjects: SceneObject[] = [];
    let layer = 0;
    
    // Create bag
    const bagWidth = PREVIEW_CANVAS_W * 0.7;
    const bagHeight = PREVIEW_CANVAS_H * 0.7;
    
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

    const bagObject: SceneObject = {
      id: "preview-bag",
      name: bag.name,
      library: bag.category as StencilKind,
      originalPixelValue: bag.pixel_value,
      currentPixelValue: bag.pixel_value,
      oldPixelValue: null,
      stencilId: "suitcase",
      filepath: bag.filepath,
      polygonOutline: bagOutline,
      transform: {
        x: PREVIEW_CANVAS_W / 2,
        y: PREVIEW_CANVAS_H / 2,
        width: bagWidth,
        height: bagHeight,
        rotation: 0
      },
      layer: layer++
    };
    newObjects.push(bagObject);
    
    // Add other items
    others.forEach((item, i) => {
      const w = item.width ? Math.round(item.width * 0.25) : 50;
      const h = item.height ? Math.round(item.height * 0.25) : 50;
      
      let itemOutline = null;
      if (item.polygon_json) {
        itemOutline = typeof item.polygon_json === 'string'
          ? JSON.parse(item.polygon_json)
          : item.polygon_json;
      }
      
      const pos = getRandomPositionInContainer(w, h, bagObject, itemOutline);
      newObjects.push({
        id: `preview-other-${i}`,
        name: item.name,
        library: item.category as StencilKind,
        originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        oldPixelValue: null,
        stencilId: "tshirt",
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
    });
    
    // Add threat
    if (threat) {
      const w = threat.width ? Math.round(threat.width * 0.25) : 60;
      const h = threat.height ? Math.round(threat.height * 0.25) : 30;
      
      let threatOutline = null;
      if (threat.polygon_json) {
        threatOutline = typeof threat.polygon_json === 'string'
          ? JSON.parse(threat.polygon_json)
          : threat.polygon_json;
      }
      
      const pos = getRandomPositionInContainer(w, h, bagObject, threatOutline);
      newObjects.push({
        id: "preview-threat",
        name: threat.name,
        library: threat.category as StencilKind,
        originalPixelValue: threat.pixel_value,
        currentPixelValue: threat.pixel_value,
        oldPixelValue: null,
        stencilId: "gun",
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
    
    return newObjects;
  }, [bag, threat, others]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (canvasRef.current) {
      drawXRayComposite(canvasRef.current, objects, () => {
        forceUpdate({});
      });
    }
  }, [objects]);

  return (
    <div className="aspect-video bg-surface rounded-xl mb-3 relative overflow-hidden border border-border w-full flex items-center justify-center p-3 group-hover:bg-accent/4 transition-colors">
      <div
        style={{
          width: PREVIEW_CANVAS_W,
          height: PREVIEW_CANVAS_H,
          transform: "scale(0.65)",
          transformOrigin: "center",
          position: "absolute",
        }}
      >
        <canvas
          ref={canvasRef}
          width={PREVIEW_CANVAS_W}
          height={PREVIEW_CANVAS_H}
          className="w-full h-full pointer-events-none"
        />
      </div>
    </div>
  );
}
