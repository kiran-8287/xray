/**
 * GenerationService - Module-level singleton for incremental combination generation.
 *
 * Memory-efficient design ("show only 100 at a time"):
 * - generatedBuffer: staging buffer holding the next ~200 combos from the worker
 * - state.combinations: ONLY the current display window (≤ ITEMS_PER_PAGE = 100)
 * - After saving a page (100), it's evicted and the next 100 are pulled straight
 *   from the staged buffer (no generation wait), then the buffer is topped back
 *   up toward STAGED_BUFFER_SIZE (200) — "add another 100 next to the buffer".
 *
 * "Save as you go" mode: when enabled with a mode (annotations/both),
 * automatically save pages of 100, evict, load next 100 from buffer, repeat.
 */

import type { CombinatorialResult, FailureLog, SceneObject } from "../types/customization";
import type { Item } from "../types/library";
import type {
  AutoSaveMode,
  GenerationParams,
  GenerationProgress,
  GenerationState,
  AutoSaveStatus,
  SplitGenerationParams,
  DistributionQuota,
} from "../types/generation";
import { getTransformedPolygon } from "./geometry";
import { attachSegmentationMasks } from "./segmentationMasks";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS } from "./fetchWithTimeout";
import {
  addCombos,
  addFailures,
  getAllCombos,
  getAllFailures,
  clearAll as storageClearAll,
} from "./storageService";
import { calculateDistributionQuotas, shouldUseSplitGeneration } from "./splitGeneration";
import { buildLayoutPayload } from "./layoutBuilder";
import {
  ITEMS_PER_PAGE,
  MAX_CONCURRENT_RENDERS,
  NOTIFY_THROTTLE_MS,
  CHUNK_SIZE,
  STAGED_BUFFER_SIZE,
  BUFFER_REFILL_THRESHOLD,
  MAX_BUFFER_SIZE,
  MAX_BUFFER_GROWTH,
  AUTO_SAVE_INITIAL_DELAY_MS,
  AUTO_SAVE_PAGE_DELAY_MS,
  DEFAULT_SPLIT_BATCH_SIZE,
  SPLIT_GENERATION_ENABLED,
  MAX_ZERO_CHUNKS,
} from "./constants";
import { debugLog } from "./debugLog";
import { reportError } from "./errorReporter";
import { ERROR_MESSAGES } from "./errorMessages";

type Subscriber = (state: GenerationState) => void;

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

// Abort flag for split generation - prevents the sequential batch loop from
// continuing after clear()/abort() is called during navigation away.
let generationAborted = false;

// Backpressure hook for split generation: when the in-memory buffer fills up,
// a sub-batch pauses and stores a resume callback here. It is invoked from
// saveCurrentPage() / processNextAutoSavePage() via checkAndRefillBuffer() once
// pages have been evicted and buffer space frees up. This keeps the buffer
// bounded instead of letting all 25K+ combos accumulate in RAM.
let splitBatchResumeFn: (() => void) | null = null;

// Chunked generation state
let totalGeneratedCount = 0; // Total combinations generated so far
let isGeneratingChunk = false; // Whether we're currently generating a chunk
let currentGenerationParams: GenerationParams | null = null; // Store params for chunk requests
// Bug #3 fix: circuit breaker — stop retrying after this many consecutive empty chunks
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
            debugLog.error("[GenerationService] subscriber error:", err);
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
            debugLog.error("[GenerationService] subscriber error:", err);
    }
  }
}

function persistToStorage() {
  const allCombos = [...state.combinations, ...generatedBuffer];
  if (allCombos.length > 0) {
    const lightweightCombos = allCombos.map(combo => ({
      id: combo.id,
      bag: combo.bag ? { id: combo.bag.id } : null,
      threats: combo.threats?.map(t => ({ id: t.id })) || [],
      others: combo.others?.map(o => ({ id: o.id })) || [],
    }));
    addCombos(lightweightCombos);
  }

  if (state.failures.length > 0) {
    addFailures(state.failures);
  }

  if (state.isGenerating && state.progress) {
    storageSetProgress(state.progress);
  }
}

function refillDisplayWindow() {
  // Show ONLY one page (ITEMS_PER_PAGE = 100) at a time — NOT 3 pages of 300.
  // Everything else stays staged in generatedBuffer so the instant the current
  // page is saved, the next 100 are pulled from the buffer ("next 100 out of the
  // stored 200"). checkAndRefillBuffer() then tops the buffer back up.
  const targetCount = ITEMS_PER_PAGE;
  
  while (state.combinations.length < targetCount && generatedBuffer.length > 0) {
    state.combinations.push(generatedBuffer.shift()!);
  }
}

async function saveOneComboAnnotationOnly(combo: CombinatorialResult): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/saved-layouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLayoutPayload(combo)),
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
    const payloads = page.map(buildLayoutPayload);
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

// Shared concurrency limiter for collage image renders.
const renderSemaphore = { current: 0, queue: [] as (() => void)[] };

// Concurrency-limited image rendering
async function renderOneComboImage(combo: CombinatorialResult): Promise<boolean> {
  const acquire = () => new Promise<void>((resolve) => {
    if (renderSemaphore.current < MAX_CONCURRENT_RENDERS) {
      renderSemaphore.current++;
      resolve();
    } else {
      renderSemaphore.queue.push(resolve);
    }
  });

  const release = () => {
    renderSemaphore.current--;
    if (renderSemaphore.queue.length > 0 && renderSemaphore.current < MAX_CONCURRENT_RENDERS) {
      const next = renderSemaphore.queue.shift()!;
      renderSemaphore.current++;
      next();
    }
  };

  try {
    await acquire();
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/render-and-save-collage-both`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects: combo.objects, name: combo.id }),
    }, LONG_REQUEST_TIMEOUT_MS, 1);
    if (!res.ok) {
      debugLog.error(`[generationService] Render failed for ${combo.id}: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    debugLog.error(`[generationService] Render error for ${combo.id}:`, err);
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

  // Buffer space just freed up — allow a paused split sub-batch to continue.
  maybeResumeSplitGeneration();

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
      debugLog.info(`[AutoSave] Waiting ${remainingDelay}ms before starting auto-save...`);
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
        debugLog.info(`[AutoSave] Waiting ${remainingDelay}ms before next save...`);
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

/**
 * Generate a single batch of combinations using a web worker
 * Used by split generation to process batches sequentially
 * 
 * NOW WITH INCREMENTAL UPDATES - Shows items immediately as they're generated!
 */
async function generateSingleBatch(
  params: GenerationParams,
  batchSize?: number,
  batchLabel?: string,
  onProgress?: (results: CombinatorialResult[], failures: FailureLog[]) => void
): Promise<{ results: CombinatorialResult[]; failures: FailureLog[] }> {
  return new Promise((resolve, reject) => {
    const results: CombinatorialResult[] = [];
    const failures: FailureLog[] = [];
    let worker: Worker | null = null;
    let generatedInBatch = 0;  // combos produced so far for THIS split sub-batch
    let chunkInFlight = false;
    let done = false;
    // IDs produced within THIS sub-batch. The worker dedups only against the
    // `existingIds` it receives per message, so for chunked generation we must
    // feed the already-generated ids of this sub-batch back in on every chunk
    // — otherwise chunk N+1 can regenerate combinations from chunk N.
    const batchGeneratedIds: string[] = [];


    // Timeout scales with the batch size. Base 5 min for the first 5,000 combos,
    // then +1 min for every additional 5,000. This gives a 25K batch ~9 minutes,
    // while keeping small batches snappy. (Previously a fixed 5-min timeout could
    // fire even for a correctly-sized batch on slow/loaded machines.)
    const k = Math.max(params.kValue || 0, 0);
    const timeoutMs = 300000 + Math.max(0, k - 5000) / 5000 * 60000;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const resetTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (done) return;
        if (worker) worker.terminate();
        reject(new Error(`${batchLabel || "Batch"} generation timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    };

    const moreToGenerate = () => generatedInBatch < params.kValue;

    // Backpressure: send the next chunk only when the in-memory buffer has room.
    // If the buffer is full, pause and hand a resume callback to the module-level
    // hook, which is invoked after pages are saved/evicted. This keeps memory
    // bounded instead of filling the buffer with all combos at once.
    const sendChunk = () => {
      if (done || chunkInFlight) return;
      if (!moreToGenerate()) return;

      const remaining = params.kValue - generatedInBatch;
      const chunkSize = Math.min(CHUNK_SIZE, remaining);

      resetTimeout();
      chunkInFlight = true;

      const effectiveThreatDist: Record<number, number> = {};
      for (let i = 1; i <= params.maxThreats; i++) {
        effectiveThreatDist[i] = (params.threatDistribution && params.threatDistribution[i]) ?? 0;
      }
      const effectiveNonThreatDist: Record<number, number> = {};
      for (let i = 1; i <= params.maxNonThreats; i++) {
        effectiveNonThreatDist[i] = (params.nonThreatDistribution && params.nonThreatDistribution[i]) ?? 0;
      }

      worker?.postMessage({
        type: "generateChunk",
        selectedBags: params.selectedBags,
        selectedThreats: params.selectedThreats,
        selectedOthers: params.selectedOthers,
        kValue: params.kValue,       // full sub-batch total (keeps isComplete math correct)
        chunkSize: chunkSize,        // cap how many this run produces
        totalGenerated: generatedInBatch,
        threatDistribution: effectiveThreatDist,
        nonThreatDistribution: effectiveNonThreatDist,
        requireAtLeastOneNonThreat: params.requireAtLeastOneNonThreat || false,
        existingIds: [...(params.existingIds || []), ...batchGeneratedIds],
        batchSize: batchSize || params.batchSize || 200,
      });
    };

    // Called once pages are saved and buffer space frees up.
    const pauseUntilSaved = () => {
      debugLog.info(`[SplitGeneration] ${batchLabel} buffer full (${generatedBuffer.length}/>=${MAX_BUFFER_GROWTH}), pausing until pages are saved...`);
      chunkInFlight = false;
      if (timeout) clearTimeout(timeout); // no in-flight work while paused
      splitBatchResumeFn = () => {
        splitBatchResumeFn = null;
        resetTimeout();
        sendChunk();
      };
    };

    try {
      worker = new Worker(
        new URL("../workers/incrementalGenerator.worker.ts", import.meta.url),
        { type: "module" }
      );

      worker.onmessage = (event) => {
        const response = event.data;

        if (response.type === "batch") {
          const batch = response.batch || [];

          // Add to results
          results.push(...batch);
          generatedInBatch += batch.length;

          // Track ids generated in this sub-batch so subsequent chunks pass
          // them back via existingIds — the worker dedups only against the
          // existingIds it receives per message, not across messages.
          for (const combo of batch) {
            if (combo.id) batchGeneratedIds.push(combo.id);
          }

          // Add any failures
          const batchFailures: FailureLog[] = response.failures || [];
          if (batchFailures.length > 0) {
            failures.push(...batchFailures);
          }

          // CALLBACK: Show only the NEW batch items immediately as generated
          if (onProgress && batch.length > 0) {
            onProgress(batch, batchFailures);
          }
        } else if (response.type === "complete" || response.type === "chunkComplete") {
          chunkInFlight = false;

          // Capture failures delivered with the completion message
          if (response.failures && response.failures.length > 0) {
            failures.push(...response.failures);
          }

          if (moreToGenerate()) {
            // Still more combos in this sub-batch: pace by buffer capacity.
            if (generatedBuffer.length < MAX_BUFFER_GROWTH) {
              sendChunk();
            } else {
              pauseUntilSaved();
            }
          } else {
            done = true;
            if (timeout) clearTimeout(timeout);
            worker?.terminate();
            resolve({ results, failures });
          }
        } else if (response.type === "error") {
          done = true;
          if (timeout) clearTimeout(timeout);
          worker?.terminate();
          reject(new Error(response.error || "Worker error"));
        }
      };

      worker.onerror = (error) => {
        done = true;
        if (timeout) clearTimeout(timeout);
        worker?.terminate();
        reject(new Error("Worker failed: " + (error.message || "Unknown error")));
      };

      sendChunk();
    } catch (err) {
      done = true;
      if (timeout) clearTimeout(timeout);
      worker?.terminate();
      reject(err);
    }
  });
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
 * Resume a paused split-generation sub-batch once buffer space frees up.
 * Called after pages are saved/evicted (manual save and auto-save).
 */
function maybeResumeSplitGeneration() {
  if (splitBatchResumeFn && generatedBuffer.length < MAX_BUFFER_GROWTH) {
    const resume = splitBatchResumeFn;
    splitBatchResumeFn = null;
    resume();
  }
}

/**
 * Check if buffer needs refilling and request next chunk if needed
 */
function checkAndRefillBuffer() {
  // Resume any paused split sub-batch now that pages have been saved.
  maybeResumeSplitGeneration();

  if (!state.isGenerating || isGeneratingChunk) return;
  
  const totalTarget = state.progress?.total || 0;
  
  // If buffer is below threshold and we haven't generated all combos, request more
  if (generatedBuffer.length < BUFFER_REFILL_THRESHOLD && totalGeneratedCount < totalTarget) {
    debugLog.info(`[GenerationService] Buffer low (${generatedBuffer.length}/${BUFFER_REFILL_THRESHOLD}), requesting next chunk...`);
    requestNextChunk();
  }
}

/**
 * Finish generation cleanly — marks the state as not generating and
 * surfaces the final progress to subscribers.
 */
function finishGeneration(progress: { generated: number; total: number } | null) {
  state.isGenerating = false;
  isGeneratingChunk = false;
  splitBatchResumeFn = null;
  state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
  state.progress = progress;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  notifySubscribers();
  persistToStorage();
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
    // Already at/near the target — nothing left to generate. Finish cleanly
    // instead of silently stalling.
    isGeneratingChunk = false;
    debugLog.info("[GenerationService] No more combos to request — finishing generation.");
    finishGeneration({ generated: Math.min(totalGeneratedCount, totalTarget), total: totalTarget });
    return;
  }
  
  debugLog.info(`[GenerationService] Requesting chunk of ${chunkSize} combos (total so far: ${totalGeneratedCount}/${totalTarget})`);
  
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
    batchSize: 200,
  });
}

export const GenerationService = {
  ITEMS_PER_PAGE,

  async startGeneration(params: GenerationParams) {
    const splitParams = params as SplitGenerationParams;
    
    // Reset abort flag at the start of any new generation
    generationAborted = false;
    
    // Attach segmentation masks to the selected threats/non-threats BEFORE
    // generation so every chunk re-sends the same (mask-enriched) Item objects
    // and placement uses the tight mask footprint (-> axis-aligned box).
    try {
      await attachSegmentationMasks([...params.selectedThreats, ...params.selectedOthers]);
    } catch (err) {
      debugLog.warn("[GenerationService] Could not attach segmentation masks:", err);
    }
    
    // Check if we should use split generation for large k values
    if (shouldUseSplitGeneration(params.kValue, splitParams)) {
      debugLog.info(`[GenerationService] Using split generation for k=${params.kValue.toLocaleString()}`);
      return await this.startSplitGeneration(splitParams);
    }
    
    // Original single-generation logic for smaller k values
    if (worker) {
      worker.terminate();
      worker = null;
    }

    autoSaveEnabled = params.autoSave === true;
    if (autoSaveEnabled) {
      autoSaveStartTime = Date.now();
    }

    // Reset chunked generation state
    totalGeneratedCount = 0;
    isGeneratingChunk = false;
    consecutiveZeroChunks = 0;
    chunkStartGeneratedCount = 0;
    generatedIds = [];
    currentGenerationParams = params;

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

    // Clear previous generation data from IndexedDB
    await storageClearAll();

    try {
      debugLog.info("[GenerationService] Creating worker...");
      const newWorker = new Worker(
        new URL("../workers/incrementalGenerator.worker.ts", import.meta.url),
        { type: "module" }
      );
      worker = newWorker;
      debugLog.info("[GenerationService] Worker created successfully");

      newWorker.onmessage = (event) => {
        const response = event.data;
        debugLog.info("[GenerationService] Received message:", response.type);

        if (response.type === "progress") {
          // Update progress without adding to buffer
          if (response.progress) {
            debugLog.info("[GenerationService] Progress update:", response.progress);
            state.progress = response.progress;
            notifySubscribers();
          }
        } else if (response.type === "batch") {
          const batch = response.batch || [];
          debugLog.info("[GenerationService] Batch received:", batch.length, "combos, buffer size:", generatedBuffer.length);
          state.progress = response.progress;
          if (response.failures) {
            state.failures.push(...response.failures);
          }
          
          // Always count generated combos and accumulate IDs
          totalGeneratedCount += batch.length;
          for (const combo of batch) {
            if (combo.id) generatedIds.push(combo.id);
          }
          
          // Always add batch to buffer - never discard data
          generatedBuffer.push(...batch);
          
          // Refill display window from buffer
          refillDisplayWindow();
          
          if (state.combinations.length > 0 || generatedBuffer.length > 0) {
            state.hasGeneratedResults = true;
          }
          notifySubscribers();
          persistToStorage();
          
          // In auto-save mode, let the auto-save loop handle refilling.
          // We intentionally do NOT call checkAndRefillBuffer() here for
          // manual mode — chunk requests are driven exclusively by
          // chunkComplete. (isGeneratingChunk is set for the initial
          // generate as well, so calling it here would be a no-op and
          // could even race with the in-flight chunk.)
          if (autoSaveEnabled) {
            wakeLoopNow();
          }
        } else if (response.type === "chunkComplete") {
          debugLog.info("[GenerationService] Chunk complete:", response.progress, "isComplete:", response.isComplete);
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
            ? Math.max(0, response.progress.generated - chunkStartGeneratedCount)
            : 0;

          if (progressDelta <= 0) {
            consecutiveZeroChunks++;
            debugLog.warn(
              `[GenerationService] Chunk produced 0 results (${consecutiveZeroChunks}/${MAX_ZERO_CHUNKS}). ` +
              (consecutiveZeroChunks >= MAX_ZERO_CHUNKS ? 'Stopping generation.' : 'Will retry...')
            );
            if (consecutiveZeroChunks >= MAX_ZERO_CHUNKS) {
              debugLog.error('[GenerationService] Too many consecutive empty chunks — aborting generation.');
              finishGeneration(response.progress || state.progress);
              return;
            }
          } else {
            consecutiveZeroChunks = 0; // reset on any successful chunk
          }
          
          // Decide whether to request the next chunk or finish. We must
          // consider totalGeneratedCount as well as response.isComplete:
          // if the count has reached (or overshot) the target, the
          // generation is done — otherwise the chunkComplete handler would
          // deadlock (neither branch matching) and the UI would hang.
          const reachedTarget = totalGeneratedCount >= params.kValue;
          const bufferHasRoom = generatedBuffer.length < MAX_BUFFER_GROWTH;
          
          if (!response.isComplete && !reachedTarget && bufferHasRoom) {
            debugLog.info("[GenerationService] Requesting next chunk...");
            requestNextChunk();
          } else {
            // Either the worker says it's complete, we've hit the target,
            // or the buffer is full (manual mode — resume via saveCurrentPage).
            if (reachedTarget || response.isComplete) {
              debugLog.info("[GenerationService] All chunks complete", { totalGeneratedCount, isComplete: response.isComplete });
              const finalProgress: { generated: number; total: number } = {
                generated: Math.min(totalGeneratedCount, params.kValue),
                total: params.kValue,
              };
              finishGeneration(finalProgress);
            } else if (generatedBuffer.length >= MAX_BUFFER_SIZE) {
              debugLog.info(`[GenerationService] Buffer full (${generatedBuffer.length}/${MAX_BUFFER_GROWTH}), pausing generation. Save pages to free up space.`);
              // Buffer is full - pause and wait for user to save pages
              // checkAndRefillBuffer() will be called after saveCurrentPage()
            }
          }
        } else if (response.type === "complete") {
          debugLog.info("[GenerationService] Generation complete:", response.progress);
          state.isGenerating = false;
          state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
          state.failures.push(...(response.failures || []));
          state.progress = response.progress || null;
          notifySubscribers();
          persistToStorage();
          worker = null;
        } else if (response.type === "error") {
          debugLog.error("[GenerationService] worker error:", response.error);
          state.isGenerating = false;
          isGeneratingChunk = false;
          state.progress = null;
          notifySubscribers();
          worker = null;
        }
      };

      newWorker.onerror = (error) => {
        debugLog.error("[GenerationService] Worker onerror:", error);
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

      // IMPORTANT: mark the initial generate as an in-flight "chunk" before
      // sending it. This prevents the batch handler from firing a duplicate
      // generateChunk request, and keeps the chunkComplete handler's
      // progress-delta / zero-chunk accounting accurate for the first run.
      isGeneratingChunk = true;
      chunkStartGeneratedCount = 0;

      debugLog.info("[GenerationService] Sending message to worker...");
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
        batchSize: params.batchSize ?? 200,
      });
      debugLog.info("[GenerationService] Message sent to worker");
    } catch (err) {
      debugLog.error("[GenerationService] failed to start worker:", err);
      state.isGenerating = false;
      state.progress = null;
      notifySubscribers();
    }
  },

  async startSplitGeneration(params: SplitGenerationParams) {
    const { splitBatchSize = 25_000 } = params;

    // Attach segmentation masks to the selected threats/non-threats so the
    // split worker uses the tight mask footprint (-> axis-aligned box) for
    // placement instead of the original image rectangle.
    try {
      await attachSegmentationMasks([...params.selectedThreats, ...params.selectedOthers]);
    } catch (err) {
      debugLog.warn("[GenerationService] Could not attach segmentation masks:", err);
    }
    
    // Reset abort flag for this generation run
    generationAborted = false;
    
    const quotas = calculateDistributionQuotas(
      params.kValue,
      params.threatDistribution,
      params.nonThreatDistribution,
      splitBatchSize
    );

    debugLog.info(`[SplitGeneration] Starting:`, {
      totalK: params.kValue.toLocaleString(),
      numBatches: quotas.numBatches,
    });

    autoSaveEnabled = params.autoSave === true;
    if (autoSaveEnabled) {
      autoSaveStartTime = Date.now();
    }

    totalGeneratedCount = 0;
    generatedIds = [];
    isGeneratingChunk = false;
    splitBatchResumeFn = null; // clear any stale pause hook from a prior run
    consecutiveZeroChunks = 0;

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

    await storageClearAll();

    // Start auto-save loop if enabled (saves pages, allowing the user to see
    // the next pages advance automatically as each page is saved to backend)
    if (autoSaveEnabled) {
      debugLog.info("[SplitGeneration] Starting auto-save loop...");
      runAutoSaveLoop();
    }

    let allFailures: FailureLog[] = [];
    let accumulatedIds: string[] = [];

    for (let i = 0; i < quotas.batches.length; i++) {
      // Check if generation was aborted (e.g., user navigated away)
      if (generationAborted) {
        debugLog.info(`[SplitGeneration] Aborted before batch ${i + 1}/${quotas.numBatches}`);
        break;
      }
      
      const batch = quotas.batches[i];
      
      state.progress = { generated: totalGeneratedCount, total: params.kValue };
      notifySubscribers();

      const batchLabel = `Batch ${i + 1}/${quotas.numBatches}`;

      try {
        // Callback to show items IMMEDIATELY as they're generated.
        // New items are streamed into generatedBuffer so the first 100
        // appear on page 1 right away, and the next 200 fill pages 2-3.
        const onProgress = (newItems: CombinatorialResult[], newFailures: FailureLog[]) => {
          // Don't process results if generation was aborted
          if (generationAborted) return;
          
          if (newItems.length > 0) {
            generatedBuffer.push(...newItems);
            totalGeneratedCount += newItems.length;
            for (const combo of newItems) {
              if (combo.id) generatedIds.push(combo.id);
            }
          }
          
          if (newFailures.length > 0) {
            allFailures.push(...newFailures);
            state.failures = allFailures;
          }
          
          // Refill display window (only loads one page of 100; the rest stays staged in buffer)
          refillDisplayWindow();
          state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
          state.progress = { generated: totalGeneratedCount, total: params.kValue };
          
          // Immediately update UI (notifySubscribers is internally throttled)
          notifySubscribers();
          persistToStorage();
        };

        const batchResult = await generateSingleBatch(
          {
            ...params,
            // CRITICAL FIX: generate ONLY this batch's quota, not the full k.
            // Previously we passed the full params.kValue, so every split sub-batch
            // regenerated the ENTIRE total (e.g. 200,000) instead of its own 25,000,
            // which caused 5-minute timeouts and massive redundant work.
            kValue: batch.batchK,
            threatDistribution: batch.threatQuotas,
            nonThreatDistribution: batch.nonThreatQuotas,
            existingIds: accumulatedIds,
          },
          params.batchSize || 200,
          batchLabel,
          onProgress  // stream items live into the display/buffer
        );

        // The whole batch's results are the source of truth for IDs & failures.
        // NOTE: totalGeneratedCount is already updated incrementally inside
        // onProgress for each emitted sub-batch, so we must NOT add
        // batchResult.results.length here (that would double-count).
        accumulatedIds.push(...batchResult.results.map(c => c.id));
        
        if (batchResult.failures) {
          allFailures.push(...batchResult.failures);
          state.failures = allFailures;
        }
        state.progress = { generated: totalGeneratedCount, total: params.kValue };
        refillDisplayWindow();

        debugLog.info(`[SplitGeneration] ${batchLabel} complete:`, {
          batchGenerated: batchResult.results.length.toLocaleString(),
          totalGenerated: totalGeneratedCount.toLocaleString(),
          displayItems: state.combinations.length,
          bufferItems: generatedBuffer.length,
          percentage: ((totalGeneratedCount / params.kValue) * 100).toFixed(1) + '%'
        });
      } catch (err) {
        debugLog.error(`${batchLabel} failed:`, err);
        allFailures.push({
          bagName: "Split Generation",
          bagId: "N/A",
          threatName: "N/A",
          threatId: "N/A",
          reason: `${batchLabel} failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          expected: batch.batchK,
          actual: 0,
        });
        state.failures = allFailures;
        notifySubscribers();
      }
    }

    // Finalize - load the display window (one page of 100) from the buffer
    refillDisplayWindow();
    state.failures = allFailures;
    state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
    state.progress = { generated: totalGeneratedCount, total: params.kValue };
    state.isGenerating = false;

    debugLog.info(`[SplitGeneration] Complete:`, {
      totalGenerated: totalGeneratedCount.toLocaleString(),
      totalFailures: allFailures.length,
      expected: params.kValue.toLocaleString(),
      finalDisplayItems: state.combinations.length,
      finalBufferItems: generatedBuffer.length,
    });

    notifySubscribers();
    persistToStorage();
  },

  getSplitGenerationPlan(params: GenerationParams) {
    const splitParams = params as SplitGenerationParams;
    
    // Quick check without full calculation
    const SPLIT_THRESHOLD = 100_000;
    const shouldSplit = (splitParams.enableSplitGeneration === true) || (params.kValue >= SPLIT_THRESHOLD);
    
    if (!shouldSplit) {
      return { shouldSplit: false, quota: null, numBatches: 0 };
    }
    
    const batchSize = splitParams.splitBatchSize || 25_000;
    const quota = calculateDistributionQuotas(
      params.kValue,
      params.threatDistribution,
      params.nonThreatDistribution,
      batchSize
    );
    
    return { shouldSplit: true, quota, numBatches: quota.numBatches };
  },

  abort() {
    // Set abort flag to stop split generation loop from continuing
    generationAborted = true;
    
    if (worker) {
      worker.terminate();
      worker = null;
    }
    state.isGenerating = false;
    state.progress = null;
    autoSaveEnabled = false;
    generatedIds = [];
    splitBatchResumeFn = null;
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
      debugLog.error("[GenerationService] initial subscriber callback error:", err);
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
      // Save exactly the currently-displayed page (ITEMS_PER_PAGE = 100), NOT
      // multiple pages of 300. After eviction, refillDisplayWindow() pulls the
      // next 100 straight from the staged buffer ("next 100 out of the stored
      // 200") so the next page appears immediately without waiting on generation,
      // and checkAndRefillBuffer() then tops the buffer back up ("add another
      // 100 next to the buffer").
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
    // Set abort flag to stop split generation loop from continuing
    generationAborted = true;
    
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

    // Clear IndexedDB storage
    storageClearAll();
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

  updateCombination(combinationId: string, updatedObjects: SceneObject[]) {
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

    (async () => {
      try {
        const [combos, failures] = await Promise.all([
          getAllCombos(),
          getAllFailures(),
        ]);

        if (combos.length > 0) {
          generatedBuffer = combos as unknown as CombinatorialResult[];
          generatedIds = generatedBuffer.map(c => c.id).filter(Boolean);
          state.combinations = [];
          refillDisplayWindow();
          state.hasGeneratedResults = state.combinations.length > 0 || generatedBuffer.length > 0;
        }

        if (failures.length > 0) {
          state.failures = failures;
        }

        if (combos.length > 0 || failures.length > 0) {
          notifySubscribers();
        }
      } catch (err) {
        debugLog.warn("[GenerationService] restore from storage failed:", err);
      }
    })();
  },
};