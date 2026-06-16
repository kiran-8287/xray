import React from "react";
import { RotateCw, GripVertical } from "lucide-react";
import type { SceneObject } from "../../types/customization";
import { getTransformedValidRegion } from "../../lib/customizationHelpers";

const CANVAS_W = 800;
const CANVAS_H = 600;

const IMAGE_BASE_URL = "http://localhost:8080/data/library_images/";

interface CanvasAreaProps {
  canvasDivRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  objects: SceneObject[];
  selectedObjectId: string | null;
  showValidRegion: boolean;
  handleMouseDown: (e: React.MouseEvent, obj: SceneObject) => void;
  handleRotationMouseDown: (e: React.MouseEvent, obj: SceneObject) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
}

export default function CanvasArea({
  canvasDivRef,
  zoom,
  objects,
  selectedObjectId,
  showValidRegion,
  handleMouseDown,
  handleRotationMouseDown,
  handleMouseMove,
  handleMouseUp,
}: CanvasAreaProps) {
  const [bagImageDimensions, setBagImageDimensions] = React.useState<{ width: number; height: number } | null>(null);
  
  const sortedObjects = [...objects].sort((a, b) => a.layer - b.layer);
  const bagObject = objects.find((o) => o.library === "bag");
  const validRegionPolygon = bagObject ? getTransformedValidRegion(bagObject, bagImageDimensions) : [];

  // Get display dimensions that fit the bag image within the canvas
  const bagImageUrl = bagObject?.filepath ? `${IMAGE_BASE_URL}${bagObject.filepath}` : null;
  const bagTransform = bagObject?.transform;

  // Handler to capture actual image dimensions for correct valid region scaling
  const handleBagImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setBagImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  return (
    <main
      className="flex-1 bg-surface flex items-center justify-center p-6 overflow-hidden relative"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Dimension badge */}
      <div className="absolute top-3 left-3 bg-panel/90 border border-border rounded-md px-2.5 py-1 text-xs font-mono text-muted shadow-card z-10 select-none">
        Canvas {CANVAS_W} × {CANVAS_H} px
      </div>

      {/* Canvas container */}
      <div
        ref={canvasDivRef}
        className="bg-white border border-border rounded-2xl shadow-panel relative select-none overflow-hidden transition-transform duration-75"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${zoom})`,
          transformOrigin: "center",
        }}
      >
        {/* Grid Pattern background */}
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-30">
          {Array.from({ length: CANVAS_W / 20 + 1 }).map((_, i) => (
            <line key={`v-${i}`} x1={i * 20} y1={0} x2={i * 20} y2={CANVAS_H} stroke="#E5E7EB" strokeWidth={1} />
          ))}
          {Array.from({ length: CANVAS_H / 20 + 1 }).map((_, i) => (
            <line key={`h-${i}`} x1={0} y1={i * 20} x2={CANVAS_W} y2={i * 20} stroke="#E5E7EB" strokeWidth={1} />
          ))}
        </svg>

        {/* Base Bag Image - shown directly centered on the canvas */}
        {bagImageUrl && bagTransform && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: bagTransform.x - bagTransform.width / 2,
              top: bagTransform.y - bagTransform.height / 2,
              width: bagTransform.width,
              height: bagTransform.height,
              transform: `rotate(${bagTransform.rotation}deg)`,
              zIndex: 1,
            }}
          >
            <img
              src={bagImageUrl}
              alt={bagObject?.name || "Bag"}
              className="w-full h-full object-contain pointer-events-none"
              draggable={false}
              onLoad={handleBagImageLoad}
            />
          </div>
        )}

        {/* Valid region overlay (from database) */}
        {showValidRegion && validRegionPolygon.length > 0 && (
          <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
            <polygon
              points={validRegionPolygon.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(5,150,105,0.04)"
              stroke="#059669"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          </svg>
        )}

        {/* Interactive Objects (threats, others placed on top of bag) */}
        {sortedObjects
          .filter((obj) => obj.library !== "bag")
          .map((obj) => {
            const isSelected = selectedObjectId === obj.id;
            const transform = obj.transform;
            const imageUrl = obj.filepath ? `${IMAGE_BASE_URL}${obj.filepath}` : null;

            return (
              <div
                key={obj.id}
                className={`absolute select-none group rounded-lg overflow-hidden ${
                  isSelected ? "z-30" : "z-20"
                }`}
                style={{
                  left: transform.x - transform.width / 2,
                  top: transform.y - transform.height / 2,
                  width: transform.width,
                  height: transform.height,
                  transform: `rotate(${transform.rotation}deg)`,
                  cursor: "move",
                }}
                onMouseDown={(e) => handleMouseDown(e, obj)}
              >
                {/* Object image */}
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt={obj.name}
                    className="w-full h-full object-contain pointer-events-none"
                    draggable={false}
                    style={{ opacity: 0.7, mixBlendMode: "multiply" }}
                  />
                )}

                {/* Selection border */}
                {isSelected && (
                  <div className="absolute inset-0 border-2 border-accent border-dashed pointer-events-none rounded-lg animate-pulse" />
                )}

                {/* Rotation handle */}
                {isSelected && (
                  <div
                    className="absolute -top-9 left-1/2 -translate-x-1/2 w-7 h-7 bg-panel border border-border shadow-card hover:border-accent hover:text-accent rounded-full flex items-center justify-center cursor-alias z-40 transition-colors"
                    onMouseDown={(e) => handleRotationMouseDown(e, obj)}
                  >
                    <RotateCw size={12} />
                  </div>
                )}

                {/* Object name label */}
                {isSelected && (
                  <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-panel/90 border border-border rounded-md px-2 py-0.5 text-[10px] font-semibold text-ink whitespace-nowrap pointer-events-none shadow-card">
                    {obj.name}
                  </div>
                )}
              </div>
            );
          })}

        {/* Empty canvas state */}
        {!bagObject && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center">
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-3 border border-border">
                <GripVertical size={24} className="text-muted/40" />
              </div>
              <p className="text-sm font-semibold text-ink mb-1">No bag selected</p>
              <p className="text-xs text-muted">Go to collage page to select a bag</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}