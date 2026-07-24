/**
 * GenerationService - Module-level singleton for incremental combination generation.
 * 
 * This service survives component mount/unmount cycles because modules in Vite
 * are singletons. It stores the worker reference at module level so that when
 * the user navigates between pages, the generation continues in the background.
 * 
 * Components can subscribe to receive incremental batch updates.
 */

import type { CombinatorialResult, FailureLog } from "../types/customization";
import type { Item } from "../types/library";
import type { GenerationParams, GenerationProgress, GenerationState } from "../types/generation";

type Subscriber = (state: GenerationState) => void;

// Module-level state (survives component mount/unmount)
let worker: Worker | null = null;
let state: GenerationState = {
  isGenerating: false,
  combinations: [],
  failures: [],
  progress: null,
  hasGeneratedResults: false,
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
    // Store only essential data (IDs and minimal info) to avoid quota limits
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
    // Clear storage if quota exceeded to prevent repeated errors
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

    state = {
      isGenerating: true,
      combinations: [],
      failures: [],
      progress: { generated: 0, total: params.kValue },
      hasGeneratedResults: false,
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
          // Append batch to accumulated results
          state.combinations.push(...(response.batch || []));
          state.progress = response.progress;
          if (response.failures) {
            state.failures.push(...response.failures);
          }
          notifySubscribers();
          persistToStorage();
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
   * Clear all results (e.g. after bulk save)
   */
  clear() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    state = {
      isGenerating: false,
      combinations: [],
      failures: [],
      progress: null,
      hasGeneratedResults: false,
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
    
    // Update the combination with new objects while maintaining the structure
    const existingCombo = state.combinations[comboIndex];
    state.combinations[comboIndex] = {
      ...existingCombo,
      objects: updatedObjects,
    };
    
    notifySubscribers();
    
    // Don't call persistToStorage() here - it would overwrite sessionStorage
    // with lightweight data, losing the full objects. The sessionStorage
    // is only for page refresh recovery, not for preserving edits.
  },

  /**
   * Restore state from sessionStorage (e.g. after page refresh)
   * Note: Only restores lightweight data (IDs). Full objects must be re-fetched.
   * Will NOT overwrite in-memory state that already has objects (e.g. after customization save).
   */
  restoreFromStorage() {
    if (state.isGenerating) return;
    
    // Check if in-memory state already has combinations with objects
    // If so, don't overwrite with lightweight storage data
    const hasFullObjects = state.combinations.some(c => c.objects && c.objects.length > 0);
    if (hasFullObjects) return;
    
    try {
      const combos = sessionStorage.getItem("collageCombinations");
      const failures = sessionStorage.getItem("collageFailures");
      if (combos) {
        // Restore as lightweight combos - full data needs to be re-fetched from backend
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
