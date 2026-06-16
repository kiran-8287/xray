import React from "react";
import { Grid3X3 } from "lucide-react";

interface SelectionTrayProps {
  selectedCount: number;
  onClearSelection: () => void;
  onGenerateCollage: () => void;
}

export default function SelectionTray({
  selectedCount,
  onClearSelection,
  onGenerateCollage,
}: SelectionTrayProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex-shrink-0 bg-panel/95 backdrop-blur-sm border-t border-border px-6 py-3 flex items-center gap-4 shadow-[0_-4px_20px_rgba(27,35,51,0.08)] z-30">
      <span className="bg-accent text-white text-xs font-bold px-2.5 py-1 rounded-full">
        {selectedCount}
      </span>
      <span className="text-sm font-semibold text-ink ml-2">
        item{selectedCount !== 1 ? "s" : ""} selected
      </span>

      <button
        onClick={onClearSelection}
        className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted hover:bg-surface hover:text-ink hover:border-muted/60 transition-all duration-150 ml-auto"
      >
        Clear Selection
      </button>
      <button
        onClick={onGenerateCollage}
        className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm"
      >
        <Grid3X3 size={15} />
        Generate Collage
      </button>
    </div>
  );
}
