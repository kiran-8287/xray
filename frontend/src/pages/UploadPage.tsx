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
import { fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS } from "../lib/fetchWithTimeout";

const LIBRARIES = LIBRARIES_UI;
const PAGE_SIZE = 100; // 100 files per batch — optimal for 12-core system (saturates worker pool, ~300MB peak RAM)

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

  // Reset upload context + local refs/state on component MOUNT.
  // UploadProvider wraps the entire app, so stale files/staged from a previous
  // visit to UploadPage (e.g. user saved all batches, went to Library/Collage,
  // then came back) would otherwise show an empty progress bar "0 / 1000".
  const didMountResetRef = useRef(false);
  useEffect(() => {
    if (didMountResetRef.current) return;
    didMountResetRef.current = true;

    // Wipe context (files + staged)
    clearAll();

    // Reset page + processing counters + processed page tracker
    setActivePage(1);
    processedPagesRef.current = new Set();
    furthestScheduledPageRef.current = 0;
    processingTotalRef.current = 0;
    processingCompletedRef.current = 0;
    processingQueueRef.current = [];
    isProcessingRef.current = false;
    setProcessing(false);
    setProcessingProgress(null);
    setStreamErrors([]);
    setSelectedForMass(new Set());
    setDuplicateWarning(null);
    setValidationMessage(null);
    setUploadStatus("idle");
    setSavingPage(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
   * Continuous queue worker loop: processes all scheduled page batches sequentially in background.
   * Re-drains the queue after each task to catch tasks added while a task was running.
   */
  const startQueueWorker = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setProcessing(true);
    adjustConcurrencyForLoad(true);

    // Keep looping as long as there are tasks — new tasks may be enqueued while we process
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
   * Schedule processing for target page and pre-fetch next 2 pages in background buffer.
   * Tracks the furthest page ever scheduled to ensure the 2-page buffer always looks ahead.
   */
  const furthestScheduledPageRef = useRef(0);

  function triggerPageProcessing(allFilesList: File[], targetPage: number = 1) {
    const totalPagesNow = Math.ceil(allFilesList.length / PAGE_SIZE);

    // Maintain a strict 1-page lookahead buffer (active page + next 1 page) to minimize memory & CPU usage
    const bufferEnd = Math.min(targetPage + 1, totalPagesNow);

    for (let p = targetPage; p <= bufferEnd; p++) {
      if (p < 1 || p > totalPagesNow) continue;
      if (processedPagesRef.current.has(p)) continue; // already processed/queued

      processedPagesRef.current.add(p);
      if (p > furthestScheduledPageRef.current) furthestScheduledPageRef.current = p;

      const startIndex = (p - 1) * PAGE_SIZE;
      const pageFiles = allFilesList.slice(startIndex, startIndex + PAGE_SIZE);
      if (pageFiles.length > 0) {
        enqueueRawFilesBatch(pageFiles, p);
      }
    }

    // (Re)start background queue processing if not already running
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
        const response = await fetchWithTimeout(`${API_BASE_URL}/api/process-raw-files`, {
          method: "POST",
          body: formData,
        }, LONG_REQUEST_TIMEOUT_MS, 1);

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

  // Page-aware state updater to prevent active-page edits from overwriting master staged state
  const setStagedForActivePage = useCallback(
    (action: React.SetStateAction<any[]>) => {
      setStaged((prevMaster) => {
        const currentActiveItems = prevMaster.filter((item: any) => item.pageNumber === activePage);
        const newActiveItems = typeof action === "function" ? action(currentActiveItems) : action;
        const otherItems = prevMaster.filter((item: any) => item.pageNumber !== activePage);
        return [...otherItems, ...newActiveItems];
      });
    },
    [activePage]
  );

  const isNextBufferReady = useMemo(() => {
    if (activePage >= totalPages) return false;
    const nextPageNumber = activePage + 1;
    const nextPageItems = staged.filter((item: any) => item.pageNumber === nextPageNumber);
    return nextPageItems.length > 0;
  }, [staged, activePage, totalPages]);

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

      const res = await fetchWithTimeout(`${API_BASE_URL}/api/items/batch-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payloadItems }),
      }, LONG_REQUEST_TIMEOUT_MS, 1);

      const data = await res.json();
      if (data.ok) {
        setUploadStatus("success");
        setTimeout(() => setUploadStatus("idle"), 3000);

        // ------ 1. Evict saved-page portion from files array ------
        // The progress banner render is gated on `files.length > 0`; if we
        // never shrink `files`, the bar (with stale denominator) stays visible
        // forever even after every batch has been saved to the library.
        const savedStart = (activePage - 1) * PAGE_SIZE;
        const savedEnd = Math.min(savedStart + PAGE_SIZE, files.length);
        const remainingFiles = [...files.slice(0, savedStart), ...files.slice(savedEnd)];

        // Because we're physically shrinking the files array, all page numbers
        // AFTER activePage must move DOWN by one (since what was page N+1 is now
        // page N). If we simply keep advancing activePage without compacting,
        // the 2nd save would splice out the wrong slice of files. So instead:
        //  - Compact files (remove the active page's slice)
        //  - Renumber remaining staged items: pageNumber > activePage decremented by 1
        //  - If files is now EMPTY: reset activePage → 1, wipe processedPages ref
        //    so a brand-new upload starting from page 1 works cleanly.
        //  - Else: keep activePage the same (the next page has now shifted INTO
        //    activePage's position because we removed files before it), unless
        //    activePage would now exceed new totalPages (at the final page when
        //    saving the last non-final chunk) — clamp to new totalPages.
        setFiles(remainingFiles);

        setStaged((prev) => {
          const afterPageRemoval = prev.filter((item: any) => item.pageNumber !== activePage);
          const renumbered = afterPageRemoval.map((item: any) => {
            if (item.pageNumber > activePage) {
              return { ...item, pageNumber: item.pageNumber - 1 };
            }
            return item;
          });
          return renumbered;
        });

        // Also remove this page from the processed set so a future upload that
        // reaches the same page number can be processed again if needed.
        processedPagesRef.current.delete(activePage);

        if (remainingFiles.length === 0) {
          // ------ Final page saved: FULL RESET ------
          // Wipe every page tracker so starting a new upload from scratch works
          processedPagesRef.current = new Set();
          furthestScheduledPageRef.current = 0;
          processingTotalRef.current = 0;
          processingCompletedRef.current = 0;
          processingQueueRef.current = [];
          isProcessingRef.current = false;
          setProcessing(false);
          setProcessingProgress(null);
          setStreamErrors([]);
          setSelectedForMass(new Set());
          setActivePage(1);
        } else {
          // ------ More pages remain: keep activePage at same logical index ------
          // Because files for activePage were spliced out, what used to be page
          // (activePage + 1) is now page activePage, so activePage stays put.
          // Only if activePage is now past totalPages (edge case at final page)
          // do we clamp.
          const newTotalPages = Math.max(1, Math.ceil(remainingFiles.length / PAGE_SIZE));
          if (activePage > newTotalPages) {
            setActivePage(newTotalPages);
          } else {
            // Kick off lookahead processing for the (now-shifted) current page
            // and its next-page lookahead buffer (the new shifted active page
            // may not yet have been pre-processed if the old buffer ended one
            // page earlier).
            triggerPageProcessing(remainingFiles, activePage);
          }
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
          Auto-partitioned 100-file batch streaming with 1-batch lookahead buffer
        </p>
      </div>

      <div className="space-y-6 max-w-5xl mx-auto">
        <UploadDropZone onFilesSelected={handleFilesSelected} />

        {/* Main Processing & Save Progress Bar Banner */}
        {files.length > 0 && (
          <div className="bg-panel border border-border rounded-2xl p-5 shadow-card space-y-2.5 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${processing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-sm font-semibold text-ink font-heading">
                  Progress: {Math.min(files.length, (activePage - 1) * PAGE_SIZE + activePageItems.length)} / {files.length} files processed
                </span>
              </div>
              <span className="text-xs font-mono font-semibold text-accent">
                {Math.round((Math.min(files.length, (activePage - 1) * PAGE_SIZE + activePageItems.length) / files.length) * 100)}%
              </span>
            </div>
            <div className="w-full bg-surface-hover/80 h-2.5 rounded-full overflow-hidden border border-border/50">
              <div
                className="bg-emerald-600 h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((Math.min(files.length, (activePage - 1) * PAGE_SIZE + activePageItems.length) / files.length) * 100))}%`
                }}
              />
            </div>
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
          <div className="bg-panel rounded-2xl border border-border p-6 shadow-card max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-ink font-heading">
                Active Batch ({activePageItems.length} Files) — Step {activePage} of {totalPages}
              </h3>
              <p className="text-xs text-muted mt-1">
                Assign categories & valid regions, then save to store in library and load the next batch.
              </p>
            </div>

            <button
              onClick={handleSaveCurrentPage}
              disabled={savingPage || activePageItems.length === 0}
              className="flex items-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all duration-150 transform active:scale-98 flex-shrink-0"
            >
              {savingPage ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving Batch & Loading Next...
                </>
              ) : (
                <>
                  <Save size={18} />
                  {activePage === totalPages ? "Save Final Batch to Library" : "Save Batch & Load Next Batch"}
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
            setStaged={setStagedForActivePage}
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