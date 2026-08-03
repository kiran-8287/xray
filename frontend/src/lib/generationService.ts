/**
 * GenerationService - Module-level singleton for incremental combination generation.
 *
 * Memory-efficient design:
 * - generatedBuffer: all combos received from worker but not yet saved
 * - state.combinations: ONLY the current display window (≤ ITEMS_PER_PAGE = 100)
 * - After saving a page, it's evicted and the next page is pulled from buffer
 *
 * "Save as you go" mode: when enabled with a mode (annotations/both),
 * automatically save pages of 100, evict, load next 100 from buffer, repeat.
 */

import type { CombinatorialResult, FailureLog } from "../types/customization";
import type { Item } from "../types/library";
import type {
  AutoSaveMode,
  GenerationParams,
  GenerationProgress,
  GenerationState,
  AutoSaveStatus,
} from "../types/generation";
import { getTransformedPolygon } from "./geometry";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS } from "./fetchWithTimeout";

type Subscriber = (state: GenerationState) => void;

const ITEMS_PER_PAGE = 100;
const MAX_CONCURRENT_RENDERS = 2; // Limit concurrent image rendering requests
const NOTIFY_THROTTLE_MS = 100; // Throttle subscriber notifications to every 100ms

// Chunked generation constants
const CHUNK_SIZE = 5000; // Generate 5k combinations per chunk
const MAX_BUFFER_SIZE = 10000; // Max combinations in memory (2 chunks)
const BUFFER_REFILL_THRESHOLD = 2000; // Request more when buffer drops below this

// Auto-save timing constants
const AUTO_SAVE_INITIAL_DELAY_MS = 5000; // Wait 5 seconds before starting auto-save
const AUTO_SAVE_PAGE_DELAY_MS = 5000; // Wait 5 seconds between each page save

let worker: Worker | null = null;
let autoSaveEnabled = false;
let autoSaveMode: AutoSaveMode = "annotations";
let generatedBuffer: CombinatorialResult[] = [];
let autoSaveRunningRef = false;
let pageSaveRunningRef = false;
let loopWakeController: { resolve: (() => void) | null } = { resolve: null };
let lastNotifyTime = 0;
let pendingNotify = false;
let autoSaveStartTime = 0;
let lastAutoSaveTime = 0; // Track when last auto-save completed

// Chunked generation state
let totalGeneratedCount = 0; // Total combinations generated so far
let isGeneratingChunk = false; // Whether we're currently generating a chunk
let currentGenerationParams: GenerationParams | null = null; // Store params for chunk requests
// Bug #3 fix: circuit breaker — stop retrying after this many consecutive empty chunks
const MAX_ZERO_CHUNKS = 3;
let consecutiveZeroChunks = 0;
// Track the total count when the current chunk was requested, so we can
// accurately measure how many results the chunk produced (totalGeneratedCount
// already includes this chunk's batches by the time chunkComplete arrives).
let chunkStartGeneratedCount = 0;
// All synthesized IDs generated so far across chunks — passed to subsequent
// chunks so the ID counter continues from the highest sequence instead of
// restarting (which would produce duplicate IDs).
let generatedIds: string[] = [];

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
  const now = Date.now();
  const timeSinceLastNotify = now - lastNotifyTime;

  // If we've notified recently, mark as pending and skip
  if (timeSinceLastNotify < NOTIFY_THROTTLE_MS) {
    if (!pendingNotify) {
      pendingNotify = true;
      // Schedule a notification after throttle period
      setTimeout(() => {
        pendingNotify = false;
        lastNotifyTime = Date.now();
        for (const cb of subscribers) {
          try {
            cb(state);
          } catch (err) {
            console.error("[GenerationService] subscriber error:", err);
          }
        }
      }, NOTIFY_THROTTLE_MS - timeSinceLastNotify);
    }
    return;
  }

  lastNotifyTime = now;
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
    const allCombos = [...state.combinations, ...generatedBuffer];
    if (allCombos.length > 0) {
      const lightweightCombos = allCombos.map(combo => ({
        id: combo.id,
        bag: combo.bag ? { id: combo.bag.id } : null,
        threats: combo.threats?.map(t => ({ id: t.id })) || [],
        others: combo.others?.map(o => ({ id: o.id })) || [],
      }));
      sessionStorage.setItem("collageCombinations", JSON.stringify(lightweightCombos));
    } else {
      sessionStorage.removeItem("collageCombinations");
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
      } catch (_) { /* ignore */ }
    }
  }
}

function refillDisplayWindow() {
  while (state.combinations.length < ITEMS_PER_PAGE && generatedBuffer.length > 0) {
    state.combinations.push(generatedBuffer.shift()!);
  }
}

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

async function saveOneComboAnnotationOnly(combo: CombinatorialResult): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/saved-layouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comboToLayout(combo)),
    }, LONG_REQUEST_TIMEOUT_MS, 1);
    return res.ok;
  } catch {
    return false;
  }
}

async function saveComboAnnotationBatch(page: CombinatorialResult[]): Promise<Set<string>> {
  const savedIds = new Set<string>();
  if (page.length === 0) return savedIds;
  try {
    const payloads = page.map(comboToLayout);
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/saved-layouts/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layouts: payloads }),
    }, LONG_REQUEST_TIMEOUT_MS, 1);
    if (!res.ok) return savedIds;
    const data = await res.json();
    if (!data || !Array.isArray(data.savedLayouts)) return savedIds;
    for (const layout of data.savedLayouts) {
      if (layout && layout.id) savedIds.add(layout.id);
    }
  } catch {
    // Fallback: save one-by-one so partial progress isn't lost.
    for (const combo of page) {
      if (await saveOneComboAnnotationOnly(combo) && combo.id) {
        savedIds.add(combo.id);
      }
    }
  }
  return savedIds;
}

// Concurrency-limited image rendering
async function renderOneComboImage(combo: CombinatorialResult): Promise<boolean> {
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
    await acquire();
    await fetchWithTimeout(`${API_BASE_URL}/api/render-and-save-collage-both`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects: combo.objects, name: combo.id }),
    }, LONG_REQUEST_TIMEOUT_MS, 1);
    return true;
  } catch {
    return false;
  } finally {
    release();
  }
}

async function savePage(page: CombinatorialResult[], mode: AutoSaveMode): Promise<{ savedAnnotations: number; savedImages: number; evictableIds: Set<string>; }> {
  const evictableIds = await saveComboAnnotationBatch(page);
  const savedAnnotations = evictableIds.size;
  let savedImages = 0;
  if (mode === "both") {
    // Render images with concurrency limit to avoid overwhelming backend
    const renderPromises: Promise<void>[] = [];
    for (const comb of page) {
      if (!comb.id || !evictableIds.has(comb.id)) continue;
      const promise = renderOneComboImage(comb).then((success) => {
        if (success) {
          savedImages++;
          if (state.autoSaveStatus) state.autoSaveStatus.imagesSaved++;
        }
      });
      renderPromises.push(promise);
    }
    // Wait for all renders with concurrency limit enforced in renderOneComboImage
    await Promise.all(renderPromises);
  }
  return { savedAnnotations, savedImages, evictableIds };
}

function evictFromDisplayWindow(evictableIds: Set<string>) {
  if (evictableIds.size === 0) return;
  const remaining = [];
  for (const c of state.combinations) {
    if (c.id && evictableIds.has(c.id)) continue;
    remaining.push(c);
  }
  state.combinations = remaining;
}

async function processNextAutoSavePage(): Promise<boolean> {
  const page = state.combinations.slice(0, ITEMS_PER_PAGE);
  if (page.length === 0) return false;

  const { savedAnnotations, evictableIds } = await savePage(page, autoSaveMode);

  if (state.autoSaveStatus) {
    state.autoSaveStatus.queued += savedAnnotations;
    state.autoSaveStatus.batchesSent++;
    state.autoSaveStatus.pagesCompleted++;
  }

  evictFromDisplayWindow(evictableIds);
  refillDisplayWindow();
  
  // Update hasGeneratedResults flag based on remaining combinations and buffer
  state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
  
  notifySubscribers();
  persistToStorage();
  return state.combinations.length > 0 || generatedBuffer.length > 0;
}

function interruptibleSleep(ms: number, signal: { resolve: (() => void) | null }): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      signal.resolve = null;
      resolve();
    };
    signal.resolve = finish;
    setTimeout(finish, ms);
  });
}

function wakeLoopNow() {
  if (loopWakeController.resolve) {
    loopWakeController.resolve();
  }
}

async function runAutoSaveLoop() {
  if (autoSaveRunningRef) return;
  autoSaveRunningRef = true;

  try {
    // Initial delay before starting auto-save
    const timeSinceStart = Date.now() - autoSaveStartTime;
    if (timeSinceStart < AUTO_SAVE_INITIAL_DELAY_MS) {
      const remainingDelay = AUTO_SAVE_INITIAL_DELAY_MS - timeSinceStart;
      console.log(`[AutoSave] Waiting ${remainingDelay}ms before starting auto-save...`);
      await interruptibleSleep(remainingDelay, loopWakeController);
      if (!autoSaveEnabled) return;
    }

    while (autoSaveEnabled) {
      if (pageSaveRunningRef) {
        await interruptibleSleep(100, loopWakeController);
        continue;
      }
      
      // Check if we should wait before next save (5 second delay between saves)
      const timeSinceLastSave = Date.now() - lastAutoSaveTime;
      if (lastAutoSaveTime > 0 && timeSinceLastSave < AUTO_SAVE_PAGE_DELAY_MS) {
        const remainingDelay = AUTO_SAVE_PAGE_DELAY_MS - timeSinceLastSave;
        console.log(`[AutoSave] Waiting ${remainingDelay}ms before next save...`);
        await interruptibleSleep(remainingDelay, loopWakeController);
        if (!autoSaveEnabled) break;
      }
      
      // Only start saving after we have at least one full page
      if (state.combinations.length >= ITEMS_PER_PAGE ||
          (!state.isGenerating && state.combinations.length > 0)) {
        const hasMore = await processNextAutoSavePage();
        lastAutoSaveTime = Date.now(); // Record when save completed
        if (!hasMore && !state.isGenerating) break;
      } else {
        await interruptibleSleep(500, loopWakeController);
        if (!autoSaveEnabled) break;
      }
    }
  } finally {
    autoSaveRunningRef = false;
    wakeLoopNow();
  }
}

async function autoSaveBatch(batch: CombinatorialResult[]) {
  if (!autoSaveEnabled || batch.length === 0) return;
  generatedBuffer.push(...batch);
  refillDisplayWindow();
  notifySubscribers();
  persistToStorage();
  wakeLoopNow();
  if (!autoSaveRunningRef) {
    runAutoSaveLoop();
  }
}

/**
 * Check if buffer needs refilling and request next chunk if needed
 */
function checkAndRefillBuffer() {
  if (!state.isGenerating || isGeneratingChunk) return;
  
  const totalTarget = state.progress?.total || 0;
  
  // If buffer is below threshold and we haven't generated all combos, request more
  if (generatedBuffer.length < BUFFER_REFILL_THRESHOLD && totalGeneratedCount < totalTarget) {
    console.log(`[GenerationService] Buffer low (${generatedBuffer.length}/${BUFFER_REFILL_THRESHOLD}), requesting next chunk...`);
    requestNextChunk();
  }
}

/**
 * Request next chunk of combinations from worker
 */
function requestNextChunk() {
  if (!worker || isGeneratingChunk) return;
  
  const params = currentGenerationParams;
  if (!params) return;
  
  isGeneratingChunk = true;
  chunkStartGeneratedCount = totalGeneratedCount; // Track where this chunk starts
  
  const totalTarget = params.kValue;
  const remaining = totalTarget - totalGeneratedCount;
  const chunkSize = Math.min(CHUNK_SIZE, remaining);
  
  if (chunkSize <= 0) {
    isGeneratingChunk = false;
    return;
  }
  
  console.log(`[GenerationService] Requesting chunk of ${chunkSize} combos (total so far: ${totalGeneratedCount}/${totalTarget})`);
  
  // Reconstruct distributions from params
  const effectiveThreatDist: Record<number, number> = {};
  for (let i = 1; i <= params.maxThreats; i++) {
    effectiveThreatDist[i] = (params.threatDistribution && params.threatDistribution[i]) ?? 0;
  }
  const effectiveNonThreatDist: Record<number, number> = {};
  for (let i = 1; i <= params.maxNonThreats; i++) {
    effectiveNonThreatDist[i] = (params.nonThreatDistribution && params.nonThreatDistribution[i]) ?? 0;
  }
  
  worker.postMessage({
    type: "generateChunk",
    selectedBags: params.selectedBags,
    selectedThreats: params.selectedThreats,
    selectedOthers: params.selectedOthers,
    kValue: totalTarget,
    threatDistribution: effectiveThreatDist,
    nonThreatDistribution: effectiveNonThreatDist,
    requireAtLeastOneNonThreat: params.requireAtLeastOneNonThreat || false,
    existingIds: [...(params.existingIds || []), ...generatedIds],
    chunkSize: chunkSize,
    totalGenerated: totalGeneratedCount,
    batchSize: 5000,
  });
}

export const GenerationService = {
  ITEMS_PER_PAGE,

  startGeneration(params: GenerationParams) {
    if (worker) {
      worker.terminate();
      worker = null;
    }

    autoSaveEnabled = params.autoSave === true;
    if (autoSaveEnabled) {
      autoSaveStartTime = Date.now(); // Record when generation started
    }

    // Reset chunked generation state
    totalGeneratedCount = 0;
    isGeneratingChunk = false;
    consecutiveZeroChunks = 0; // Bug #3 fix: reset circuit breaker on new generation
    chunkStartGeneratedCount = 0;
    generatedIds = []; // Reset accumulated IDs across chunks
    currentGenerationParams = params; // Store params for later chunk requests

    state = {
      isGenerating: true,
      combinations: [],
      failures: [],
      progress: { generated: 0, total: params.kValue },
      hasGeneratedResults: false,
      autoSaveStatus: autoSaveEnabled
        ? { enabled: true, mode: autoSaveMode, queued: 0, batchesSent: 0, errors: 0, pagesCompleted: 0, imagesSaved: 0 }
        : null,
    };
    generatedBuffer = [];
    notifySubscribers();

    try {
      sessionStorage.removeItem("collageCombinations");
      sessionStorage.removeItem("collageFailures");
      sessionStorage.setItem("generationProgress", JSON.stringify(state.progress));
    } catch (_) { /* ignore */ }

    try {
      console.log("[GenerationService] Creating worker...");
      const newWorker = new Worker(
        new URL("../workers/incrementalGenerator.worker.ts", import.meta.url),
        { type: "module" }
      );
      worker = newWorker;
      console.log("[GenerationService] Worker created successfully");

      newWorker.onmessage = (event) => {
        const response = event.data;
        console.log("[GenerationService] Received message:", response.type, response);

        if (response.type === "progress") {
          // Update progress without adding to buffer
          if (response.progress) {
            console.log("[GenerationService] Progress update:", response.progress);
            state.progress = response.progress;
            notifySubscribers();
          }
        } else if (response.type === "batch") {
          const batch = response.batch || [];
          console.log("[GenerationService] Batch received:", batch.length, "combos, buffer size:", generatedBuffer.length);
          state.progress = response.progress;
          if (response.failures) {
            state.failures.push(...response.failures);
          }
          
          // Enforce buffer size limit - if buffer is full, we need to pause generation
          if (generatedBuffer.length >= MAX_BUFFER_SIZE && !autoSaveEnabled) {
            console.log(`[GenerationService] Buffer full (${generatedBuffer.length}/${MAX_BUFFER_SIZE}), pausing generation...`);
            // Don't add to buffer, wait for user to save
            // The worker will naturally slow down as we don't request more chunks
          } else {
            // Add batch to buffer
            generatedBuffer.push(...batch);
            totalGeneratedCount += batch.length;
            
            // Accumulate generated IDs for subsequent chunks so the ID
            // counter continues from the highest sequence instead of
            // restarting (which would produce duplicate IDs).
            for (const combo of batch) {
              if (combo.id) generatedIds.push(combo.id);
            }
            
            // Refill display window from buffer
            refillDisplayWindow();
            
            if (state.combinations.length > 0 || generatedBuffer.length > 0) {
              state.hasGeneratedResults = true;
            }
            notifySubscribers();
            persistToStorage();
            
            // Check if we need to generate more chunks
            if (autoSaveEnabled) {
              // In auto-save mode, let auto-save loop handle refilling
              wakeLoopNow();
            } else {
              // In manual mode, check if we need more
              checkAndRefillBuffer();
            }
          }
        } else if (response.type === "chunkComplete") {
          console.log("[GenerationService] Chunk complete:", response.progress, "isComplete:", response.isComplete);
          isGeneratingChunk = false;
          
          if (response.failures) {
            state.failures.push(...response.failures);
          }

          // Bug #3 fix: circuit breaker — if this chunk produced 0 results,
          // increment the consecutive-zero counter and bail out once the
          // threshold is reached to avoid an infinite retry loop.
          // Use the progress delta from the chunk start as the authoritative
          // "produced" count (totalGeneratedCount already includes this
          // chunk's batches by the time chunkComplete arrives).
          const progressDelta = response.progress
            ? response.progress.generated - chunkStartGeneratedCount
            : 0;

          if (progressDelta <= 0) {
            consecutiveZeroChunks++;
            console.warn(
              `[GenerationService] Chunk produced 0 results (${consecutiveZeroChunks}/${MAX_ZERO_CHUNKS}). ` +
              (consecutiveZeroChunks >= MAX_ZERO_CHUNKS ? 'Stopping generation.' : 'Will retry...')
            );
            if (consecutiveZeroChunks >= MAX_ZERO_CHUNKS) {
              console.error('[GenerationService] Too many consecutive empty chunks — aborting generation.');
              state.isGenerating = false;
              state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
              state.progress = response.progress || state.progress;
              notifySubscribers();
              persistToStorage();
              if (worker) { worker.terminate(); worker = null; }
              return;
            }
          } else {
            consecutiveZeroChunks = 0; // reset on any successful chunk
          }
          
          // Check if we need to generate more
          if (!response.isComplete && totalGeneratedCount < params.kValue) {
            console.log("[GenerationService] Requesting next chunk...");
            requestNextChunk();
          } else if (response.isComplete) {
            console.log("[GenerationService] All chunks complete");
            state.isGenerating = false;
            state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
            state.progress = response.progress || null;
            notifySubscribers();
            persistToStorage();
            worker = null;
          }
        } else if (response.type === "complete") {
          console.log("[GenerationService] Generation complete:", response.progress);
          state.isGenerating = false;
          state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
          state.failures.push(...(response.failures || []));
          state.progress = response.progress || null;
          notifySubscribers();
          persistToStorage();
          worker = null;
        } else if (response.type === "error") {
          console.error("[GenerationService] worker error:", response.error);
          state.isGenerating = false;
          isGeneratingChunk = false;
          state.progress = null;
          notifySubscribers();
          worker = null;
        }
      };

      newWorker.onerror = (error) => {
        console.error("[GenerationService] Worker onerror:", error);
        state.isGenerating = false;
        state.progress = null;
        notifySubscribers();
        worker = null;
      };

      const effectiveThreatDist: Record<number, number> = {};
      for (let i = 1; i <= params.maxThreats; i++) {
        effectiveThreatDist[i] = (params.threatDistribution && params.threatDistribution[i]) ?? 0;
      }
      const effectiveNonThreatDist: Record<number, number> = {};
      for (let i = 1; i <= params.maxNonThreats; i++) {
        effectiveNonThreatDist[i] = (params.nonThreatDistribution && params.nonThreatDistribution[i]) ?? 0;
      }

      console.log("[GenerationService] Sending message to worker...");
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
      console.log("[GenerationService] Message sent to worker");
    } catch (err) {
      console.error("[GenerationService] failed to start worker:", err);
      state.isGenerating = false;
      state.progress = null;
      notifySubscribers();
    }
  },

  abort() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    state.isGenerating = false;
    state.progress = null;
    autoSaveEnabled = false;
    generatedIds = [];
    notifySubscribers();
    try {
      sessionStorage.removeItem("generationProgress");
    } catch (_) { /* ignore */ }
  },

  subscribe(callback: Subscriber): () => void {
    subscribers.add(callback);
    try {
      callback(state);
    } catch (err) {
      console.error("[GenerationService] initial subscriber callback error:", err);
    }
    return () => {
      subscribers.delete(callback);
    };
  },

  getState(): GenerationState {
    return {
      ...state,
      combinations: [...state.combinations],
      failures: [...state.failures],
    };
  },

  getBufferCount(): number {
    return generatedBuffer.length;
  },

  getTotalPending(): number {
    return state.combinations.length + generatedBuffer.length;
  },

  isGenerating(): boolean {
    return state.isGenerating;
  },

  hasGeneratedResults(): boolean {
    return state.hasGeneratedResults;
  },

  getAutoSaveStatus(): AutoSaveStatus | null {
    return state.autoSaveStatus;
  },

  isAutoSaveEnabled(): boolean {
    return autoSaveEnabled;
  },

  getAutoSaveMode(): AutoSaveMode {
    return autoSaveMode;
  },

  setAutoSaveMode(mode: AutoSaveMode) {
    autoSaveMode = mode;
    if (state.autoSaveStatus) {
      state.autoSaveStatus.mode = mode;
      notifySubscribers();
    }
  },

  enableAutoSave(mode: AutoSaveMode) {
    autoSaveEnabled = true;
    autoSaveMode = mode;
    autoSaveStartTime = Date.now(); // Record when auto-save was enabled
    lastAutoSaveTime = 0; // Reset last save time
    
    if (!state.autoSaveStatus) {
      state.autoSaveStatus = { enabled: true, mode, queued: 0, batchesSent: 0, errors: 0, pagesCompleted: 0, imagesSaved: 0 };
    } else {
      state.autoSaveStatus = { ...state.autoSaveStatus, enabled: true, mode };
    }
    notifySubscribers();
    wakeLoopNow();
    if (!autoSaveRunningRef && (state.combinations.length > 0 || generatedBuffer.length > 0)) {
      runAutoSaveLoop();
    }
  },

  disableAutoSave() {
    autoSaveEnabled = false;
    if (state.autoSaveStatus) {
      state.autoSaveStatus = { ...state.autoSaveStatus, enabled: false };
    }
    wakeLoopNow();
    notifySubscribers();
  },

  isPageSaveInProgress(): boolean {
    return pageSaveRunningRef || autoSaveRunningRef;
  },

  async saveCurrentPage(mode: AutoSaveMode): Promise<number> {
    if (pageSaveRunningRef) {
      return 0;
    }
    pageSaveRunningRef = true;
    try {
      const page = state.combinations.slice(0, ITEMS_PER_PAGE);
      if (page.length === 0) return 0;

      const { savedAnnotations, evictableIds } = await savePage(page, mode);

      if (state.autoSaveStatus) {
        state.autoSaveStatus.queued += savedAnnotations;
        state.autoSaveStatus.batchesSent++;
        state.autoSaveStatus.pagesCompleted++;
        if (mode === "both") {
          // imagesSaved counter is already updated inside savePage
        }
      }

      evictFromDisplayWindow(evictableIds);
      refillDisplayWindow();

      // Update hasGeneratedResults flag based on remaining combinations and buffer
      state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
      
      notifySubscribers();
      persistToStorage();
      
      // After saving, check if we need to generate more to refill buffer
      if (state.isGenerating) {
        checkAndRefillBuffer();
      }
      
      wakeLoopNow();
      return savedAnnotations;
    } finally {
      pageSaveRunningRef = false;
      wakeLoopNow();
    }
  },

  clear() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    autoSaveEnabled = false;
    generatedBuffer = [];
    generatedIds = [];
    chunkStartGeneratedCount = 0;
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
    } catch (_) { /* ignore */ }
  },

  setCombinations(combinations: CombinatorialResult[], failures: FailureLog[]) {
    if (state.isGenerating) return;
    generatedBuffer = combinations;
    generatedIds = combinations.map(c => c.id).filter(Boolean);
    state.combinations = [];
    refillDisplayWindow();
    state.failures = failures;
    state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
    notifySubscribers();
  },

  updateCombination(combinationId: string, updatedObjects: any[]) {
    if (state.isGenerating) return;

    const idx1 = state.combinations.findIndex(c => c.id === combinationId);
    if (idx1 !== -1) {
      state.combinations[idx1] = { ...state.combinations[idx1], objects: updatedObjects };
      notifySubscribers();
      return;
    }
    const idx2 = generatedBuffer.findIndex(c => c.id === combinationId);
    if (idx2 !== -1) {
      generatedBuffer[idx2] = { ...generatedBuffer[idx2], objects: updatedObjects };
    }
  },

  restoreFromStorage() {
    if (state.isGenerating) return;

    const hasFullObjects = state.combinations.some(c => c.objects && c.objects.length > 0) ||
      generatedBuffer.some(c => c.objects && c.objects.length > 0);
    if (hasFullObjects) return;

    try {
      const combos = sessionStorage.getItem("collageCombinations");
      const failures = sessionStorage.getItem("collageFailures");
      if (combos) {
        generatedBuffer = JSON.parse(combos);
        generatedIds = generatedBuffer.map(c => c.id).filter(Boolean);
        state.combinations = [];
        refillDisplayWindow();
        state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
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
