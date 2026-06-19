import React, { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Database, Loader2, CheckCircle2, XCircle, Grid3X3, BookOpen, ChevronLeft, ChevronRight, Settings2, AlertTriangle, List, X } from "lucide-react";
import type { Item } from "../types/library";
import type { CombinatorialResult, FailureLog } from "../types/customization";
import SyntheticPreview from "../components/collage/SyntheticPreview";
import { generateCombinations } from "../lib/combinationGenerator";

const ITEMS_PER_PAGE = 20;

export default function CollagePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as
    | { selectedBags?: Item[]; selectedThreats?: Item[]; selectedOthers?: Item[]; densityPreset?: "empty" | "few" | "filled" }
    | undefined;

  // Selections from library (restored from localStorage on refresh)
  const [selectedBags, setSelectedBags] = useState<Item[]>(() => {
    try {
      const saved = localStorage.getItem("selectedBags");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [selectedThreats, setSelectedThreats] = useState<Item[]>(() => {
    try {
      const saved = localStorage.getItem("selectedThreats");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [selectedOthers, setSelectedOthers] = useState<Item[]>(() => {
    try {
      const saved = localStorage.getItem("selectedOthers");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [kValue, setKValue] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("collageKValue");
      return saved ? parseInt(saved) : 20;
    } catch { return 20; }
  });

  const [combinations, setCombinations] = useState<CombinatorialResult[]>(() => {
    try {
      const cached = sessionStorage.getItem("collageCombinations");
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [failures, setFailures] = useState<FailureLog[]>(() => {
    try {
      const cached = sessionStorage.getItem("collageFailures");
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [showLogs, setShowLogs] = useState(false);

  const [exportState, setExportState] = useState<{
    status: "idle" | "generating" | "success" | "error";
    message: string;
    datasetId?: string;
    outputDir?: string;
  }>({ status: "idle", message: "" });

  // Whenever new data arrives via location state, persist it
  useEffect(() => {
    if (!locationState || !locationState.selectedBags || locationState.selectedBags.length === 0) {
      return;
    }

    const { selectedBags: bags, selectedThreats: threats, selectedOthers: others } = locationState;

    setSelectedBags(bags);
    setSelectedThreats(threats || []);
    setSelectedOthers(others || []);

    // Persist to localStorage
    try {
      localStorage.setItem("selectedBags", JSON.stringify(bags));
      localStorage.setItem("selectedThreats", JSON.stringify(threats || []));
      localStorage.setItem("selectedOthers", JSON.stringify(others || []));
    } catch (err) {
      console.error("Error saving collage state to localStorage:", err);
    }
  }, [locationState]);

  // Persist combinations and failures to sessionStorage
  useEffect(() => {
    try {
      if (combinations.length > 0) {
        sessionStorage.setItem("collageCombinations", JSON.stringify(combinations));
      }
      if (failures.length > 0) {
        sessionStorage.setItem("collageFailures", JSON.stringify(failures));
      }
    } catch (err) {
      console.error("Error saving to sessionStorage:", err);
    }
  }, [combinations, failures]);

  // Persist K value
  useEffect(() => {
    localStorage.setItem("collageKValue", String(kValue));
  }, [kValue]);

  const handleGenerate = useCallback(async () => {
    if (selectedBags.length === 0) return;

    setIsGenerating(true);
    setGenerationProgress(`Generating ${kValue} combinations...`);

    // Use setTimeout to allow UI to update before blocking
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const density = (localStorage.getItem("densityPreset") as "empty" | "few" | "filled") || "filled";
      const { results, failures: genFailures } = generateCombinations(
        selectedBags,
        selectedThreats,
        selectedOthers,
        kValue,
        density
      );

      setCombinations(results);
      setFailures(genFailures);
      setCurrentPage(0);
      setGenerationProgress(`Generated ${results.length} combinations${results.length < kValue ? ` (only ${results.length} unique placements possible)` : ""}`);
      
      setTimeout(() => setGenerationProgress(""), 3000);
    } catch (err) {
      console.error("Generation error:", err);
      setGenerationProgress("Error generating combinations. Check console for details.");
      setTimeout(() => setGenerationProgress(""), 5000);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedBags, selectedThreats, selectedOthers, kValue]);

  const handleOpenCombination = (comb: CombinatorialResult) => {
    // Store the pre-computed objects in sessionStorage so CustomizationPage can load them
    const storageKey = `xray_workspace_precomputed_${comb.id}`;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(comb.objects));
    } catch (err) {
      console.error("Error saving precomputed objects:", err);
    }

    const queryParams = new URLSearchParams();
    queryParams.set("bagId", comb.bag.id);
    if (comb.threat) queryParams.set("threatId", comb.threat.id);
    if (comb.others.length > 0) {
      queryParams.set("otherIds", comb.others.map((o) => o.id).join(","));
    }
    // Add flag to indicate we have pre-computed objects
    queryParams.set("precomputed", comb.id);

    navigate(`/customize?${queryParams.toString()}`);
  };

  const handleExportDataset = async () => {
    setExportState({ status: "generating", message: "Generating high-resolution PNG scans & YOLO annotations..." });
    try {
      const response = await fetch("http://localhost:8080/api/dataset/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          combinations: combinations.map(c => ({
            id: c.id,
            bag: c.bag,
            threat: c.threat,
            others: c.others
          })),
          resolutionWidth: 800,
          resolutionHeight: 600
        })
      });

      if (!response.ok) {
        throw new Error("Failed to generate dataset");
      }

      const data = await response.json();
      setExportState({
        status: "success",
        message: `Successfully generated ${data.files.length} scans!`,
        datasetId: data.datasetId,
        outputDir: data.outputDir
      });
    } catch (err) {
      console.error(err);
      setExportState({
        status: "error",
        message: "Failed to generate dataset. Please verify backend is running."
      });
    }
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(combinations.length / ITEMS_PER_PAGE));
  const paginatedCombinations = combinations.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  const hasSelections = selectedBags.length > 0;
  const hasFailures = failures.length > 0;

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 animate-fade-in text-sm">
      {/* Header Row */}
      <div className="flex items-end justify-between mb-8 border-l-4 border-accent pl-4">
        <div>
          <h2 className="text-3xl font-bold text-ink tracking-tight">Collage Generator</h2>
          <p className="text-sm text-muted mt-1">
            {selectedBags.length} bag{selectedBags.length !== 1 ? "s" : ""}, {selectedThreats.length} threat{selectedThreats.length !== 1 ? "s" : ""}, {selectedOthers.length} non-threat{selectedOthers.length !== 1 ? "s" : ""} selected
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportDataset}
            disabled={exportState.status === "generating" || combinations.length === 0}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-500 shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export Dataset"
          >
            {exportState.status === "generating" ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Database size={15} />
            )}
          </button>
          <button
            onClick={() => navigate("/library")}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm"
            title="New Collage"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {/* Configuration Bar: K Input + Generate */}
      <div className="mb-6 p-4 bg-panel rounded-2xl border border-border shadow-card flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Settings2 size={16} className="text-muted" />
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">Combinations</span>
        </div>
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor="k-input" className="text-xs text-muted">Generate</label>
            <input
              id="k-input"
              type="number"
              min={1}
              max={10000}
              value={kValue}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                setKValue(Math.max(1, Math.min(10000, val)));
              }}
              className="w-24 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink font-mono text-center focus:outline-none focus:border-accent"
            />
            <span className="text-xs text-muted">unique combinations</span>
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !hasSelections}
            className="px-5 py-2 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isGenerating ? (
              <>
                <Loader2 className="animate-spin" size={15} />
                Generating...
              </>
            ) : (
              <>
                <Settings2 size={15} />
                Generate
              </>
            )}
          </button>
          {generationProgress && (
            <span className="text-xs text-muted animate-pulse">{generationProgress}</span>
          )}
        </div>
      </div>

      {/* Export Status Banner */}
      {exportState.status !== "idle" && (
        <div className={`mb-6 p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 ${
          exportState.status === "generating"
            ? "bg-accent/5 border-accent/20 text-accent animate-pulse"
            : exportState.status === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-rose-50 border-rose-200 text-rose-800"
        }`}>
          <div className="flex items-center gap-3">
            {exportState.status === "generating" && (
              <Loader2 className="animate-spin text-accent" size={24} />
            )}
            {exportState.status === "success" && (
              <CheckCircle2 className="text-emerald-600" size={24} />
            )}
            {exportState.status === "error" && (
              <XCircle className="text-rose-600" size={24} />
            )}
            <div>
              <p className="font-semibold text-sm">{exportState.message}</p>
              {exportState.status === "success" && exportState.outputDir && (
                <p className="text-xs text-emerald-600 font-mono mt-1 select-all">
                  Saved at: {exportState.outputDir}
                </p>
              )}
            </div>
          </div>
          {exportState.status !== "generating" && (
            <button
              onClick={() => setExportState({ status: "idle", message: "" })}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {combinations.length === 0 && failures.length === 0 ? (
        <div className="text-center py-24 bg-panel rounded-2xl border border-border shadow-card">
          <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
            <Grid3X3 size={28} className="text-muted/40" />
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">No scanned bags selected</h3>
          <p className="text-sm text-muted mb-6">
            Please go to the Library page and select bags/objects to generate combinations.
          </p>
          <button
            onClick={() => navigate("/library")}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover transition-all text-sm inline-flex items-center gap-1.5 cursor-pointer"
          >
            <BookOpen size={15} />
            Go to Library
          </button>
        </div>
      ) : (
        <>
          {/* Summary bar with logs toggle */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted">
              {combinations.length > 0
                ? `Showing ${currentPage * ITEMS_PER_PAGE + 1}–${Math.min((currentPage + 1) * ITEMS_PER_PAGE, combinations.length)} of ${combinations.length} combinations`
                : "0 combinations generated"}
              {failures.length > 0 && (
                <span className="ml-2 text-rose-600 font-medium">
                  · {failures.length} failure{failures.length !== 1 ? "s" : ""}
                </span>
              )}
            </p>
            {failures.length > 0 && (
              <button
                onClick={() => setShowLogs(!showLogs)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  showLogs
                    ? "bg-rose-50 border-rose-200 text-rose-700"
                    : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                }`}
              >
                {showLogs ? <X size={14} /> : <AlertTriangle size={14} />}
                {showLogs ? "Hide Logs" : `${failures.length} Issue${failures.length !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>

          {/* Logs Panel */}
          {showLogs && failures.length > 0 && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl shadow-card">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-rose-600" />
                <h3 className="text-sm font-semibold text-rose-800">Generation Issues</h3>
                <span className="text-xs text-rose-500 ml-1">({failures.length} total)</span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {failures.map((f, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-white rounded-xl border border-rose-100 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-rose-800">
                        {f.bagName} ← {f.threatName}
                      </span>
                      <span className="text-rose-500 font-mono">
                        {f.actual}/{f.expected}
                      </span>
                    </div>
                    <p className="text-rose-600 leading-relaxed">{f.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Combination Grid */}
          {combinations.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {paginatedCombinations.map((comb) => (
                  <button
                    key={comb.id}
                    onClick={() => handleOpenCombination(comb)}
                    className="bg-panel rounded-2xl border border-border p-4 shadow-card hover:shadow-card-hover hover:border-accent/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden group text-left w-full"
                  >
                    <SyntheticPreview
                      objects={comb.objects}
                      bagName={comb.bag.name}
                      threatName={comb.threat?.name}
                      othersCount={comb.others.length}
                    />
                  </button>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-2 rounded-xl border border-border bg-panel hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft size={16} className="text-muted" />
                  </button>
                  
                  {Array.from({ length: totalPages }, (_, i) => i).map((page) => {
                    const showPage = page === 0 || page === totalPages - 1 || 
                      Math.abs(page - currentPage) <= 1;
                    const showEllipsis = page === currentPage - 2 || page === currentPage + 2;
                    
                    if (!showPage && !showEllipsis) return null;
                    if (!showPage && showEllipsis) {
                      return <span key={page} className="text-muted text-xs px-1">...</span>;
                    }
                    
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-[36px] h-9 rounded-xl text-sm font-medium transition-all ${
                          page === currentPage
                            ? "bg-accent text-white shadow-btn"
                            : "border border-border bg-panel text-muted hover:bg-surface hover:text-ink"
                        }`}
                      >
                        {page + 1}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="p-2 rounded-xl border border-border bg-panel hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight size={16} className="text-muted" />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}