/** LoadPage — import pixel data + JSONs from a previous system. */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  Play,
  Database,
  FileJson,
  ArrowRight,
  RefreshCw,
  Layers,
} from "lucide-react";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS } from "../lib/fetchWithTimeout";

const API_BASE = API_BASE_URL;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Toast = { id: string; type: "success" | "error" | "info"; message: string };

type MissingObject = { layoutId: string; missing: string[] };
type JsonStats = {
  annotationsFiles: number;
  savedLayoutsFiles: number;
  catalogFiles: number;
  unknownFiles: number;
  errors: { file: string; error: string }[];
};
type UnclassifiedItem = { id: string; category: string | null };

type AnalyzeReport = {
  pixel: {
    total: number;
    newFiles: string[];
    duplicateFiles: string[];
    noLowEnergy: string[];
    highCount: number;
  };
  json: JsonStats;
  items: {
    toAdd: any[];
    duplicates: any[];
    unclassified: UnclassifiedItem[];
  };
  layouts: {
    total: number;
    toAdd: any[];
    duplicates: number;
    collisionRenames: number;
    missingObjects: MissingObject[];
  };
  itemDerivation?: {
    conflicts: number;
    reconciled: Array<{ base: string; from: string[]; to: string; count: number; type?: string }>;
  };
  stats: {
    pixelNew: number;
    pixelDuplicate: number;
    itemsToAdd: number;
    itemsDuplicate: number;
    unclassified: number;
    layoutsToAdd: number;
    layoutsDuplicate: number;
    collisionRenames: number;
    missingLayouts: number;
    subcategoryConflicts?: number;
  };
};

type RunSummary = {
  pixel: { copied: number; skipped: number };
  items: { added: number; skipped: number };
  validRegions: { generated: number; failed: number };
  layouts: { added: number; skipped: number; renamed: number; purged: number };
};

type ProgressState = {
  stage: string;
  message: string;
  done: number;
  total: number;
};

const CATEGORY_OPTIONS = [
  { value: "", label: "— None (leave unclassified) —" },
  { value: "bags", label: "Bags" },
  { value: "threats", label: "Threats" },
  { value: "non-threats", label: "Non-threats" },
];

/** Warn when selected files exceed this count to prevent browser/memory issues */
const LARGE_IMPORT_WARNING_THRESHOLD = 10_000;
const LARGE_IMPORT_ERROR_THRESHOLD = 100_000;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const apiKey = localStorage.getItem("apiKey");
  if (apiKey) headers["X-API-Key"] = apiKey;
  return headers;
}

/** Split the files selected from a folder/file picker into energy + json buckets. */
type FileBuckets = {
  high: File[];
  low: File[];
  catalog: File[];
  annotation: File[];
  layout: File[];
  other: File[];
  json: File[];
};

/** Match the backend detectJsonType() filename heuristics so the UI classifies
 *  the catalog (bags/threats/non-threats) separately from annotations and
 *  saved-layouts partitions. */
function classifyJsonFileName(relPath: string): "catalog" | "annotation" | "savedLayouts" | "unknown" {
  const n = String(relPath).toLowerCase();
  const base = (n.split("/").pop() || "").split("\\").pop() || n;
  if (/^(bags?)[_-]?\d*\.json$/.test(base)) return "catalog";
  if (/^(threats?)[_-]?\d*\.json$/.test(base)) return "catalog";
  if (/^non[_-]?threats?[_-]?\d*\.json$/.test(base)) return "catalog";
  if (/^savedlayouts?[_-]?\d*\.json$/.test(base)) return "savedLayouts";
  if (/^annotations?[_-]?\d*\.json$/.test(base)) return "annotation";
  return "unknown";
}

function bucketFiles(files: File[]): FileBuckets {
  const high: File[] = [];
  const low: File[] = [];
  const catalog: File[] = [];
  const annotation: File[] = [];
  const layout: File[] = [];
  const other: File[] = [];
  const json: File[] = [];
  for (const f of files) {
    const rel = (f as any).webkitRelativePath || f.name;
    const lower = rel.toLowerCase();
    if (lower.endsWith(".npz")) {
      if (/(^|\/)lowenergy\//.test(lower)) low.push(f);
      else high.push(f);
    } else if (lower.endsWith(".json")) {
      json.push(f);
      const kind = classifyJsonFileName(rel);
      if (kind === "catalog") catalog.push(f);
      else if (kind === "annotation") annotation.push(f);
      else if (kind === "savedLayouts") layout.push(f);
      else other.push(f);
    }
  }
  return { high, low, catalog, annotation, layout, other, json };
}

/* ------------------------------------------------------------------ */
/* Progress banner helper                                              */
/* ------------------------------------------------------------------ */

const STAGE_LABELS: Record<string, string> = {
  start: "Starting",
  pixel: "Copying pixel data",
  items: "Registering library items",
  "valid-region": "Generating valid regions",
  layouts: "Importing saved layouts",
  analyze: "Analyzing",
};

export default function LoadPage() {
  /* ---- Input mode & file selection ---- */
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  /* ---- Analysis & gating ---- */
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<AnalyzeReport | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string>("");
  const [skipMissing, setSkipMissing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [massCategory, setMassCategory] = useState("");
  const [importWarning, setImportWarning] = useState<string | null>(null);

  /* Apply the chosen mass-assign category to every unclassified pixel file. */
  const applyMassCategory = () => {
    if (!report || !massCategory) return;
    setOverrides((prev) => {
      const next = { ...prev };
      for (const u of report.items.unclassified) next[u.id] = massCategory;
      return next;
    });
    showToast("info", `Assigned "${CATEGORY_OPTIONS.find((o) => o.value === massCategory)?.label ?? massCategory}" to all ${report.items.unclassified.length} unclassified file(s).`);
  };

  /* ---- Run / progress ---- */
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ---- Toasts ---- */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = (type: Toast["type"], message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  /* ---- Navigation ---- */
  const navigate = useNavigate();

  /* ---- Cleanup aborts on unmount ---- */
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

    const wheel = useMemo(() => {
    if (!selectedFiles.length) return { r: 0, l: 0, c: 0, a: 0, o: 0 };
    const b = bucketFiles(selectedFiles);
    return {
      r: b.high.length,
      l: b.low.length,
      c: b.catalog.length,
      a: b.annotation.length,
      o: b.layout.length + b.other.length,
    };
  }, [selectedFiles]);

  /* ------------------------------------------------------------------ */
  /* Analysis (pre-flight)                                               */
  /* ------------------------------------------------------------------ */
  const handleAnalyze = async () => {
    setAnalyzeError(null);
    setReport(null);
    setSummary(null);
    setRunError(null);

    if (selectedFiles.length === 0) {
      setAnalyzeError("Please select a folder containing .npz pixel data and .json annotation files.");
      return;
    }

    const newRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setRunId(newRunId);
    setAnalyzing(true);

    try {
      const body = new FormData();
      body.append("runId", newRunId);
      const b = bucketFiles(selectedFiles);
      for (const f of b.high) body.append("pixelFiles", f, f.name);
      for (const f of b.low) body.append("pixelFilesLow", f, f.name);
      for (const f of b.json) body.append("jsonFiles", f, f.name);

      setProgress({ stage: "analyze", message: "Uploading & analyzing inputs…", done: 0, total: 1 });

      const res = await fetchWithTimeout(`${API_BASE}/api/import/analyze`, {
        method: "POST",
        headers: apiHeaders(),
        body,
      }, LONG_REQUEST_TIMEOUT_MS, 0);

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 401) throw new Error("Authentication required. Configure your API key first.");
        throw new Error(data?.error || `Analysis failed (HTTP ${res.status})`);
      }

      // Read NDJSON stream for progress updates
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let finalReport: AnalyzeReport | null = null;
      let buffer = ''; // Buffer for incomplete lines across chunks

      if (!reader) {
        throw new Error("No response stream available");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Add chunk to buffer (handles incomplete lines split across chunks)
        buffer += decoder.decode(value, { stream: true });
        
        // Split by newlines
        const lines = buffer.split('\n');
        
        // Keep last element if buffer doesn't end with newline (incomplete line)
        if (!buffer.endsWith('\n')) {
          buffer = lines.pop() || '';
        } else {
          buffer = '';
        }

        for (const line of lines) {
          if (!line.trim()) continue; // Skip empty lines
          
          try {
            const data = JSON.parse(line);
            if (data.stage === 'start') {
              setProgress({ stage: 'analyze', message: data.message || 'Starting analysis…', done: 0, total: 1 });
            } else if (data.stage === 'analyze') {
              setProgress({ stage: 'analyze', message: data.message || 'Analyzing…', done: data.done || 0, total: 1 });
            } else if (data.stage === 'done' && data.report) {
              finalReport = data.report;
            } else if (data.stage === 'error') {
              throw new Error(data.message || 'Analysis failed');
            }
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      }
      
      // Try to parse any remaining data in buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.stage === 'done' && data.report) {
            finalReport = data.report;
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!finalReport) {
        throw new Error("No analysis report received");
      }

      const r: AnalyzeReport = {
        pixel: { total: 0, newFiles: [], duplicateFiles: [], noLowEnergy: [], highCount: 0, ...finalReport.pixel },
        json: finalReport.json || { annotationsFiles: 0, savedLayoutsFiles: 0, catalogFiles: 0, unknownFiles: 0, errors: [] },
        items: { toAdd: [], duplicates: [], unclassified: [], ...finalReport.items },
        layouts: { total: 0, toAdd: [], duplicates: 0, collisionRenames: 0, missingObjects: [], ...finalReport.layouts },
        itemDerivation: finalReport.itemDerivation || { conflicts: 0, reconciled: [] },
        stats: { subcategoryConflicts: 0, ...finalReport.stats },
      };
      r.items.unclassified = (r.items.unclassified || []).map((u: any) => ({
        id: typeof u === "string" ? u : (u && u.id) || u,
        category: (u && u.category) || null,
      }));

      if (r.itemDerivation && r.itemDerivation.conflicts > 0) {
        showToast("info",
          `${r.itemDerivation.conflicts} item(s) had conflicting subcategory labels in the source annotations and were assigned the most common label per bag.`);
      }

      setReport(r);
      setProgress(null);

      if (r.json.errors && r.json.errors.length > 0) {
        showToast("info", `${r.json.errors.length} JSON file(s) could not be parsed — see report.`);
      }
      const recognizedJson =
        (r.json?.catalogFiles || 0) + (r.json?.annotationsFiles || 0) + (r.json?.savedLayoutsFiles || 0);
      if (r.json?.unknownFiles) {
        showToast("info", `${r.json.unknownFiles} JSON file(s) were not recognized as catalog / annotation and were ignored.`);
      }
      if (recognizedJson === 0 && (r.json?.unknownFiles || 0) === 0 && (r.json?.errors || []).length === 0) {
        showToast("info",
          "No annotation or catalog JSON was recognized — only pixel data was found. " +
          "Files without an assigned category will be copied but not listed in the library.");
      }
      if (r.layouts.missingObjects.length > 0) {
        showToast("error", `Analysis found ${r.layouts.missingObjects.length} layout(s) with missing objects.`);
      } else if (r.items.toAdd.length === 0 && r.layouts.toAdd.length === 0) {
        showToast("info", "Everything in the upload already exists — nothing new to import.");
      } else {
        // Show warning for very large imports
        const totalNew = r.items.toAdd.length + r.layouts.toAdd.length;
        if (totalNew > 50000) {
          showToast("warning", 
            `Large import: ${totalNew.toLocaleString()} new items/layouts. This may take 30+ minutes. ` +
            `Please keep this page open and don't navigate away. Consider importing in smaller batches if you experience issues.`);
        } else {
          showToast("success", "Analysis complete — no blocking issues.");
        }
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "Unknown error";
      setAnalyzeError(m);
      showToast("error", `Analysis failed: ${m}`);
    } finally {
      setAnalyzing(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Run / import (NDJSON stream)                                        */
  /* ------------------------------------------------------------------ */
  const handleRun = async () => {
    if (!runId) return;
    setRunError(null);
    setSummary(null);
    setRunning(true);
    setProgress({ stage: "start", message: "Starting import…", done: 0, total: 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload: Record<string, unknown> = {
        runId,
        stagedId: runId,
        options: {
          autoValidRegions: true,
          copyPixelData: true,
          skipMissing: !!(skipMissing && report?.layouts.missingObjects.length),
          categoryOverrides: overrides,
        },
      };

      // Calculate timeout based on import size (very large imports need more time)
      const totalToAdd = (report.layouts.toAdd?.length || 0) + (report.items.toAdd?.length || 0);
      const importTimeoutMs = totalToAdd > 50000 ? 60 * 60 * 1000 : // 60 min for 50k+ items
                              totalToAdd > 10000 ? 30 * 60 * 1000 : // 30 min for 10k+ items
                              LONG_REQUEST_TIMEOUT_MS; // 30 min default
      
      console.log(`[Import] Starting import of ${totalToAdd.toLocaleString()} items with ${importTimeoutMs / 1000 / 60}-minute timeout`);
      
      const res = await fetchWithTimeout(`${API_BASE}/api/import/run`, {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
        signal: controller.signal,
      }, importTimeoutMs, 0);

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        if (res.status === 401) throw new Error("Authentication required. Configure your API key first.");
        throw new Error(data?.error || `Import failed (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }
          if (!ev || typeof ev !== "object") continue;

          if (ev.stage === "done") {
            setSummary(ev.summary || null);
            setProgress(null);
            const s = ev.summary;
            if (s) {
              showToast("success",
                `Import complete: +${s.items.added} items, +${s.layouts.added} layouts, ${s.pixel.copied} pixel file(s) copied, ${s.validRegions.generated} valid region(s).`);
            } else {
              showToast("success", "Import complete");
            }
            return;
          }
          if (ev.stage === "error") {
            throw new Error(ev.message || "Import failed");
          }
          if (ev.stage === "cancelled") {
            showToast("info", "Import cancelled.");
            setProgress(null);
            return;
          }
          setProgress({ stage: ev.stage, message: ev.message || "", done: ev.done || 0, total: ev.total || 0 });
        }
      }

      // If the stream ended without a terminal event (done/error/cancelled),
      // surface it instead of silently doing nothing.
      setProgress(null);
      throw new Error("Import stream ended unexpectedly without a completion event. Please check the backend logs.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        showToast("info", "Import stopped.");
      } else {
        const m = err instanceof Error ? err.message : "Unknown error";
        setRunError(m);
        showToast("error", `Import failed: ${m}`);
      }
      setProgress(null);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleCancel = async () => {
    if (runId) {
      try {
        await fetchWithTimeout(`${API_BASE}/api/import/cancel`, {
          method: "POST",
          headers: apiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ jobId: runId }),
        }, 10000).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }
    abortRef.current?.abort();
  };

  /* ------------------------------------------------------------------ */
  /* Reset                                                               */
  /* ------------------------------------------------------------------ */
  const invalidateAnalysis = () => {
    setReport(null);
    setRunId("");
    setSummary(null);
    setRunError(null);
    setOverrides({});
    setMassCategory("");
    setSkipMissing(false);
  };

  const resetAll = () => {
    setSelectedFiles([]);
    setReport(null);
    setRunId("");
    setSummary(null);
    setRunError(null);
    setAnalyzeError(null);
    setOverrides({});
    setMassCategory("");
    setSkipMissing(false);
    setImportWarning(null);
    abortRef.current?.abort();
  };

  /* ------------------------------------------------------------------ */
  /* Derived                                                             */
  /* ------------------------------------------------------------------ */
  const hasMissing = !!(report && report.layouts.missingObjects.length);
  const importBlocked = hasMissing && !skipMissing;
  const progressPct =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  const toastStyles = `
    @keyframes load-slide-down {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-load-slide-down { animation: load-slide-down 0.2s ease-out; }
  `;

  return (
    <div className="p-6">
      {toasts.length > 0 && (
        <>
          <style>{toastStyles}</style>
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
            {toasts.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium animate-load-slide-down"
                style={{
                  backgroundColor: t.type === 'success' ? '#ECFDF5' : t.type === 'error' ? '#FEF2F2' : '#EFF4FF',
                  borderColor: t.type === 'success' ? '#6EE7B7' : t.type === 'error' ? '#FCA5A5' : '#BFDBFE',
                  color: t.type === 'success' ? '#065F46' : t.type === 'error' ? '#991B1B' : '#1E40AF',
                }}
              >
                {t.type === 'success' && <CheckCircle2 size={16} className="text-emerald-600" />}
                {t.type === 'error' && <AlertCircle size={16} className="text-rose-600" />}
                {t.type === 'info' && <AlertTriangle size={16} className="text-blue-600" />}
                {t.message}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="border-l-4 border-accent pl-4">
          <h2 className="text-3xl font-bold text-ink tracking-tight font-heading">Load Data</h2>
          <p className="text-sm text-muted mt-1">
            Import items and layouts from a previous system.
          </p>
        </div>
        <button
          onClick={resetAll}
          disabled={analyzing || running}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={15} />
          Reset
        </button>
      </div>

      {/* Step 1 — inputs */}
      <div className="rounded-2xl border border-border bg-panel p-5 shadow-sm mb-6">
        <label
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface p-10 text-center cursor-pointer hover:border-accent transition-colors"
        >
          <FolderOpen size={36} className="text-muted" />
          <span className="text-lg font-semibold text-ink">Select folder</span>
          <span className="text-sm text-muted max-w-md">
                            Pick the folder with <strong>pixel-data</strong>, <strong>catalog</strong> and <strong>annotations</strong> inside.
          </span>
          <input
            type="file"
            multiple
            {...({ webkitdirectory: "", directory: "" } as any)}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setSelectedFiles(files);
              if (files.length >= LARGE_IMPORT_ERROR_THRESHOLD) {
                setImportWarning(`⚠️ ${files.length.toLocaleString()} files selected exceeds safe limit (${LARGE_IMPORT_ERROR_THRESHOLD.toLocaleString()}). Please split into smaller batches.`);
              } else if (files.length >= LARGE_IMPORT_WARNING_THRESHOLD) {
                setImportWarning(`⚠️ ${files.length.toLocaleString()} files selected. Large imports may take longer and consume significant memory.`);
              } else {
                setImportWarning(null);
              }
              invalidateAnalysis();
            }}
          />
          <span className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold">
            <Upload size={15} /> Select
          </span>
        </label>

        <div className="mt-4 rounded-xl border border-border bg-white p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Expected structure:</p>
          <pre className="text-[11px] text-muted font-mono leading-relaxed whitespace-pre">{`{pixel-data}/highenergy/*.npz
{pixel-data}/lowenergy/*.npz
{catalog}/bags_1.json, threats_1.json, non_threats_1.json
{annotations}/*.json`}</pre>
          <p className="text-[11px] text-muted mt-2">
            .npz, catalog .json, annotation .json and layout .json files are split automatically. Just pick the top folder.
          </p>
        </div>

        {wheel.r > 0 || wheel.l > 0 || wheel.c > 0 || wheel.a > 0 || wheel.o > 0 ? (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <div className="rounded-xl border border-border bg-white p-3 text-sm">
              <span className="font-semibold text-ink">{wheel.r}</span>
              <span className="text-muted ml-1">high-energy .npz</span>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 text-sm">
              <span className="font-semibold text-ink">{wheel.l}</span>
              <span className="text-muted ml-1">low-energy .npz</span>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 text-sm">
              <span className="font-semibold text-ink">{wheel.c}</span>
              <span className="text-muted ml-1">catalog .json</span>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 text-sm">
              <span className="font-semibold text-ink">{wheel.a}</span>
              <span className="text-muted ml-1">annotation .json</span>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 text-sm">
              <span className="font-semibold text-ink">{wheel.o}</span>
              <span className="text-muted ml-1">layout/other .json</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted mt-3">
            If your browser doesn't support folder selection, select the files individually — the page separates
            <span className="font-mono"> lowenergy/</span> .npz, other .npz, catalog .json, annotation .json,
            and layout .json automatically.
          </p>
        )}

        {importWarning && (
          <div className={`mt-4 rounded-xl border p-4 flex items-start gap-2 ${
            selectedFiles.length >= LARGE_IMPORT_ERROR_THRESHOLD
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-amber-300 bg-amber-50 text-amber-800"
          }`}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">{importWarning}</p>
              {selectedFiles.length >= LARGE_IMPORT_ERROR_THRESHOLD && (
                <p className="text-xs mt-1">The Analyze button is disabled. Please select fewer files or split your import into multiple batches.</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={analyzing || running || selectedFiles.length === 0 || selectedFiles.length >= LARGE_IMPORT_ERROR_THRESHOLD}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Play size={15} />}
            {analyzing ? "Analyzing..." : "Analyze"}
          </button>
          {analyzing && progress && <span className="text-xs text-muted">{progress.message}</span>}
        </div>

        {analyzeError && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{analyzeError}</span>
          </div>
        )}
      </div>

      {/* Step 3 — analysis report */}
      {report && (
        <div className="mb-6 rounded-2xl border border-border bg-panel p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Database size={18} className="text-accent" />
            <h3 className="text-lg font-bold text-ink font-heading">Analysis Report</h3>
          </div>

          {/* Missing objects gate */}
          {hasMissing && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={18} className="text-rose-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-rose-700">
                    {report.layouts.missingObjects.length} layout(s) need missing objects.
                  </p>
                  <p className="text-xs text-rose-600 mt-1">
                    Add the objects and re-analyze, or skip them. Skipping removes from this import only.
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 max-h-56 overflow-auto">
                {report.layouts.missingObjects.map((m, i) => (
                  <div key={i} className="rounded-lg border border-rose-200 bg-white p-2.5">
                    <p className="text-xs font-mono text-ink">Layout: <span className="font-semibold">{m.layoutId}</span></p>
                    <p className="text-[11px] text-muted mt-0.5">
                      Missing object id(s): {m.missing.join(", ")}
                    </p>
                  </div>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipMissing}
                  onChange={(e) => setSkipMissing(e.target.checked)}
                  disabled={running}
                  className="w-4 h-4 accent-rose-600"
                />
                <span>
                  <span className="font-semibold">Skip missing files</span>
                  <span className="text-xs text-muted ml-1">(removes the {report.layouts.missingObjects.length} affected layout(s) from this import copy)</span>
                </span>
              </label>
            </div>
          )}

          {/* Summary stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Pixel" value={report.pixel.total} sub={`${report.stats?.pixelNew ?? 0} new`} />
            <Stat label="Items" value={report.stats?.itemsToAdd ?? 0} tone={report.stats?.itemsToAdd ? "ok" : "flat"} sub={`${report.stats?.itemsDuplicate ?? 0} skip`} />
            <Stat label="Dupes" value={(report.stats?.itemsDuplicate ?? 0) + (report.stats?.pixelDuplicate ?? 0)} tone="flat" />
            <Stat label="Layouts" value={report.stats?.layoutsToAdd ?? 0} tone={report.stats?.layoutsToAdd ? "ok" : "flat"} sub={`${report.stats?.layoutsDuplicate ?? 0} skip`} />
          </div>

          {report.json && (
            <div className="mb-3 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-semibold">JSON:</span>
              <span className="font-mono">{report.json.catalogFiles ?? 0} catalog</span>
              <span className="font-mono">{report.json.annotationsFiles ?? 0} annotation</span>
              <span className="font-mono">{report.json.savedLayoutsFiles ?? 0} layout</span>
              <span className="font-mono">{(report.json.errors || []).length} errors</span>
            </div>
          )}

          {report.pixel.noLowEnergy && report.pixel.noLowEnergy.length > 0 && (
            <div className="mb-3 text-xs text-amber-700">
              <AlertTriangle size={13} className="inline mr-1 -mt-0.5" />
              {report.pixel.noLowEnergy.length} file(s) missing low-energy partner.
            </div>
          )}

          {report.json && report.json.errors.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1.5">Skipped files:</p>
              <ul className="space-y-1">
                {report.json.errors.map((e, i) => (
                  <li key={i} className="text-[11px] text-amber-700 font-mono">{e.file}: {e.error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="rounded-xl border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={15} className="text-accent" />
                <span className="text-sm font-semibold text-ink">Library items</span>
              </div>
              <ul className="space-y-1 text-sm text-ink">
                <li className="text-muted text-xs">
                  +{report.stats?.itemsToAdd ?? 0} new item(s) · {report.stats?.itemsDuplicate ?? 0} existing (skipped, never re-created)
                </li>
                {report.items.toAdd.length > 0 && (
                  <li className="mt-1">
                    <span className="text-xs font-semibold text-muted">to add:</span>
                    <span className="text-xs text-muted break-words">
                      {" "}{report.items.toAdd.slice(0, 30).map((i: any) => i?.id ?? i).join(", ")}
                      {report.items.toAdd.length > 30 ? ` +${report.items.toAdd.length - 30} more` : ""}
                    </span>
                  </li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileJson size={15} className="text-accent" />
                <span className="text-sm font-semibold text-ink">Saved combinations</span>
              </div>
              <ul className="space-y-1 text-sm text-ink">
                <li className="text-muted text-xs">
                  {report.layouts.total} found · +{report.stats?.layoutsToAdd ?? 0} to add · {report.stats?.layoutsDuplicate ?? 0} duplicate(s)
                </li>
                <li className="text-muted text-xs">
                  {report.stats?.collisionRenames ?? 0} same id, different content (fresh id)
                </li>
                {report.stats?.missingLayouts ? (
                  <li className="text-rose-600 text-xs font-semibold">
                    {report.stats.missingLayouts} blocked — missing objects
                  </li>
                ) : null}
              </ul>
            </div>
          </div>

          {report.items.unclassified.length > 0 && (
            <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={18} className="text-amber-600" />
                <span className="text-sm font-bold text-amber-900">
                  {report.items.unclassified.length} pixel file(s) have no category
                </span>
              </div>
              <p className="text-xs text-amber-700 mb-3">
                These files were not tagged in the original system. Choose a category below and click Apply to assign them all at once, or expand Assign individually to set them one by one. Leaving the dropdown on None copies the pixel files to storage but they will not appear in the library.
              </p>

              {/* Mass assign — single dropdown for all unclassified items */}
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2.5">
                <span className="text-xs font-bold text-amber-900 whitespace-nowrap uppercase tracking-wide">Mass Assign All:</span>
                <select
                  value={massCategory}
                  onChange={(e) => setMassCategory(e.target.value)}
                  disabled={running}
                  className="w-48 p-2 border-2 border-amber-200 rounded-lg text-xs bg-white font-medium focus:outline-none focus:border-accent"
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={applyMassCategory}
                  disabled={running || !massCategory}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-accent text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors shadow-sm"
                >
                  <Layers size={14} />
                  {massCategory
                    ? <>Apply {CATEGORY_OPTIONS.find((o) => o.value === massCategory)?.label ?? massCategory} to all {report.items.unclassified.length} file(s)</>
                    : <>Select a category above</>}
                </button>
                {Object.keys(overrides).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOverrides({})}
                    disabled={running}
                    className="px-3 py-2 rounded-xl border-2 border-amber-200 bg-white text-xs font-bold text-amber-700 hover:text-amber-900 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Clear all overrides
                  </button>
                )}
              </div>

              {/* Per-file overrides */}
              <details className="group">
                <summary className="text-xs font-semibold text-amber-800 cursor-pointer hover:text-amber-900 select-none">
                  Assign individually ({report.items.unclassified.length} files)
                </summary>
                <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-amber-200 bg-white p-2 space-y-1">
                  {report.items.unclassified.slice(0, 200).map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-ink truncate">{u.id}</span>
                      <select
                        value={overrides[u.id] ?? ""}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        disabled={running}
                        className="text-xs rounded-lg border border-amber-200 bg-white px-2 py-1.5 focus:outline-none focus:border-accent font-medium"
                      >
                        {CATEGORY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {report.items.unclassified.length > 200 && (
                    <p className="text-xs text-amber-600 font-medium">+{report.items.unclassified.length - 200} more…</p>
                  )}
                </div>
              </details>
            </div>
          )}

          {report.itemDerivation?.conflicts ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2 mb-1">
                <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
                <span className="text-sm font-semibold text-amber-800">
                  {report.itemDerivation.conflicts} item(s) reconciled to a consistent category / subcategory
                </span>
              </div>
              <p className="text-xs text-amber-700 mb-2">
                The same base bag appeared in multiple sources with different category or subcategory labels
                (e.g. some copies assigned different categories or subcategories).
                To avoid jumbled categories, every copy was assigned the most common label for that bag.
              </p>
              {report.itemDerivation.reconciled.length > 0 && (
                <div className="max-h-40 overflow-auto space-y-1">
                  {report.itemDerivation.reconciled.slice(0, 10).map((r) => (
                    <div key={r.base + '-' + (r.type || '')} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[11px] text-amber-900">
                      <span className="font-mono font-semibold">{r.base}</span> → <span className="font-semibold">{r.to}</span>
                      <span className="text-amber-600"> ({r.count} file(s), conflicting {r.type ?? 'labels'}: {Array.from(new Set(r.from)).join(", ")})</span>
                    </div>
                  ))}
                  {report.itemDerivation.reconciled.length > 10 && (
                    <p className="text-[11px] text-amber-600">+{report.itemDerivation.reconciled.length - 10} more…</p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Run / import */}
          <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
            <button
              onClick={handleRun}
              disabled={running || importBlocked}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={importBlocked ? "Resolve (or skip) missing objects first" : "Import the analyzed items and combinations"}
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {running ? "Importing..." : "Import"}
            </button>
            {importBlocked && (
              <span className="text-xs text-rose-600">
                Enable "Skip missing files" above to import.
              </span>
            )}
            {!importBlocked && running && (
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-300 bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors"
              >
                <X size={15} /> Stop
              </button>
            )}
          </div>

          {runError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{runError}</span>
            </div>
          )}
        </div>
      )}

      {/* Step 4 — progress */}
      {running && progress && (
        <div className="mb-6 rounded-2xl border border-border bg-panel p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-ink flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-accent" />
              {STAGE_LABELS[progress.stage] || progress.stage}
            </span>
            <span className="text-xs text-muted">
              {progress.total > 0 ? `${progress.done}/${progress.total}` : "…"}
            </span>
          </div>
          {progress.total > 0 && (
            <div className="h-2 w-full rounded-full bg-surface overflow-hidden">
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          )}
          {progress.message && <p className="text-xs text-muted mt-2">{progress.message}</p>}
        </div>
      )}

      {/* Step 5 — result summary */}
      {summary && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={20} className="text-emerald-600" />
            <h3 className="text-lg font-bold text-emerald-800 font-heading">Import complete</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Items added" value={summary.items.added} tone="ok" sub={`${summary.items.skipped} skipped`} />
            <Stat label="Layouts" value={summary.layouts.added} tone="ok" sub={`${summary.layouts.skipped} skip · ${summary.layouts.renamed} renamed`} />
            <Stat label="Pixel files" value={summary.pixel.copied} sub={`${summary.pixel.skipped} skipped`} />
            <Stat label="Valid regions" value={summary.validRegions.generated} sub={summary.validRegions.failed ? `${summary.validRegions.failed} failed` : "generated"} tone={summary.validRegions.failed ? "warn" : "ok"} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate("/library")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
            >
              <Layers size={15} /> Go to Library
            </button>
            <button
              type="button"
              onClick={() => navigate("/saved")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-300 bg-white text-emerald-700 text-sm font-semibold hover:bg-emerald-50 transition-colors"
            >
              <FileJson size={15} /> Go to Saved
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted mt-6 leading-relaxed">
        Only pixel data (.npz) and JSONs are transferred — no bulky rendered images.
        Thumbnails and previews regenerate on demand.
        Duplicates are skipped.
        "Skip missing" removes only from this import.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational helper                                         */
/* ------------------------------------------------------------------ */

function Stat({ label, value, sub, tone = "flat" }: {
  label: string;
  value: number;
  sub?: string;
  tone?: "ok" | "warn" | "flat";
}) {
  const toneClass = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-ink";
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <p className="text-[11px] text-muted uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}