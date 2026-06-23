import React from "react";
import { Check, CheckCircle2, Edit3, Trash2 } from "lucide-react";
import type { Item } from "../../types/library";

function normalizeCategoryName(cat: string): string {
  const normalized = (cat || "").toLowerCase().trim();
  if (normalized === "non-threats" || normalized === "non-threat" || normalized.includes("non threat")) {
    return "non-threats";
  }
  if (normalized.includes("bag")) return "bags";
  if (normalized.includes("threat") || normalized.includes("electronic") || normalized === "electronics") return "threats";
  return "non-threats";
}

const CATEGORY_MAP: Record<string, { bg: string; text: string; border: string; borderAccent: string; label: string; slug: string }> = {
  bags: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", borderAccent: "border-blue-500", label: "Bags", slug: "bags" },
  threats: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", borderAccent: "border-rose-500", label: "Threats", slug: "threats" },
  "non-threats": { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", borderAccent: "border-gray-500", label: "Non-Threats", slug: "non-threats" },
};

function getCategoryConfig(category: string): { bg: string; text: string; border: string; borderAccent: string; label: string; slug: string } {
  const normalized = normalizeCategoryName(category);
  return CATEGORY_MAP[normalized] || CATEGORY_MAP["non-threats"];
}

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
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
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

export default function ItemCard({
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
      className={`relative bg-panel rounded-xl border shadow-card cursor-pointer transition-all duration-150 overflow-hidden group hover:shadow-card-hover hover:border-accent/40 hover:-translate-y-0.5 ${
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
              : "bg-panel/90 border-border hover:border-accent/50"
          }`}
        >
          {isSelected && <Check size={13} className="stroke-[3]" />}
        </button>
      </div>

      {/* Image Area */}
      <div className="relative aspect-square bg-surface flex items-center justify-center p-4 overflow-hidden group-hover:bg-accent/4 transition-colors">
        {item.category === "bags" && item.valid_region_points && item.valid_region_points.length > 0 ? (
          <ThumbnailWithRegion
            src={`http://localhost:8080/data/library_images/${item.filepath}`}
            validRegionPoints={item.valid_region_points}
            alt={item.filename}
          />
        ) : (
          <img
            src={`http://localhost:8080/data/library_images/${item.filepath}`}
            alt={item.filename}
            className="max-w-full max-h-full object-contain"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
            }}
          />
        )}
      </div>

      {/* Meta Section */}
      <div className="p-3 border-t border-surface">
        <div className="flex items-center justify-between mb-1">
          <h5 className="font-semibold text-ink text-xs truncate flex-1 mr-2" title={item.name}>
            {formatDisplayName(item.name)}
          </h5>
          {item.category === "bags" && item.valid_region_points && item.valid_region_points.length > 0 && (
            <div title="Valid region saved" className="flex-shrink-0">
              <CheckCircle2 size={14} className="text-green-600" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-md border ${config.bg} ${config.text} ${config.border}`}>
            {item.category}
          </span>
          <div className="flex items-center gap-1">
            {item.category === "bags" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditRegion();
                }}
                className="p-1 rounded-md bg-panel border border-border text-muted hover:border-accent/50 hover:text-accent shadow-card transition-all"
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
              className="p-1 rounded-md bg-panel border border-border text-muted hover:border-red-500 hover:text-red-600 shadow-card transition-all"
              title="Delete item"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
