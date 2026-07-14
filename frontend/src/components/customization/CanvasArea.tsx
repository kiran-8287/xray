import React, { useRef, useEffect } from "react";
import { RotateCw, GripVertical } from "lucide-react";
import type { SceneObject } from "../../types/customization";
import { getTransformedValidRegion } from "../../lib/customizationHelpers";
import { drawXRayComposite, imgCache } from "../../lib/xrayRenderer";

const CANVAS_W = 800;
const CANVAS_H = 600;

const IMAGE_BASE_URL = "http://localhost:8080/data/library_images/";

interface CanvasAreaProps {
  canvasDivRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  objects: SceneObject[];
  selectedObjectId: string | null;
  showValidRegion: boolean;
  showGrid: boolean;
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
  showGrid,
  handleMouseDown,
  handleRotationMouseDown,
  handleMouseMove,
  handleMouseUp,
}: CanvasAreaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bagImageDimensions, setBagImageDimensions] = React.useState<{ width: number; height: number } | null>(null);
  const onImagesLoadedRef = useRef<() => void>(() => {});

  const sortedObjects = [...objects].sort((a, b) => a.layer - b.layer);
  const bagObject = objects.find((o) => o.library === "bag");
  const validRegionPolygon = bagObject ? getTransformedValidRegion(bagObject, bagImageDimensions) : [];

  const handleBagImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setBagImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Set canvas size to bag dimensions if available
    if (bagImageDimensions) {
      canvas.width = bagImageDimensions.width;
      canvas.height = bagImageDimensions.height;
    }
    (async () => {
      await drawXRayComposite(canvas!, objects, onImagesLoadedRef.current);
    })();
  }, [objects, bagImageDimensions]);

  onImagesLoadedRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    (async () => {
      await drawXRayComposite(canvas!, objects!, onImagesLoadedRef.current);
    })();
  };

  return (
    <main
      className="flex-1 bg-surface flex items-center justify-center p-6 pt-[200px] overflow-auto relative"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        ref={canvasDivRef}
        className="bg-white border border-border rounded-2xl shadow-panel relative select-none overflow-hidden transition-transform duration-75"
        style={{
          width: bagImageDimensions ? bagImageDimensions.width : CANVAS_W,
          height: bagImageDimensions ? bagImageDimensions.height : CANVAS_H,
          transform: `scale(${zoom})`,
          transformOrigin: "center",
        }}
      >
        {showGrid && (
          <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
            {/* Minor grid lines every 20px */}
            {Array.from({ length: (bagImageDimensions ? bagImageDimensions.width : CANVAS_W) / 20 + 1 }).map((_, i) => (
              <line key={`v-${i}`} x1={i * 20} y1={0} x2={i * 20} y2={bagImageDimensions ? bagImageDimensions.height : CANVAS_H} stroke="rgba(37, 99, 235, 0.15)" strokeWidth={0.5} />
            ))}
            {Array.from({ length: (bagImageDimensions ? bagImageDimensions.height : CANVAS_H) / 20 + 1 }).map((_, i) => (
              <line key={`h-${i}`} x1={0} y1={i * 20} x2={bagImageDimensions ? bagImageDimensions.width : CANVAS_W} y2={i * 20} stroke="rgba(37, 99, 235, 0.15)" strokeWidth={0.5} />
            ))}
            {/* Major grid lines every 100px */}
            {Array.from({ length: (bagImageDimensions ? bagImageDimensions.width : CANVAS_W) / 100 + 1 }).map((_, i) => (
              <line key={`mv-${i}`} x1={i * 100} y1={0} x2={i * 100} y2={bagImageDimensions ? bagImageDimensions.height : CANVAS_H} stroke="rgba(37, 99, 235, 0.5)" strokeWidth={1} />
            ))}
            {Array.from({ length: (bagImageDimensions ? bagImageDimensions.height : CANVAS_H) / 100 + 1 }).map((_, i) => (
              <line key={`mh-${i}`} x1={0} y1={i * 100} x2={bagImageDimensions ? bagImageDimensions.width : CANVAS_W} y2={i * 100} stroke="rgba(37, 99, 235, 0.5)" strokeWidth={1} />
            ))}
          </svg>
        )}

        {/* Origin marker */}
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ zIndex: 2 }}>
          <circle cx="0" cy="0" r="4" fill="#DC2626" stroke="white" strokeWidth={1.5} />
          <line x1="0" y1="0" x2="12" y2="0" stroke="#DC2626" strokeWidth={1.5} />
          <line x1="0" y1="0" x2="0" y2="12" stroke="#DC2626" strokeWidth={1.5} />
        </svg>

        <canvas
          ref={canvasRef}
          width={bagImageDimensions ? bagImageDimensions.width : CANVAS_W}
          height={bagImageDimensions ? bagImageDimensions.height : CANVAS_H}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{ zIndex: 1 }}
        />

        {bagObject?.filepath && (
          <img
            src={`${IMAGE_BASE_URL}${bagObject.filepath}`}
            alt=""
            className="hidden"
            onLoad={handleBagImageLoad}
          />
        )}

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

        {sortedObjects
          .filter((obj) => obj.library !== "bag")
          .map((obj) => {
            const isSelected = selectedObjectId === obj.id;
            // Use transform dimensions (now set to natural dimensions from CustomizationPage)
            const objWidth = obj.transform.width;
            const objHeight = obj.transform.height;

            return (
              <React.Fragment key={obj.id}>
                <div
                  className={`absolute select-none rounded-lg overflow-visible ${
                    isSelected ? "z-30" : "z-20"
                  }`}
                  style={{
                    left: obj.transform.x - objWidth / 2,
                    top: obj.transform.y - objHeight / 2,
                    width: objWidth,
                    height: objHeight,
                    transform: `rotate(${obj.transform.rotation}deg)`,
                    cursor: "move",
                  }}
                  onMouseDown={(e) => handleMouseDown(e, obj)}
                >
                  {isSelected && (
                    <div className="absolute inset-0 border-2 border-accent border-dashed pointer-events-none rounded-lg animate-pulse" />
                  )}
                </div>

                {isSelected && (() => {
                  const angleRad = (obj.transform.rotation * Math.PI) / 180;
                  const topCenterX = obj.transform.x + (objHeight / 2) * Math.sin(angleRad);
                  const topCenterY = obj.transform.y - (objHeight / 2) * Math.cos(angleRad);

                  return (
                    <div
                      className="absolute z-40"
                      style={{
                        left: topCenterX,
                        top: topCenterY,
                        transform: `translateX(-50%) translateY(-100%)`,
                      }}
                    >
                      <button
                        type="button"
                        className="w-7 h-7 rounded-full border-2 border-accent bg-panel shadow-md text-accent hover:bg-accent hover:text-white cursor-grab active:cursor-grabbing transition-all flex items-center justify-center"
                        onMouseDown={(e) => handleRotationMouseDown(e, obj)}
                        title="Drag to rotate"
                      >
                        <RotateCw size={12} />
                      </button>
                    </div>
                  );
                })()}

                {isSelected && (
                  <div
                    className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-panel/90 border border-border rounded-md px-2 py-0.5 text-[10px] font-semibold text-ink whitespace-nowrap pointer-events-none shadow-card z-40"
                    style={{
                      left: obj.transform.x,
                    }}
                  >
                    {obj.name}
                  </div>
                )}
              </React.Fragment>
            );
          })}

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