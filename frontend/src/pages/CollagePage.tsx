import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Grid3X3, ChevronLeft, ChevronRight, X, FolderOpen, Download, Edit3 } from "lucide-react";
import { IoMdPhotos } from "react-icons/io";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { GenerationService } from "../lib/generationService";
import type { Item } from "../types/library";
import type { CombinatorialResult, FailureLog } from "../types/customization";
import SyntheticPreview from "../components/collage/SyntheticPreview";
import { getRectCorners, getTransformedPolygon } from "../lib/geometry";

import type { GenerationParams, GenerationProgress, GenerationState, AutoSaveStatus } from "../types/generation";

const ITEMS_PER_PAGE = 50;

const toastStyles = `
  @keyframes slide-down {
    from { transform: translate(-50%, -20px); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
  }
  .animate-slide-down { animation: slide-down 0.25s ease-out; }
`;

type CollageToast = { id: string; type: "info"; message: string };

export default function CollagePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as
    | { selectedBags?: Item[]; selectedThreats?: Item[]; selectedOthers?: Item[]; densityPreset?: "empty" | "few" | "filled" }
    | undefined;

  // Selections from library
  const [selectedBags, setSelectedBags] = useState<Item[]>([]);
  const [selectedThreats, setSelectedThreats] = useState<Item[]>([]);
  const [selectedOthers, setSelectedOthers] = useState<Item[]>([]);

  const [combinations, setCombinations] = useState<CombinatorialResult[]>([]);
  const [failures, setFailures] = useState<FailureLog[]>([]);

  // Generation state from service
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ generated: number; total: number } | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus | null>(null);

  // State for "Save as you go" auto-save toggle
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("libraryAutoSave");
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  const handleToggleAutoSave = (enabled: boolean) => {
    setAutoSave(enabled);
    try {
      localStorage.setItem("libraryAutoSave", JSON.stringify(enabled));
    } catch { /* ignore */ }
    GenerationService.setAutoSaveEnabled(enabled);
  };

  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState<string>("1");
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

  // Bulk save confirmation modal state
  const [showBulkSaveModal, setShowBulkSaveModal] = useState(false);

  // Unsaved combinations navigation warning modal state
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

  // Preview modal state
  const [selectedCombination, setSelectedCombination] = useState<CombinatorialResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saveImageState, setSaveImageState] = useState<{
    status: "idle" | "saving" | "success" | "error";
    message: string;
    imageUrl: string | null;
  }>({ status: "idle", message: "", imageUrl: null });

  // Save location modal state
  const [showSaveLocationModal, setShowSaveLocationModal] = useState(false);
  const [saveLocationOption, setSaveLocationOption] = useState<"default" | "custom">("default");
  const [customOutputPath, setCustomOutputPath] = useState("");
  const [selectedDirHandle, setSelectedDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [pendingSaveAction, setPendingSaveAction] = useState<{ type: "single" | "bulk"; saveImages?: boolean } | null>(null);

  // Subscribe to GenerationService for incremental updates
  useEffect(() => {
    // Restore from sessionStorage if available (e.g. after page refresh)
    GenerationService.restoreFromStorage();
    
    const unsub = GenerationService.subscribe((state) => {
      setIsGenerating(state.isGenerating);
      setGenerationProgress(state.progress);
      setAutoSaveStatus(state.autoSaveStatus);
      if (state.autoSaveStatus) {
        setAutoSave(state.autoSaveStatus.enabled);
      }
      if (state.combinations.length > 0) {
        setCombinations(state.combinations);
      }
      if (state.failures.length > 0) {
        setFailures(state.failures);
      }
    });
    return unsub;
  }, []);

  // shelf-storage: restore previous state from sessionStorage/localStorage
  // when no fresh locationState is present, with backend fallback for stale item refs
  useEffect(() => {
    // If generation is already running via service, don't restore from storage
    if (GenerationService.isGenerating()) return;

    if (locationState && locationState.selectedBags && locationState.selectedBags.length > 0) {
      return; // fresh navigation from Library — handled by the locationState effect below
    }

    // Check if GenerationService already has data (e.g. from customization save)
    const serviceState = GenerationService.getState();
    if (serviceState.combinations.length > 0) {
      // Use the service state instead of restoring from storage
      // This preserves any updates made in customization page
      setCombinations(serviceState.combinations);
      setFailures(serviceState.failures);
      return;
    }

    const restoredCombos: any[] = [];
    const restoredFailures: any[] = [];
    const restoredBags: any[] = [];
    const restoredThreats: any[] = [];
    const restoredOthers: any[] = [];
    let restoreError: string | null = null;

    const readJSON = (raw: string | null) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };

    try {
      restoredCombos.push(...(readJSON(sessionStorage.getItem("collageCombinations")) || []));
      restoredFailures.push(...(readJSON(sessionStorage.getItem("collageFailures")) || []));
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

    const applyRestore = (fb: any[] | null, ft: any[] | null, fo: any[] | null) => {
      const bags = fb || restoredBags;
      const threats = ft || restoredThreats;
      const others = fo || restoredOthers;
      setCombinations(restoredCombos);
      setFailures(restoredFailures);
      setSelectedBags(bags); setSelectedThreats(threats); setSelectedOthers(others);
      if (restoreError) console.warn("[CollagePage] " + restoreError);
      try {
        sessionStorage.setItem("collageCombinations", JSON.stringify(restoredCombos));
        sessionStorage.setItem("collageFailures", JSON.stringify(restoredFailures));
        localStorage.setItem("selectedBags", JSON.stringify(bags));
        localStorage.setItem("selectedThreats", JSON.stringify(threats));
        localStorage.setItem("selectedOthers", JSON.stringify(others));
      } catch (e) {
        console.error("[CollagePage] error re-saving after restore:", e);
      }
    };

    // Detects stale item refs (e.g. hard refresh cleared localStorage but sessionStorage kept combos).
    // Rebuilds item arrays by fetching items from the backend matching combo item ids.
    const comboItemIds = new Set();
    restoredCombos.forEach(c => {
      comboItemIds.add(c.bag.id);
      if (c.threats && c.threats.length > 0) c.threats.forEach((t: any) => comboItemIds.add(t.id));
      c.others.forEach((o: any) => comboItemIds.add(o.id));
    });

    if (restoredCombos.length > 0 && comboItemIds.size > 0 &&
        restoredBags.length === 0 && restoredThreats.length === 0 && restoredOthers.length === 0) {
      (async () => {
        try {
          const res = await fetchWithTimeout(API_BASE_URL + "/api/items/categorized");
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          const cat = data.categorized || data;
          const matchedBags: any[] = [], matchedThreats: any[] = [], matchedOthers: any[] = [];
          for (const subcats of Object.values(cat as Record<string, any>)) {
            for (const items of Object.values(subcats as Record<string, any>)) {
              for (const item of items as any[]) {
                if (!comboItemIds.has(item.id)) continue;
                const cl = (item.category || "").toLowerCase();
                if (cl.includes("bag")) matchedBags.push(item);
                else if (cl.includes("threat")) matchedThreats.push(item);
                else matchedOthers.push(item);
              }
            }
          }
          applyRestore(matchedBags, matchedThreats, matchedOthers);
        } catch (e) {
          console.error("[CollagePage] fetch fresh items failed:", e);
          // Even if fetch fails, preserve the combinations with original item refs
          applyRestore(restoredBags, restoredThreats, restoredOthers);
        }
      })();
      return;
    }

    applyRestore(null, null, null);
  }, []);

  // Whenever new data arrives via location state, persist it
  useEffect(() => {
    if (!locationState || !locationState.selectedBags || locationState.selectedBags.length === 0) {
      return;
    }

    // Check if GenerationService has data (e.g. after returning from customization)
    // If so, don't override with stale locationState data
    const serviceState = GenerationService.getState();
    if (serviceState.combinations.length > 0) {
      // Service has data - don't overwrite with stale location state
      return;
    }

    const { selectedBags: bags, selectedThreats: threats, selectedOthers: others, combinations: preCombinations, failures: preFailures } = locationState as any;

    setSelectedBags(bags);
    setSelectedThreats(threats || []);
    setSelectedOthers(others || []);
    setCombinations(preCombinations && preCombinations.length > 0 ? preCombinations : []);
    setFailures(preFailures && preFailures.length > 0 ? preFailures : []);

    // Persist to localStorage
    try {
      localStorage.setItem("selectedBags", JSON.stringify(bags));
      localStorage.setItem("selectedThreats", JSON.stringify(threats || []));
      localStorage.setItem("selectedOthers", JSON.stringify(others || []));
    } catch (err) {
      console.error("Error saving collage state to localStorage:", err);
    }
  }, [locationState]);

  // Persist combinations and failures to sessionStorage (only non-empty data)
  useEffect(() => {
    try {
      if (combinations.length > 0) {
        // Store lightweight version to avoid quota issues
        const lightweightCombos = combinations.map(combo => ({
          id: combo.id,
          bag: combo.bag ? { id: combo.bag.id } : null,
          threats: combo.threats?.map(t => ({ id: t.id })) || [],
          others: combo.others?.map(o => ({ id: o.id })) || [],
        }));
        sessionStorage.setItem("collageCombinations", JSON.stringify(lightweightCombos));
      } else {
        sessionStorage.removeItem("collageCombinations");
      }
      if (failures.length > 0) {
        sessionStorage.setItem("collageFailures", JSON.stringify(failures));
      } else {
        sessionStorage.removeItem("collageFailures");
      }
    } catch (err) {
      // Silently handle quota errors - data is still available in memory
      if (err instanceof Error && err.name !== 'QuotaExceededError') {
        console.error("Error saving to sessionStorage:", err);
      }
    }
  }, [combinations, failures]);

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
    if (comb.threats && comb.threats.length > 0) {
      queryParams.set("threatIds", comb.threats.map(t => t.id).join(","));
    }
    if (comb.others.length > 0) {
      queryParams.set("otherIds", comb.others.map((o) => o.id).join(","));
    }
    // Add flag to indicate we have pre-computed objects
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

  // Helper: save rendered PNG blobs to the user's selected folder using File System Access API
  async function saveBlobsToFolder(highBlob: Blob, lowBlob: Blob, filename: string, dirHandle: FileSystemDirectoryHandle) {
    // Create collage_images/high/ and collage_images/low/ structure
    const collageDir = await dirHandle.getDirectoryHandle('collage_images', { create: true });
    const highDir = await collageDir.getDirectoryHandle('high', { create: true });
    const lowDir = await collageDir.getDirectoryHandle('low', { create: true });

    // Write high energy image
    const highFile = await highDir.getFileHandle(filename, { create: true });
    const highWritable = await highFile.createWritable();
    await highWritable.write(highBlob);
    await highWritable.close();

    // Write low energy image
    const lowFile = await lowDir.getFileHandle(filename, { create: true });
    const lowWritable = await lowFile.createWritable();
    await lowWritable.write(lowBlob);
    await lowWritable.close();
  }

  const handleSaveImage = async () => {
    if (!selectedCombination) return;

    // Show save location modal first
    setPendingSaveAction({ type: "single" });
    setShowSaveLocationModal(true);
  };

  const executeSaveImage = async (outputPath?: string, dirHandle?: FileSystemDirectoryHandle | null) => {
    if (!selectedCombination) return;

    setSaveImageState({ status: "saving", message: "Rendering high & low energy images...", imageUrl: null });

    try {
      if (dirHandle) {
        // Browser folder selected via Browse — save to backend default first, then copy to user's folder
        // Step 1: Render to default location on backend
        const response = await fetch(`${API_BASE_URL}/api/render-and-save-collage-both`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objects: selectedCombination.objects,
            name: selectedCombination.id,
            // Don't send outputPath — backend saves to default
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to render images");
        }

        const data = await response.json();
        const safeName = selectedCombination.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
        const filename = `${safeName}.png`;

        // Step 2: Fetch the rendered PNGs as blobs
        const highUrl = `${API_BASE_URL}${data.high_url}`;
        const lowUrl = `${API_BASE_URL}${data.low_url}`;
        
        const [highRes, lowRes] = await Promise.all([
          fetch(highUrl),
          fetch(lowUrl)
        ]);
        
        const [highBlob, lowBlob] = await Promise.all([
          highRes.blob(),
          lowRes.blob()
        ]);

        // Step 3: Write blobs to user's selected folder
        await saveBlobsToFolder(highBlob, lowBlob, filename, dirHandle);

        setSaveImageState({
          status: "success",
          message: `High & low energy images saved to selected folder!`,
          imageUrl: data.high_url,
        });
      } else {
        // No browser folder handle — send outputPath to backend as before
        const response = await fetch(`${API_BASE_URL}/api/render-and-save-collage-both`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objects: selectedCombination.objects,
            name: selectedCombination.id,
            outputPath: outputPath || undefined,
          }),
        });

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
    // If saving images, show the save location modal first
    if (saveImages) {
      setShowBulkSaveModal(false);
      setPendingSaveAction({ type: "bulk", saveImages });
      setShowSaveLocationModal(true);
      return;
    }

    setShowBulkSaveModal(false);
    setBulkSaveState({ status: "saving", message: "Saving all workspaces...", savedCount: 0 });
    let savedCount = 0;
    let failedCount = 0;
    
    try {
      for (const comb of combinations) {
        // Generate auto-annotation from workspace contents
        const threatNames = comb.threats && comb.threats.length > 0 ? comb.threats.map(t => t.name) : [];
        const otherNames = comb.others.map(o => o.name);
        const allObjects = [...threatNames, ...otherNames];
        const annotation = `${comb.bag.name}${allObjects.length > 0 ? ` containing ${allObjects.join(", ")}` : ""}`;
        
        // Find the bag's top-left corner (first corner of its rectangle)
        const bagObject = comb.objects.find((o: any) => o.library === "bag");
        let bagTopLeft: { x: number; y: number } = { x: 0, y: 0 };
        let validRegionPolygon: any[] = [];
        
        if (bagObject) {
          const bagCorners = getRectCorners(
            { x: bagObject.transform.x, y: bagObject.transform.y },
            { width: bagObject.transform.width, height: bagObject.transform.height },
            bagObject.transform.rotation
          );
          bagTopLeft = bagCorners[0];
          
          // Get valid region
          try {
            // Check if we can get the valid region from the bag
            if (bagObject.polygonOutline) {
              validRegionPolygon = getTransformedPolygon(
                { x: bagObject.transform.x, y: bagObject.transform.y },
                { width: bagObject.transform.width, height: bagObject.transform.height },
                bagObject.transform.rotation,
                bagObject.polygonOutline
              );
            }
          } catch (e) {
            console.error("Error getting valid region:", e);
          }
        }
        
        // Separate objects into bag, threats, and non-threats
        const bagObj = bagObject ? {
          id: bagObject.id,
          subcategory: bagObject.subcategory ? bagObject.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
          filepath: bagObject.filepath,
          center: { x: bagObject.transform.x, y: bagObject.transform.y },
          size: { width: bagObject.transform.width, height: bagObject.transform.height },
          originalPixelValue: bagObject.originalPixelValue,
          currentPixelValue: bagObject.currentPixelValue,
          oldPixelValue: bagObject.oldPixelValue,
          polygonOutline: bagObject.polygonOutline,
          validRegionPolygon,
          layer: bagObject.layer,
          tags: bagObject.tags || [],
        } : null;

        const threats = comb.objects
          .filter((o: any) => o.library === "threat")
          .map((obj: any) => ({
            id: obj.id,
            subcategory: obj.subcategory ? obj.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
            filepath: obj.filepath,
            center: { x: obj.transform.x, y: obj.transform.y },
            size: { width: obj.transform.width, height: obj.transform.height },
            rotation: obj.transform.rotation,
            originalPixelValue: obj.originalPixelValue,
            currentPixelValue: obj.currentPixelValue,
            oldPixelValue: obj.oldPixelValue,
            layer: obj.layer,
          }));

        const nonThreats = comb.objects
          .filter((o: any) => o.library !== "bag" && o.library !== "threat")
          .map((obj: any) => ({
            id: obj.id,
            subcategory: obj.subcategory ? obj.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
            filepath: obj.filepath,
            center: { x: obj.transform.x, y: obj.transform.y },
            size: { width: obj.transform.width, height: obj.transform.height },
            rotation: obj.transform.rotation,
            originalPixelValue: obj.originalPixelValue,
            currentPixelValue: obj.currentPixelValue,
            oldPixelValue: obj.oldPixelValue,
            layer: obj.layer,
          }));

        const layout_json = {
          threat_count: threats.length,
          non_threat_count: nonThreats.length,
          objects: {
            bag: bagObj,
            threats,
            "non-threats": nonThreats,
          },
          createdAt: new Date().toISOString(),
        };
        
        const response = await fetch(`${API_BASE_URL}/api/saved-layouts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: comb.id,
            name: annotation,
            filepath: null,
            layout_json,
          }),
        });

        if (response.ok) {
          savedCount++;
        } else {
          failedCount++;
        }

        setBulkSaveState(prev => ({
          ...prev,
          message: `Saving workspaces... (${savedCount}/${combinations.length})`,
          savedCount
        }));
      }
      
      if (failedCount === 0) {
        setBulkSaveState({
          status: "success",
          message: `Successfully saved ${savedCount} workspace${savedCount !== 1 ? "s" : ""}!`,
          savedCount
        });
        
        // Reset collage state only after fully successful bulk save
        GenerationService.clear();
        setCombinations([]);
        setFailures([]);
        setSelectedBags([]);
        setSelectedThreats([]);
        setSelectedOthers([]);
        setCurrentPage(0);
        
        // Clear persisted storage
        try {
          sessionStorage.removeItem("collageCombinations");
          sessionStorage.removeItem("collageFailures");
          localStorage.removeItem("selectedBags");
          localStorage.removeItem("selectedThreats");
          localStorage.removeItem("selectedOthers");
        } catch (e) {
          console.error("Error clearing storage after bulk save:", e);
        }
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
    
    try {
      for (const comb of combinations) {
        // Generate auto-annotation from workspace contents
        const threatNames = comb.threats && comb.threats.length > 0 ? comb.threats.map(t => t.name) : [];
        const otherNames = comb.others.map(o => o.name);
        const allObjects = [...threatNames, ...otherNames];
        const annotation = `${comb.bag.name}${allObjects.length > 0 ? ` containing ${allObjects.join(", ")}` : ""}`;
        
        // Find the bag's top-left corner (first corner of its rectangle)
        const bagObject = comb.objects.find((o: any) => o.library === "bag");
        let validRegionPolygon: any[] = [];
        
        if (bagObject) {
          try {
            if (bagObject.polygonOutline) {
              validRegionPolygon = getTransformedPolygon(
                { x: bagObject.transform.x, y: bagObject.transform.y },
                { width: bagObject.transform.width, height: bagObject.transform.height },
                bagObject.transform.rotation,
                bagObject.polygonOutline
              );
            }
          } catch (e) {
            console.error("Error getting valid region:", e);
          }
        }
        
        // Separate objects into bag, threats, and non-threats
        const bagObj = bagObject ? {
          id: bagObject.id,
          subcategory: bagObject.subcategory ? bagObject.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
          filepath: bagObject.filepath,
          center: { x: bagObject.transform.x, y: bagObject.transform.y },
          size: { width: bagObject.transform.width, height: bagObject.transform.height },
          originalPixelValue: bagObject.originalPixelValue,
          currentPixelValue: bagObject.currentPixelValue,
          oldPixelValue: bagObject.oldPixelValue,
          polygonOutline: bagObject.polygonOutline,
          validRegionPolygon,
          layer: bagObject.layer,
          tags: bagObject.tags || [],
        } : null;

        const threats = comb.objects
          .filter((o: any) => o.library === "threat")
          .map((obj: any) => ({
            id: obj.id,
            subcategory: obj.subcategory ? obj.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
            filepath: obj.filepath,
            center: { x: obj.transform.x, y: obj.transform.y },
            size: { width: obj.transform.width, height: obj.transform.height },
            rotation: obj.transform.rotation,
            originalPixelValue: obj.originalPixelValue,
            currentPixelValue: obj.currentPixelValue,
            oldPixelValue: obj.oldPixelValue,
            layer: obj.layer,
          }));

        const nonThreats = comb.objects
          .filter((o: any) => o.library !== "bag" && o.library !== "threat")
          .map((obj: any) => ({
            id: obj.id,
            subcategory: obj.subcategory ? obj.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
            filepath: obj.filepath,
            center: { x: obj.transform.x, y: obj.transform.y },
            size: { width: obj.transform.width, height: obj.transform.height },
            rotation: obj.transform.rotation,
            originalPixelValue: obj.originalPixelValue,
            currentPixelValue: obj.currentPixelValue,
            oldPixelValue: obj.oldPixelValue,
            layer: obj.layer,
          }));

        const layout_json = {
          threat_count: threats.length,
          non_threat_count: nonThreats.length,
          objects: {
            bag: bagObj,
            threats,
            "non-threats": nonThreats,
          },
          createdAt: new Date().toISOString(),
        };
        
        const response = await fetch(`${API_BASE_URL}/api/saved-layouts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: comb.id,
            name: annotation,
            filepath: null,
            layout_json,
          }),
        });

        if (response.ok) {
          savedCount++;
        } else {
          failedCount++;
        }

        // Also save both high and low energy rendered images if requested
        if (response.ok) {
          try {
            // Use dirHandle if available (browser file API), otherwise outputPath (backend saves directly)
            const renderRes = await fetch(`${API_BASE_URL}/api/render-and-save-collage-both`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                objects: comb.objects,
                name: comb.id,
                outputPath: dirHandle ? undefined : (outputPath || undefined),
              }),
            });
            
            if (dirHandle && renderRes.ok) {
              const renderData = await renderRes.json();
              const safeName = comb.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
              const filename = `${safeName}.png`;
              
              // Fetch blobs from backend default location
              const [highRes, lowRes] = await Promise.all([
                fetch(`${API_BASE_URL}${renderData.high_url}`),
                fetch(`${API_BASE_URL}${renderData.low_url}`)
              ]);
              const [highBlob, lowBlob] = await Promise.all([highRes.blob(), lowRes.blob()]);
              
              // Write to user's folder
              await saveBlobsToFolder(highBlob, lowBlob, filename, dirHandle);
            }
          } catch (err) {
            console.error(`Error saving images for ${comb.id}:`, err);
          }
        }

        setBulkSaveState(prev => ({
          ...prev,
          message: `Saving workspaces... (${savedCount}/${combinations.length})`,
          savedCount
        }));
      }
      
      setBulkSaveState({
        status: "success",
        message: `Successfully saved ${savedCount} workspace${savedCount !== 1 ? "s" : ""}!${failedCount > 0 ? ` (${failedCount} failed)` : ""}`,
        savedCount
      });
      
      // Reset collage state after successful bulk save
      GenerationService.clear();
      setCombinations([]);
      setFailures([]);
      setSelectedBags([]);
      setSelectedThreats([]);
      setSelectedOthers([]);
      setCurrentPage(0);
      
      // Clear persisted storage
      try {
        sessionStorage.removeItem("collageCombinations");
        sessionStorage.removeItem("collageFailures");
        localStorage.removeItem("selectedBags");
        localStorage.removeItem("selectedThreats");
        localStorage.removeItem("selectedOthers");
      } catch (e) {
        console.error("Error clearing storage after bulk save:", e);
      }
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

    // Capture the directory handle BEFORE any state resets
    const dirHandle = selectedDirHandle;
    const outputPath = saveLocationOption === "custom" ? customOutputPath.trim() : undefined;

    // Close modal and reset state first
    setPendingSaveAction(null);
    setCustomOutputPath("");
    setSaveLocationOption("default");
    setSelectedDirHandle(null);
    setShowSaveLocationModal(false);

    // Then execute save with captured values
    if (pendingSaveAction.type === "single") {
      executeSaveImage(outputPath, dirHandle);
    } else if (pendingSaveAction.type === "bulk") {
      executeBulkSave(outputPath, dirHandle);
    }
  };

  // Handle navigation with unsaved combinations warning
  const handleNavigateToLibrary = () => {
    if (combinations.length > 0 && !isGenerating && bulkSaveState.status !== "success") {
      setShowUnsavedModal(true);
      setPendingNavigation(() => () => navigate("/library"));
    } else {
      navigate("/library");
    }
  };

  const handleUnsavedModalAction = (action: "discard" | "cancel") => {
    if (action === "discard") {
      setShowUnsavedModal(false);
      if (pendingNavigation) {
        pendingNavigation();
        setPendingNavigation(null);
      }
    } else {
      setShowUnsavedModal(false);
      setPendingNavigation(null);
    }
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(combinations.length / ITEMS_PER_PAGE));
  const paginatedCombinations = combinations.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  // Sync page input with actual 1-based current page
  useEffect(() => {
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  // Clamp currentPage if totalPages shrinks (e.g., combinations reset)
  useEffect(() => {
    const clamped = Math.min(currentPage, Math.max(0, totalPages - 1));
    if (clamped !== currentPage) setCurrentPage(clamped);
  }, [totalPages, currentPage, setCurrentPage]);

  const clamp1Based = (n: number) => Math.min(totalPages, Math.max(1, Math.floor(n)));

  const parsePageInput = (raw: string): { value: number; clamped: boolean; invalid: boolean; rawParsed: number | null } => {
    const trimmed = raw.trim();
    if (trimmed === "") return { value: currentPage + 1, clamped: false, invalid: true, rawParsed: null };
    const digitsOnly = trimmed.replace(/\D/g, "");
    if (digitsOnly === "") return { value: currentPage + 1, clamped: false, invalid: true, rawParsed: null };
    if (digitsOnly.length > 9) {
      const bigParsed = parseInt(digitsOnly, 10);
      return { value: totalPages, clamped: true, invalid: false, rawParsed: isNaN(bigParsed) ? null : bigParsed };
    }
    const parsed = parseInt(digitsOnly, 10);
    if (isNaN(parsed) || !isFinite(parsed)) return { value: currentPage + 1, clamped: false, invalid: true, rawParsed: null };
    if (parsed < 1) return { value: 1, clamped: true, invalid: false, rawParsed: parsed };
    if (parsed > totalPages) return { value: totalPages, clamped: true, invalid: false, rawParsed: parsed };
    if (parsed === currentPage + 1) return { value: currentPage + 1, clamped: false, invalid: false, rawParsed: parsed };
    return { value: parsed, clamped: false, invalid: false, rawParsed: parsed };
  };

  const handlePageInputBeforeInput = (e: React.FormEvent<HTMLInputElement>) => {
    const ev = e.nativeEvent as InputEvent;
    if (ev.inputType.startsWith("delete") || ev.data === null) return;
    if (!/^\d+$/.test(ev.data)) e.preventDefault();
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value.replace(/\D/g, ""));
  };

  const goToPageFromInput = (value1Based: number, rawParsed: number | null, clamped: boolean) => {
    if (clamped && rawParsed !== null) {
      if (rawParsed > totalPages) {
        showToast("info", `No page ${rawParsed} — max is ${totalPages}. Jumping to last page.`);
      } else if (rawParsed < 1) {
        showToast("info", `Page numbers start at 1. Jumping to page 1.`);
      }
    }
    setCurrentPage(value1Based - 1);
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const { value, rawParsed, clamped } = parsePageInput(pageInput);
      goToPageFromInput(value, rawParsed, clamped);
      setPageInput(String(value));
    } else if (e.key === "Escape") {
      setPageInput(String(currentPage + 1));
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCurrentPage(Math.min(totalPages - 1, currentPage + 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCurrentPage(Math.max(0, currentPage - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setCurrentPage(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  };

  const handlePageInputBlur = () => {
    const { value, rawParsed, clamped } = parsePageInput(pageInput);
    if (value !== currentPage + 1) goToPageFromInput(value, rawParsed, clamped);
    setPageInput(String(value));
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 animate-fade-in text-sm">
      {/* Header Row */}
      <div className="flex items-end justify-between mb-8 border-l-4 border-accent pl-4">
        <div>
          <h2 className="text-3xl font-bold text-ink tracking-tight font-heading">Collage Images</h2>
        </div>
        <div className="flex items-center gap-3">
          {/* Save as you go auto-save toggle */}
          <label className="flex items-center gap-2 cursor-pointer bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200/80 rounded-xl px-3.5 py-2 text-blue-900 font-medium transition-colors shadow-sm">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => handleToggleAutoSave(e.target.checked)}
              className="w-4 h-4 border border-blue-300 rounded bg-white text-blue-600 focus:outline-none focus:border-blue-500 cursor-pointer"
            />
            <span className="text-xs whitespace-nowrap font-semibold">Save as you go</span>
          </label>

          <button
            onClick={() => setShowBulkSaveModal(true)}
            disabled={bulkSaveState.status === "saving" || combinations.length === 0 || isGenerating}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-blue-600 shadow-btn flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Bulk Save All Workspaces"
          >
            {bulkSaveState.status === "saving" ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <FolderOpen size={15} />
            )}
          </button>

          {/* Bulk Save Confirmation Modal */}
          {showBulkSaveModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowBulkSaveModal(false)} />
              <div className="relative z-[10000] w-full max-w-md bg-white rounded-2xl shadow-lg border border-border p-6">
          <h3 className="text-base font-semibold text-ink mb-2 font-heading">Bulk Save Options</h3>
                <p className="text-sm text-muted mb-5">
                  Choose how you want to save {combinations.length} combination{combinations.length !== 1 ? "s" : ""}:
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => handleBulkSave(true)}
                      className="w-full px-4 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:shadow-btn-hover transition-all cursor-pointer text-left"
                  >
                    <span className="block text-base mb-0.5">Save Annotations + Images</span>
                    <span className="block text-xs opacity-90 font-normal">
                      Save workspace annotations to savedLayouts.json and render PNG images to collage_images folder
                    </span>
                  </button>
                  <button
                    onClick={() => handleBulkSave(false)}
                    className="w-full px-4 py-3 rounded-xl bg-panel border border-border text-ink font-semibold text-sm hover:bg-surface transition-all cursor-pointer text-left"
                  >
                    <span className="block text-base mb-0.5">Save Annotations Only</span>
                    <span className="block text-xs text-muted font-normal">
                      Save workspace annotations to savedLayouts.json only (no images)
                    </span>
                  </button>
                  <button
                    onClick={() => setShowBulkSaveModal(false)}
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

                  {saveLocationOption === "custom" && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-ink mb-1.5">
                        Full Folder Path
                      </label>
                      <input
                        type="text"
                        value={customOutputPath}
                        onChange={(e) => setCustomOutputPath(e.target.value)}
                        placeholder="C:\path\to\your\folder"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                        autoFocus
                      />
                      <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                        <p className="text-xs text-amber-800">
                          Creates <code className="text-xs bg-amber-100 px-1 rounded">collage_images/high/</code> and <code className="text-xs bg-amber-100 px-1 rounded">collage_images/low/</code> at the given path.
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
        </div>
      </div>

      {/* Generation Progress Banner */}
      {isGenerating && generationProgress && (
        <div className="mb-6 p-4 rounded-xl border bg-blue-50 border-blue-200 text-blue-800 transition-all duration-300">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-blue-600 shrink-0" size={24} />
            <div className="flex-1">
              <p className="font-semibold text-sm">
                Generating combinations... ({generationProgress.generated} / {generationProgress.total})
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
      {autoSaveStatus?.enabled && (
        <div className="mb-6 p-3 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center justify-between text-xs font-medium">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>
              <strong className="font-semibold">Auto-Save active:</strong> {autoSaveStatus.queued.toLocaleString()} layout(s) queued to disk across {autoSaveStatus.batchesSent} batch(es)
            </span>
          </div>
          {autoSaveStatus.errors > 0 && (
            <span className="text-rose-600 font-semibold px-2 py-0.5 rounded bg-rose-100 border border-rose-200">
              {autoSaveStatus.errors} save error(s)
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
            {bulkSaveState.status === "saving" && (
              <Loader2 className="animate-spin text-blue-600" size={24} />
            )}
            {bulkSaveState.status === "success" && (
              <CheckCircle2 className="text-emerald-600" size={24} />
            )}
            {bulkSaveState.status === "error" && (
              <XCircle className="text-rose-600" size={24} />
            )}
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
      {showUnsavedModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => handleUnsavedModalAction("cancel")} />
          <div className="relative z-[10000] w-full max-w-md bg-white rounded-2xl shadow-lg border border-border p-6">
            <h3 className="text-base font-semibold text-ink mb-2 font-heading">Unsaved Combinations</h3>
            <p className="text-sm text-muted mb-5">
              You have generated combinations that haven't been saved. If you leave this page, they will be discarded.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleUnsavedModalAction("discard")}
                className="w-full px-4 py-2.5 rounded-xl bg-rose-600 text-white font-semibold text-sm hover:shadow-btn-hover transition-all"
              >
                Discard & Leave
              </button>
              <button
                onClick={() => handleUnsavedModalAction("cancel")}
                className="w-full px-4 py-2.5 rounded-xl bg-panel border border-border text-ink font-semibold text-sm hover:bg-surface transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {combinations.length === 0 && failures.length === 0 && !isGenerating ? (
        <div className="text-center py-32 px-12 bg-panel rounded-2xl border border-border shadow-card">
          <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-5 border-2 border-border">
            <Grid3X3 size={34} className="text-muted/30" />
          </div>
          <h3 className="text-xl font-bold text-ink mb-2 font-heading">No scanned bags selected</h3>
          <p className="text-base text-muted mb-8 max-w-md mx-auto leading-relaxed">
            Please go to the Library page and select bags and objects to generate combinations.
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
          {/* Summary bar with logs toggle */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-muted">
              {combinations.length > 0 && (
                <p>
                  {selectedBags.length} bag{selectedBags.length !== 1 ? "s" : ""}, {selectedThreats.length} threat{selectedThreats.length !== 1 ? "s" : ""}, {selectedOthers.length} non-threat{selectedOthers.length !== 1 ? "s" : ""} selected
                </p>
              )}
              <p>
                {combinations.length > 0
                  ? `Showing ${currentPage * ITEMS_PER_PAGE + 1}–${Math.min((currentPage + 1) * ITEMS_PER_PAGE, combinations.length)} of ${combinations.length} combinations`
                  : isGenerating
                  ? `Generating ${generationProgress?.generated || 0} / ${generationProgress?.total || 0} combinations...`
                  : "0 combinations generated"}
              </p>
            </div>
          </div>


          {/* Combination Grid */}
          {combinations.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {paginatedCombinations.map((comb) => (
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

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-2 rounded-xl border border-border bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
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
                        className={`min-w-[36px] h-9 rounded-xl text-sm font-medium ${
                          page === currentPage
                            ? "bg-accent text-white shadow-btn"
                            : "border border-border bg-panel text-muted"
                        }`}
                      >
                        {page + 1}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="p-2 rounded-xl border border-border bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={16} className="text-muted" />
                  </button>

                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="hidden sm:inline text-sm text-muted whitespace-nowrap">Page</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={pageInput}
                      onChange={handlePageInputChange}
                      onBeforeInput={handlePageInputBeforeInput}
                      onKeyDown={handlePageInputKeyDown}
                      onBlur={handlePageInputBlur}
                      className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-center text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
                      placeholder="1"
                      title="Type page number, then Enter. ArrowUp=Next, ArrowDown=Prev, Home=First, End=Last. Esc cancels."
                    />
                    <span className="text-sm text-muted whitespace-nowrap">/ {totalPages}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Preview Modal */}
      {showModal && selectedCombination && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCloseModal} />
          <div className="relative z-[10000] w-full max-w-3xl bg-white rounded-2xl shadow-lg border border-border overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panel">
              <h3 className="text-base font-semibold text-accent-sky font-mono truncate pr-4">
              </h3>
              <button
                onClick={handleCloseModal}
                className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-ink transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex flex-col md:flex-row">
              {/* Left: Image Preview */}
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

              {/* Right: Action Buttons */}
              <div className="w-full md:w-64 p-6 border-t md:border-t-0 md:border-l border-border flex flex-col gap-4 justify-center">
                {/* Save Image Button */}
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

                {/* Save status message */}
                {saveImageState.status !== "idle" && saveImageState.status !== "saving" && (
                  <p className={`text-xs text-center font-medium ${
                    saveImageState.status === "success" ? "text-emerald-600" : "text-rose-600"
                  }`}>
                    {saveImageState.message}
                  </p>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted font-medium">OR</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Customize Button */}
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

      <style>{toastStyles}</style>
      {toasts.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 shadow-lg text-sm font-medium animate-slide-down"
            >
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}