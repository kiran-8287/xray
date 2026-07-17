import React from "react";

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
  maxNonThreats: number;
  setMaxNonThreats: (value: number) => void;
  nonThreatDistribution: Record<number, number>;
  setNonThreatDistribution: (value: Record<number, number>) => void;
  selectedNonThreatCount: number;
  requireAtLeastOneNonThreat: boolean;
  setRequireAtLeastOneNonThreat: (value: boolean) => void;
  isGenerating: boolean;
  generationProgress: string;
  onGenerate: () => void;
  hasCombinations: boolean;
  hasIncompleteSelection: boolean;
  incompleteSelectionMessage: string;
}

const THREAT_LABELS: Record<number, string> = {
  1: "1 threat",
  2: "2 threats",
  3: "3 threats",
  4: "4 threats",
};

const NON_THREAT_LABELS: Record<number, string> = {
  1: "1 non-threat",
  2: "2 non-threats",
  3: "3 non-threats",
  4: "4 non-threats",
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
  maxNonThreats,
  setMaxNonThreats,
  nonThreatDistribution,
  setNonThreatDistribution,
  selectedNonThreatCount,
  requireAtLeastOneNonThreat,
  setRequireAtLeastOneNonThreat,
  isGenerating,
  generationProgress,
  onGenerate,
  hasCombinations,
  hasIncompleteSelection,
  incompleteSelectionMessage,
}: SelectionTrayProps) {
  if (selectedCount === 0) return null;

  const updateThreatDistribution = (key: number, raw: string) => {
    const val = parseInt(raw);
    if (isNaN(val) || val < 0) return;
    setThreatDistribution({ ...threatDistribution, [key]: Math.min(val, 100) });
  };

  const updateNonThreatDistribution = (key: number, raw: string) => {
    const val = parseInt(raw);
    if (isNaN(val) || val < 0) return;
    setNonThreatDistribution({ ...nonThreatDistribution, [key]: Math.min(val, 100) });
  };

  // Calculate total percentages
  const threatDistributionTotal = Object.keys(threatDistribution).reduce((sum, k) => sum + (threatDistribution[parseInt(k)] || 0), 0);
  const nonThreatDistributionTotal = Object.keys(nonThreatDistribution).reduce((sum, k) => sum + (nonThreatDistribution[parseInt(k)] || 0), 0);
  
  // Check if distributions are valid (must total 100% when there are selected items)
  const hasValidThreatDistribution = selectedCount === 0 || threatDistributionTotal === 100;
  const hasValidNonThreatDistribution = selectedCount === 0 || selectedNonThreatCount === 0 || nonThreatDistributionTotal === 100;
  const hasValidDistribution = hasValidThreatDistribution && hasValidNonThreatDistribution;

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
          <div key={`threat-${n}`} className="flex items-center gap-1">
            <span className="text-[11px] text-muted whitespace-nowrap">{THREAT_LABELS[n]}:</span>
            <input
              type="number"
              min={0}
              max={100}
              value={threatDistribution[n] ?? 0}
              onChange={(e) => updateThreatDistribution(n, e.target.value)}
              className="w-12 bg-surface border border-border rounded-lg px-1.5 py-1 text-xs text-ink font-mono text-center focus:outline-none focus:border-accent"
            />
            <span className="text-[11px] text-muted">%</span>
          </div>
        ))}
        <div className={`text-[10px] font-medium ml-1 ${threatDistributionTotal === 100 ? 'text-green-600' : 'text-rose-600'}`}>
          Total: {threatDistributionTotal}%
        </div>

        {/* Non-threat distribution controls - only show when non-threats are selected */}
        {selectedNonThreatCount > 0 && (
          <>
            <div className="w-px h-6 bg-border mx-1" />

            {/* Max non-threats selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted">max</span>
              <select
                value={maxNonThreats}
                onChange={(e) => setMaxNonThreats(parseInt(e.target.value))}
                className="bg-surface border border-border rounded-xl px-2 py-1.5 text-sm text-ink font-mono text-center focus:outline-none focus:border-accent"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
              <span className="text-xs text-muted">non-threats/combo</span>
            </div>

            {/* Percentage inputs for 1..maxNonThreats */}
            {Array.from({ length: maxNonThreats }, (_, i) => i + 1).map((n) => (
              <div key={`non-threat-${n}`} className="flex items-center gap-1">
                <span className="text-[11px] text-muted whitespace-nowrap">{NON_THREAT_LABELS[n]}:</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={nonThreatDistribution[n] ?? 0}
                  onChange={(e) => updateNonThreatDistribution(n, e.target.value)}
                  className="w-12 bg-surface border border-border rounded-lg px-1.5 py-1 text-xs text-ink font-mono text-center focus:outline-none focus:border-accent"
                />
                <span className="text-[11px] text-muted">%</span>
              </div>
            ))}
            <div className={`text-[10px] font-medium ml-1 ${nonThreatDistributionTotal === 100 ? 'text-green-600' : 'text-rose-600'}`}>
              Total: {nonThreatDistributionTotal}%
            </div>

            {/* Include at least one non-threat checkbox */}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={requireAtLeastOneNonThreat}
                onChange={(e) => setRequireAtLeastOneNonThreat(e.target.checked)}
                className="w-3.5 h-3.5 border border-border rounded bg-surface focus:outline-none focus:border-accent"
              />
              <span className="text-[11px] text-muted whitespace-nowrap">Include at least one non-threat</span>
            </label>
          </>
        )}

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
        disabled={selectedCount === 0 || hasIncompleteSelection || !hasValidDistribution || isGenerating}
        title={
          isGenerating ? "Generation in progress..." :
          hasIncompleteSelection ? incompleteSelectionMessage :
          !hasValidDistribution ? "Distribution percentages must total 100%" :
          ""
        }
        className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? "Generating..." : "Generate Collage"}
      </button>
    </div>
  );
}