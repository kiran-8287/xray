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
  threatDistribution: Record<number, number>;
  setThreatDistribution: (value: Record<number, number>) => void;
  isGenerating: boolean;
  generationProgress: string;
  onGenerate: () => void;
  hasCombinations: boolean;
}

const THREAT_LABELS: Record<number, string> = {
  1: "1 threat",
  2: "2 threats",
  3: "3 threats",
  4: "4 threats",
};

export default function SelectionTray({
  selectedCount,
  onClearSelection,
  onGenerateCollage,
  kValue,
  setKValue,
  maxThreats,
  setMaxThreats,
  threatDistribution,
  setThreatDistribution,
  isGenerating,
  generationProgress,
  onGenerate,
  hasCombinations,
}: SelectionTrayProps) {
  if (selectedCount === 0) return null;

  const updateDistribution = (key: number, raw: string) => {
    const val = parseInt(raw);
    if (isNaN(val) || val < 0) return;
    setThreatDistribution({ ...threatDistribution, [key]: Math.min(val, 100) });
  };

  return (
    <div className="flex-shrink-0 bg-panel/95 backdrop-blur-sm border-t border-border px-6 py-3 flex items-center gap-4 shadow-[0_-4px_20px_rgba(27,35,51,0.08)] z-30">
      {/* Left: Selection count and text */}
      <span className="bg-accent text-white text-xs font-bold px-2.5 py-1 rounded-full">
        {selectedCount}
      </span>
      <span className="text-sm font-semibold text-ink">
        item{selectedCount !== 1 ? "s" : ""} selected
      </span>

      {/* Middle: Controls */}
      <div className="flex items-center gap-3 ml-auto flex-wrap">
        {/* K value input */}
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

        <div className="w-px h-6 bg-border mx-1" />

        {/* Step 1: Max threats selector */}
        <div className="flex items-center gap-1.5">
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

        {/* Step 2: Percentage inputs for 1..maxThreats */}
        {Array.from({ length: maxThreats }, (_, i) => i + 1).map((n) => (
          <div key={n} className="flex items-center gap-1">
            <span className="text-[11px] text-muted whitespace-nowrap">{THREAT_LABELS[n]}:</span>
            <input
              type="number"
              min={0}
              max={100}
              value={threatDistribution[n] ?? 0}
              onChange={(e) => updateDistribution(n, e.target.value)}
              className="w-12 bg-surface border border-border rounded-lg px-1.5 py-1 text-xs text-ink font-mono text-center focus:outline-none focus:border-accent"
            />
            <span className="text-[11px] text-muted">%</span>
          </div>
        ))}

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