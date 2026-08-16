// Web Worker for combination generation
// Offloads heavy computation from main thread

import { generateCombinations } from "../lib/combinationGenerator";
import { debugLog } from "../lib/debugLog";

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

function validateCombinationWorkerRequest(data: unknown): CombinationWorkerRequest | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.type !== "generate") return null;
  if (typeof obj.kValue !== "number" || obj.kValue <= 0) return null;
  if (!Array.isArray(obj.selectedBags) || !Array.isArray(obj.selectedThreats) || !Array.isArray(obj.selectedOthers)) return null;
  if (!obj.existingIds || typeof obj.existingIds !== "object") return null;
  const payload = obj as CombinationWorkerRequest;
  return payload;
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;

  const request = validateCombinationWorkerRequest(data);
  if (!request) {
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

    // Use setTimeout to allow progress message to be sent, then await async generation
    setTimeout(async () => {
      try {
        const { results, failures } = await generateCombinations(
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