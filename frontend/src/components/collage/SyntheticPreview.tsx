import React from "react";
import type { Item } from "../../types/library";
import type { StencilKind } from "../../stencils/types";
import { getCategoryConfig } from "../../config/categories";

interface SyntheticPreviewProps {
  bag: Item;
  threat?: Item;
  others: Item[];
}

export default function SyntheticPreview({ bag, threat, others }: SyntheticPreviewProps) {
  const bagUrl = `http://localhost:8080/data/library_images/${bag.filepath}`;
  const threatUrl = threat ? `http://localhost:8080/data/library_images/${threat.filepath}` : null;
  const otherUrls = others.slice(0, 3).map((item) => ({ id: item.id, url: `http://localhost:8080/data/library_images/${item.filepath}`, name: item.name }));
  const categoryConfig = getCategoryConfig(bag.category);

  return (
    <div className="bg-panel rounded-2xl border border-border overflow-hidden shadow-card transition-colors duration-200 hover:border-accent/40 hover:bg-accent/5">
      <div className="bg-surface p-3 flex items-center justify-center h-40 overflow-hidden">
        <img
          src={bagUrl}
          alt={bag.name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-ink truncate" title={bag.name}>{bag.name}</p>
            <p className="text-xs text-muted mt-1">{others.length} other item{others.length !== 1 ? "s" : ""}</p>
          </div>
          <span className={`inline-flex px-2 py-1 rounded-full text-[11px] font-semibold ${categoryConfig.bg} ${categoryConfig.text} ${categoryConfig.border}`}>
            {bag.category}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {threatUrl && (
            <div className="w-16 h-16 rounded-2xl border border-border overflow-hidden bg-white">
              <img src={threatUrl} alt={threat?.name} className="w-full h-full object-contain" />
            </div>
          )}
          {otherUrls.map((other) => (
            <div key={other.id} className="w-16 h-16 rounded-2xl border border-border overflow-hidden bg-white">
              <img src={other.url} alt={other.name} className="w-full h-full object-contain" />
            </div>
          ))}
          {threatUrl === null && otherUrls.length === 0 && (
            <div className="text-xs text-muted">No additional items</div>
          )}
        </div>
      </div>
    </div>
  );
}
