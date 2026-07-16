// Incremental Web Worker for combination generation
// Sends batches of combinations back to the main thread as they're generated

import { generateCombinationsIncremental } from "../lib/combinationGenerator";

export interface IncrementalWorkerRequest {
  type: "generate";
  selectedBags: any[];
  selectedThreats: any[];
  selectedOthers: any[];
  kValue: number;
  threatDistribution: Record<number, number>;
  nonThreatDistribution: Record<number, number>;
  requireAtLeastOneNonThreat: boolean;
  existingIds: string[];
}

export interface IncrementalWorkerResponse {
  type: "batch" | "complete" | "error";
  batch?: any[];
  failures?: any[];
  progress?: { generated: number; total: number };
  error?: string;
}

self.onmessage = async (event: MessageEvent<IncrementalWorkerRequest>) => {
  const data = event.data;

  if (data.type !== "generate") {
    self.postMessage({
      type: "error",
      error: "Invalid request type",
    } as IncrementalWorkerResponse);
    return;
  }

  try {
    // Run incremental generation with batch callback
    const { results, failures } = await generateCombinationsIncremental(
      data.selectedBags,
      data.selectedThreats,
      data.selectedOthers,
      data.kValue,
      // onBatch callback - sends batches to main thread
      (batch, progress) => {
        self.postMessage({
          type: "batch",
          batch,
          failures: [],
          progress,
        } as IncrementalWorkerResponse);
      },
      data.threatDistribution,
      data.nonThreatDistribution,
      data.requireAtLeastOneNonThreat,
      data.existingIds
    );

    // Send final complete message
    self.postMessage({
      type: "complete",
      batch: [],
      failures,
      progress: { generated: results.length, total: data.kValue },
    } as IncrementalWorkerResponse);
  } catch (err) {
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    } as IncrementalWorkerResponse);
  }
};

export {};