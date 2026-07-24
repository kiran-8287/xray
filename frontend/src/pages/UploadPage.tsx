import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CheckCircle2, AlertCircle, Upload as UploadIcon, AlertTriangle, Wand2, X } from "lucide-react";
import { useBlocker } from "react-router-dom";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";
import { useUploadContext } from "../context/UploadContext";
import { API_BASE_URL } from "../config/api";
import { LIBRARIES_UI, getLibrarySubcategories } from "../config/categories";
import ConfirmModal from "../components/common/ConfirmModal";

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

  const hasUnsavedChanges = staged.length > 0 || files.length > 0;
  const routerBlocker = useBlocker(hasUnsavedChanges);

  // Reset blocker if unsaved changes are resolved while blocked
  useEffect(() => {
    if (routerBlocker.state === "blocked" && !hasUnsavedChanges) {
      routerBlocker.reset?.();
    }
  }, [routerBlocker.state, hasUnsavedChanges, routerBlocker]);

  // Pipeline-specific state
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{ n: number; total: number } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [streamErrors, setStreamErrors] = useState<{ id: string; reason: string }[]>([]);
  const processingTotalRef = useRef(0);
  const processingCompletedRef = useRef(0);
  const processingActiveRef = useRef(false);
  const processingQueueRef = useRef<(() => Promise<void>)[]>([]);
  const isProcessingRef = useRef(false);

  // Clean up orphaned pre-processed files on page load
  useEffect(() => {
    const cleanupOrphanedFiles = async () => {
      const orphanedItems = sessionStorage.getItem('orphanedPreprocessedItems');
      if (orphanedItems) {
        try {
          const itemIds = JSON.parse(orphanedItems);
          // Clean up each orphaned item
          await Promise.all(
            itemIds.map((itemId: string) =>
              fetch(`${API_BASE_URL}/api/temp-files/${itemId}`, {
                method: 'DELETE',
              }).catch(err => console.error('Failed to cleanup orphaned files:', err))
            )
          );
        } catch (err) {
          console.error('Error parsing orphaned items:', err);
        }
        // Clear session storage
        sessionStorage.removeItem('orphanedPreprocessedItems');
      }
    };

    cleanupOrphanedFiles();
  }, []);

  // Warn user before leaving page if there are staged items
  useEffect(() => {
    const hasUnsavedChanges = staged.length > 0 || files.length > 0;
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [staged.length, files.length]);

  const handleFilesSelected = (newFiles: File[]) => {
    // Check for duplicates in the new files themselves
    const seenNames = new Set<string>();
    const uniqueNewFiles: File[] = [];
    const duplicateNames: string[] = [];
    
    for (const f of newFiles) {
      if (seenNames.has(f.name)) {
        duplicateNames.push(f.name);
      } else {
        seenNames.add(f.name);
        uniqueNewFiles.push(f);
      }
    }
    
    // Show warning for duplicates within the same selection
    if (duplicateNames.length > 0) {
      setDuplicateWarning(`${duplicateNames.length} duplicate file(s) in selection: ${duplicateNames.slice(0, 3).join(", ")}${duplicateNames.length > 3 ? "..." : ""}`);
      setTimeout(() => setDuplicateWarning(null), 5000);
    }
    
    // Filter files to only allow .dump.pgm and .tip files
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];
    
    for (const f of uniqueNewFiles) {
      if (f.name.endsWith(".dump.pgm") || f.name.endsWith(".tip")) {
        validFiles.push(f);
      } else {
        invalidFiles.push(f.name);
      }
    }
    
    // Show error if any invalid files were found
    if (invalidFiles.length > 0) {
      const errorMessage = `Invalid file type(s): ${invalidFiles.slice(0, 5).join(", ")}${invalidFiles.length > 5 ? ` and ${invalidFiles.length - 5} more` : ""}. Only .dump.pgm and .tip files are allowed.`;
      setValidationMessage(errorMessage);
      setTimeout(() => setValidationMessage(null), 5000);
    }
    
    // If no valid files, don't proceed
    if (validFiles.length === 0) {
      return;
    }
    
    // Clear previous errors/warnings
    setDuplicateWarning(null);
    setStreamErrors([]);
    
    // Add valid files to state so UploadFileQueue renders
    setFiles((prev) => [...prev, ...validFiles]);
    // Route all valid files to raw processing pipeline
    processRawFiles(validFiles);
  };

  /**
   * Process raw files via NDJSON streaming endpoint
   * Parses the NDJSON stream progressively and appends items to staged panel as they complete.
   * Accumulates totals across multiple batch uploads so the progress bar shows the correct total.
   */
  async function processRawFiles(files: File[]) {
    // Update total immediately so the progress bar shows the combined count right away
    processingTotalRef.current += files.length;
    setProcessing(true);
    setProcessingProgress({ n: processingCompletedRef.current, total: processingTotalRef.current });

    // Queue this batch for processing
    processingQueueRef.current.push(async () => {
      const formData = new FormData();
      files.forEach((f) => formData.append("rawFiles", f));

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
        let errors = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.trim()) continue;

            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }

            if (msg.status === "done") {
              processingCompletedRef.current++;
              setProcessingProgress({ n: processingCompletedRef.current, total: processingTotalRef.current });

              // Append to staged panel immediately
              setStaged((prev) => {
                const next = [...prev, {
                  file: new File([], msg.id),
                  category: msg.fileType === "dump" ? "bags" : "non-threats",
                  subcategory: "",
                  valid_region_points: null,
                  preProcessed: true,
                  filepath: msg.filepath,
                  preGeneratedFilepath: msg.filepath,
                  fileType: msg.fileType,
                  itemId: msg.id,
                  pixelDataFilename: msg.pixelDataFilename,
                  width: msg.width,
                  height: msg.height,
                }];
                
                const orphanedItems = JSON.parse(sessionStorage.getItem('orphanedPreprocessedItems') || '[]');
                if (!orphanedItems.includes(msg.id)) {
                  orphanedItems.push(msg.id);
                  sessionStorage.setItem('orphanedPreprocessedItems', JSON.stringify(orphanedItems));
                }
                
                return next;
              });
            } else if (msg.status === "error") {
              errors++;
              setStreamErrors((prev) => [...prev, { id: msg.id, reason: msg.reason }]);
            } else if (msg.status === "complete") {
              if (msg.duplicates > 0) {
                setDuplicateWarning(`${msg.duplicates} file(s) skipped — already in library`);
              }
            }
          }
        }
      } catch {
        // On error, don't stop processing - just mark this batch as done
      }
    });

    // Process queue sequentially if not already processing
    if (!isProcessingRef.current) {
      isProcessingRef.current = true;
      while (processingQueueRef.current.length > 0) {
        const next = processingQueueRef.current.shift();
        if (next) await next();
      }
      isProcessingRef.current = false;
      
      // All batches completed - reset state
      setProcessing(false);
      setProcessingProgress(null);
      processingTotalRef.current = 0;
      processingCompletedRef.current = 0;
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

    const summarize = (items: string[], label: string, suffix = "items") => {
      if (items.length === 0) return "";
      if (items.length <= 5) return `${label} ${items.join(", ")}`;
      const first = items.slice(0, 5).join(", ");
      const more = items.length - 5;
      return `${label} ${first} and ${more} more ${suffix}`;
    };

    if (missingCategory.length > 0 || missingBagsRegion.length > 0) {
      const lines: string[] = [];
      lines.push(summarize(missingCategory, "Set category & subcategory for item(s)"));
      lines.push(summarize(missingBagsRegion, "Draw valid region for bag item(s)", "bags"));
      setValidationMessage(lines.filter(Boolean).join(" | "));
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

      // Check if response is JSON before parsing
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Server returned non-JSON response:", text);
        throw new Error(`Server error (${res.status}): Expected JSON response but got HTML. Check server logs.`);
      }

      const data = await res.json();
      if (data.ok) {
        if (data.errors && data.errors.length > 0) {
          setDuplicateFilenames(data.errors.map((e: any) => e.filename || e.message || String(e)));
        }
        if (data.duplicates && data.duplicates.length > 0) {
          setDuplicateFilenames(prev => [...prev, ...data.duplicates]);
        }
        setUploadStatus("success");
        setConfirmUpload(false);
        setValidationMessage(null);
        setTimeout(() => {
          clearAll();
          sessionStorage.removeItem('orphanedPreprocessedItems');
        }, 1000);
      } else {
        setUploadStatus("error");
        setValidationMessage(data.error || "Upload failed. Please try again.");
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
        <h2 className="text-3xl font-bold text-ink tracking-tight font-heading">Upload Images</h2>
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
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl font-semibold text-white bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
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

        <ConfirmModal
          isOpen={routerBlocker.state === "blocked"}
          title="Unsaved Changes"
          message="You have staged files that haven't been uploaded. If you leave this page, they will be discarded."
          confirmLabel="Discard & Leave"
          cancelLabel="Cancel"
          confirmVariant="danger"
          onConfirm={() => {
            (routerBlocker as any).proceed?.();
          }}
          onCancel={() => {
            (routerBlocker as any).reset?.();
          }}
        />
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