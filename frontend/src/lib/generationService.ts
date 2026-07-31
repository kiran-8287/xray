/**
 * GenerationService - Module-level singleton for incremental combination generation.
 *
 * This service survives component mount/unmount cycles because modules in Vite
 * are singletons. It stores the worker reference at module level so that when
 * the user navigates between pages, the generation continues in the background.
 *
 * Components can subscribe to receive incremental batch updates.
 *
 * Auto-save: when params.autoSave=true, each received batch is converted to
 * saved-layout records and POSTed to POST /api/saved-layouts/batch-bulk for
 * sequential disk write (no parallel write lock contention).
 */

import type { CombinatorialResult, FailureLog } from "../types/customization";
import type { Item } from "../types/library";
import type { GenerationParams, GenerationProgress, GenerationState, AutoSaveStatus } from "../types/generation";
import { getTransformedPolygon } from "./geometry";
import { API_BASE_URL } from "../config/api";

type Subscriber = (state: GenerationState) => void;

// Module-level state (survives component mount/unmount)
let worker: Worker | null = null;
let autoSaveEnabled = false;
let state: GenerationState = {
  isGenerating: false,
  combinations: [],
  failures: [],
  progress: null,
  hasGeneratedResults: false,
  autoSaveStatus: null,
};
const subscribers = new Set<Subscriber>();

function notifySubscribers() {
  for (const cb of subscribers) {
    try {
      cb(state);
    } catch (err) {
      console.error("[GenerationService] subscriber error:", err);
    }
  }
}

function persistToStorage() {
  try {
    if (state.combinations.length > 0) {
      const lightweightCombos = state.combinations.map(combo => ({
        id: combo.id,
        bag: combo.bag ? { id: combo.bag.id } : null,
        threats: combo.threats?.map(t => ({ id: t.id })) || [],
        others: combo.others?.map(o => ({ id: o.id })) || [],
      }));
      sessionStorage.setItem("collageCombinations", JSON.stringify(lightweightCombos));
    }
    if (state.failures.length > 0) {
      sessionStorage.setItem("collageFailures", JSON.stringify(state.failures));
    }
    if (state.isGenerating && state.progress) {
      sessionStorage.setItem("generationProgress", JSON.stringify(state.progress));
    } else {
      sessionStorage.removeItem("generationProgress");
    }
  } catch (err) {
    console.warn("[GenerationService] storage persist failed:", err);
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      try {
        sessionStorage.removeItem("collageCombinations");
        sessionStorage.removeItem("collageFailures");
      } catch (clearErr) {
        // Ignore cleanup errors
      }
    }
  }
}

// ---- Auto-save helpers ----

/**
 * Convert a CombinatorialResult to the saved-layout format expected by the backend.
 */
function comboToLayout(combo: CombinatorialResult): any {
  const bagObject = combo.objects?.find((o: any) => o.library === "bag");
  let validRegionPolygon: any[] = [];

  if (bagObject?.polygonOutline) {
    try {
      validRegionPolygon = getTransformedPolygon(
        { x: bagObject.transform.x, y: bagObject.transform.y },
        { width: bagObject.transform.width, height: bagObject.transform.height },
        bagObject.transform.rotation,
        bagObject.polygonOutline
      );
    } catch { /* ignore */ }
  }

  const threatNames = combo.threats?.map(t => t.name) || [];
  const otherNames = combo.others?.map(o => o.name) || [];
  const allNames = [...threatNames, ...otherNames];
  const name = `${combo.bag?.name || "bag"}${allNames.length > 0 ? ` containing ${allNames.join(", ")}` : ""}`;

  const bagObj = bagObject ? {
    id: bagObject.id,
    subcategory: bagObject.subcategory?.toLowerCase().replace(/\s+/g, '-'),
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

  const threats = (combo.objects || [])
    .filter((o: any) => o.library === "threat")
    .map((obj: any) => ({
      id: obj.id,
      subcategory: obj.subcategory?.toLowerCase().replace(/\s+/g, '-'),
      filepath: obj.filepath,
      center: { x: obj.transform.x, y: obj.transform.y },
      size: { width: obj.transform.width, height: obj.transform.height },
      rotation: obj.transform.rotation,
      originalPixelValue: obj.originalPixelValue,
      currentPixelValue: obj.currentPixelValue,
      oldPixelValue: obj.oldPixelValue,
      layer: obj.layer,
    }));

  const nonThreats = (combo.objects || [])
    .filter((o: any) => o.library !== "bag" && o.library !== "threat")
    .map((obj: any) => ({
      id: obj.id,
      subcategory: obj.subcategory?.toLowerCase().replace(/\s+/g, '-'),
      filepath: obj.filepath,
      center: { x: obj.transform.x, y: obj.transform.y },
      size: { width: obj.transform.width, height: obj.transform.height },
      rotation: obj.transform.rotation,
      originalPixelValue: obj.originalPixelValue,
      currentPixelValue: obj.currentPixelValue,
      oldPixelValue: obj.oldPixelValue,
      layer: obj.layer,
    }));

  return {
    id: combo.id,
    name,
    filepath: null,
    layout_json: {
      threat_count: threats.length,
      non_threat_count: nonThreats.length,
      objects: { bag: bagObj, threats, "non-threats": nonThreats },
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Auto-save a batch of combinations to the backend (fire-and-forget with error tracking).
 */
async function autoSaveBatch(batch: CombinatorialResult[]) {
  if (!autoSaveEnabled || batch.length === 0) return;

  try {
    const layouts = batch.map(comboToLayout);
    const res = await fetch(`${API_BASE_URL}/api/saved-layouts/batch-bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layouts }),
    });

    if (state.autoSaveStatus) {
      if (res.ok) {
        state.autoSaveStatus = {
          ...state.autoSaveStatus,
          queued: state.autoSaveStatus.queued + batch.length,
          batchesSent: state.autoSaveStatus.batchesSent + 1,
        };
      } else {
        state.autoSaveStatus = {
          ...state.autoSaveStatus,
          errors: state.autoSaveStatus.errors + 1,
        };
        console.error("[GenerationService] auto-save batch failed:", res.status);
      }
    }
    notifySubscribers();
  } catch (err) {
    console.error("[GenerationService] auto-save fetch error:", err);
    if (state.autoSaveStatus) {
      state.autoSaveStatus = {
        ...state.autoSaveStatus,
        errors: state.autoSaveStatus.errors + 1,
      };
      notifySubscribers();
    }
  }
}

export const GenerationService = {
  /**
   * Start generating combinations in a Web Worker.
   * The worker sends back incremental batches which we accumulate and notify subscribers.
   */
  startGeneration(params: GenerationParams) {
    // If already generating, abort previous
    if (worker) {
      worker.terminate();
      worker = null;
    }

    autoSaveEnabled = params.autoSave === true;

    state = {
      isGenerating: true,
      combinations: [],
      failures: [],
      progress: { generated: 0, total: params.kValue },
      hasGeneratedResults: false,
      autoSaveStatus: autoSaveEnabled
        ? { enabled: true, queued: 0, batchesSent: 0, errors: 0 }
        : null,
    };
    notifySubscribers();

    // Clear previous storage
    try {
      sessionStorage.removeItem("collageCombinations");
      sessionStorage.removeItem("collageFailures");
      sessionStorage.setItem("generationProgress", JSON.stringify(state.progress));
    } catch (err) {
      // ignore
    }

    try {
      const newWorker = new Worker(
        new URL("../workers/incrementalGenerator.worker.ts", import.meta.url),
        { type: "module" }
      );
      worker = newWorker;

      newWorker.onmessage = (event) => {
        const response = event.data;

        if (response.type === "batch") {
          const batch = response.batch || [];
          // Append batch to accumulated results
          state.combinations.push(...batch);
          state.progress = response.progress;
          if (response.failures) {
            state.failures.push(...response.failures);
          }
          notifySubscribers();
          persistToStorage();

          // Auto-save this batch if enabled (non-blocking)
          if (autoSaveEnabled && batch.length > 0) {
            autoSaveBatch(batch);
          }
        } else if (response.type === "complete") {
          state.isGenerating = false;
          state.hasGeneratedResults = true;
          state.failures.push(...(response.failures || []));
          state.progress = response.progress || null;
          notifySubscribers();
          persistToStorage();
          worker = null;
        } else if (response.type === "error") {
          console.error("[GenerationService] worker error:", response.error);
          state.isGenerating = false;
          state.progress = null;
          notifySubscribers();
          worker = null;
        }
      };

      newWorker.onerror = (error) => {
        console.error("[GenerationService] worker error:", error);
        state.isGenerating = false;
        state.progress = null;
        notifySubscribers();
        worker = null;
      };

      // Build effective distributions
      const effectiveThreatDist: Record<number, number> = {};
      for (let i = 1; i <= params.maxThreats; i++) {
        effectiveThreatDist[i] = (params.threatDistribution && params.threatDistribution[i]) ?? 0;
      }
      const effectiveNonThreatDist: Record<number, number> = {};
      for (let i = 1; i <= params.maxNonThreats; i++) {
        effectiveNonThreatDist[i] = (params.nonThreatDistribution && params.nonThreatDistribution[i]) ?? 0;
      }

      newWorker.postMessage({
        type: "generate",
        selectedBags: params.selectedBags,
        selectedThreats: params.selectedThreats,
        selectedOthers: params.selectedOthers,
        kValue: params.kValue,
        threatDistribution: effectiveThreatDist,
        nonThreatDistribution: effectiveNonThreatDist,
        requireAtLeastOneNonThreat: params.requireAtLeastOneNonThreat || false,
        existingIds: params.existingIds || [],
        batchSize: params.batchSize ?? 5000,
      });
    } catch (err) {
      console.error("[GenerationService] failed to start worker:", err);
      state.isGenerating = false;
      state.progress = null;
      notifySubscribers();
    }
  },

  /**
   * Abort current generation
   */
  abort() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    state.isGenerating = false;
    state.progress = null;
    autoSaveEnabled = false;
    notifySubscribers();
    try {
      sessionStorage.removeItem("generationProgress");
    } catch (err) {
      // ignore
    }
  },

  /**
   * Subscribe to state changes. Returns unsubscribe function.
   */
  subscribe(callback: Subscriber): () => void {
    subscribers.add(callback);
    // Immediately call with current state
    try {
      callback(state);
    } catch (err) {
      console.error("[GenerationService] initial subscriber callback error:", err);
    }
    return () => {
      subscribers.delete(callback);
    };
  },

  /**
   * Get current state synchronously
   */
  getState(): GenerationState {
    return { ...state, combinations: [...state.combinations], failures: [...state.failures] };
  },

  /**
   * Check if currently generating
   */
  isGenerating(): boolean {
    return state.isGenerating;
  },

  /**
   * Check if there are generated results that should block navigation
   */
  hasGeneratedResults(): boolean {
    return state.hasGeneratedResults;
  },

  /**
   * Get current auto-save status
   */
  getAutoSaveStatus(): AutoSaveStatus | null {
    return state.autoSaveStatus;
  },

  /**
   * Check if auto-save is enabled
   */
  isAutoSaveEnabled(): boolean {
    return autoSaveEnabled;
  },

  /**
   * Dynamically enable or disable auto-save.
   */
  setAutoSaveEnabled(enabled: boolean) {
    autoSaveEnabled = enabled;
    if (enabled) {
      if (!state.autoSaveStatus) {
        state.autoSaveStatus = { enabled: true, queued: 0, batchesSent: 0, errors: 0 };
      } else {
        state.autoSaveStatus = { ...state.autoSaveStatus, enabled: true };
      }
      // If there are existing combinations and queued is 0, auto-save the existing batch
      if (state.combinations.length > 0 && state.autoSaveStatus.queued === 0) {
        autoSaveBatch(state.combinations);
      }
    } else {
      if (state.autoSaveStatus) {
        state.autoSaveStatus = { ...state.autoSaveStatus, enabled: false };
      }
    }
    notifySubscribers();
  },

  /**
   * Clear all results (e.g. after bulk save)
   */
  clear() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    autoSaveEnabled = false;
    state = {
      isGenerating: false,
      combinations: [],
      failures: [],
      progress: null,
      hasGeneratedResults: false,
      autoSaveStatus: null,
    };
    notifySubscribers();
    try {
      sessionStorage.removeItem("collageCombinations");
      sessionStorage.removeItem("collageFailures");
      sessionStorage.removeItem("generationProgress");
    } catch (err) {
      // ignore
    }
  },

  /**
   * Replace combinations (e.g. when restoring from storage)
   */
  setCombinations(combinations: CombinatorialResult[], failures: FailureLog[]) {
    // Don't overwrite if currently generating
    if (state.isGenerating) return;
    state.combinations = combinations;
    state.failures = failures;
    state.hasGeneratedResults = combinations.length > 0;
    notifySubscribers();
  },

  /**
   * Update a specific combination (e.g. after customization save)
   */
  updateCombination(combinationId: string, updatedObjects: any[]) {
    if (state.isGenerating) return;

    const comboIndex = state.combinations.findIndex(c => c.id === combinationId);
    if (comboIndex === -1) return;

    const existingCombo = state.combinations[comboIndex];
    state.combinations[comboIndex] = {
      ...existingCombo,
      objects: updatedObjects,
    };

    notifySubscribers();
  },

  /**
   * Restore state from sessionStorage (e.g. after page refresh)
   * Note: Only restores lightweight data (IDs). Full objects must be re-fetched.
   */
  restoreFromStorage() {
    if (state.isGenerating) return;

    const hasFullObjects = state.combinations.some(c => c.objects && c.objects.length > 0);
    if (hasFullObjects) return;

    try {
      const combos = sessionStorage.getItem("collageCombinations");
      const failures = sessionStorage.getItem("collageFailures");
      if (combos) {
        state.combinations = JSON.parse(combos);
        state.hasGeneratedResults = true;
      }
      if (failures) {
        state.failures = JSON.parse(failures);
      }
      if (combos || failures) {
        notifySubscribers();
      }
    } catch (err) {
      console.warn("[GenerationService] restore from storage failed:", err);
    }
  },
};
