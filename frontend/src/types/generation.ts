import type { Item } from "./library";
import type { CombinatorialResult, FailureLog } from "./customization";

export type GenerationProgress = {
  generated: number;
  total: number;
};

export type AutoSaveMode = "annotations" | "both";

export type AutoSaveStatus = {
  enabled: boolean;
  mode: AutoSaveMode;
  queued: number;
  batchesSent: number;
  errors: number;
  pagesCompleted: number;
  imagesSaved: number;
};

export type GenerationState = {
  isGenerating: boolean;
  combinations: CombinatorialResult[];
  failures: FailureLog[];
  progress: GenerationProgress | null;
  hasGeneratedResults: boolean;
  autoSaveStatus: AutoSaveStatus | null;
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
  /** Number of combinations per emitted batch (default: 5000) */
  batchSize?: number;
  /** Auto-save each batch to backend as it's generated */
  autoSave?: boolean;
  /** Bag selection weighting strategy */
  bagWeightMode?: 'uniform' | 'subcategory_proportional';
};