import React, { useRef, useEffect, useState } from "react";
import type { SceneObject } from "../../types/customization";

const CANVAS_W = 800;
const CANVAS_H = 600;
const IMAGE_BASE_URL = "http://localhost:8080/data/library_images/";

interface SyntheticPreviewProps {
  objects: SceneObject[];
  bagName: string;
  threatName?: string;
  othersCount: number;
}

/**
 * Previews each combination exactly like the customization page renders it:
 * bag image at full opacity, threat/non-threat images overlaid with
 * multiply blending at reduced opacity. Uses DOM positioning (not canvas)
 * to match the CanvasArea rendering exactly.
 */
export default function SyntheticPreview({ objects, bagName, threatName, othersCount }: SyntheticPreviewProps) {
  const [allLoaded, setAllLoaded] = useState(false);
  const loadedRef = useRef(new Set<string>());

  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
  const totalImages = objects.filter(o => o.filepath).length;

  const handleImageLoad = (url: string) => {
    loadedRef.current.add(url);
    if (loadedRef.current.size >= totalImages) {
      setAllLoaded(true);
    }
  };

  // Scale factor to fit 800x600 into preview
  // We want it to fill nicely in the card
  return (
    <div className="bg-panel rounded-2xl border border-border overflow-hidden shadow-card transition-colors duration-200 hover:border-accent/40 hover:bg-accent/5">
      <div className="bg-surface p-2 flex items-center justify-center h-40 overflow-hidden relative">
        {/* Container at 4:3 aspect ratio scaled to fit */}
        <div className="relative w-full h-full flex items-center justify-center">
          <div
            className="relative bg-white rounded-lg overflow-hidden"
            style={{
              width: 200,
              height: 150,
              transformOrigin: "center",
            }}
          >
            {/* Render all objects layer by layer using DOM positioning */}
            {sorted.map(obj => {
              if (!obj.filepath) return null;
              const url = `${IMAGE_BASE_URL}${obj.filepath}`;
              const tx = obj.transform;

              // Scale coordinates from 800x600 space to 200x150 preview space
              const scaleX = 200 / CANVAS_W;
              const scaleY = 150 / CANVAS_H;
              const scaledX = tx.x * scaleX;
              const scaledY = tx.y * scaleY;
              const scaledW = tx.width * scaleX;
              const scaledH = tx.height * scaleY;

              // For non-bag objects, use multiply blend like CanvasArea does
              const isBag = obj.library === "bag";

              return (
                <div
                  key={obj.id}
                  className="absolute"
                  style={{
                    left: scaledX - scaledW / 2,
                    top: scaledY - scaledH / 2,
                    width: scaledW,
                    height: scaledH,
                    transform: `rotate(${tx.rotation}deg)`,
                    transformOrigin: `${scaledW / 2}px ${scaledH / 2}px`,
                    opacity: isBag ? 1 : 0.7,
                    mixBlendMode: isBag ? "normal" : "multiply" as any,
                    zIndex: obj.layer,
                  }}
                >
                  <img
                    src={url}
                    alt={obj.name}
                    className="w-full h-full object-contain"
                    draggable={false}
                    onLoad={() => handleImageLoad(url)}
                    onError={() => handleImageLoad(url)} // count errors as "loaded" to avoid stuck spinner
                  />
                </div>
              );
            })}

            {/* Loading overlay */}
            {!allLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-50">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate" title={bagName}>{bagName}</p>
            <p className="text-xs text-muted mt-0.5">
              {othersCount} other item{othersCount !== 1 ? "s" : ""}
              {threatName && <span className="ml-1.5 text-rose-500">· 1 threat</span>}
            </p>
          </div>
        </div>
        {threatName && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 truncate max-w-full">
              {threatName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}