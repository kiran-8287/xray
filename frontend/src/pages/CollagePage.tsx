import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Grid3X3, X, FolderOpen, Download, Edit3, Save, Play } from "lucide-react";
import { IoMdPhotos } from "react-icons/io";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS } from "../lib/fetchWithTimeout";
import { GenerationService } from "../lib/generationService";
import { clearAll as storageClearAll, addFailures } from "../lib/storageService";
import type { Item } from "../types/library";
import type { CombinatorialResult, FailureLog } from "../types/customization";
import SyntheticPreview from "../components/collage/SyntheticPreview";
import { getRectCorners, getTransformedPolygon } from "../lib/geometry";
import ConfirmModal from "../components/common/ConfirmModal";
import ExportLocationSelector from "../components/common/ExportLocationSelector";

import type { GenerationProgress, GenerationState, AutoSaveStatus, AutoSaveMode } from "../types/generation";
import { buildLayoutPayload } from "../lib/layoutBuilder";

const ITEMS_PER_PAGE = GenerationService.ITEMS_PER_PAGE;
const MAX_CONCURRENT_RENDERS = 2; // Limit concurrent image rendering to prevent backend overload

const toastStyles = `
  @keyframes slide-up {
    from { transform: translate(-50%, 20px); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
  }
  .animate-slide-up { animation: slide-up 0.25s ease-out; }
`;

type CollageToast = { id: string; type: "info"; message: string };

export default function CollagePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as
    | { selectedBags?: Item[]; selectedThreats?: Item[]; selectedOthers?: Item[]; densityPreset?: "empty" | "few" | "filled" }
    | undefined;

  const [selectedBags, setSelectedBags] = useState<Item[]>([]);
  const [selectedThreats, setSelectedThreats] = useState<Item[]>([]);
  const [selectedOthers, setSelectedOthers] = useState<Item[]>([]);

  const [combinations, setCombinations] = useState<CombinatorialResult[]>([]);
  const [failures, setFailures] = useState<FailureLog[]>([]);
  const [bufferCount, setBufferCount] = useState(0);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ generated: number; total: number } | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus | null>(null);

  const [autoSave, setAutoSave] = useState<boolean>(false);
  const [autoSaveLocalMode, setAutoSaveLocalMode] = useState<AutoSaveMode>("annotations");
  const [showAutoSaveModeDialog, setShowAutoSaveModeDialog] = useState(false);

  const [toasts, setToasts] = useState<CollageToast[]>([]);

  const showToast = (type: CollageToast["type"], message: string) => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  };

  const [bulkSaveState, setBulkSaveState] = useState<{
    status: "idle" | "saving" | "success" | "error";
    message: string;
    savedCount: number;
  }>({ status: "idle", message: "", savedCount: 0 });

  const [isSavingPage, setIsSavingPage] = useState(false);

  const [showSaveThisPageDialog, setShowSaveThisPageDialog] = useState(false);
  const [pendingSavePageMode, setPendingSavePageMode] = useState<AutoSaveMode | null>(null);

  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

  const [selectedCombination, setSelectedCombination] = useState<CombinatorialResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saveImageState, setSaveImageState] = useState<{
    status: "idle" | "saving" | "success" | "error";
    message: string;
    imageUrl: string | null;
  }>({ status: "idle", message: "", imageUrl: null });

  const [showSaveLocationModal, setShowSaveLocationModal] = useState(false);
  const [saveLocationOption, setSaveLocationOption] = useState<"default" | "custom">("default");
  const [customOutputPath, setCustomOutputPath] = useState("");
  const [selectedDirHandle, setSelectedDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [pendingSaveAction, setPendingSaveAction] = useState<{ type: "single" | "bulk"; saveImages?: boolean } | null>(null);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);

  useEffect(() => {
    GenerationService.restoreFromStorage();
    const serviceState = GenerationService.getState();
    const hasActiveResults = GenerationService.isGenerating() || serviceState.combinations.length > 0 || GenerationService.getBufferCount() > 0;

    const unsub = GenerationService.subscribe((state) => {
      setIsGenerating(state.isGenerating);
      setGenerationProgress(state.progress);
      setAutoSaveStatus(state.autoSaveStatus);
      setCombinations(state.combinations);
      setFailures(state.failures);
      setBufferCount(GenerationService.getBufferCount());
      if (state.autoSaveStatus) {
        setAutoSave(state.autoSaveStatus.enabled);
        setAutoSaveLocalMode(state.autoSaveStatus.mode);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (GenerationService.isGenerating()) return;
    if (locationState && locationState.selectedBags && locationState.selectedBags.length > 0) {
      return;
    }

    (async () => {
      const serviceState = GenerationService.getState();
      if (serviceState.combinations.length > 0) {
        setCombinations(serviceState.combinations);
        setFailures(serviceState.failures);
        return;
      }

    const restoredCombos: unknown[] = [];
    const restoredFailures: unknown[] = [];
    const restoredBags: unknown[] = [];
    const restoredThreats: unknown[] = [];
    const restoredOthers: unknown[] = [];
    let restoreError: string | null = null;

    const readJSON = (raw: string | null): unknown | null => {
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    function hasBagId(combo: unknown): combo is { bag: { id: string } } {
      return isRecord(combo) && isRecord(combo.bag) && typeof combo.bag.id === "string";
    }

    function hasThreatsArray(combo: unknown): combo is { threats: { id: string }[] } {
      return isRecord(combo) && Array.isArray(combo.threats);
    }

    function hasOthersArray(combo: unknown): combo is { others: { id: string }[] } {
      return isRecord(combo) && Array.isArray(combo.others);
    }

    function hasId(value: unknown): value is { id: string } {
      return isRecord(value) && typeof value.id === "string";
    }

    try {
      // Try IndexedDB first (handles large datasets)
      const [idbCombos, idbFailures] = await Promise.all([
        import("../lib/storageService").then(m => m.getAllCombos()),
        import("../lib/storageService").then(m => m.getAllFailures()),
      ]);

      if (idbCombos.length > 0) {
        restoredCombos.push(...idbCombos);
      }
      if (idbFailures.length > 0) {
        restoredFailures.push(...idbFailures);
      }

      // Fallback to sessionStorage if IndexedDB is empty (first-time users)
      if (restoredCombos.length === 0) {
        restoredCombos.push(...(readJSON(sessionStorage.getItem("collageCombinations")) || []));
      }
      if (restoredFailures.length === 0) {
        restoredFailures.push(...(readJSON(sessionStorage.getItem("collageFailures")) || []));
      }

      restoredBags.push(...(readJSON(localStorage.getItem("selectedBags")) || []));
      restoredThreats.push(...(readJSON(localStorage.getItem("selectedThreats")) || []));
      restoredOthers.push(...(readJSON(localStorage.getItem("selectedOthers")) || []));
    } catch (err) {
      console.error("[CollagePage] error reading storage:", err);
      restoreError = String(err);
    }

    if (
      restoredCombos.length === 0 && restoredFailures.length === 0 &&
      restoredBags.length === 0 && restoredThreats.length === 0 && restoredOthers.length === 0
    ) return;

    const applyRestore = (fb: unknown[] | null, ft: unknown[] | null, fo: unknown[] | null) => {
      const bags = fb || restoredBags;
      const threats = ft || restoredThreats;
      const others = fo || restoredOthers;
      if (restoredCombos.length > 0) {
        GenerationService.setCombinations(restoredCombos as CombinatorialResult[], restoredFailures as FailureLog[]);
      }
      setFailures(restoredFailures as FailureLog[]);
      setSelectedBags(bags as Item[]); setSelectedThreats(threats as Item[]); setSelectedOthers(others as Item[]);
      if (restoreError) console.warn("[CollagePage] " + restoreError);
      // Note: combos and failures are now persisted to IndexedDB by generationService/storageService
      try {
        localStorage.setItem("selectedBags", JSON.stringify(bags));
        localStorage.setItem("selectedThreats", JSON.stringify(threats));
        localStorage.setItem("selectedOthers", JSON.stringify(others));
      } catch (e) {
        console.error("[CollagePage] error re-saving after restore:", e);
      }
    };

    const comboItemIds = new Set<string>();
    for (const c of restoredCombos) {
      if (hasBagId(c)) comboItemIds.add(c.bag.id);
      if (hasThreatsArray(c) && c.threats.length > 0) {
        for (const t of c.threats) {
          if (hasId(t)) comboItemIds.add(t.id);
        }
      }
      if (hasOthersArray(c)) {
        for (const o of c.others) {
          if (hasId(o)) comboItemIds.add(o.id);
        }
      }
    }

    function hasIdAndCategory(value: unknown): value is { id: string; category?: string } {
      return isRecord(value) && typeof value.id === "string";
    }

    if (restoredCombos.length > 0 && comboItemIds.size > 0 &&
        restoredBags.length === 0 && restoredThreats.length === 0 && restoredOthers.length === 0) {
      (async () => {
        try {
          const res = await fetchWithTimeout(API_BASE_URL + "/api/items/categorized", undefined, 30000, 3, 1000, [429]);
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          const cat = data.categorized || data;
          const matchedBags: unknown[] = [], matchedThreats: unknown[] = [], matchedOthers: unknown[] = [];
          if (isRecord(cat)) {
            for (const subcats of Object.values(cat)) {
              if (!isRecord(subcats)) continue;
              for (const items of Object.values(subcats)) {
                if (!Array.isArray(items)) continue;
                for (const item of items) {
                  if (!hasIdAndCategory(item) || !comboItemIds.has(item.id)) continue;
                  const cl = (item.category || "").toLowerCase();
                  if (cl.includes("bag")) matchedBags.push(item);
                  else if (cl.includes("threat")) matchedThreats.push(item);
                  else matchedOthers.push(item);
                }
              }
            }
          }
          applyRestore(matchedBags, matchedThreats, matchedOthers);
        } catch (e) {
          console.error("[CollagePage] fetch fresh items failed:", e);
          applyRestore(restoredBags, restoredThreats, restoredOthers);
        }
      })();
      return;
    }

    applyRestore(null, null, null);
    })(); // Close outer async IIFE
  }, []);

  useEffect(() => {
    if (!locationState || !locationState.selectedBags || locationState.selectedBags.length === 0) {
      return;
    }
    const serviceState = GenerationService.getState();
    if (serviceState.combinations.length > 0) {
      return;
    }

    const { selectedBags: bags, selectedThreats: threats, selectedOthers: others, combinations: preCombinations, failures: preFailures } = locationState as {
      selectedBags?: Item[];
      selectedThreats?: Item[];
      selectedOthers?: Item[];
      combinations?: CombinatorialResult[];
      failures?: FailureLog[];
    };

    setSelectedBags(bags);
    setSelectedThreats(threats || []);
    setSelectedOthers(others || []);
    if (preCombinations && preCombinations.length > 0) {
      GenerationService.setCombinations(preCombinations, preFailures || []);
    }
    setFailures(preFailures && preFailures.length > 0 ? preFailures : []);

    try {
      localStorage.setItem("selectedBags", JSON.stringify(bags));
      localStorage.setItem("selectedThreats", JSON.stringify(threats || []));
      localStorage.setItem("selectedOthers", JSON.stringify(others || []));
    } catch (err) {
      console.error("Error saving collage state to localStorage:", err);
    }
  }, [locationState]);

  useEffect(() => {
    if (failures.length > 0) {
      addFailures(failures);
    }
  }, [failures]);

  // Warn user and clean up if they reload during generation or if results exist
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (GenerationService.isGenerating()) {
        // Clean up the generation process
        GenerationService.abort();

        // Show browser's native confirmation dialog
        const message = "Combination generation is in progress. If you reload, all progress will be lost. Are you sure you want to continue?";
        event.returnValue = message;
        return message;
      }

      if (GenerationService.hasGeneratedResults()) {
        const message = "You have generated combinations that haven't been fully saved. If you reload, progress will be lost. Are you sure you want to continue?";
        event.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const handleToggleAutoSave = (checked: boolean) => {
    if (checked) {
      setShowAutoSaveModeDialog(true);
    } else {
      GenerationService.disableAutoSave();
      setAutoSave(false);
      showToast("info", "Save as you go disabled");
    }
  };

  const confirmAutoSaveWithMode = (mode: AutoSaveMode) => {
    setAutoSaveLocalMode(mode);
    setAutoSave(true);
    setShowAutoSaveModeDialog(false);
    GenerationService.enableAutoSave(mode);
    showToast(
      "info",
      `Save as you go enabled (${mode === "both" ? "Annotations + Images" : "Annotations Only"}). Processing pages of 100...`
    );
  };

  const handleRequestSaveThisPage = () => {
    setPendingSavePageMode(null);
    setShowSaveThisPageDialog(true);
  };

  const confirmSaveThisPage = (mode: AutoSaveMode) => {
    setShowSaveThisPageDialog(false);
    setPendingSavePageMode(mode);
    executeSaveThisPage(mode);
  };

  const executeSaveThisPage = async (mode: AutoSaveMode) => {
    if (combinations.length === 0) return;
    setIsSavingPage(true);
    const saved = await GenerationService.saveCurrentPage(mode);
    if (saved > 0) {
      const freshBufferCount = GenerationService.getBufferCount();
      setBufferCount(freshBufferCount);
      showToast("info", `✓ ${saved} combinations saved (${mode === "both" ? "Annotations + Images" : "Annotations Only"}) — display refreshed from buffer (${freshBufferCount.toLocaleString()} remaining)`);
    } else {
      showToast("info", `Failed to save combinations — please retry`);
    }
    setIsSavingPage(false);
    setPendingSavePageMode(null);
  };

  const handleOpenCombination = (comb: CombinatorialResult) => {
    const storageKey = `xray_workspace_precomputed_${comb.id}`;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(comb.objects));
    } catch (err) {
      console.error("Error saving precomputed objects:", err);
    }

    const queryParams = new URLSearchParams();
    queryParams.set("bagId", comb.bag.id);
    if (comb.threats && comb.threats.length > 0) {
      queryParams.set("threatIds", comb.threats.map(t => t.id).join(","));
    }
    if (comb.others.length > 0) {
      queryParams.set("otherIds", comb.others.map((o) => o.id).join(","));
    }
    queryParams.set("precomputed", comb.id);

    navigate(`/customize?${queryParams.toString()}`);
  };

  const handleOpenPreviewModal = (comb: CombinatorialResult) => {
    setSelectedCombination(comb);
    setShowModal(true);
    setSaveImageState({ status: "idle", message: "", imageUrl: null });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedCombination(null);
    setSaveImageState({ status: "idle", message: "", imageUrl: null });
  };

  async function saveBlobsToFolder(highBlob: Blob, lowBlob: Blob, filename: string, dirHandle: FileSystemDirectoryHandle) {
    const collageDir = await dirHandle.getDirectoryHandle('collage_images', { create: true });
    const highDir = await collageDir.getDirectoryHandle('high', { create: true });
    const lowDir = await collageDir.getDirectoryHandle('low', { create: true });

    const highFile = await highDir.getFileHandle(filename, { create: true });
    const highWritable = await highFile.createWritable();
    await highWritable.write(highBlob);
    await highWritable.close();

    const lowFile = await lowDir.getFileHandle(filename, { create: true });
    const lowWritable = await lowFile.createWritable();
    await lowWritable.write(lowBlob);
    await lowWritable.close();
  }

  const handleChooseDirectory = async () => {
    if (typeof window === "undefined" || !(window as Window & typeof globalThis & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker) {
      showToast("info", "This browser does not support folder picker. Please enter a custom path instead.");
      setSaveLocationOption("custom");
      return;
    }

    try {
      setIsChoosingFolder(true);
      const dirHandle = await (window as Window & typeof globalThis & { showDirectoryPicker: (options?: { mode?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
        mode: "readwrite",
        startIn: "desktop",
      });
      setSelectedDirHandle(dirHandle);
      setSaveLocationOption("custom");
      setCustomOutputPath("");
      showToast("info", "Folder selected. Click Continue to save the collage images there.");
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Error choosing directory:", err);
        showToast("info", "Folder selection was cancelled or unavailable.");
      }
    } finally {
      setIsChoosingFolder(false);
    }
  };

  const handleSaveImage = async () => {
    if (!selectedCombination) return;
    setPendingSaveAction({ type: "single" });
    setShowSaveLocationModal(true);
  };

  const executeSaveImage = async (outputPath?: string, dirHandle?: FileSystemDirectoryHandle | null) => {
    if (!selectedCombination) return;

    setSaveImageState({ status: "saving", message: "Rendering high & low energy images...", imageUrl: null });

    try {
      // Concurrency-limited image rendering
      const semaphore = { current: 0, queue: [] as (() => void)[] };
      const acquire = () => new Promise<void>((resolve) => {
        if (semaphore.current < MAX_CONCURRENT_RENDERS) {
          semaphore.current++;
          resolve();
        } else {
          semaphore.queue.push(resolve);
        }
      });
      const release = () => {
        semaphore.current--;
        if (semaphore.queue.length > 0 && semaphore.current < MAX_CONCURRENT_RENDERS) {
          const next = semaphore.queue.shift()!;
          semaphore.current++;
          next();
        }
      };

      await acquire();
      try {
        if (dirHandle) {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/render-and-save-collage-both`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              objects: selectedCombination.objects,
              name: selectedCombination.id,
            }),
          }, LONG_REQUEST_TIMEOUT_MS, 1);

          if (!response.ok) {
            throw new Error("Failed to render images");
          }

          const data = await response.json();
          const safeName = selectedCombination.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
          const filename = `${safeName}.png`;

          const highUrl = `${API_BASE_URL}${data.high_url}`;
          const lowUrl = `${API_BASE_URL}${data.low_url}`;

          const [highRes, lowRes] = await Promise.all([fetch(highUrl), fetch(lowUrl)]);
          const [highBlob, lowBlob] = await Promise.all([highRes.blob(), lowRes.blob()]);

          await saveBlobsToFolder(highBlob, lowBlob, filename, dirHandle);

          setSaveImageState({
            status: "success",
            message: `High & low energy images saved to selected folder!`,
            imageUrl: data.high_url,
          });
        } else {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/render-and-save-collage-both`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              objects: selectedCombination.objects,
              name: selectedCombination.id,
              outputPath: outputPath || undefined,
            }),
          }, LONG_REQUEST_TIMEOUT_MS, 1);

          if (!response.ok) {
            throw new Error("Failed to render images");
          }

          const data = await response.json();
          setSaveImageState({
            status: "success",
            message: `High & low energy images saved!`,
            imageUrl: data.high_url,
          });
        }
      } finally {
        release();
      }
    } catch (err) {
      console.error("Error saving images:", err);
      setSaveImageState({
        status: "error",
        message: "Failed to save images. Make sure backend is running.",
        imageUrl: null,
      });
    }
  };

  const handleBulkSave = async (saveImages: boolean = false) => {
    if (saveImages) {
      setShowSaveThisPageDialog(false);
      setPendingSaveAction({ type: "bulk", saveImages });
      setShowSaveLocationModal(true);
      return;
    }

    setShowSaveThisPageDialog(false);
    setBulkSaveState({ status: "saving", message: "Saving all workspaces...", savedCount: 0 });
    let savedCount = 0;
    let failedCount = 0;

    try {
      while (combinations.length > 0 || bufferCount > 0 || isGenerating) {
        if (combinations.length === 0) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        const batch = combinations.slice(0, ITEMS_PER_PAGE);
        for (const comb of batch) {
          try {
            const response = await fetch(`${API_BASE_URL}/api/saved-layouts`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(buildLayoutPayload(comb)),
            });
            if (response.ok) savedCount++; else failedCount++;
          } catch { failedCount++; }
        }
        setCombinations(prev => prev.slice(batch.length));
        setBufferCount(GenerationService.getBufferCount());
        setBulkSaveState(prev => ({
          ...prev,
          message: `Saving workspaces... (${savedCount} saved)`,
          savedCount
        }));
      }

      if (failedCount === 0) {
        setBulkSaveState({
          status: "success",
          message: `Successfully saved ${savedCount} workspace${savedCount !== 1 ? "s" : ""}!`,
          savedCount
        });
        GenerationService.clear();
        setCombinations([]);
        setFailures([]);
        setSelectedBags([]);
        setSelectedThreats([]);
        setSelectedOthers([]);
        setBufferCount(0);
        // Clear IndexedDB storage
        storageClearAll();
        try {
          localStorage.removeItem("selectedBags");
          localStorage.removeItem("selectedThreats");
          localStorage.removeItem("selectedOthers");
        } catch (e) {
          console.error("Error clearing storage after bulk save:", e);
        }
        
        // Reset bulk save state to idle after showing success message
        setTimeout(() => {
          setBulkSaveState({ status: "idle", message: "", savedCount: 0 });
        }, 3000);
      } else {
        setBulkSaveState({
          status: "error",
          message: `Partially saved: ${savedCount} succeeded, ${failedCount} failed. Your combinations are preserved — please retry.`,
          savedCount
        });
      }
    } catch (err) {
      console.error(err);
      setBulkSaveState({
        status: "error",
        message: "Failed to bulk save workspaces. Please verify backend is running. Your combinations are preserved.",
        savedCount
      });
    }
  };

  const executeBulkSave = async (outputPath?: string, dirHandle?: FileSystemDirectoryHandle | null) => {
    if (!pendingSaveAction?.saveImages) return;

    setShowSaveLocationModal(false);
    setBulkSaveState({ status: "saving", message: "Saving all workspaces...", savedCount: 0 });
    let savedCount = 0;
    let failedCount = 0;

    // Concurrency limiter for image rendering
    const semaphore = { current: 0, queue: [] as (() => void)[] };
    const acquire = () => new Promise<void>((resolve) => {
      if (semaphore.current < MAX_CONCURRENT_RENDERS) {
        semaphore.current++;
        resolve();
      } else {
        semaphore.queue.push(resolve);
      }
    });
    const release = () => {
      semaphore.current--;
      if (semaphore.queue.length > 0 && semaphore.current < MAX_CONCURRENT_RENDERS) {
        const next = semaphore.queue.shift()!;
        semaphore.current++;
        next();
      }
    };

    try {
      while (combinations.length > 0 || bufferCount > 0 || isGenerating) {
        if (combinations.length === 0) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        const batch = combinations.slice(0, ITEMS_PER_PAGE);
        for (const comb of batch) {
          const layoutPayload = buildLayoutPayload(comb);
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/saved-layouts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(layoutPayload),
          }, LONG_REQUEST_TIMEOUT_MS, 1);
          if (response.ok) {
            savedCount++;
            // Render images with concurrency limit
            if (pendingSaveAction.saveImages) {
              await acquire();
              try {
                const renderRes = await fetchWithTimeout(`${API_BASE_URL}/api/render-and-save-collage-both`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    objects: comb.objects,
                    name: comb.id,
                    outputPath: dirHandle ? undefined : (outputPath || undefined),
                  }),
                }, LONG_REQUEST_TIMEOUT_MS, 1);
                if (dirHandle && renderRes.ok) {
                  const renderData = await renderRes.json();
                  const safeName = comb.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
                  const filename = `${safeName}.png`;
                  const [highRes, lowRes] = await Promise.all([
                    fetch(`${API_BASE_URL}${renderData.high_url}`),
                    fetch(`${API_BASE_URL}${renderData.low_url}`)
                  ]);
                  const [highBlob, lowBlob] = await Promise.all([highRes.blob(), lowRes.blob()]);
                  await saveBlobsToFolder(highBlob, lowBlob, filename, dirHandle);
                }
              } catch (err) {
                console.error(`Error saving images for ${comb.id}:`, err);
              } finally {
                release();
              }
            }
          } else {
            failedCount++;
          }
        }
        setCombinations(prev => prev.slice(batch.length));
        setBufferCount(GenerationService.getBufferCount());
        setBulkSaveState(prev => ({
          ...prev,
          message: `Saving workspaces... (${savedCount} saved)`,
          savedCount
        }));
      }

      setBulkSaveState({
        status: "success",
        message: `Successfully saved ${savedCount} workspace${savedCount !== 1 ? "s" : ""}!${failedCount > 0 ? ` (${failedCount} failed)` : ""}`,
        savedCount
      });
      GenerationService.clear();
      setFailures([]);
      setSelectedBags([]);
      setSelectedThreats([]);
      setSelectedOthers([]);
      setBufferCount(0);
      // Clear IndexedDB storage
      storageClearAll();
      try {
        localStorage.removeItem("selectedBags");
        localStorage.removeItem("selectedThreats");
        localStorage.removeItem("selectedOthers");
      } catch (e) {
        console.error("Error clearing storage after bulk save:", e);
      }
      
      // Reset bulk save state to idle after showing success message
      setTimeout(() => {
        setBulkSaveState({ status: "idle", message: "", savedCount: 0 });
      }, 3000);
    } catch (err) {
      console.error(err);
      setBulkSaveState({
        status: "error",
        message: "Failed to bulk save workspaces. Please verify backend is running.",
        savedCount
      });
    }
  };

  const handleSaveLocationConfirm = () => {
    if (!pendingSaveAction) return;

    const dirHandle = selectedDirHandle;
    const outputPath = saveLocationOption === "custom" ? customOutputPath.trim() : undefined;

    setPendingSaveAction(null);
    setCustomOutputPath("");
    setSaveLocationOption("default");
    setSelectedDirHandle(null);
    setShowSaveLocationModal(false);

    if (pendingSaveAction.type === "single") {
      executeSaveImage(outputPath, dirHandle);
    } else if (pendingSaveAction.type === "bulk") {
      executeBulkSave(outputPath, dirHandle);
    }
  };

  const handleNavigateToLibrary = () => {
    const totalPending = combinations.length + bufferCount;
    if (totalPending > 0 && !isGenerating && bulkSaveState.status !== "success") {
      setShowUnsavedModal(true);
      setPendingNavigation(() => () => navigate("/library"));
    } else {
      navigate("/library");
    }
  };

  const handleUnsavedModalAction = (action: "discard" | "cancel") => {
    if (action === "discard") {
      setShowUnsavedModal(false);
      GenerationService.clear();
      if (pendingNavigation) {
        pendingNavigation();
        setPendingNavigation(null);
      }
    } else {
      setShowUnsavedModal(false);
      setPendingNavigation(null);
    }
  };

  const totalPending = combinations.length + bufferCount;
  const totalRequested = generationProgress?.total || 0;
  const totalGenerated = generationProgress?.generated || 0;
  // Only show auto-save banner while there are still combinations to process or generation is active
  const showAutoSaveBanner = autoSaveStatus?.enabled && (
    isGenerating || totalPending > 0
  );

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 animate-fade-in text-sm">
      <style>{toastStyles}</style>

      {/* Header Row */}
      <div className="flex items-end justify-between mb-8 border-l-4 border-accent pl-4">
        <div>
          <h2 className="text-3xl font-bold text-ink tracking-tight font-heading">Collage Images</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ExportLocationSelector scope="collage" />
          {(totalPending > 0 || isGenerating) && (
          <div className="flex items-center gap-3 flex-wrap">
            {/* Save this page button */}
            <button
              onClick={handleRequestSaveThisPage}
              disabled={isSavingPage || combinations.length === 0 || (autoSaveStatus?.enabled ?? false)}
              className="px-5 py-2.5 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-btn flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
              title={autoSaveStatus?.enabled ? "Save as you go is active — pages are saved automatically" : "Save the currently displayed combinations (100 max) and load the next batch"}
            >
              {isSavingPage ? (
                <Loader2 className="animate-spin" size={15} />
              ) : (
                <Save size={15} />
              )}
              <span>Save this page</span>
            </button>

            {/* Save as you go toggle */}
            <div className="flex items-center gap-2 bg-blue-50/80 border border-blue-200/80 rounded-xl px-3.5 py-2 text-blue-900 font-medium transition-colors shadow-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSave}
                  onChange={(e) => handleToggleAutoSave(e.target.checked)}
                  disabled={isSavingPage}
                  className="w-4 h-4 border border-blue-300 rounded bg-white text-blue-600 focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-xs whitespace-nowrap font-semibold">Save as you go</span>
              </label>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Generation Progress Banner */}
      {isGenerating && generationProgress && (
        <div className="mb-6 p-4 rounded-xl border bg-blue-50 border-blue-200 text-blue-800 transition-all duration-300">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-blue-600 shrink-0" size={24} />
            <div className="flex-1">
              <p className="font-semibold text-sm">
                Generating combinations... ({generationProgress.generated.toLocaleString()} / {generationProgress.total.toLocaleString()})
              </p>
              <div className="mt-2 w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (generationProgress.generated / generationProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Save Progress Banner */}
      {showAutoSaveBanner && (
        <div className="mb-6 p-3 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center justify-between text-xs font-medium flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>
              <strong className="font-semibold">Save as you go active ({autoSaveStatus.mode === "both" ? "Annotations + Images" : "Annotations Only"}):</strong>{' '}
              {autoSaveStatus.queued.toLocaleString()} combination{autoSaveStatus.queued !== 1 ? "s" : ""} saved across {autoSaveStatus.pagesCompleted} page{autoSaveStatus.pagesCompleted !== 1 ? "s" : ""}
              {autoSaveStatus.mode === "both" && autoSaveStatus.imagesSaved > 0 && ` (${autoSaveStatus.imagesSaved.toLocaleString()} images rendered)`}
            </span>
          </div>
          {autoSaveStatus.errors > 0 && (
            <span className="text-rose-600 font-semibold px-2 py-0.5 rounded bg-rose-100 border border-rose-200">
              {autoSaveStatus.errors} save error{autoSaveStatus.errors !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Bulk Save Status Banner */}
      {bulkSaveState.status !== "idle" && (
        <div className={`mb-6 p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 ${
          bulkSaveState.status === "saving"
            ? "bg-blue-50 border-blue-200 text-blue-800 animate-pulse"
            : bulkSaveState.status === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-rose-50 border-rose-200 text-rose-800"
        }`}>
          <div className="flex items-center gap-3">
            {bulkSaveState.status === "saving" && (<Loader2 className="animate-spin text-blue-600" size={24} />)}
            {bulkSaveState.status === "success" && (<CheckCircle2 className="text-emerald-600" size={24} />)}
            {bulkSaveState.status === "error" && (<XCircle className="text-rose-600" size={24} />)}
            <div>
              <p className="font-semibold text-sm">{bulkSaveState.message}</p>
            </div>
          </div>
          {bulkSaveState.status !== "saving" && (
            <button
              onClick={() => setBulkSaveState({ status: "idle", message: "", savedCount: 0 })}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Unsaved Combinations Navigation Warning Modal */}
      <ConfirmModal
        isOpen={showUnsavedModal}
        title="Unsaved Combinations"
        message="You have generated combinations that haven't been saved. If you leave this page, they will be discarded."
        confirmLabel="Discard & Leave"
        cancelLabel="Cancel"
        confirmVariant="danger"
        onConfirm={() => handleUnsavedModalAction("discard")}
        onCancel={() => handleUnsavedModalAction("cancel")}
      />

      {/* Auto-Save Mode Selection Dialog */}
      {showAutoSaveModeDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAutoSaveModeDialog(false)} />
          <div className="relative z-[10000] w-full max-w-md bg-white rounded-2xl shadow-lg border border-border p-6">
            <h3 className="text-base font-semibold text-ink mb-2 font-heading flex items-center gap-2">
              <Play size={18} className="text-blue-600" />
              Enable Save as you go
            </h3>
            <p className="text-sm text-muted mb-5">
              Choose how you want to save combinations. Pages of 100 will be saved automatically as they are generated,
              then cleared from memory and the next 100 processed until all {totalRequested.toLocaleString()} are done.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => confirmAutoSaveWithMode("both")}
                className="w-full px-4 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:shadow-btn-hover transition-all cursor-pointer text-left"
              >
                <span className="block text-base mb-0.5">Save Annotations + Images</span>
                <span className="block text-xs opacity-90 font-normal">
                  Save layout JSON annotations + render high &amp; low energy PNG images (slower)
                </span>
              </button>
              <button
                onClick={() => confirmAutoSaveWithMode("annotations")}
                className="w-full px-4 py-3 rounded-xl bg-panel border border-border text-ink font-semibold text-sm hover:bg-surface transition-all cursor-pointer text-left"
              >
                <span className="block text-base mb-0.5">Save Annotations Only</span>
                <span className="block text-xs text-muted font-normal">
                  Save layout JSON annotations only — no PNG rendering (fast)
                </span>
              </button>
              <button
                onClick={() => { setAutoSave(false); setShowAutoSaveModeDialog(false); }}
                className="w-full px-4 py-2.5 rounded-xl text-muted font-semibold text-sm hover:text-ink transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save This Page Mode Selection Dialog */}
      {showSaveThisPageDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowSaveThisPageDialog(false)} />
          <div className="relative z-[10000] w-full max-w-md bg-white rounded-2xl shadow-lg border border-border p-6">
            <h3 className="text-base font-semibold text-ink mb-2 font-heading flex items-center gap-2">
              <Save size={18} className="text-emerald-600" />
              Save this page ({combinations.length} combinations)
            </h3>
            <p className="text-sm text-muted mb-5">
              Choose how to save the currently displayed combinations. After saving, the next 100 combinations
              will be loaded automatically (from {bufferCount.toLocaleString()} already generated in buffer
              {totalGenerated > totalPending ? `, ${(totalGenerated - totalPending).toLocaleString()} previously saved` : ""}).
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => confirmSaveThisPage("both")}
                className="w-full px-4 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:shadow-btn-hover transition-all cursor-pointer text-left"
              >
                <span className="block text-base mb-0.5">Save Annotations + Images</span>
                <span className="block text-xs opacity-90 font-normal">
                  Save layout JSON + render PNG images to collage_images
                </span>
              </button>
              <button
                onClick={() => confirmSaveThisPage("annotations")}
                className="w-full px-4 py-3 rounded-xl bg-panel border border-border text-ink font-semibold text-sm hover:bg-surface transition-all cursor-pointer text-left"
              >
                <span className="block text-base mb-0.5">Save Annotations Only</span>
                <span className="block text-xs text-muted font-normal">
                  Save layout JSON annotations to savedLayouts.json only (no images)
                </span>
              </button>
              <button
                onClick={() => setShowSaveThisPageDialog(false)}
                className="w-full px-4 py-2.5 rounded-xl text-muted font-semibold text-sm hover:text-ink transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Location Modal */}
      {showSaveLocationModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => {
            setShowSaveLocationModal(false);
            setPendingSaveAction(null);
          }} />
          <div className="relative z-[10000] w-full max-w-md bg-white rounded-2xl shadow-lg border border-border p-6">
            <h3 className="text-base font-semibold text-ink mb-2 font-heading">Choose Save Location</h3>
            <p className="text-sm text-muted mb-5">
              Select where you want to save the collage images:
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setSaveLocationOption("default")}
                className={`w-full px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all cursor-pointer text-left ${
                  saveLocationOption === "default"
                    ? "border-accent bg-accent/5 text-ink"
                    : "border-border bg-panel text-ink hover:border-muted"
                }`}
              >
                <span className="block text-base mb-0.5">Default Location</span>
                <span className="block text-xs text-muted font-normal">
                  Save to backend/data/collage_images (current location)
                </span>
              </button>
              <button
                onClick={() => setSaveLocationOption("custom")}
                className={`w-full px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all cursor-pointer text-left ${
                  saveLocationOption === "custom"
                    ? "border-accent bg-accent/5 text-ink"
                    : "border-border bg-panel text-ink hover:border-muted"
                }`}
              >
                <span className="block text-base mb-0.5">Custom Location</span>
                <span className="block text-xs text-muted font-normal">
                  Choose a custom directory path
                </span>
              </button>

              <button
                onClick={handleChooseDirectory}
                disabled={isChoosingFolder}
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface text-ink font-semibold text-sm hover:bg-panel transition-all cursor-pointer text-left flex items-center gap-2"
              >
                <FolderOpen size={16} className="text-accent" />
                <span>{isChoosingFolder ? "Selecting folder..." : "Choose folder from desktop"}</span>
              </button>

              {selectedDirHandle && (
                <div className="mt-1 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                  <p className="text-xs text-emerald-800">
                    Selected folder: <span className="font-semibold">{selectedDirHandle.name}</span>
                  </p>
                </div>
              )}

              {saveLocationOption === "custom" && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-ink mb-1.5">Full Folder Path</label>
                  <input
                    type="text"
                    value={customOutputPath}
                    onChange={(e) => setCustomOutputPath(e.target.value)}
                    placeholder="C:\\path\\to\\your\\folder"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                    autoFocus
                  />
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                    <p className="text-xs text-amber-800">
                      Creates <code className="text-xs bg-amber-100 px-1 rounded">collage_images/high/</code> and{' '}
                      <code className="text-xs bg-amber-100 px-1 rounded">collage_images/low/</code> at the given path.
                    </p>
                  </div>
                  {customOutputPath && (
                    <div className="mt-1.5 text-xs text-emerald-700">
                      ✅ Will save to: {customOutputPath.replace(/\\$|\/$/, '')}\collage_images\high\ and ...\low\
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    setShowSaveLocationModal(false);
                    setPendingSaveAction(null);
                    setCustomOutputPath("");
                    setSaveLocationOption("default");
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-muted font-semibold text-sm hover:text-ink transition-all cursor-pointer border border-border"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLocationConfirm}
                  disabled={saveLocationOption === "custom" && !customOutputPath.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:shadow-btn-hover transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {combinations.length === 0 && failures.length === 0 && !isGenerating ? (
        <div className="text-center py-32 px-12 bg-panel rounded-2xl border border-border shadow-card">
          <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-5 border-2 border-border">
            <CheckCircle2 size={34} className="text-emerald-500" />
          </div>
          <h3 className="text-xl font-bold text-ink mb-2 font-heading">
            {autoSaveStatus?.enabled ? "All combinations saved!" : "No scanned bags selected"}
          </h3>
          <p className="text-base text-muted mb-8 max-w-md mx-auto leading-relaxed">
            {autoSaveStatus?.enabled
              ? `All ${(autoSaveStatus.queued || totalRequested).toLocaleString()} combinations have been saved successfully.`
              : "Please go to the Library page and select bags and objects to generate combinations."}
          </p>
          <button
            onClick={handleNavigateToLibrary}
            className="px-6 py-3 rounded-xl font-semibold text-white bg-blue-600 shadow-btn text-base inline-flex items-center gap-2 cursor-pointer"
          >
            <IoMdPhotos />
            Go to Library
          </button>
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="text-xs text-muted">
              {selectedBags.length > 0 && (
                <p>
                  {selectedBags.length} bag{selectedBags.length !== 1 ? "s" : ""},{" "}
                  {selectedThreats.length} threat{selectedThreats.length !== 1 ? "s" : ""},{" "}
                  {selectedOthers.length} non-threat{selectedOthers.length !== 1 ? "s" : ""} selected
                </p>
              )}
              <p>
                {isGenerating
                  ? `Generating ${totalGenerated.toLocaleString()}/${totalRequested.toLocaleString()} combinations...`
                  : totalGenerated > 0
                  ? `${combinations.length.toLocaleString()} showing now${bufferCount > 0 ? ` · ${bufferCount.toLocaleString()} in buffer` : ""}${totalGenerated > totalPending ? ` · ${(totalGenerated - totalPending).toLocaleString()} saved` : ""}`
                  : "0 combinations generated"}
              </p>
            </div>
          </div>

          {/* Combination Grid - always show max ITEMS_PER_PAGE */}
          {combinations.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {combinations.map((comb) => (
                <button
                  key={comb.id}
                  onClick={() => handleOpenPreviewModal(comb)}
                  className="bg-panel rounded-2xl border border-border p-4 shadow-card cursor-pointer overflow-hidden group text-left w-full"
                >
                  <SyntheticPreview
                    objects={comb.objects}
                    combinationId={comb.id}
                    bagId={comb.bag.id}
                    threatId={comb.threats?.[0]?.id}
                    otherIds={comb.others.map(o => o.id)}
                  />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Preview Modal */}
      {showModal && selectedCombination && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCloseModal} />
          <div className="relative z-[10000] w-full max-w-3xl bg-white rounded-2xl shadow-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panel">
              <h3 className="text-base font-semibold text-accent-sky font-mono truncate pr-4" />
              <button
                onClick={handleCloseModal}
                className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-ink transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col md:flex-row">
              <div className="flex-1 p-6 flex items-center justify-center bg-surface">
                <div className="w-full max-w-md">
                  <SyntheticPreview
                    objects={selectedCombination.objects}
                    combinationId={selectedCombination.id}
                    bagId={selectedCombination.bag.id}
                    threatId={selectedCombination.threats?.[0]?.id}
                    otherIds={selectedCombination.others.map(o => o.id)}
                  />
                </div>
              </div>
              <div className="w-full md:w-64 p-6 border-t md:border-t-0 md:border-l border-border flex flex-col gap-4 justify-center">
                <button
                  onClick={handleSaveImage}
                  disabled={saveImageState.status === "saving"}
                  className={`w-full px-5 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 text-sm transition-all cursor-pointer ${
                    saveImageState.status === "success"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : saveImageState.status === "error"
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : "bg-blue-600 text-white shadow-btn hover:shadow-btn-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  }`}
                >
                  {saveImageState.status === "saving" ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Saving...
                    </>
                  ) : saveImageState.status === "success" ? (
                    <>
                      <CheckCircle2 size={16} />
                      Saved!
                    </>
                  ) : saveImageState.status === "error" ? (
                    <>
                      <XCircle size={16} />
                      Failed
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      Save Image
                    </>
                  )}
                </button>

                {saveImageState.status !== "idle" && saveImageState.status !== "saving" && (
                  <p className={`text-xs text-center font-medium ${
                    saveImageState.status === "success" ? "text-emerald-600" : "text-rose-600"
                  }`}>
                    {saveImageState.message}
                  </p>
                )}

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted font-medium">OR</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <button
                  onClick={() => {
                    handleCloseModal();
                    handleOpenCombination(selectedCombination);
                  }}
                  className="w-full px-5 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 text-sm bg-blue-600 text-white shadow-btn hover:shadow-btn-hover transition-all cursor-pointer"
                >
                  <Edit3 size={16} />
                  Customize
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 shadow-lg text-sm font-medium animate-slide-up"
            >
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
