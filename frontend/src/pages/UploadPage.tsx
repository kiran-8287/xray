import React, { useState, useEffect, useCallback, useMemo } from "react";
import { CheckCircle2, AlertCircle, Upload as UploadIcon, AlertTriangle, Wand2, X } from "lucide-react";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";
import { useUploadContext } from "../context/UploadContext";
import { API_BASE_URL } from "../config/api";
import { LIBRARIES_UI, getLibrarySubcategories } from "../config/categories";

// Use centralized library definitions
const LIBRARIES = LIBRARIES_UI;

export default function UploadPage() {
  const { files, setFiles, staged, setStaged, clearAll } = useUploadContext();
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("My Upload");
  const [selectedForMass, setSelectedForMass] = useState<Set<number>>(new Set());
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [duplicateFilenames, setDuplicateFilenames] = useState<string[]>([]);

  // Pipeline-specific state
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{ n: number; total: number } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [streamErrors, setStreamErrors] = useState<{ id: string; reason: string }[]>([]);

  const handleFilesSelected = (newFiles: File[]) => {
    // Check if any of the new files are raw files
    const hasRawFiles = newFiles.some(
      (f) => f.name.endsWith(".dump.pgm") || f.name.endsWith(".tip")
    );

    if (hasRawFiles) {
      // Clear previous errors/warnings
      setDuplicateWarning(null);
      setStreamErrors([]);
      // Add files to state so UploadFileQueue renders
      setFiles((prev) => [...prev, ...newFiles]);
      // Route all files (including co-submitted PNGs) to raw processing pipeline
      processRawFiles(newFiles);
      return;
    }

    // Existing PNG flow: unchanged
    setFiles((prev) => [...prev, ...newFiles]);
    const startIdx = staged.length;
    const newStaged = newFiles.map((f) => ({
      file: f,
      category: "",
      subcategory: "",
      valid_region_points: null,
    }));
    setStaged((prev) => [...prev, ...newStaged]);
    const newIndices = new Set<number>();
    for (let i = startIdx; i < startIdx + newFiles.length; i++) {
      newIndices.add(i);
    }
    setSelectedForMass(newIndices);
  };

  /**
   * Process raw files via NDJSON streaming endpoint
   * Parses the NDJSON stream progressively and appends items to staged panel as they complete.
   */
  async function processRawFiles(files: File[]) {
    const formData = new FormData();
    files.forEach((f) => formData.append("rawFiles", f));

    setProcessing(true);
    setProcessingProgress({ n: 0, total: files.length });
    console.log(`[frontend] Starting raw file processing for ${files.length} files`);

    try {
      const response = await fetch(`${API_BASE_URL}/api/process-raw-files`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = 0;
      let errors = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!; // last element may be incomplete

        for (const line of lines) {
          if (!line.trim()) continue;

          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            console.warn("Malformed NDJSON line:", line);
            continue;
          }

          if (msg.status === "done") {
            completed++;
            setProcessingProgress({ n: completed, total: files.length });
            console.log(`[frontend] Received done: ${msg.id} (${msg.fileType}) ${msg.width}x${msg.height} — staged count: ${completed}`);

            // Append to staged panel immediately
            setStaged((prev) => {
              const next = [...prev, {
                file: new File([], msg.id),
                category: msg.fileType === "dump" ? "bags" : "non-threats",
                subcategory: "",
                valid_region_points: null,
                preProcessed: true,
                preGeneratedFilepath: msg.filepath,
                fileType: msg.fileType,
                itemId: msg.id,
                pixelDataFilename: msg.pixelDataFilename,
                width: msg.width,
                height: msg.height,
              }];
              console.log(`[frontend] staged updated: now ${next.length} items`);
              return next;
            });
          } else if (msg.status === "error") {
            errors++;
            console.log(`[frontend] Received error: ${msg.id} — ${msg.reason}`);
            setStreamErrors((prev) => [...prev, { id: msg.id, reason: msg.reason }]);
          } else if (msg.status === "complete") {
            console.log(`[frontend] Stream complete. Total: ${msg.total}, Processed: ${msg.processed}, Duplicates: ${msg.duplicates}, Failed: ${msg.failed}`);
            setProcessing(false);
            setProcessingProgress(null);
            if (msg.duplicates > 0) {
              setDuplicateWarning(`${msg.duplicates} file(s) skipped — already in library`);
            }
          }
        }
      }

      // If stream ended without a "complete" line
      if (processing) {
        console.log(`[frontend] Stream ended without complete line. Staged: ${completed}, Errors: ${errors}`);
        setProcessing(false);
        setProcessingProgress(null);
      }
    } catch (err) {
      console.error("processRawFiles error:", err);
      setProcessing(false);
      setProcessingProgress(null);
    }
  }

  const handleUpload = async () => {
    const missingCategory: string[] = [];
    const missingBagsRegion: string[] = [];

    staged.forEach((s, i) => {
      const sn = `#${i + 1}`;
      if (!s.category || !s.subcategory) {
        missingCategory.push(sn);
      }
      if (s.category === "bags" && !s.valid_region_points) {
        missingBagsRegion.push(sn);
      }
    });

    if (missingCategory.length > 0 || missingBagsRegion.length > 0) {
      const lines: string[] = [];
      if (missingCategory.length > 0) {
        lines.push(`Set category & subcategory for item(s) ${missingCategory.join(", ")}`);
      }
      if (missingBagsRegion.length > 0) {
        lines.push(`Draw valid region for bag item(s) ${missingBagsRegion.join(", ")}`);
      }
      setValidationMessage(lines.join(" | "));
      setTimeout(() => setValidationMessage(null), 5000);
      return;
    }

    setConfirmUpload(true);
  };

  const doUpload = async () => {
    setConfirmUpload(false);
    setUploading(true);
    setUploadStatus("idle");
    setValidationMessage(null);
    setDuplicateFilenames([]);
    try {
      const formData = new FormData();
      formData.append("folderName", folderName);

      // Only append file bytes for non-pre-processed items
      staged.forEach((s) => {
        if (!s.preProcessed) formData.append("images", s.file);
      });

      // Build metadata with pre-processed fields when applicable
      const metadata = staged.map((s) => ({
        originalname: s.preProcessed ? s.itemId! : s.file.name,
        category: s.category,
        subcategory: s.subcategory,
        valid_region_points: s.valid_region_points || null,
        tags: s.tags && s.tags.length > 0 ? s.tags : [],
        ...(s.preProcessed && {
          preProcessed: true,
          preGeneratedFilepath: s.preGeneratedFilepath,
          itemId: s.itemId,
          width: s.width,
          height: s.height,
          pixelDataFilename: s.pixelDataFilename,
          fileType: s.fileType,
        }),
      }));
      formData.append("metadata", JSON.stringify(metadata));

      const res = await fetch(`${API_BASE_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.ok) {
        if (data.duplicates && data.duplicates.length > 0) {
          setDuplicateFilenames(data.duplicates);
          setUploadStatus("error");
        } else if (data.errors && data.errors.length > 0) {
          setUploadStatus("error");
        } else {
          setUploadStatus("success");
          // Refresh library after successful upload by fetching categorized items
          try {
            const libraryRes = await fetch(`${API_BASE_URL}/api/items/categorized`);
            if (libraryRes.ok) {
              const libraryData = await libraryRes.json();
              // Store in session storage so LibraryPage can pick it up
              sessionStorage.setItem("refreshedCategorizedItems", JSON.stringify(libraryData));
              // Also trigger a refresh event for any listeners
              window.dispatchEvent(new CustomEvent("libraryRefresh", { detail: libraryData }));
            }
          } catch (refreshErr) {
            console.warn("Failed to refresh library cache:", refreshErr);
          }
          setTimeout(() => {
            clearAll();
          }, 1000);
        }
      } else {
        setUploadStatus("error");
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("error");
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadStatus("idle");
      }, 3500);
    }
  };

  const toggleSelectAll = () => {
    if (selectedForMass.size === staged.length) {
      setSelectedForMass(new Set());
    } else {
      setSelectedForMass(new Set(staged.map((_, i) => i)));
    }
  };

  const toggleSelect = (idx: number) => {
    setSelectedForMass((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="w-full py-6 px-6 animate-fade-in">
      <div className="border-l-4 border-accent pl-4 mb-8">
        <h2 className="text-3xl font-bold text-ink tracking-tight">Upload Images</h2>
      </div>

      <div className="space-y-6 max-w-5xl mx-auto">
        <UploadDropZone onFilesSelected={handleFilesSelected} />

        {/* Processing indicator */}
        {processing && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-center gap-3 shadow-card">
            <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 animate-pulse">
              <span className="text-xs font-bold">...</span>
            </div>
            <span className="text-sm font-medium">
              Processing files… {processingProgress?.n ?? 0} / {processingProgress?.total ?? 0}
            </span>
          </div>
        )}

        {/* Stream errors */}
        {streamErrors.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 shadow-card">
            <h4 className="text-xs font-semibold text-rose-700 uppercase tracking-wider mb-2">Processing Errors</h4>
            <ul className="space-y-1">
              {streamErrors.map((err, i) => (
                <li key={i} className="text-xs text-rose-600 font-mono">
                  {err.id}: {err.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Duplicate warning banner (dismissible) */}
        {duplicateWarning && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-center justify-between gap-3 shadow-card">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={14} />
              </div>
              <span className="text-sm font-medium">{duplicateWarning}</span>
            </div>
            <button
              onClick={() => setDuplicateWarning(null)}
              className="p-1 rounded-lg text-amber-600"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="bg-panel rounded-2xl border border-border p-8 shadow-card max-w-5xl mx-auto">
          <button
            onClick={handleUpload}
            disabled={uploading || staged.length === 0}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              "Uploading..."
            ) : (
              <>
                <UploadIcon size={20} />
                Upload {staged.length > 0 ? `${staged.length} Files` : "Files"}
              </>
            )}
          </button>

          {staged.length === 0 && (
            <div className="mt-6 py-8 text-center">
              <p className="text-lg font-semibold text-muted">No files selected</p>
              <p className="text-sm text-muted/60 mt-2 max-w-sm mx-auto leading-relaxed">
                Drag and drop a folder or individual dump or tip files into the dropzone above to queue them for upload
              </p>
            </div>
          )}
        </div>

        {validationMessage && (
          <div className="fixed bottom-24 right-6 z-50 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3 shadow-card animate-slide-up max-w-md">
            <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={14} />
            </div>
            <span className="text-sm font-medium">{validationMessage}</span>
          </div>
        )}

        {duplicateFilenames.length > 0 && (
          <div className="fixed bottom-24 right-6 z-50 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3 shadow-card animate-slide-up max-w-md">
            <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={14} />
            </div>
            <div className="text-sm font-medium">
              <p className="mb-1">Already exists in library:</p>
              <ul className="list-disc list-inside text-xs">
                {duplicateFilenames.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {staged.length > 0 && (
          <UploadFileQueue
            files={files}
            staged={staged}
            setStaged={setStaged}
            setFiles={setFiles}
            uploading={uploading}
            handleUpload={handleUpload}
            selectedForMass={selectedForMass}
            onToggleSelect={toggleSelect}
            onSelectAll={toggleSelectAll}
          />
        )}
      </div>

      {/* Upload confirmation dialog */}
      {confirmUpload && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-panel border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4" style={{ maxWidth: 440, width: "90%" }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-900/40 border border-amber-700/50 flex items-center justify-center shrink-0">
                <UploadIcon size={18} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">Confirm Upload</h3>
                <p className="text-sm text-muted leading-relaxed">
                  This will upload <strong className="text-ink">{staged.length} file{staged.length !== 1 ? 's' : ''}</strong> to Library. Only proceed if you trust this source.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConfirmUpload(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-ink"
              >
                Cancel
              </button>
              <button
                onClick={doUpload}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadStatus === "success" && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-emerald-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <span className="text-sm font-medium">Upload successful! Go to Collage page to see combinations.</span>
        </div>
      )}

      {uploadStatus === "error" && duplicateFilenames.length === 0 && (
        <div className="fixed bottom-6 right-6 z-50 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-rose-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <AlertCircle size={14} />
          </div>
          <span className="text-sm font-medium">Upload failed. Please try again.</span>
        </div>
      )}
    </div>
  );
}