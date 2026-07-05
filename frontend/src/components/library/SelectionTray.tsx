import React from "react";
import { Grid3X3, Loader2, Settings2 } from "lucide-react";
import { IoMdPhotos } from "react-icons/io";

interface SelectionTrayProps {
  selectedCount: number;
  onClearSelection: () => void;
  onGenerateCollage: () => void;
  kValue: number;
  setKValue: (value: number) => void;
  maxThreats: number;
  setMaxThreats: (value: number) => void;
  isGenerating: boolean;
  generationProgress: string;
  onGenerate: () => void;
  hasCombinations: boolean;
}

export default function SelectionTray({
  selectedCount,
  onClearSelection,
  onGenerateCollage,
  kValue,
  setKValue,
  maxThreats,
  setMaxThreats,
  isGenerating,
  generationProgress,
  onGenerate,
  hasCombinations,
}: SelectionTrayProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex-shrink-0 bg-panel/95 backdrop-blur-sm border-t border-border px-6 py-3 flex items-center gap-4 shadow-[0_-4px_20px_rgba(27,35,51,0.08)] z-30">
      {/* Left: Selection count and text */}
      <span className="bg-accent text-white text-xs font-bold px-2.5 py-1 rounded-full">
        {selectedCount}
      </span>
      <span className="text-sm font-semibold text-ink">
        item{selectedCount !== 1 ? "s" : ""} selected
      </span>

      {/* Middle: K-combinations generator */}
      <div className="flex items-center gap-3 ml-auto flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">Generate</span>
        </div>
        <input
          type="number"
          min={1}
          max={10000}
          value={kValue}
          onChange={(e) => {
            const val = parseInt(e.target.value) || 1;
            setKValue(Math.max(1, Math.min(10000, val)));
          }}
          className="w-25 bg-surface border border-border rounded-xl px-3 py-1.5 text-sm text-ink font-mono text-center focus:outline-none focus:border-accent"
        />
        <span className="text-xs text-muted">unique combinations</span>

        {/* Max threats per combo */}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-xs text-muted">max</span>
          <select
            value={maxThreats}
            onChange={(e) => setMaxThreats(parseInt(e.target.value))}
            className="bg-surface border border-border rounded-xl px-2 py-1.5 text-sm text-ink font-mono text-center focus:outline-none focus:border-accent"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
          <span className="text-xs text-muted">threats/combo</span>
        </div>

        {generationProgress && (
          <span className="text-xs text-muted animate-pulse">{generationProgress}</span>
        )}
      </div>

      {/* Right: Clear and Collage buttons */}
      <button
        onClick={onClearSelection}
        className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted"
      >
        Clear Selection
      </button>
      <button
        onClick={onGenerateCollage}
        disabled={selectedCount === 0}
        className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Generate Collage
      </button>
    </div>
  );
}
