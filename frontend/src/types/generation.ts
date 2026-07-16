import type { Item } from "./library";
import type { CombinatorialResult, FailureLog } from "./customization";

export type GenerationProgress = {
  generated: number;
  total: number;
};

export type GenerationState = {
  isGenerating: boolean;
  combinations: CombinatorialResult[];
  failures: FailureLog[];
  progress: GenerationProgress | null;
  hasGeneratedResults: boolean;
};

export type GenerationParams = {
  selectedBags: Item[];
  selectedThreats: Item[];
  selectedOthers: Item[];
  kValue: number;
  maxThreats: number;
  threatDistribution: Record<number, number>;
  maxNonThreats: number;
  nonThreatDistribution: Record<number, number>;
  requireAtLeastOneNonThreat?: boolean;
  existingIds?: string[];
};