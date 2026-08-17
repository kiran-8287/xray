import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ImageOff } from "lucide-react";
import { API_BASE_URL } from "../../config/api";
import { escapeAttribute, sanitizeId } from "../../lib/sanitize";

const CANVAS_W = 800;
const CANVAS_H = 600;
const IMAGE_BASE_URL = `${API_BASE_URL}/data/library_images/`;

interface LoadPreviewSceneProps {
  /** Annotation object shape: { bag, threats, non-threats }. */
  objects?: Record<string, any> | null;
  /** Render larger (used by the high-res preview modal). */
  large?: boolean;
}

interface SceneObject {
  id?: string;
  name?: string;
  filepath?: string;
  isBag?: boolean;
  center?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
  rotation?: number;
  layer?: number;
}

/**
 * Client-side composition of a Load-page annotation preview — the exact same
 * approach the Collage page uses for its 100-image tiles (SyntheticPreview):
 * layer the existing library PNGs (`/data/library_images/<filepath>`) on top of
 * each other using DOM transforms + multiply blending. No per-combination
 * backend render request is issued, so a whole page of 100 cards appears as fast
 * as the (cached) static images load, and nothing contends with Save requests.
 *
 * The annotation objects already carry `filepath`, `center`, `size`, `rotation`
 * and `layer` (800x600 canvas space), which is everything this composition needs.
 */
export default function LoadPreviewScene({ objects, large = false }: LoadPreviewSceneProps) {
  const [allLoaded, setAllLoaded] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const loadedRef = useRef(new Set<string>());

  const sceneObjects = useMemo<SceneObject[]>(() => {
    const out: SceneObject[] = [];
    const obj = objects || {};
    if (obj.bag) {
      out.push({ ...obj.bag, isBag: true, layer: obj.bag.layer ?? 0, rotation: obj.bag.rotation ?? 0 });
    }
    if (Array.isArray(obj.threats)) {
      for (const t of obj.threats) {
        out.push({ ...t, isBag: false, layer: t.layer ?? 1, rotation: t.rotation ?? 0 });
      }
    }
    if (Array.isArray(obj["non-threats"])) {
      for (const nt of obj["non-threats"]) {
        out.push({ ...nt, isBag: false, layer: nt.layer ?? 1, rotation: nt.rotation ?? 0 });
      }
    }
    return out.sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  }, [objects]);

  const totalImages = sceneObjects.filter((o) => o.filepath).length;

  const handleImageLoad = (url: string) => {
    loadedRef.current.add(url);
    if (loadedRef.current.size >= totalImages) {
      setAllLoaded(true);
    }
  };

  const handleImageError = (url: string, id: string) => {
    loadedRef.current.add(url);
    setFailedImages((prev) => new Set(prev).add(url));
    if (loadedRef.current.size >= totalImages) {
      setAllLoaded(true);
    }
  };

  if (sceneObjects.length === 0 || totalImages === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-1.5 text-muted/50 px-2">
          <ImageOff size={large ? 44 : 28} />
          <span className="text-xs text-center">No image data available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-white overflow-hidden">
      {/* Render all objects layer by layer, scaling the 800x600 canvas space onto
          the (4:3) card/modal area using percentages. */}
      {sceneObjects.map((obj, idx) => {
        if (!obj.filepath) return null;
        const url = `${IMAGE_BASE_URL}${obj.filepath}`;
        const cx = obj.center?.x ?? CANVAS_W / 2;
        const cy = obj.center?.y ?? CANVAS_H / 2;
        const width = obj.size?.width ?? 100;
        const height = obj.size?.height ?? 100;
        const rotation = obj.rotation ?? 0;

        const hasError = failedImages.has(url);

        return (
          <div
            key={obj.id ?? obj.name ?? idx}
            className="absolute"
            style={{
              left: `${(cx / CANVAS_W) * 100}%`,
              top: `${(cy / CANVAS_H) * 100}%`,
              width: `${(width / CANVAS_W) * 100}%`,
              height: `${(height / CANVAS_H) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              transformOrigin: "center",
              opacity: obj.isBag ? 1 : 0.7,
              mixBlendMode: obj.isBag ? "normal" : "multiply",
              zIndex: obj.layer ?? 0,
            }}
          >
            {hasError ? (
              <div
                className="w-full h-full flex items-center justify-center bg-rose-50 border border-rose-200 rounded"
                title={escapeAttribute(`Failed to load: ${sanitizeId(obj.id || obj.name || "")}`)}
              >
                <AlertTriangle size={14} className="text-rose-500" />
              </div>
            ) : (
              <img
                src={url}
                alt={escapeAttribute(sanitizeId(obj.id || obj.name || ""))}
                className="w-full h-full object-contain"
                draggable={false}
                loading={large ? "eager" : "lazy"}
                decoding="async"
                onLoad={() => handleImageLoad(url)}
                onError={() => handleImageError(url, obj.id || obj.name || "")}
              />
            )}
          </div>
        );
      })}

      {/* Loading overlay — hidden as soon as every requested image has loaded (or failed). */}
      {!allLoaded && totalImages > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white z-50">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}