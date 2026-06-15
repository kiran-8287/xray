import React from "react";
import { Check, CheckCircle2, Edit3, Trash2 } from "lucide-react";
import type { Item } from "../../types/library";
import { getCategoryConfig } from "../../config/categories";

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
      <div className="aspect-square bg-surface flex items-center justify-center p-4 overflow-hidden group-hover:bg-accent/4 transition-colors">
        <img
          src={`http://localhost:8080/data/library_images/${item.filepath}`}
          alt={item.filename}
          className="max-w-full max-h-full object-contain"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = "none";
          }}
        />
      </div>

      {/* Meta Section */}
      <div className="p-3 border-t border-surface">
        <div className="flex items-center justify-between mb-1">
          <h5 className="font-semibold text-ink text-xs truncate flex-1 mr-2" title={item.name}>
            {item.name}
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
