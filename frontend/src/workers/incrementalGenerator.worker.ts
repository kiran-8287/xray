// Incremental Web Worker for combination generation
// Sends batches of combinations back to the main thread as they're generated

import { generateCombinationsIncremental } from "../lib/combinationGenerator";

export interface IncrementalWorkerRequest {
  type: "generate" | "generateChunk";
  selectedBags: any[];
  selectedThreats: any[];
  selectedOthers: any[];
  kValue: number;
  threatDistribution: Record<number, number>;
  nonThreatDistribution: Record<number, number>;
  requireAtLeastOneNonThreat: boolean;
  existingIds: string[];
  /** Number of combos per emitted batch (default: 5000) */
  batchSize?: number;
  /** For chunked generation: how many more to generate (default: 5000) */
  chunkSize?: number;
  /** For chunked generation: total already generated */
  totalGenerated?: number;
}

export interface IncrementalWorkerResponse {
  type: "batch" | "complete" | "error" | "progress" | "chunkComplete";
  batch?: any[];
  failures?: any[];
  progress?: { generated: number; total: number };
  error?: string;
  isComplete?: boolean;
}

// ---------------------------------------------------------------------------
// Serialization queue: the main thread may post a "generate" followed by
// one or more "generateChunk" messages. The onmessage handler below is async,
// so without serialization a new message could start processing while the
// previous generation is still running. Because the generators rely on
// module-level state (the synthesized-ID sequence in combinationGenerator.ts),
// overlapping runs would interleave and corrupt the ID counter / progress.
// ---------------------------------------------------------------------------
let processing = false;
const messageQueue: IncrementalWorkerRequest[] = [];

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (messageQueue.length > 0) {
      const request = messageQueue.shift()!;
      await handleRequest(request);
      // Yield to the event loop between requests so progress/batch messages
      // have a chance to flush to the main thread.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally {
    processing = false;
  }
}

async function handleRequest(data: IncrementalWorkerRequest) {
  console.log("[Worker] Received message:", data.type, {
    k: data.kValue,
    bags: data.selectedBags.length,
    chunkSize: data.chunkSize,
    totalGenerated: data.totalGenerated,
  });

  if (data.type !== "generate" && data.type !== "generateChunk") {
    console.error("[Worker] Invalid request type:", data.type);
    self.postMessage({
      type: "error",
      error: "Invalid request type",
    } as IncrementalWorkerResponse);
    return;
  }

  try {
    // For chunked generation, calculate how many to generate in this chunk
    let generateCount = data.kValue;
    if (data.type === "generateChunk" && data.chunkSize) {
      const remaining = data.kValue - (data.totalGenerated || 0);
      generateCount = Math.min(data.chunkSize, remaining);
    }

    console.log("[Worker] Starting generation:", {
      total: data.kValue,
      generating: generateCount,
      alreadyGenerated: data.totalGenerated || 0,
    });

    // Send immediate progress update
    self.postMessage({
      type: "progress",
      progress: { generated: data.totalGenerated || 0, total: data.kValue },
    } as IncrementalWorkerResponse);

    console.log("[Worker] Calling generateCombinationsIncremental...");

    // Run incremental generation with batch callback
    const { results, failures } = await generateCombinationsIncremental(
      data.selectedBags,
      data.selectedThreats,
      data.selectedOthers,
      generateCount,
      // onBatch callback - sends batches to main thread
      (batch, progress) => {
        const totalProgress = (data.totalGenerated || 0) + progress.generated;
        console.log("[Worker] Batch callback:", batch.length, "combos, total progress:", totalProgress, "/", data.kValue);
        self.postMessage({
          type: "batch",
          batch,
          failures: [],
          progress: { generated: totalProgress, total: data.kValue },
        } as IncrementalWorkerResponse);
      },
      data.threatDistribution,
      data.nonThreatDistribution,
      data.requireAtLeastOneNonThreat,
      data.existingIds,
      data.batchSize ?? 200
    );

    const totalGenerated = (data.totalGenerated || 0) + results.length;
    console.log("[Worker] Chunk complete:", results.length, "results, total:", totalGenerated);

    // Send chunk complete message
    self.postMessage({
      type: "chunkComplete",
      batch: [],
      failures,
      progress: { generated: totalGenerated, total: data.kValue },
      isComplete: totalGenerated >= data.kValue,
    } as IncrementalWorkerResponse);
  } catch (err) {
    console.error("[Worker] Error:", err);
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    } as IncrementalWorkerResponse);
  }
}

self.onmessage = (event: MessageEvent<IncrementalWorkerRequest>) => {
  const data = event.data;
  messageQueue.push(data);
  processQueue();
};

// Reset the serialization queue if a terminate/close is requested.
self.onclose = () => {
  messageQueue.length = 0;
  processing = false;
};

export {};