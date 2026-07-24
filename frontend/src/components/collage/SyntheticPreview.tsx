import React, { useRef, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { SceneObject } from "../../types/customization";
import { API_BASE_URL } from "../../config/api";

const CANVAS_W = 800;
const CANVAS_H = 600;
const IMAGE_BASE_URL = `${API_BASE_URL}/data/library_images/`;

interface SyntheticPreviewProps {
  objects: SceneObject[];
  combinationId: string;
  bagId: string;
  threatId?: string;
  otherIds: string[];
}

/**
 * Previews each combination exactly like the customization page renders it:
 * bag image at full opacity, threat/non-threat images overlaid with
 * multiply blending at reduced opacity. Uses DOM positioning (not canvas)
 * to match the CanvasArea rendering exactly.
 */
export default function SyntheticPreview({ objects, combinationId, bagId, threatId, otherIds }: SyntheticPreviewProps) {
  const [allLoaded, setAllLoaded] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const loadedRef = useRef(new Set<string>());

  // Guard against undefined or non-array objects
  const objectsArray = Array.isArray(objects) ? objects : [];
  const sorted = [...objectsArray].sort((a, b) => a.layer - b.layer);
  const totalImages = objectsArray.filter(o => o.filepath).length;

  const handleImageLoad = (url: string) => {
    loadedRef.current.add(url);
    if (loadedRef.current.size >= totalImages) {
      setAllLoaded(true);
    }
  };

  const handleImageError = (url: string, objName: string) => {
    loadedRef.current.add(url);
    setFailedImages(prev => new Set(prev).add(url));
    if (loadedRef.current.size >= totalImages) {
      setAllLoaded(true);
    }
  };

  // Scale factor to fit 800x600 into preview
  // We want it to fill nicely in the card
  return (
    <div className="bg-panel rounded-2xl border border-border overflow-hidden shadow-card">
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
            {sorted.length > 0 ? sorted.map(obj => {
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

              const hasError = failedImages.has(url);
              
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
                  {hasError ? (
                    <div className="w-full h-full flex items-center justify-center bg-rose-50 border border-rose-200 rounded" title={`Failed to load: ${obj.name}`}>
                      <AlertTriangle size={14} className="text-rose-500" />
                    </div>
                  ) : (
                    <img
                      src={url}
                      alt={obj.name}
                      className="w-full h-full object-contain"
                      draggable={false}
                      onLoad={() => handleImageLoad(url)}
                      onError={() => handleImageError(url, obj.name)}
                    />
                  )}
                </div>
              );
            }) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">
                No objects
              </div>
            )}

            {/* Loading overlay */}
            {!allLoaded && sorted.length > 0 && (
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
            <p className="text-sm font-semibold text-accent-sky font-mono truncate" title={combinationId}>{combinationId}</p>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-muted truncate" title={bagId}>Bag: {bagId}</p>
          {threatId && (
            <p className="text-[10px] font-mono text-rose-600 truncate" title={threatId}>Threat: {threatId}</p>
          )}
          {otherIds.length > 0 && (
            <p className="text-[10px] font-mono text-muted truncate" title={otherIds.join(", ")}>Others: {otherIds.join(", ")}</p>
          )}
        </div>
      </div>
    </div>
  );
}