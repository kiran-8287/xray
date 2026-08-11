/**
 * ExportLocationSelector — always-visible button + guided modal for choosing the
 * folder where generated images / annotations are exported (Load, Saved, Collage).
 *
 * Backed by the existing backend config endpoints:
 *   GET  /api/user-config/exports-path   → current path + server platform
 *   POST /api/user-config/exports-path   → save a new path (or "" for default)
 *
 * The modal teaches the user the exact absolute-path format for the server OS and
 * validates live before saving, so path mistakes cannot be saved silently.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderCog, Loader2, X } from "lucide-react";
import { API_BASE_URL } from "../../config/api";
import { fetchWithTimeout } from "../../lib/fetchWithTimeout";
import { platformDisplayName, validateExportPath, type ServerPlatform } from "../../lib/exportPath";

export interface ExportLocationSelectorHandle {
  /** Open the export-location dialog programmatically (e.g. before the first save). */
  open: () => void;
}

interface ExportLocationSelectorProps {
  className?: string;
  /** Which scope to manage: load, saved, or collage. Defaults to 'saved'. */
  scope?: 'load' | 'saved' | 'collage';
  /** Called once after the current config is fetched from the backend. */
  onConfigLoaded?: (exportsPath: string | null, configured: boolean, platform: ServerPlatform | "") => void;
  /** Called after a path is saved (custom or default). */
  onPathSaved?: (exportsPath: string | null, configured: boolean) => void;
}

const ExportLocationSelector = forwardRef<ExportLocationSelectorHandle, ExportLocationSelectorProps>(
  function ExportLocationSelector({ className = "", scope = "saved", onConfigLoaded, onPathSaved }, ref) {
    const [loading, setLoading] = useState(true);
    const [exportsPath, setExportsPath] = useState<string | null>(null);
    const [configured, setConfigured] = useState(false);
    const [platform, setPlatform] = useState<ServerPlatform | "">("");
    const [showModal, setShowModal] = useState(false);
    const [input, setInput] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const autoOpenedRef = useRef(false);

    // Load current configuration once.
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetchWithTimeout(`${API_BASE_URL}/api/user-config/exports-path`);
          const data = await res.json();
          if (cancelled || !data?.ok) return;
          
          // Extract the path for this specific scope
          const paths = data.paths || {};
          const scopedPath = paths[scope] || data.exportsPath || null;
          const scopedConfigured = data.configured?.[scope] || data.configured || false;
          const p = typeof scopedPath === "string" && scopedPath.length > 0 ? scopedPath : null;
          const isConfigured = scopedConfigured === true && p !== null;
          
          setExportsPath(p);
          setConfigured(isConfigured);
          setPlatform(data.platform || "");
          onConfigLoaded?.(p, isConfigured, data.platform || "");
          
          // Auto-open dialog ONLY ONCE EVER on first visit when no path is configured.
          // Uses localStorage to ensure it never shows again after the first time.
          if (!isConfigured && !autoOpenedRef.current) {
            const everShown = typeof window !== 'undefined' ? window.localStorage.getItem('exportLocationDialogShown') : null;
            if (!everShown) {
              autoOpenedRef.current = true;
              setSaveError(null);
              setShowModal(true);
              try {
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem('exportLocationDialogShown', 'true');
                }
              } catch {
                /* ignore storage errors */
              }
            }
          }
        } catch (err) {
          console.warn("[ExportLocationSelector] Failed to load export path config:", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [scope, onConfigLoaded]);

    const openModal = () => {
      setInput(exportsPath ?? "");
      setSaveError(null);
      setShowModal(true);
    };

    useImperativeHandle(ref, () => ({ open: openModal }));

    const validation = useMemo(() => validateExportPath(input, platform), [input, platform]);

    const submit = async (useDefault: boolean) => {
      if (saving) return;
      if (!useDefault && !validation.ok) {
        setSaveError(validation.error || "Invalid path");
        return;
      }
      setSaving(true);
      setSaveError(null);
      try {
        const apiKey = localStorage.getItem("apiKey");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["X-API-Key"] = apiKey;
        const bodyValue = useDefault ? "" : validation.normalized ?? "";
        const res = await fetchWithTimeout(
          `${API_BASE_URL}/api/user-config/exports-path`,
          { method: "POST", headers, body: JSON.stringify({ scope, exportsPath: bodyValue }) },
          30000
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to save export location (HTTP ${res.status})`);
        }
        const data = await res.json();
        const p = typeof data.exportsPath === "string" && data.exportsPath.length > 0 ? data.exportsPath : null;
        const isConfigured = p !== null;
        setExportsPath(p);
        setConfigured(isConfigured);
        setInput(p ?? "");
        setShowModal(false);
        try {
          localStorage.setItem("exportsPathConfigured", isConfigured ? "true" : "false");
        } catch {
          /* ignore storage errors */
        }
        onPathSaved?.(p, isConfigured);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    };

    const isWin = platform === "win32";
    const sep = isWin ? "\\" : "/";
    const buttonLabel = loading
      ? "Export location…"
      : configured && exportsPath
        ? exportsPath
        : "Export location: default";
    const fullTitle = configured && exportsPath ? `Exports are saved to: ${exportsPath}` : "Set where exported images & files are saved";
return (
      <>
        <button
          type="button"
          onClick={openModal}
          title={fullTitle}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface transition-colors ${className}`}
        >
          <FolderCog size={16} className="shrink-0 text-accent" />
          <span className="max-w-[280px] truncate font-mono text-xs text-muted">{buttonLabel}</span>
        </button>

        {showModal && (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-border p-6">
              <button
                onClick={() => !saving && setShowModal(false)}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-colors"
              >
                <X size={18} />
              </button>

              <h3 className="text-lg font-semibold text-ink mb-1">Export Location</h3>
              <p className="text-xs text-muted mb-4">
                Choose the folder where generated images &amp; files are saved. Applies to Load, Saved, and Collage
                exports only — imports are never affected.
              </p>

              <div className="rounded-xl border border-border bg-surface p-3 mb-4">
                <p className="text-xs text-muted">
                  Current location:{" "}
                  <span className="font-mono text-ink break-all">
                    {configured && exportsPath ? exportsPath : "Default (backend/data/exports)"}
                  </span>
                </p>
              </div>

              <div className="mb-3">
                <label className="block text-sm font-medium text-ink mb-1.5">Absolute folder path</label>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setSaveError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && validation.ok && !saving) submit(false);
                  }}
                  placeholder={isWin ? "C:\\XrayExports" : "/home/you/XrayExports"}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                  autoFocus
                />

                {input.trim() ? (
                  validation.ok ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-700">
                      <CheckCircle2 size={14} /> Valid absolute path for the {platformDisplayName(platform)} server.
                    </p>
                  ) : (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {validation.error}
                    </p>
                  )
                ) : (
                  <p className="mt-1.5 text-xs text-muted">
                    Empty + "Use Default" keeps the built-in{" "}
                    <span className="font-mono">backend/data/exports</span> folder.
                  </p>
                )}

                {validation.ok && validation.normalized && (
                  <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                    ✅ Files will be saved to:{" "}
                    <span className="font-mono break-all">
                      {validation.normalized}
                      {sep}high / {validation.normalized}
                      {sep}low
                      {isWin ? " / …\\annotations" : " / …/annotations"}
                    </span>
                  </div>
                )}
              </div>
<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4">
                <p className="text-[11px] font-semibold text-amber-800 mb-1.5 uppercase tracking-wider">
                  How to type the path ({platformDisplayName(platform)} server)
                </p>
                <ul className="space-y-1 text-xs text-amber-800 list-disc ml-4">
                  {!isWin ? (
                    <>
                      <li>
                        Linux system: must start with a forward slash — e.g.{" "}
                        <span className="font-mono">/home/you/XrayExports</span>
                      </li>
                      <li>
                        Linux system: give the full absolute path from the root directory (no ~, no shortcuts, no quotes).
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        Linux system: must start with a forward slash — e.g.{" "}
                        <span className="font-mono">/home/you/XrayExports</span>
                      </li>
                      <li>
                        Linux system: give the full absolute path from the root directory (no ~, no shortcuts, no quotes).
                      </li>
                    </>
                  )}
                  {isWin && (
                    <>
                      <li>
                        Windows: drive letter + backslash or forward slash — e.g.{" "}
                        <span className="font-mono">C:\XrayExports</span> or <span className="font-mono">C:/XrayExports</span>
                      </li>
                      <li>Windows: give the full absolute path from the drive root (no shortcuts, no quotes).</li>
                    </>
                  )}
                  <li>A trailing slash or backslash is removed automatically.</li>
                  <li>Subfolders (high, low, annotations, catalog) are created automatically.</li>
                </ul>
              </div>

              {saveError && (
                <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 flex items-start gap-1.5">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {saveError}
                </div>
              )}

              <div className="flex gap-2 justify-end items-center">
                <button
                  onClick={() => submit(true)}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface transition-colors disabled:opacity-50"
                >
                  Use Default
                </button>
                <button
                  onClick={() => !saving && setShowModal(false)}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl border border-border bg-panel text-sm font-semibold text-ink hover:bg-surface transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => submit(false)}
                  disabled={saving || !validation.ok}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <FolderCog size={16} />}
                  Save Location
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
);

export default ExportLocationSelector;