import React from "react";
import { Check, CheckCircle2, Edit3, Trash2 } from "lucide-react";
import type { Item } from "../../types/library";
import { getCategoryConfig } from "../../config/categories";

interface ItemRowProps {
  item: Item;
  isSelected: boolean;
  onSelect: () => void;
  onEditRegion: () => void;
  onDelete: () => void;
}

export default function ItemRow({
  item,
  isSelected,
  onSelect,
  onEditRegion,
  onDelete,
}: ItemRowProps) {
  const config = getCategoryConfig(item.category);

  return (
    <tr
      onClick={onSelect}
      className={`hover:bg-surface/50 cursor-pointer transition-colors ${isSelected ? "bg-accent/4" : ""}`}
    >
      <td className="px-5 py-3">
        <div
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
            isSelected
              ? "bg-accent border-accent text-white"
              : "bg-panel border-border"
          }`}
        >
          {isSelected && <Check size={13} className="stroke-[3]" />}
        </div>
      </td>
      <td className="px-5 py-3">
        <div className="w-10 h-10 bg-surface rounded-lg border border-border p-1 flex items-center justify-center overflow-hidden">
          <img
            src={`http://localhost:8080/data/library_images/${item.filepath}`}
            alt={item.filename}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      </td>
      <td className="px-5 py-3 text-sm font-semibold text-ink">{item.name}</td>
      <td className="px-5 py-3 text-xs font-mono text-muted">{item.filename}</td>
      <td className="px-5 py-3">
        <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-md border ${config.bg} ${config.text} ${config.border}`}>
          {item.subcategory}
        </span>
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          {item.category === "bags" && item.valid_region_points && item.valid_region_points.length > 0 && (
            <div title="Valid region saved">
              <CheckCircle2 size={14} className="text-green-600" />
            </div>
          )}
          {item.category === "bags" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditRegion();
              }}
              className="p-1.5 rounded-md bg-panel border border-border text-muted hover:border-accent/50 hover:text-accent shadow-card transition-all flex items-center gap-1 text-xs"
              title="Edit valid region"
            >
              <Edit3 size={13} />
              Region
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded-md bg-panel border border-border text-muted hover:border-red-500 hover:text-red-600 shadow-card transition-all flex items-center gap-1 text-xs"
            title="Delete item"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
