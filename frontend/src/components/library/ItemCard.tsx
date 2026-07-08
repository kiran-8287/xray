import React, { memo, useRef, useEffect } from "react";
import { Check, Edit3, Trash2 } from "lucide-react";
import type { Item } from "../../types/library";
import { getCategoryConfig } from "../../config/categories";
import ImageWithPlaceholder from "../common/ImageWithPlaceholder";

function formatDisplayName(name: string) {
  return name.replace(/\.[^.]+$/i, "");
}

function parseValidRegionPoints(validRegionPoints: any) {
  if (!validRegionPoints) return [];
  const raw = typeof validRegionPoints === "string" ? JSON.parse(validRegionPoints) : validRegionPoints;

  let points: any[] = [];
  if (Array.isArray(raw)) {
    points = raw;
  } else if (raw && typeof raw === "object") {
    points = raw.simplifiedPoints || raw.points || raw.shapes?.[0]?.points || [];
  }

  return points
    .map((p: any) => ({ x: Number(p.x), y: Number(p.y) }))
    .filter((p: any) => !Number.isNaN(p.x) && !Number.isNaN(p.y));
}

function ThumbnailWithRegion({ src, validRegionPoints, alt }: { src: string; validRegionPoints: any; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      const size = 156;
      canvas.width = size;
      canvas.height = size;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);

      const points = parseValidRegionPoints(validRegionPoints).map((p) => ({
        x: p.x <= 1 ? p.x * size : p.x,
        y: p.y <= 1 ? p.y * size : p.y,
      }));

      if (points.length >= 2) {
        ctx.save();
        ctx.strokeStyle = "rgba(16, 185, 129, 0.95)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        if (points.length > 2) ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    };

    img.src = src;
  }, [src, validRegionPoints]);

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full max-h-full object-contain"
      title={alt}
    />
  );
}

interface ItemCardProps {
  item: Item;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onEditRegion: () => void;
  onDelete: () => void;
}

const ItemCard = memo(function ItemCard({
  item,
  isSelected,
  onSelect,
  onOpen,
  onEditRegion,
  onDelete,
}: ItemCardProps) {
  const config = getCategoryConfig(item.category);

  return (
    <div
      onClick={onOpen}
      className={`relative bg-panel rounded-xl border shadow-card cursor-pointer transition-all duration-150 overflow-hidden group ${
        isSelected
          ? "border-accent ring-2 ring-accent/20 shadow-btn bg-accent/4"
          : "border-border"
      }`}
    >
      {/* Checkbox */}
      <div className="absolute top-2.5 left-2.5 z-10">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
            isSelected
              ? "bg-accent border-accent text-white scale-105"
              : "bg-panel/90 border-border"
          }`}
        >
          {isSelected && <Check size={13} className="stroke-[3]" />}
        </button>
      </div>

      {/* Image Area */}
      <div className="relative aspect-square bg-surface flex items-center justify-center p-4 overflow-hidden">
        {item.category === "bags" && item.valid_region_points && item.valid_region_points.length > 0 ? (
          <ThumbnailWithRegion
            src={`http://localhost:8080/data/library_images/${item.filepath}`}
            validRegionPoints={item.valid_region_points}
            alt={item.filename}
          />
        ) : (
          <ImageWithPlaceholder
            src={`http://localhost:8080/data/library_images/${item.filepath}`}
            alt={item.filename}
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>

      {/* Meta Section */}
      <div className="p-3 border-t border-surface">
        <h5 className="font-semibold text-ink text-xs truncate" title={item.name}>
          {formatDisplayName(item.name)}
        </h5>
        
        {/* Tags Display - only for bags */}
        {item.category === "bags" && item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.tags.map((tagSlug) => {
              const tagName = tagSlug
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
              return (
                <span
                  key={tagSlug}
                  className="inline-flex items-center px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-medium"
                  title={tagName}
                >
                  {tagName}
                </span>
              );
            })}
          </div>
        )}
        
        <div className="flex items-center justify-end gap-1 mt-2">
          {item.category === "bags" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditRegion();
              }}
              className="p-1 rounded-md bg-panel border border-border text-muted shadow-card"
              title="Edit valid region"
            >
              <Edit3 size={12} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded-md bg-panel border border-border text-muted shadow-card"
            title="Delete item"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default ItemCard;