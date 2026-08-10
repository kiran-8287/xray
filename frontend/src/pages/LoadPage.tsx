/** LoadPage — upload annotation files, analyze library availability, render and export combinations. */

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, AlertCircle, X, Play, RefreshCw, Download, Save, Image as ImageIcon, Check,
} from "lucide-react";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS } from "../lib/fetchWithTimeout";
import ConfirmModal from "../components/common/ConfirmModal";
import ExportLocationSelector, { ExportLocationSelectorHandle } from "../components/common/ExportLocationSelector";

const API_BASE = API_BASE_URL;
const PAGE_SIZE = 100;

type Toast = { id: string; type: "success" | "error" | "info"; message: string };
type Combination = { layoutId: string; layoutName: string; objects: Record<string, any>; missingObjectIds: string[]; allPresent: boolean };
type AnalysisResult = { totalCombinations: number; validCombinations: number; invalidCombinations: number; totalUniqueObjects: number; presentObjects: number; missingObjects: number; missingObjectIds: string[]; combinations: Combination[] };
type PaginationInfo = { page: number; limit: number; total: number; totalPages: number };

export default function LoadPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportJobIdRef = useRef<string | null>(null);
  const exportLocationRef = useRef<ExportLocationSelectorHandle>(null);

  const [phase, setPhase] = useState<"upload" | "analyzing" | "report" | "generating" | "results">("upload");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [libraryItemIds, setLibraryItemIds] = useState<Set<string>>(new Set());
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [reportAction, setReportAction] = useState<"upload-missing" | "continue" | null>(null);

  const [validCombinations, setValidCombinations] = useState<Combination[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "selected" | "individual" | null>(null);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [renderingPreviews, setRenderingPreviews] = useState<Set<string>>(new Set());
  const [showHighRes, setShowHighRes] = useState<{ combo: Combination; url: string } | null>(null);
  const [showSaveOptions, setShowSaveOptions] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<{ type: "all" | "selected" | "individual"; combo?: Combination } | null>(null);
  const [exportsPathConfigured, setExportsPathConfigured] = useState(false);
  const [exportsPath, setExportsPath] = useState("");

  const showToast = (type: Toast["type"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };
/** Load library item IDs for fast checking (with fallback to paginated /api/items/categorized) */
  useEffect(() => {
    const loadLibraryIds = async () => {
      const ids = new Set<string>();
      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/items/ids`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.ids)) { data.ids.forEach((id: string) => ids.add(id)); }
        }
      } catch (err) { console.warn("items/ids unavailable, using categorized fallback:", err); }

      // Fallback: paginate through /api/items/categorized (max 500/page) to collect all item IDs
      if (ids.size === 0) {
        try {
          let page = 1;
          let totalPages = 1;
          do {
            const res = await fetchWithTimeout(`${API_BASE}/api/items/categorized?page=${page}&limit=500`);
            const data = await res.json();
            if (!data.ok || !data.categorized) break;
            for (const cat of Object.values(data.categorized) as any) {
              for (const subs of Object.values(cat) as any) {
                for (const item of subs) { if (item?.id) ids.add(item.id); }
              }
            }
            totalPages = data.pagination?.totalPages || 1;
            page += 1;
          } while (page <= totalPages);
        } catch (fallbackErr) { console.error("Failed to load library via fallback:", fallbackErr); }
      }

      setLibraryItemIds(ids);
      if (ids.size === 0) { showToast("error", "Failed to load library items. Please refresh."); }
      else { console.log(`Loaded ${ids.size} library item IDs`); }
    };
    loadLibraryIds();
  }, []);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".json"));
    if (arr.length === 0) { showToast("error", "Please select JSON annotation files."); return; }
    setUploadedFiles(arr);
  };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); handleFilesSelected(e.dataTransfer.files); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };

  /** Parse annotation files, check every object against the library, build analysis report. */
  const analyzeAnnotations = useCallback(async () => {
    if (uploadedFiles.length === 0) { showToast("error", "Please upload annotation files first."); return; }
    setPhase("analyzing"); showToast("info", "Analyzing annotations...");
    try {
      const allCombinations: Combination[] = [];
      const allObjectIds = new Set<string>();
      const missingObjectIds = new Set<string>();
      let validCount = 0, invalidCount = 0;
      for (const file of uploadedFiles) {
        const text = await file.text();
        try {
          const data = JSON.parse(text);
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const objects = item.objects || {};
            const objectIds: string[] = [];
            if (objects.bag?.id) objectIds.push(objects.bag.id);
            if (Array.isArray(objects.threats)) { for (const t of objects.threats) { if (t.id) objectIds.push(t.id); } }
            if (Array.isArray(objects["non-threats"])) { for (const nt of objects["non-threats"]) { if (nt.id) objectIds.push(nt.id); } }
            const combo: Combination = {
              layoutId: item.layoutId || `${file.name}_${allCombinations.length}`,
              layoutName: item.layoutName || item.layoutId || file.name,
              objects, missingObjectIds: [], allPresent: true,
            };
            for (const oid of objectIds) {
              allObjectIds.add(oid);
              if (!libraryItemIds.has(oid)) { combo.missingObjectIds.push(oid); missingObjectIds.add(oid); }
            }
            if (combo.missingObjectIds.length > 0) { combo.allPresent = false; invalidCount++; } else { validCount++; }
            allCombinations.push(combo);
          }
        } catch (err) { console.error(`Failed to parse ${file.name}:`, err); }
      }
      const result: AnalysisResult = {
        totalCombinations: allCombinations.length, validCombinations: validCount, invalidCombinations: invalidCount,
        totalUniqueObjects: allObjectIds.size, presentObjects: allObjectIds.size - missingObjectIds.size,
        missingObjects: missingObjectIds.size, missingObjectIds: Array.from(missingObjectIds), combinations: allCombinations,
      };
      setAnalysis(result); setPhase("report");
      showToast("success", `Analysis complete: ${validCount} valid, ${invalidCount} with missing objects`);
    } catch (err) {
      console.error("Analysis error:", err); showToast("error", "Failed to analyze annotations."); setPhase("upload");
    }
  }, [uploadedFiles, libraryItemIds, showToast]);

  const handleReportAction = (action: "upload-missing" | "continue") => {
    setReportAction(action);
    if (action === "upload-missing") { navigate("/upload"); } else {
      const validCombos = analysis?.combinations.filter((c) => c.allPresent) || [];
      setValidCombinations(validCombos); setPage(1); setSelectedForExport(new Set()); setPhase("generating");
      showToast("info", `Generating images for ${validCombos.length} valid combinations...`);
      generatePreviews(validCombos.slice(0, PAGE_SIZE));
    }
  };
/** Generate preview thumbnail for a set of combinations via /api/render-preview */
  const generatePreviews = async (combos: Combination[]) => {
    const newRendering = new Set(renderingPreviews);
    const newUrls: Record<string, string> = { ...previewUrls };
    for (const combo of combos) {
      if (newRendering.has(combo.layoutId) || newUrls[combo.layoutId]) continue;
      newRendering.add(combo.layoutId);
    }
    setRenderingPreviews(newRendering);
    for (const combo of combos) {
      if (newUrls[combo.layoutId]) continue;
      try {
        // /api/render-preview expects the nested { bag, threats, non-threats } format
        const objects = combo.objects || {};
        if (!objects.bag && !Array.isArray(objects.threats) && !Array.isArray(objects["non-threats"])) continue;
        const res = await fetchWithTimeout(
          `${API_BASE}/api/render-preview`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objects }) },
          LONG_REQUEST_TIMEOUT_MS
        );
        const data = await res.json();
        if (data.image) { newUrls[combo.layoutId] = `data:image/png;base64,${data.image}`; }
      } catch (err) { console.error(`Failed to render preview for ${combo.layoutId}:`, err); }
    }
    setPreviewUrls(newUrls);
    setRenderingPreviews(new Set());
  };

  /** Pagination */
  useEffect(() => {
    if (phase !== "results" || validCombinations.length === 0) return;
    const totalPages = Math.max(1, Math.ceil(validCombinations.length / PAGE_SIZE));
    setPagination({ page, limit: PAGE_SIZE, total: validCombinations.length, totalPages });
  }, [phase, validCombinations.length, page]);

  const currentPageCombos = useMemo(() => {
    if (!pagination) return [];
    const start = (page - 1) * PAGE_SIZE;
    return validCombinations.slice(start, start + PAGE_SIZE);
  }, [validCombinations, page, pagination]);

  /** Generate previews for new page when it changes */
  useEffect(() => { if ((phase === "results" || phase === "generating") && currentPageCombos.length > 0) { generatePreviews(currentPageCombos); } }, [phase, page, validCombinations.length]);

  /** Move from "generating" to "results" once first batch of previews are requested */
  useEffect(() => {
    if (phase === "generating" && validCombinations.length > 0) {
      const t = setTimeout(() => setPhase("results"), 800);
      return () => clearTimeout(t);
    }
  }, [phase, validCombinations.length]);
 

/** Export combinations to exports folder (high + low resolution images) */
  const exportCombinations = async (combos: Combination[], mode: "all" | "selected" | "individual") => {
    if (!exportsPathConfigured) { setShowSaveOptions(false); exportLocationRef.current?.open(); return; }
    if (exporting || combos.length === 0) return;
    setExporting(true);
    setExportMode(mode);
    setExportProgress({ done: 0, total: combos.length });
    const jobId = `load_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    exportJobIdRef.current = jobId;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const apiKey = localStorage.getItem("apiKey");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["X-API-Key"] = apiKey;
      const res = await fetchWithTimeout(`${API_BASE}/api/load/export-combinations?jobId=${encodeURIComponent(jobId)}`, { method: "POST", headers, body: JSON.stringify({ combinations: combos, scope: 'load' }), signal: controller.signal }, LONG_REQUEST_TIMEOUT_MS);
      const data = await res.json();
      if (data.ok) {
        const fileCountMsg = data.summary?.fileCount ? ` (${data.summary.fileCount.high} high, ${data.summary.fileCount.low} low)` : "";
        showToast("success", `Exported ${data.summary?.success || combos.length} combination(s)${fileCountMsg}`);
        showToast("info", `Saved to: ${exportsPath || "default exports folder"}`);
      } else { throw new Error(data.error || "Export failed"); }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") { showToast("info", "Export stopped."); }
      else { showToast("error", `Export failed: ${err instanceof Error ? err.message : String(err)}`); }
    } finally {
      exportAbortRef.current = null;
      exportJobIdRef.current = null;
      setExporting(false);
      setExportMode(null);
      setExportProgress(null);
    }
  };

  const stopExport = () => {
    if (exportJobIdRef.current) { fetch(`${API_BASE}/api/load/export-combinations/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: exportJobIdRef.current }) }).catch(() => {}); }
    exportAbortRef.current?.abort();
  };

  const handleSaveAll = () => { if (validCombinations.length === 0) return; setPendingSaveAction({ type: "all" }); setShowSaveOptions(true); };
  const handleSaveSelected = () => { if (selectedForExport.size === 0) { showToast("error", "No combinations selected"); return; } setPendingSaveAction({ type: "selected" }); setShowSaveOptions(true); };
  const handleSaveIndividual = (combo: Combination) => { setPendingSaveAction({ type: "individual", combo }); setShowSaveOptions(true); };

  const confirmSave = () => {
    if (!pendingSaveAction) return;
    setShowSaveOptions(false);
    let combosToExport: Combination[] = [];
    if (pendingSaveAction.type === "all") { combosToExport = validCombinations; }
    else if (pendingSaveAction.type === "selected") { combosToExport = validCombinations.filter((c) => selectedForExport.has(c.layoutId)); }
    else if (pendingSaveAction.type === "individual" && pendingSaveAction.combo) { combosToExport = [pendingSaveAction.combo]; }
    const type = pendingSaveAction.type;
    setPendingSaveAction(null);
    if (combosToExport.length > 0) { exportCombinations(combosToExport, type); }
  };

  const cancelSave = () => { setShowSaveOptions(false); setPendingSaveAction(null); };

  const toggleSelect = (layoutId: string) => {
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (next.has(layoutId)) next.delete(layoutId); else next.add(layoutId);
      return next;
    });
  };

  const goToPage = (p: number) => { if (!pagination) return; const clamped = Math.min(Math.max(1, p), pagination.totalPages); setPage(clamped); };

  const handleReset = () => {
    setPhase("upload"); setAnalysis(null); setValidCombinations([]); setPage(1);
    setSelectedForExport(new Set()); setPreviewUrls({}); setShowHighRes(null); setPagination(null);
  };
return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-panel border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink font-heading">Load Annotations</h1>
            <p className="text-sm text-muted mt-1">Upload annotation files, check library availability, and generate combination images.</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportLocationSelector
              ref={exportLocationRef}
              scope="load"
              autoOpen
              onConfigLoaded={(p, configured) => { setExportsPath(p ?? ""); setExportsPathConfigured(configured); }}
              onPathSaved={(p, configured) => {
                setExportsPath(p ?? "");
                setExportsPathConfigured(configured);
                showToast(configured && p ? "success" : "info", configured && p ? `Export location saved: ${p}` : "Using the default export folder.");
              }}
            />
            {phase !== "upload" && (
              <button onClick={handleReset} className="px-4 py-2 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface transition-colors">
                <RefreshCw size={16} className="inline mr-1.5" /> New Upload
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Toasts */}
        {toasts.length > 0 && (
          <div className="fixed bottom-6 right-6 z-50 space-y-2">
            {toasts.map((t) => (
              <div key={t.id} className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up ${t.type === "success" ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : t.type === "error" ? "bg-rose-50 border border-rose-200 text-rose-800" : "bg-blue-50 border border-blue-200 text-blue-800"}`}>
                {t.type === "success" && <CheckCircle2 size={16} className="inline mr-1.5" />}
                {t.type === "error" && <AlertCircle size={16} className="inline mr-1.5" />}
                {t.type === "info" && <AlertTriangle size={16} className="inline mr-1.5" />}
                {t.message}
              </div>
            ))}
          </div>
        )}

        {/* Phase: Upload */}
        {phase === "upload" && (
          <div className="max-w-2xl mx-auto">
            <div onDrop={handleDrop} onDragOver={handleDragOver} onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-border rounded-2xl p-12 text-center cursor-pointer hover:border-accent hover:bg-white transition-all">
              <Upload size={48} className="mx-auto text-muted mb-4" />
              <h3 className="text-lg font-semibold text-ink mb-2">Upload Annotation Files</h3>
              <p className="text-sm text-muted mb-4">Drop JSON annotation files here, or click to browse.<br />Each file should contain combinations with objects.</p>
              <input ref={fileInputRef} type="file" accept=".json" multiple onChange={(e) => handleFilesSelected(e.target.files)} className="hidden" />
              <button className="px-6 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors">Choose Files</button>
            </div>
            {uploadedFiles.length > 0 && (
              <div className="mt-6 bg-white rounded-xl border border-border p-4">
                <h4 className="text-sm font-semibold text-ink mb-2">Selected Files ({uploadedFiles.length})</h4>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {uploadedFiles.map((f, i) => (<div key={i} className="text-xs text-muted font-mono">{f.name}</div>))}
                </div>
                <button onClick={analyzeAnnotations} className="mt-4 w-full px-6 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                  <Play size={16} /> Analyze Annotations
                </button>
              </div>
            )}
          </div>
        )}

        {/* Phase: Analyzing */}
        {phase === "analyzing" && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={48} className="animate-spin text-accent mb-4" />
            <p className="text-lg font-semibold text-ink">Analyzing annotations...</p>
            <p className="text-sm text-muted mt-1">Checking objects against library</p>
          </div>
        )}
{/* Phase: Report */}
        {phase === "report" && analysis && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
              <h2 className="text-xl font-bold text-ink mb-4">Analysis Report</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[10px] text-muted uppercase tracking-wider">Total Combinations</p>
                  <p className="text-2xl font-bold text-ink">{analysis.totalCombinations}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-[10px] text-emerald-600 uppercase tracking-wider">Valid</p>
                  <p className="text-2xl font-bold text-emerald-700">{analysis.validCombinations}</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-[10px] text-rose-600 uppercase tracking-wider">Missing Objects</p>
                  <p className="text-2xl font-bold text-rose-700">{analysis.invalidCombinations}</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[10px] text-muted uppercase tracking-wider">Missing Files</p>
                  <p className="text-2xl font-bold text-ink">{analysis.missingObjects}</p>
                </div>
              </div>

              {analysis.missingObjectIds.length > 0 && (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                      <AlertTriangle size={16} /> Missing Files ({analysis.missingObjectIds.length})
                    </h3>
                    <button onClick={() => setShowMissingOnly(!showMissingOnly)} className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-700 font-medium hover:bg-amber-100 transition-colors">
                      {showMissingOnly ? "Hide" : "Show"} Missing Files
                    </button>
                  </div>
                  {showMissingOnly && (
                    <div className="max-h-60 overflow-auto rounded-lg border border-amber-200 bg-white p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {analysis.missingObjectIds.map((id, i) => (<div key={i} className="text-xs font-mono text-amber-900 py-0.5 truncate" title={id}>{id}</div>))}
                    </div>
                  )}
                </div>
              )}

              <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="text-sm font-semibold text-emerald-800 flex items-center gap-2 mb-1">
                  <CheckCircle2 size={16} /> Present in Library
                </h3>
                <p className="text-xs text-emerald-700">{analysis.presentObjects} unique objects found in library out of {analysis.totalUniqueObjects} total unique objects.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                {analysis.invalidCombinations > 0 && (
                  <button onClick={() => handleReportAction("upload-missing")} className="px-6 py-3 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors flex items-center gap-2">
                    <Upload size={16} /> Upload Missing Files
                  </button>
                )}
                {analysis.validCombinations > 0 && (
                  <button onClick={() => handleReportAction("continue")} className="px-6 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors flex items-center gap-2">
                    <Play size={16} /> Continue with Available Files ({analysis.validCombinations})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Phase: Generating / Results */}
        {(phase === "generating" || phase === "results") && (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">{validCombinations.length} Combinations</span>
                {selectedForExport.size > 0 && (<span className="text-xs text-muted">({selectedForExport.size} selected)</span>)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={handleSaveSelected} disabled={exporting || selectedForExport.size === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {exporting && exportMode === "selected" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Save Selected ({selectedForExport.size})
                </button>
                <button onClick={handleSaveAll} disabled={exporting || validCombinations.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {exporting && exportMode === "all" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Save All
                </button>
                {exporting && (
                  <button onClick={stopExport} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-300 bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors">
                    <X size={16} /> Stop Saving
                  </button>
                )}
              </div>
            </div>

            {exporting && exportProgress && (
              <div className="mb-4 rounded-xl border border-border bg-panel p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-ink flex items-center gap-2"><Loader2 size={16} className="animate-spin text-accent" /> Exporting...</span>
                  <span className="text-xs text-muted">{exportProgress.done}/{exportProgress.total}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-surface overflow-hidden">
                  <div className="h-full bg-accent transition-all duration-300" style={{ width: `${exportProgress.total > 0 ? (exportProgress.done / exportProgress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {currentPageCombos.map((combo) => (
                <div key={combo.layoutId} className={`bg-white rounded-xl border-2 shadow-sm overflow-hidden transition-all ${selectedForExport.has(combo.layoutId) ? "border-accent ring-2 ring-accent/20" : "border-border hover:border-accent/50"}`}>
                  <div className="relative aspect-[4/3] bg-surface cursor-pointer" onClick={() => { if (previewUrls[combo.layoutId]) { setShowHighRes({ combo, url: previewUrls[combo.layoutId] }); } }}>
                    {previewUrls[combo.layoutId] ? (<img src={previewUrls[combo.layoutId]} alt={combo.layoutName} className="w-full h-full object-contain" />)
                      : renderingPreviews.has(combo.layoutId) ? (<div className="flex items-center justify-center h-full"><Loader2 size={24} className="animate-spin text-muted" /></div>)
                      : (<div className="flex items-center justify-center h-full"><ImageIcon size={32} className="text-muted/40" /></div>)}
                    {selectedForExport.has(combo.layoutId) && (<div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-accent flex items-center justify-center"><Check size={14} className="text-white" /></div>)}
                  </div>
                  <div className="p-3">
                    <h4 className="text-sm font-semibold text-ink truncate mb-1" title={combo.layoutName}>{combo.layoutName}</h4>
                    <p className="text-[10px] text-muted font-mono mb-2">{combo.layoutId}</p>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => toggleSelect(combo.layoutId)} className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedForExport.has(combo.layoutId) ? "bg-accent text-white" : "bg-surface border border-border text-ink hover:bg-gray-100"}`}>
                        {selectedForExport.has(combo.layoutId) ? "Selected" : "Select"}
                      </button>
                      <button onClick={() => handleSaveIndividual(combo)} disabled={exporting} className="px-2 py-1.5 rounded-lg border border-border bg-white text-xs font-medium text-ink hover:bg-surface transition-colors disabled:opacity-50" title="Save this combination">
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between gap-3">
                <p className="text-sm text-muted">Showing {((pagination.page - 1) * pagination.limit) + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => goToPage(page - 1)} disabled={pagination.page <= 1} className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40">Prev</button>
                  <div className="flex items-center gap-1.5">
                    <span className="hidden sm:inline text-sm text-muted whitespace-nowrap">Page</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={String(page)} onChange={(e) => { const val = e.target.value.replace(/\D/g, ""); if (val) goToPage(parseInt(val, 10)); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const val = (e.target as HTMLInputElement).value.replace(/\D/g, ""); if (val) goToPage(parseInt(val, 10)); } }} className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-center text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-40" />
                    <span className="text-sm text-muted">/ {pagination.totalPages}</span>
                  </div>
                  <button onClick={() => goToPage(page + 1)} disabled={pagination.page >= pagination.totalPages} className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
{/* High-res preview modal */}
      {showHighRes && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={() => setShowHighRes(null)}>
          <div className="relative max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
            <button onClick={() => setShowHighRes(null)} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"><X size={20} /></button>
            <img src={showHighRes.url} alt={showHighRes.combo.layoutName} className="max-w-full max-h-[85vh] object-contain" />
            <div className="p-4 border-t border-border">
              <h3 className="text-sm font-semibold text-ink">{showHighRes.combo.layoutName}</h3>
              <p className="text-xs text-muted font-mono">{showHighRes.combo.layoutId}</p>
            </div>
          </div>
        </div>
      )}

      {/* Save confirmation modal */}
      <ConfirmModal isOpen={showSaveOptions} title="Confirm Export" message={pendingSaveAction?.type === "all" ? `Save all ${validCombinations.length} combinations as high + low resolution images?` : pendingSaveAction?.type === "selected" ? `Save ${selectedForExport.size} selected combinations as high + low resolution images?` : `Save this combination as high + low resolution images?`} confirmLabel="Save" cancelLabel="Cancel" confirmVariant="primary" onConfirm={confirmSave} onCancel={cancelSave} />
    </div>
  );
}