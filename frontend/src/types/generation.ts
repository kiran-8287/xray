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

/**
 * Split generation parameters for handling large k values safely.
 * When kValue exceeds SAFE_GENERATION_THRESHOLD, generation is split
 * into multiple smaller batches with exact distribution quotas.
 */
export type SplitGenerationParams = GenerationParams & {
  /** Enable split generation mode */
  enableSplitGeneration?: boolean;
  /** Target batch size for split generation (default: 25000) */
  splitBatchSize?: number;
};

/**
 * Distribution quota for a single batch in split generation.
 * Ensures exact weighted distribution is maintained across all batches.
 */
export type DistributionQuota = {
  /** Total k value across all batches */
  totalK: number;
  /** Number of batches */
  numBatches: number;
  /** Per-batch quotas for threat counts */
  batches: Array<{
    batchK: number;
    threatQuotas: Record<number, number>;
    nonThreatQuotas: Record<number, number>;
  }>;
};

/**
 * Memory safety limits for generation
 */
export const GENERATION_LIMITS = {
  /** k value above this triggers split generation warning */
  SOFT_WARN_THRESHOLD: 50_000,
  /** k value above this forces split generation */
  SPLIT_THRESHOLD: 100_000,
  /** Recommended batch size for split generation */
  DEFAULT_BATCH_SIZE: 25_000,
  /** Maximum batch size to prevent memory issues */
  MAX_BATCH_SIZE: 50_000,
  /** Maximum buffer size in memory */
  MAX_BUFFER_SIZE: 300,
  /** Memory check interval (ms) */
  MEMORY_CHECK_INTERVAL: 5000,
} as const;
