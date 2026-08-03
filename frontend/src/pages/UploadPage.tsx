import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, X, Save } from "lucide-react";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";
import { useUploadContext } from "../context/UploadContext";
import { API_BASE_URL } from "../config/api";
import { LIBRARIES_UI } from "../config/categories";
import ConfirmModal from "../components/common/ConfirmModal";
import { initializeConcurrencyPools, adjustConcurrencyForLoad } from "../lib/concurrencyController";
import { fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS } from "../lib/fetchWithTimeout";
import { setUploadUnsaved } from "../lib/navigationGuard";

const LIBRARIES = LIBRARIES_UI;
const PAGE_SIZE = 100;

interface FileSlot {
  file: File;
  originalIndex: number;
}

export default function UploadPage() {
  const { files, setFiles, staged, setStaged, clearAll } = useUploadContext();

  const fileSlotsRef = useRef<FileSlot[]>([]);
  const originalTotalFilesRef = useRef<number>(0);
  const processedOriginalIndicesRef = useRef<Set<number>>(new Set());
  const savedOriginalIndicesRef = useRef<Set<number>>(new Set());
  const processingQueueRef = useRef<(() => Promise<void>)[]>([]);
  const isProcessingRef = useRef(false);
  const processingTotalRef = useRef(0);
  const processingCompletedRef = useRef(0);
  const lookAheadRunningRef = useRef(false);

  const [savingPage, setSavingPage] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [selectedForMass, setSelectedForMass] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{ n: number; total: number } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [streamErrors, setStreamErrors] = useState<{ id: string; reason: string }[]>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number>(0);

  useEffect(() => {
    initializeConcurrencyPools();
  }, []);

  const didMountResetRef = useRef(false);
  useEffect(() => {
    if (didMountResetRef.current) return;
    didMountResetRef.current = true;

    clearAll();
    fileSlotsRef.current = [];
    originalTotalFilesRef.current = 0;
    processedOriginalIndicesRef.current = new Set();
    savedOriginalIndicesRef.current = new Set();
    processingQueueRef.current = [];
    isProcessingRef.current = false;
    processingTotalRef.current = 0;
    processingCompletedRef.current = 0;
    lookAheadRunningRef.current = false;
    setProcessing(false);
    setProcessingProgress(null);
    setStreamErrors([]);
    setSelectedForMass(new Set());
    setDuplicateWarning(null);
    setValidationMessage(null);
    setUploadStatus("idle");
    setSavingPage(false);
    setCurrentBatchIndex(0);
  }, []);

  useEffect(() => {
    const cleanupOrphanedFiles = async () => {
      const orphanedItems = sessionStorage.getItem('orphanedPreprocessedItems');
      if (!orphanedItems) return;

      try {
        const itemIds = JSON.parse(orphanedItems);
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
          sessionStorage.removeItem('orphanedPreprocessedItems');
          return;
        }

        await fetch(`${API_BASE_URL}/api/temp-files/batch-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds }),
        }).catch(err => console.error('Failed to cleanup orphaned files:', err));
      } catch (err) {
        console.error('Error parsing orphaned items:', err);
      }

      sessionStorage.removeItem('orphanedPreprocessedItems');
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

    const handlePageHide = () => {
      const orphanedItems = JSON.parse(sessionStorage.getItem('orphanedPreprocessedItems') || '[]');
      if (Array.isArray(orphanedItems) && orphanedItems.length > 0) {
        navigator.sendBeacon(
          `${API_BASE_URL}/api/temp-files/batch-delete`,
          JSON.stringify({ itemIds: orphanedItems })
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [staged.length, files.length]);

  const hasUnsavedChanges = staged.length > 0 || files.length > 0;

  useEffect(() => {
    setUploadUnsaved(hasUnsavedChanges);
    return () => {
      setUploadUnsaved(false);
    };
  }, [hasUnsavedChanges]);

  const totalOriginalBatches = useMemo(
    () => Math.max(1, Math.ceil(originalTotalFilesRef.current / PAGE_SIZE)),
    [staged.length, files.length, currentBatchIndex]
  );

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

  function enqueueRawFilesBatch(slots: FileSlot[], batchNumber: number) {
    if (slots.length === 0) return;

    const batchFiles = slots.map(s => s.file);
    processingTotalRef.current += batchFiles.length;

    const slotByItemId = new Map<string, FileSlot>();
    for (const s of slots) {
      const dotIndex = s.file.name.indexOf(".");
      const itemId = dotIndex === -1 ? s.file.name : s.file.name.slice(0, dotIndex);
      slotByItemId.set(itemId, s);
    }

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
                const slot = slotByItemId.get(msg.id);
                const origIdx = slot ? slot.originalIndex : -1;

                if (origIdx !== -1 && !processedOriginalIndicesRef.current.has(origIdx)) {
                  processedOriginalIndicesRef.current.add(origIdx);
                  processingCompletedRef.current++;
                  setProcessingProgress({
                    n: processingCompletedRef.current,
                    total: processingTotalRef.current,
                  });

                  const newItem = {
                    file: slot!.file,
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
                    pageNumber: Math.floor(origIdx / PAGE_SIZE),
                    globalIndex: origIdx,
                  };

                  const orphanedItems = JSON.parse(sessionStorage.getItem('orphanedPreprocessedItems') || '[]');
                  if (!orphanedItems.includes(msg.id)) {
                    orphanedItems.push(msg.id);
                    sessionStorage.setItem('orphanedPreprocessedItems', JSON.stringify(orphanedItems));
                  }

                  setStaged((prev) => [...prev, newItem]);
                }
              } else if (msg.status === "duplicate") {
                const slot = slotByItemId.get(msg.itemId);
                if (slot) {
                  const origIdx = slot.originalIndex;
                  if (!processedOriginalIndicesRef.current.has(origIdx)) {
                    processedOriginalIndicesRef.current.add(origIdx);
                    savedOriginalIndicesRef.current.add(origIdx);
                    processingCompletedRef.current++;
                    setProcessingProgress({
                      n: processingCompletedRef.current,
                      total: processingTotalRef.current,
                    });
                  }
                }
              } else if (msg.status === "error") {
                const displayReason = msg.reason && typeof msg.reason === "string" && msg.reason.trim().length > 0
                  ? msg.reason.replace(/\s+/g, " ").trim()
                  : "Unknown processing error — no details returned from worker";

                const displayId = msg.filename && typeof msg.filename === "string"
                  ? msg.filename
                  : (msg.id || "unknown");

                setStreamErrors((prev) => [...prev, { id: displayId, reason: displayReason }]);

                let slot = slotByItemId.get(msg.id);
                if (!slot && typeof msg.filename === "string") {
                  const dotIndex = msg.filename.indexOf(".");
                  const fileItemId = dotIndex === -1 ? msg.filename : msg.filename.slice(0, dotIndex);
                  slot = slotByItemId.get(fileItemId);
                }

                if (slot) {
                  const origIdx = slot.originalIndex;
                  if (!processedOriginalIndicesRef.current.has(origIdx)) {
                    processedOriginalIndicesRef.current.add(origIdx);
                    processingCompletedRef.current++;
                    setProcessingProgress({
                      n: processingCompletedRef.current,
                      total: processingTotalRef.current,
                    });
                  }
                }
              } else if (msg.status === "skipped") {
                const dotIndex = msg.filename.indexOf(".");
                const itemId = dotIndex === -1 ? msg.filename : msg.filename.slice(0, dotIndex);
                const slot = slotByItemId.get(itemId);
                if (slot) {
                  const origIdx = slot.originalIndex;
                  if (!processedOriginalIndicesRef.current.has(origIdx)) {
                    processedOriginalIndicesRef.current.add(origIdx);
                    processingCompletedRef.current++;
                    setProcessingProgress({
                      n: processingCompletedRef.current,
                      total: processingTotalRef.current,
                    });
                  }
                }
              } else if (msg.status === "complete") {
                if (msg.duplicates > 0) {
                  setDuplicateWarning(`${msg.duplicates} file(s) skipped — already in library`);
                  setTimeout(() => setDuplicateWarning(null), 5000);
                }

                setTimeout(() => {
                  setCurrentBatchIndex((prevCurrent) => {
                    const nextUnsaved = findFirstUnsavedBatch();
                    const totalSlots = fileSlotsRef.current.length;
                    if (totalSlots === 0) {
                      originalTotalFilesRef.current = 0;
                      return prevCurrent;
                    }
                    if (nextUnsaved !== prevCurrent) {
                      return nextUnsaved;
                    }
                    return prevCurrent;
                  });
                }, 50);
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, 0));
          if (done) break;
        }
      } catch (err) {
        console.error(`[Batch ${batchNumber}] Batch processing error:`, err);
      }
    });
  }

  const triggerBatchProcessingFor = useCallback((targetBatch: number) => {
    const totalSlots = fileSlotsRef.current.length;
    if (totalSlots === 0) return;

    const totalBatches = Math.ceil(totalSlots / PAGE_SIZE);
    const lookAheadBatch = Math.min(targetBatch + 1, totalBatches - 1);

    const batchesToProcess = [targetBatch];
    if (lookAheadBatch !== targetBatch) {
      batchesToProcess.push(lookAheadBatch);
    }

    for (const b of batchesToProcess) {
      const startIdx = b * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalSlots);

      const unprocessedSlots: FileSlot[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        const slot = fileSlotsRef.current[i];
        if (!slot) continue;
        if (savedOriginalIndicesRef.current.has(slot.originalIndex)) continue;
        if (processedOriginalIndicesRef.current.has(slot.originalIndex)) continue;
        unprocessedSlots.push(slot);
      }

      if (unprocessedSlots.length > 0) {
        enqueueRawFilesBatch(unprocessedSlots, b);
      }
    }

    startQueueWorker();
  }, []);

  useEffect(() => {
    if (lookAheadRunningRef.current) return;

    const totalSlots = fileSlotsRef.current.length;
    if (totalSlots === 0) return;

    const targetBatch = currentBatchIndex;
    const totalBatches = Math.ceil(totalSlots / PAGE_SIZE);
    const lookAheadBatch = Math.min(targetBatch + 1, totalBatches - 1);

    let needsLookAhead = false;
    const startIdx = lookAheadBatch * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, totalSlots);
    for (let i = startIdx; i < endIdx; i++) {
      const slot = fileSlotsRef.current[i];
      if (!slot) continue;
      if (savedOriginalIndicesRef.current.has(slot.originalIndex)) continue;
      if (!processedOriginalIndicesRef.current.has(slot.originalIndex)) {
        needsLookAhead = true;
        break;
      }
    }

    if (needsLookAhead && !isProcessingRef.current) {
      lookAheadRunningRef.current = true;
      setTimeout(() => {
        lookAheadRunningRef.current = false;
        triggerBatchProcessingFor(currentBatchIndex);
      }, 50);
    }
  }, [currentBatchIndex, staged.length, triggerBatchProcessingFor]);

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

    const nextSlotIndex = fileSlotsRef.current.length;
    const newSlots: FileSlot[] = validFiles.map((f, i) => ({
      file: f,
      originalIndex: nextSlotIndex + i,
    }));
    fileSlotsRef.current = [...fileSlotsRef.current, ...newSlots];
    originalTotalFilesRef.current = fileSlotsRef.current.length;

    const updatedFiles = [...files, ...validFiles];
    setFiles(updatedFiles);

    triggerBatchProcessingFor(currentBatchIndex);
  };

  const currentBatchItems = useMemo(() => {
    const within = staged.filter((item: any) => item.pageNumber === currentBatchIndex);
    within.sort((a: any, b: any) => Number(a.globalIndex) - Number(b.globalIndex));
    return within;
  }, [staged, currentBatchIndex]);

  const setStagedForCurrentBatch = useCallback(
    (action: React.SetStateAction<any[]>) => {
      setStaged((prevMaster) => {
        const currentBatchItemsLocal = prevMaster.filter((item: any) => item.pageNumber === currentBatchIndex);
        currentBatchItemsLocal.sort((a: any, b: any) => Number(a.globalIndex) - Number(b.globalIndex));
        const newBatchItems = typeof action === "function" ? action(currentBatchItemsLocal) : action;
        const otherItems = prevMaster.filter((item: any) => item.pageNumber !== currentBatchIndex);
        const merged = [...otherItems, ...newBatchItems];
        merged.sort((a: any, b: any) => Number(a.globalIndex) - Number(b.globalIndex));
        return merged;
      });
    },
    [currentBatchIndex]
  );

  const handleSetFilesFromChild = useCallback(
    (update: React.SetStateAction<File[]>) => {
      const filesBefore = [...files];
      const nextFiles: File[] =
        typeof update === "function" ? (update as any)(filesBefore) : update;

      const removedFiles = filesBefore.filter(
        (f) => !nextFiles.some((nf) => nf === f || nf.name === f.name)
      );

      for (const rf of removedFiles) {
        const slot = fileSlotsRef.current.find(
          (s) => s.file === rf || s.file.name === rf.name
        );
        if (slot) savedOriginalIndicesRef.current.add(slot.originalIndex);
      }

      setFiles(nextFiles);
    },
    [files, setFiles]
  );

  const findFirstUnsavedBatch = useCallback((): number => {
    const totalSlots = fileSlotsRef.current.length;
    for (let b = 0; b * PAGE_SIZE < totalSlots; b++) {
      const startIdx = b * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalSlots);
      let hasUnsavedInBatch = false;
      for (let i = startIdx; i < endIdx; i++) {
        if (!savedOriginalIndicesRef.current.has(i)) {
          hasUnsavedInBatch = true;
          break;
        }
      }
      if (hasUnsavedInBatch) return b;
    }
    return Math.ceil(totalSlots / PAGE_SIZE);
  }, []);

  useEffect(() => {
    const totalSlots = fileSlotsRef.current.length;
    if (totalSlots === 0) return;
    if (isProcessingRef.current) return;

    const totalBatches = Math.ceil(totalSlots / PAGE_SIZE);
    if (currentBatchIndex >= totalBatches) return;

    const currStart = currentBatchIndex * PAGE_SIZE;
    const currEnd = Math.min(currStart + PAGE_SIZE, totalSlots);
    let allCurrSaved = true;
    for (let i = currStart; i < currEnd; i++) {
      if (!savedOriginalIndicesRef.current.has(i)) {
        allCurrSaved = false;
        break;
      }
    }

    if (allCurrSaved) {
      const nextUnsaved = findFirstUnsavedBatch();
      if (nextUnsaved !== currentBatchIndex) {
        setCurrentBatchIndex(nextUnsaved);
      }
    }
  }, [currentBatchIndex, staged.length, findFirstUnsavedBatch]);

  const handleSaveCurrentBatch = async () => {
    if (currentBatchItems.length === 0) {
      setValidationMessage("No processed items to save in this batch.");
      setTimeout(() => setValidationMessage(null), 3000);
      return;
    }

    const missingCategory: string[] = [];
    const missingBagsRegion: string[] = [];

    currentBatchItems.forEach((s: any, i: number) => {
      const sn = `#${i + 1}`;
      if (!s.category || !s.subcategory) missingCategory.push(sn);
      if (s.category === "bags" && !s.valid_region_points) missingBagsRegion.push(sn);
    });

    if (missingCategory.length > 0 || missingBagsRegion.length > 0) {
      const msgs: string[] = [];
      if (missingCategory.length > 0) msgs.push(`Set category & subcategory for ${missingCategory.length} item(s)`);
      if (missingBagsRegion.length > 0) msgs.push(`Draw valid region for ${missingBagsRegion.length} bag item(s)`);
      setValidationMessage(msgs.join(" | "));
      setTimeout(() => setValidationMessage(null), 5000);
      return;
    }

    setSavingPage(true);
    setValidationMessage(null);

    try {
      const payloadItems = currentBatchItems.map((s: any) => ({
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
      if (!data.ok) {
        setUploadStatus("error");
        setValidationMessage(data.error || "Failed to save batch. Please try again.");
        return;
      }

      setUploadStatus("success");
      setTimeout(() => setUploadStatus("idle"), 3000);

      const savedItemIds: string[] = [];
      for (const s of currentBatchItems) {
        if (typeof s.globalIndex === "number") {
          savedOriginalIndicesRef.current.add(s.globalIndex);
        }
        if (s.itemId) savedItemIds.push(s.itemId);
      }

      const orphanedItems: string[] = JSON.parse(sessionStorage.getItem('orphanedPreprocessedItems') || '[]');
      const remainingOrphans = orphanedItems.filter((id: string) => !savedItemIds.includes(id));
      sessionStorage.setItem('orphanedPreprocessedItems', JSON.stringify(remainingOrphans));

      setStaged((prev) => prev.filter((item: any) => item.pageNumber !== currentBatchIndex));

      const remainingFilesList: File[] = [];
      for (const slot of fileSlotsRef.current) {
        if (savedOriginalIndicesRef.current.has(slot.originalIndex)) continue;
        remainingFilesList.push(slot.file);
      }
      setFiles(remainingFilesList);

      setSelectedForMass(new Set());

      const totalRemaining = fileSlotsRef.current.length - savedOriginalIndicesRef.current.size;

      if (totalRemaining === 0) {
        fileSlotsRef.current = [];
        originalTotalFilesRef.current = 0;
        processedOriginalIndicesRef.current = new Set();
        savedOriginalIndicesRef.current = new Set();
        processingTotalRef.current = 0;
        processingCompletedRef.current = 0;
        processingQueueRef.current = [];
        isProcessingRef.current = false;
        lookAheadRunningRef.current = false;
        setProcessing(false);
        setProcessingProgress(null);
        setStreamErrors([]);
        setCurrentBatchIndex(0);
        clearAll();
      } else {
        const nextFirstUnsaved = findFirstUnsavedBatch();
        setCurrentBatchIndex(nextFirstUnsaved);

        const totalBatches = Math.ceil(fileSlotsRef.current.length / PAGE_SIZE);
        const nextLookAhead = Math.min(nextFirstUnsaved + 1, totalBatches - 1);

        if (nextLookAhead !== nextFirstUnsaved) {
          setTimeout(() => {
            triggerBatchProcessingFor(nextFirstUnsaved);
          }, 100);
        }
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("error");
    } finally {
      setSavingPage(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedForMass.size === currentBatchItems.length) {
      setSelectedForMass(new Set());
    } else {
      setSelectedForMass(new Set(currentBatchItems.map((_, i) => i)));
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

  const displayDenominator = originalTotalFilesRef.current;
  const displayNumerator = Math.min(
    displayDenominator,
    processingCompletedRef.current
  );
  const displayPercent = displayDenominator > 0
    ? Math.min(100, Math.round((displayNumerator / displayDenominator) * 100))
    : 0;

  const remainingSlotsCount = fileSlotsRef.current.length - savedOriginalIndicesRef.current.size;
  const isFinalBatch = remainingSlotsCount <= PAGE_SIZE;

  return (
    <div className="w-full py-6 px-6 animate-fade-in">
      <div className="border-l-4 border-accent pl-4 mb-8">
        <h2 className="text-3xl font-bold text-ink tracking-tight font-heading">Upload Images</h2>
        <p className="text-sm text-muted mt-1">
          100-file batches with automatic look-ahead pre-processing — next batch is always buffered and ready
        </p>
      </div>

      <div className="space-y-6 max-w-5xl mx-auto">
        <UploadDropZone onFilesSelected={handleFilesSelected} />

        {displayDenominator > 0 && (
          <div className="bg-panel border border-border rounded-2xl p-5 shadow-card space-y-2.5 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${processing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-sm font-semibold text-ink font-heading">
                  Progress: {displayNumerator.toLocaleString()} / {displayDenominator.toLocaleString()} files processed
                </span>
              </div>
              <span className="text-xs font-mono font-semibold text-accent">
                {displayPercent}%
              </span>
            </div>
            <div className="w-full bg-surface-hover/80 h-2.5 rounded-full overflow-hidden border border-border/50">
              <div
                className="bg-emerald-600 h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${displayPercent}%`
                }}
              />
            </div>
          </div>
        )}

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

        {currentBatchItems.length > 0 && displayDenominator > 0 && (
          <div className="bg-panel rounded-2xl border border-border p-6 shadow-card max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-ink font-heading">
                Active Batch ({currentBatchItems.length} Files) — Batch {currentBatchIndex + 1} of {totalOriginalBatches}
              </h3>
              <p className="text-xs text-muted mt-1">
                Assign categories & valid regions, then save to store in library and reveal the next pre-buffered batch instantly.
              </p>
            </div>

            <button
              onClick={handleSaveCurrentBatch}
              disabled={savingPage || currentBatchItems.length === 0}
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
                  {isFinalBatch ? "Save Final Batch to Library" : "Save Batch & Load Next Batch"}
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

        {staged.length > 0 && currentBatchItems.length > 0 && (
          <UploadFileQueue
            files={files}
            staged={currentBatchItems}
            setStaged={setStagedForCurrentBatch}
            setFiles={handleSetFilesFromChild}
            uploading={savingPage}
            processing={processing}
            handleUpload={handleSaveCurrentBatch}
            selectedForMass={selectedForMass}
            onToggleSelect={toggleSelect}
            onSelectAll={toggleSelectAll}
          />
        )}

        </div>

      {uploadStatus === "success" && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-emerald-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <span className="text-sm font-medium">Batch saved! Loaded next pre-buffered batch instantly.</span>
        </div>
      )}

      {uploadStatus === "error" && (
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
