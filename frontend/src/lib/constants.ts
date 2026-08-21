/**
 * Centralized frontend constants.
 *
 * This file is the single source of truth for magic numbers used across the
 * frontend: canvas sizes, timeouts, batch sizes, buffer limits, and thresholds.
 * If a value needs tuning, change it here instead of hunting through multiple files.
 */

// ---------------------------------------------------------------------------
// Network timeouts (ms)
// ---------------------------------------------------------------------------
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000; // 30 seconds
export const LONG_REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const MEDIUM_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Generation / UI batching
// ---------------------------------------------------------------------------
export const ITEMS_PER_PAGE = 100;
export const MAX_CONCURRENT_RENDERS = 2;
export const NOTIFY_THROTTLE_MS = 100;
export const CHUNK_SIZE = 5000;
export const STAGED_BUFFER_SIZE = 200;
export const BUFFER_REFILL_THRESHOLD = STAGED_BUFFER_SIZE;
export const MAX_BUFFER_SIZE = 300; // 100 shown + 200 staged
export const MAX_BUFFER_GROWTH = 1000;
export const DEFAULT_BATCH_SIZE = 200; // emit every 200 combos
export const YIELD_INTERVAL = 10; // yield to event loop every 10 combos
export const VALID_REGION_CACHE_MAX_SIZE = 100;

// ---------------------------------------------------------------------------
// Auto-save timing
// ---------------------------------------------------------------------------
export const AUTO_SAVE_INITIAL_DELAY_MS = 5000;
export const AUTO_SAVE_PAGE_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// Split generation
// ---------------------------------------------------------------------------
export const DEFAULT_SPLIT_BATCH_SIZE = 25_000;
export const SPLIT_GENERATION_ENABLED = true;
export const SPLIT_THRESHOLD = 100_000;

// ---------------------------------------------------------------------------
// Circuit breaker / retry
// ---------------------------------------------------------------------------
export const MAX_ZERO_CHUNKS = 3;

// ---------------------------------------------------------------------------
// Storage / IndexedDB batching
// ---------------------------------------------------------------------------
export const BATCH_FLUSH_SIZE = 1000;
export const BATCH_FLUSH_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// Combination generation tolerances / intervals
// ---------------------------------------------------------------------------
export const PLACEMENT_TOLERANCE = 0.05;
export const LOG_INTERVAL_MS = 2000;
export const MAX_PLACEMENT_ATTEMPTS = 20;
export const PROGRESS_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Segmentation mask chunk size
// ---------------------------------------------------------------------------
export const SEGMENTATION_CHUNK_SIZE = 40;

// ---------------------------------------------------------------------------
// Image / rendering thresholds
// ---------------------------------------------------------------------------
export const WHITE_THRESHOLD = 245;

// ---------------------------------------------------------------------------
// Miscellaneous
// ---------------------------------------------------------------------------
export const MAX_COMBINATIONS_PER_REQUEST = 10_000;
export const DEFAULT_ITEM_FALLBACK_SIZE = 120;

// ---------------------------------------------------------------------------
// Memory / resource bounds
// ---------------------------------------------------------------------------
export const IMG_CACHE_MAX = 200;
export const PIXEL_CACHE_MAX = 500;
export const MAX_CANDIDATE_POOL = 50_000;
export const COMBO_BATCH_BUFFER_MAX = 10_000;
export const FAILURE_BATCH_BUFFER_MAX = 10_000;
