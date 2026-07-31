import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CheckCircle2, AlertCircle, Upload as UploadIcon, AlertTriangle, Wand2, X, Save } from "lucide-react";
import { useBlocker } from "react-router-dom";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";
import { useUploadContext } from "../context/UploadContext";
import { API_BASE_URL } from "../config/api";
import { LIBRARIES_UI, getLibrarySubcategories } from "../config/categories";
import ConfirmModal from "../components/common/ConfirmModal";
import { concurrencyController, initializeConcurrencyPools, adjustConcurrencyForLoad } from "../lib/concurrencyController";

const LIBRARIES = LIBRARIES_UI;
const PAGE_SIZE = 50; // 50 files per batch for fast rendering & background buffering

export default function UploadPage() {
  const { files, setFiles, staged, setStaged, clearAll } = useUploadContext();
  const [uploading, setUploading] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("My Upload");
  const [selectedForMass, setSelectedForMass] = useState<Set<number>>(new Set());
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [duplicateFilenames, setDuplicateFilenames] = useState<string[]>([]);

  // Active page index (1-based)
  const [activePage, setActivePage] = useState(1);
  const processedPagesRef = useRef<Set<number>>(new Set());

  const hasUnsavedChanges = staged.length > 0 || files.length > 0;
  const routerBlocker = useBlocker(hasUnsavedChanges);

  useEffect(() => {
    if (routerBlocker.state === "blocked" && !hasUnsavedChanges) {
      routerBlocker.reset?.();
    }
  }, [routerBlocker.state, hasUnsavedChanges, routerBlocker]);

  // Pipeline state
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{ n: number; total: number } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [streamErrors, setStreamErrors] = useState<{ id: string; reason: string }[]>([]);
  const processingTotalRef = useRef(0);
  const processingCompletedRef = useRef(0);
  const processingQueueRef = useRef<(() => Promise<void>)[]>([]);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    initializeConcurrencyPools();
  }, []);

  // Cleanup orphaned files on mount
  useEffect(() => {
    const cleanupOrphanedFiles = async () => {
      const orphanedItems = sessionStorage.getItem('orphanedPreprocessedItems');
      if (orphanedItems) {
        try {
          const itemIds = JSON.parse(orphanedItems);
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
        sessionStorage.removeItem('orphanedPreprocessedItems');
      }
    };
    cleanupOrphanedFiles();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (staged.length > 0 || files.length > 0) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [staged.length, files.length]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(files.length / PAGE_SIZE)), [files.length]);

  // Handle new files dropped / selected
  const handleFilesSelected = (newFiles: File[]) => {
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
    
    if (duplicateNames.length > 0) {
      setDuplicateWarning(`${duplicateNames.length} duplicate file(s) in selection: ${duplicateNames.slice(0, 3).join(", ")}${duplicateNames.length > 3 ? "..." : ""}`);
      setTimeout(() => setDuplicateWarning(null), 5000);
    }
    
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];
    
    for (const f of uniqueNewFiles) {
      const lowerName = f.name.toLowerCase();
      if (
        lowerName.endsWith(".dump.pgm") || 
        lowerName.endsWith(".pgm") || 
        lowerName.endsWith(".tip") || 
        lowerName.endsWith(".dump")
      ) {
        validFiles.push(f);
      } else {
        invalidFiles.push(f.name);
      }
    }
    
    if (invalidFiles.length > 0) {
      const errorMessage = `Invalid file type(s): ${invalidFiles.slice(0, 5).join(", ")}${invalidFiles.length > 5 ? ` and ${invalidFiles.length - 5} more` : ""}. Supported extensions: .dump.pgm, .pgm, .tip, .dump.`;
      setValidationMessage(errorMessage);
      setTimeout(() => setValidationMessage(null), 5000);
    }
    
    if (validFiles.length === 0) return;
    
    setDuplicateWarning(null);
    setStreamErrors([]);

    const updatedFiles = [...files, ...validFiles];
    setFiles(updatedFiles);

    // Trigger 50-item page processing with 2-page background pre-fetch buffer
    triggerPageProcessing(updatedFiles, 1);
  };

  /**
   * Continuous queue worker loop: processes all scheduled page batches sequentially in background
   */
  const startQueueWorker = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setProcessing(true);
    adjustConcurrencyForLoad(true);

    while (processingQueueRef.current.length > 0) {
      const task = processingQueueRef.current.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.error("Queue task error:", err);
        }
      }
    }

    isProcessingRef.current = false;
    setProcessing(false);
    setProcessingProgress(null);
    adjustConcurrencyForLoad(false);
  };

  /**
   * Schedule processing for target page and pre-fetch next 2 pages in background buffer
   */
  function triggerPageProcessing(allFilesList: File[], targetPage: number) {
    const pagesToSchedule = [targetPage, targetPage + 1, targetPage + 2];

    for (const p of pagesToSchedule) {
      if (p < 1 || p > Math.ceil(allFilesList.length / PAGE_SIZE)) continue;
      if (processedPagesRef.current.has(p)) continue; // already processed/processing

      processedPagesRef.current.add(p);

      const startIndex = (p - 1) * PAGE_SIZE;
      const pageFiles = allFilesList.slice(startIndex, startIndex + PAGE_SIZE);
      if (pageFiles.length > 0) {
        enqueueRawFilesBatch(pageFiles, p);
      }
    }

    // Start background queue processing
    startQueueWorker();
  }

  /**
   * Enqueue a 50-file page batch task
   */
  function enqueueRawFilesBatch(batchFiles: File[], pageNumber: number) {
    processingTotalRef.current += batchFiles.length;

    processingQueueRef.current.push(async () => {
      const formData = new FormData();
      batchFiles.forEach((f) => formData.append("rawFiles", f));

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

        while (true) {
          const { done, value } = await reader.read();
          if (value) {
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

                const newItem = {
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
                  pageNumber,
                };

                const orphanedItems = JSON.parse(sessionStorage.getItem('orphanedPreprocessedItems') || '[]');
                if (!orphanedItems.includes(msg.id)) {
                  orphanedItems.push(msg.id);
                  sessionStorage.setItem('orphanedPreprocessedItems', JSON.stringify(orphanedItems));
                }

                setStaged((prev) => [...prev, newItem]);
              } else if (msg.status === "error") {
                setStreamErrors((prev) => [...prev, { id: msg.id, reason: msg.reason }]);
              } else if (msg.status === "complete") {
                if (msg.duplicates > 0) {
                  setDuplicateWarning(`${msg.duplicates} file(s) skipped — already in library`);
                }
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, 0));
          if (done) break;
        }
      } catch (err) {
        console.error(`[Page ${pageNumber}] Batch processing error:`, err);
      }
    });
  }

  // Active 50 items displayed on current page
  const activePageItems = useMemo(() => {
    const pageItems = staged.filter((item: any) => item.pageNumber === activePage);
    if (pageItems.length > 0) return pageItems;
    // Fallback: slice staged items by 50
    const startIdx = (activePage - 1) * PAGE_SIZE;
    return staged.slice(startIdx, startIdx + PAGE_SIZE);
  }, [staged, activePage]);

  // Save current page items to library and advance to pre-buffered next page
  const handleSaveCurrentPage = async () => {
    if (activePageItems.length === 0) {
      setValidationMessage("No processed items to save on this page.");
      setTimeout(() => setValidationMessage(null), 3000);
      return;
    }

    const missingCategory: string[] = [];
    const missingBagsRegion: string[] = [];

    activePageItems.forEach((s: any, i: number) => {
      const sn = `#${i + 1}`;
      if (!s.category || !s.subcategory) missingCategory.push(sn);
      if (s.category === "bags" && !s.valid_region_points) missingBagsRegion.push(sn);
    });

    if (missingCategory.length > 0 || missingBagsRegion.length > 0) {
      const msgs = [];
      if (missingCategory.length > 0) msgs.push(`Set category & subcategory for ${missingCategory.length} item(s)`);
      if (missingBagsRegion.length > 0) msgs.push(`Draw valid region for ${missingBagsRegion.length} bag item(s)`);
      setValidationMessage(msgs.join(" | "));
      setTimeout(() => setValidationMessage(null), 5000);
      return;
    }

    setSavingPage(true);
    setValidationMessage(null);

    try {
      const payloadItems = activePageItems.map((s: any) => ({
        id: s.itemId || `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        category: s.category,
        subcategory: s.subcategory,
        valid_region_points: s.valid_region_points || null,
        tags: s.tags && s.tags.length > 0 ? s.tags : [],
        filepath: s.preGeneratedFilepath || s.filepath,
        width: s.width,
        height: s.height,
        pixelDataFilename: s.pixelDataFilename,
      }));

      const res = await fetch(`${API_BASE_URL}/api/items/batch-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payloadItems }),
      });

      const data = await res.json();
      if (data.ok) {
        setUploadStatus("success");
        setTimeout(() => setUploadStatus("idle"), 3000);

        // Evict saved active page items from staged memory
        setStaged((prev) => prev.filter((item: any) => item.pageNumber !== activePage));

        // Advance to next pre-buffered page immediately
        if (activePage < totalPages) {
          const nextPage = activePage + 1;
          setActivePage(nextPage);
          // Pre-fetch next upcoming pages in background buffer
          triggerPageProcessing(files, nextPage);
        }
      } else {
        setUploadStatus("error");
        setValidationMessage(data.error || "Failed to save batch. Please try again.");
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("error");
    } finally {
      setSavingPage(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedForMass.size === activePageItems.length) {
      setSelectedForMass(new Set());
    } else {
      setSelectedForMass(new Set(activePageItems.map((_, i) => i)));
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
        <p className="text-sm text-muted mt-1">
          Auto-partitioned 50-item batch streaming with instant pre-fetch buffer
        </p>
      </div>

      <div className="space-y-6 max-w-5xl mx-auto">
        <UploadDropZone onFilesSelected={handleFilesSelected} />

        {/* Processing indicator */}
        {processing && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-center justify-between shadow-card">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 animate-pulse">
                <span className="text-xs font-bold">...</span>
              </div>
              <span className="text-sm font-medium">
                Pre-buffering batches in background… ({processingProgress?.n ?? 0} / {processingProgress?.total ?? 0} items)
              </span>
            </div>
            <span className="text-xs font-mono bg-amber-200/60 text-amber-900 px-2.5 py-1 rounded-lg">
              2-Batch Buffer Active
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

        {/* Duplicate warning banner */}
        {duplicateWarning && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-center justify-between gap-3 shadow-card">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={14} />
              </div>
              <span className="text-sm font-medium">{duplicateWarning}</span>
            </div>
            <button onClick={() => setDuplicateWarning(null)} className="p-1 rounded-lg text-amber-600">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Save Batch Controls */}
        {activePageItems.length > 0 && (
          <div className="bg-panel rounded-2xl border border-border p-6 shadow-card max-w-5xl mx-auto flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-ink font-heading">
                Batch Ready ({activePageItems.length} Tiles)
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Assign categories & valid regions, then save to append directly to library storage.
              </p>
            </div>

            <button
              onClick={handleSaveCurrentPage}
              disabled={savingPage || activePageItems.length === 0}
              className="flex items-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all duration-150 transform active:scale-98"
            >
              {savingPage ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving Batch to Library...
                </>
              ) : (
                <>
                  <Save size={18} />
                  Save Batch to Library
                </>
              )}
            </button>
          </div>
        )}

        {validationMessage && (
          <div className="fixed bottom-24 right-6 z-50 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3 shadow-card animate-slide-up max-w-md">
            <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={14} />
            </div>
            <span className="text-sm font-medium">{validationMessage}</span>
          </div>
        )}

        {staged.length > 0 && (
          <UploadFileQueue
            files={files}
            staged={activePageItems}
            setStaged={setStaged}
            setFiles={setFiles}
            uploading={savingPage}
            processing={processing}
            handleUpload={handleSaveCurrentPage}
            selectedForMass={selectedForMass}
            onToggleSelect={toggleSelect}
            onSelectAll={toggleSelectAll}
          />
        )}

        <ConfirmModal
          isOpen={routerBlocker.state === "blocked"}
          title="Unsaved Changes"
          message="You have staged files that haven't been saved. Leaving will discard unsaved items in this batch."
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

      {uploadStatus === "success" && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-emerald-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <span className="text-sm font-medium">Batch saved! Loaded next pre-buffered batch instantly.</span>
        </div>
      )}

      {uploadStatus === "error" && duplicateFilenames.length === 0 && (
        <div className="fixed bottom-6 right-6 z-50 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-rose-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <AlertCircle size={14} />
          </div>
          <span className="text-sm font-medium">Save failed. Please try again.</span>
        </div>
      )}
    </div>
  );
}