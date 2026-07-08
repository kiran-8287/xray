// Web Worker for combination generation
// Offloads heavy computation from main thread

import { generateCombinations } from "../lib/combinationGenerator";

export interface CombinationWorkerRequest {
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

export interface CombinationWorkerResponse {
  type: "progress" | "result" | "error";
  message?: string;
  results?: any[];
  failures?: any[];
  error?: string;
}

self.onmessage = (event: MessageEvent<CombinationWorkerRequest>) => {
  const data = event.data;

  if (data.type !== "generate") {
    self.postMessage({
      type: "error",
      error: "Invalid request type",
    } as CombinationWorkerResponse);
    return;
  }

  try {
    // Send progress update
    self.postMessage({
      type: "progress",
      message: `Generating ${data.kValue} combinations...`,
    } as CombinationWorkerResponse);

    // Use setTimeout to allow progress message to be sent
    setTimeout(() => {
      try {
        const { results, failures } = generateCombinations(
          data.selectedBags,
          data.selectedThreats,
          data.selectedOthers,
          data.kValue,
          data.threatDistribution,
          data.nonThreatDistribution,
          data.requireAtLeastOneNonThreat,
          data.existingIds
        );

        self.postMessage({
          type: "result",
          message: `Generated ${results.length} combinations`,
          results,
          failures,
        } as CombinationWorkerResponse);
      } catch (err) {
        self.postMessage({
          type: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        } as CombinationWorkerResponse);
      }
    }, 50);
  } catch (err) {
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    } as CombinationWorkerResponse);
  }
};

export {};