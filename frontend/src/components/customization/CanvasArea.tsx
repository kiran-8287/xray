import React, { useRef, useEffect, useState, useCallback } from "react";
import { RotateCw } from "lucide-react";
import type { SceneObject } from "../../types/customization";
import { getTransformedValidRegion } from "../../lib/customizationHelpers";
import { drawXRayComposite } from "../../lib/xrayRenderer";

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  const sortedObjects = [...objects].sort((a, b) => a.layer - b.layer);
  const bagObject = objects.find((o) => o.library === "bag");
  const validRegionPolygon = bagObject ? getTransformedValidRegion(bagObject) : [];

  const handleImageLoaded = useCallback(() => {
    setLoadVersion((v) => v + 1);
  }, []);

  // Redraw canvas whenever objects change OR when an image finishes loading
  useEffect(() => {
    if (canvasRef.current) {
      drawXRayComposite(canvasRef.current, objects, handleImageLoaded);
    }
  }, [objects, loadVersion, handleImageLoaded]);

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
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-40">
          {Array.from({ length: CANVAS_W / 20 + 1 }).map((_, i) => (
            <line
              key={`v-${i}`}
              x1={i * 20}
              y1={0}
              x2={i * 20}
              y2={CANVAS_H}
              stroke="#F0F3F8"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: CANVAS_H / 20 + 1 }).map((_, i) => (
            <line
              key={`h-${i}`}
              x1={0}
              y1={i * 20}
              x2={CANVAS_W}
              y2={i * 20}
              stroke="#F0F3F8"
              strokeWidth={1}
            />
          ))}
        </svg>

        {/* Onscreen X-Ray Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />

        {/* Valid region overlay */}
        {showValidRegion && validRegionPolygon.length > 0 && (
          <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
            <polygon
              points={validRegionPolygon.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(5,150,105,0.02)"
              stroke="#059669"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          </svg>
        )}

        {/* Scene Objects (Interactive layers + visible image previews) */}
        {sortedObjects.map((obj) => {
          const isSelected = selectedObjectId === obj.id;
          const transform = obj.transform;
          const isBag = obj.library === "bag";
          const cursorClass = isBag ? "cursor-default" : "cursor-move";
          const zIndexClass = isBag ? "z-10" : (isSelected ? "z-30" : "z-20");
          const imageUrl = obj.filepath ? `${IMAGE_BASE_URL}${obj.filepath}` : null;

          return (
            <div
              key={obj.id}
              className={`absolute select-none group rounded-lg overflow-hidden ${cursorClass} ${zIndexClass}`}
              style={{
                left: transform.x - transform.width / 2,
                top: transform.y - transform.height / 2,
                width: transform.width,
                height: transform.height,
                transform: `rotate(${transform.rotation}deg)`,
              }}
              onMouseDown={(e) => handleMouseDown(e, obj)}
            >
              {/* Visible image preview of the object */}
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt={obj.name}
                  className="w-full h-full object-cover pointer-events-none"
                  draggable={false}
                  style={{ opacity: 0.4, mixBlendMode: "multiply" }}
                  onLoad={() => {
                    // Force re-render of the canvas when an image loads
                    handleImageLoaded();
                  }}
                />
              )}

              {/* Selection border indicator */}
              {isSelected && (
                <div className="absolute inset-0 border-2 border-accent border-dashed pointer-events-none rounded-lg animate-pulse" />
              )}

              {/* Rotation Handle */}
              {isSelected && obj.library !== "bag" && (
                <div
                  className="absolute -top-9 left-1/2 -translate-x-1/2 w-7 h-7 bg-panel border border-border shadow-card hover:border-accent hover:text-accent rounded-full flex items-center justify-center cursor-alias z-40 transition-colors"
                  onMouseDown={(e) => handleRotationMouseDown(e, obj)}
                >
                  <RotateCw size={12} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}