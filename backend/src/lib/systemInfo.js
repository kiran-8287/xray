/**
 * System Information - Dynamic worker sizing based on CPU and memory
 * Detects system capabilities and provides recommendations for worker counts
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(config.dataDir, 'system-config.json');

/**
 * Get system information
 */
export function getSystemInfo() {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  
  return {
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model || 'unknown',
    cpuSpeed: cpus[0]?.speed || 0,
    totalMemoryMB: Math.round(totalMemory / 1024 / 1024),
    freeMemoryMB: Math.round(freeMemory / 1024 / 1024),
    usedMemoryMB: Math.round((totalMemory - freeMemory) / 1024 / 1024),
    memoryUsagePercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100)
  };
}

/**
 * Calculate recommended worker count based on system resources.
 *
 * IMPORTANT MEMORY BUDGET NOTES
 * ------------------------------
 * Each Node worker thread in the upload pipeline spawns a **separate Python**
 * subprocess that imports NumPy + PIL + (dumpread/tipread). Baseline RSS of
 * such a child is ~200–350 MB, but because we now batch 20 files per Python
 * process (BATCH_SIZE=20 in workerPool), the per-file amortized cost is tiny
 * while the per-child cost is paid once per 20 files.
 *
 * The auto-valid-region path additionally spawns Pythons importing scipy+cv2
 * (~300–500 MB each) and is clamped *separately* (server.js caps it at 3).
 *
 * We therefore apply these safeguards:
 *   1. HARD_CAP 8 for upload (was 6). Because 20 files/child, 8 upload
 *      workers = max 8 upload Pythons at once — FEWER than before (6–10)
 *      under the old BATCH_SIZE=1 pattern, while total throughput is higher.
 *   2. Realistic 500 MB per-worker commit budget for upload workers.
 *   3. Reserve 1.5 GB for Node itself + OS (your logs showed Node climbing
 *      to ~800 MB during preprocessing, so 1.5 GB is a safety buffer).
 *
 * @param {Object} options - Configuration options
 * @param {number} options.minWorkers - Minimum workers (default: 1)
 * @param {number} options.maxWorkers - Absolute caller cap (before our hard cap)
 * @param {number} options.memoryPerWorkerMB - Estimated commit per worker in MB
 * @param {number} options.hardCap - Absolute ceiling. Pass different caps per
 *   operation (e.g. 8 for upload, 3 for cv2-heavy auto-valid-region).
 * @returns {number} Recommended worker count
 */
export function calculateOptimalWorkerCount(options = {}) {
  const DEFAULT_HARD_CAP = 8;
  const NODE_RESERVE_MB = 1536;              // 1.5 GB for Node + OS
  const DEFAULT_MEM_PER_WORKER_MB = 500;      // Python child baseline

  const {
    minWorkers = 1,
    maxWorkers,
    memoryPerWorkerMB = DEFAULT_MEM_PER_WORKER_MB,
    hardCap = DEFAULT_HARD_CAP,
  } = options;

  const systemInfo = getSystemInfo();
  const cpuBasedWorkers = Math.min(
    maxWorkers || systemInfo.cpuCount,
    hardCap
  );

  // Memory-based worker cap
  const availableForWorkersMB = Math.max(
    0,
    systemInfo.freeMemoryMB - NODE_RESERVE_MB
  );
  const memoryBasedWorkers = Math.floor(availableForWorkersMB / memoryPerWorkerMB);

  // Use the most conservative estimate (CPU cap ↓ memory ↓ hard cap)
  const recommendedWorkers = Math.min(cpuBasedWorkers, memoryBasedWorkers);

  const bounded = Math.max(minWorkers, Math.min(recommendedWorkers, cpuBasedWorkers));

  return Number.isFinite(bounded) ? bounded : minWorkers;
}

function isValidWorkerCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}

function normalizePersistedConfig(config) {
  if (!config || typeof config !== 'object') {
    return null;
  }

  const systemInfo = getSystemInfo();
  const cpuCount = Number.isInteger(config.cpuCount) && config.cpuCount > 0
    ? config.cpuCount
    : systemInfo.cpuCount;
  const cpuModel = typeof config.cpuModel === 'string' && config.cpuModel.trim()
    ? config.cpuModel
    : systemInfo.cpuModel;
  const optimalWorkerCount = isValidWorkerCount(config.optimalWorkerCount)
    ? config.optimalWorkerCount
    : calculateOptimalWorkerCount();

  return {
    cpuCount,
    cpuModel,
    optimalWorkerCount,
    detectedAt: typeof config.detectedAt === 'string' ? config.detectedAt : new Date().toISOString(),
    lastUpdated: typeof config.lastUpdated === 'string' ? config.lastUpdated : new Date().toISOString(),
  };
}

/**
 * Load persisted system configuration
 */
export async function loadSystemConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    // File doesn't exist or is invalid
    return null;
  }
}

/**
 * Save system configuration
 */
export async function saveSystemConfig(config) {
  try {
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Failed to save system config:', err);
    return false;
  }
}

/**
 * Initialize system configuration on first run
 * Detects CPU cores and stores the value for reuse
 */
export async function initializeSystemConfig() {
  const existingConfig = await loadSystemConfig();
  const systemInfo = getSystemInfo();
  const freshOptimalWorkers = calculateOptimalWorkerCount();
  const now = new Date().toISOString();

  const normalized = normalizePersistedConfig(existingConfig);
  const hasBadPersistedConfig = !normalized
    || normalized.cpuCount !== systemInfo.cpuCount
    || normalized.cpuModel !== systemInfo.cpuModel
    || !isValidWorkerCount(normalized.optimalWorkerCount)
    || normalized.optimalWorkerCount !== freshOptimalWorkers;

  const config = {
    cpuCount: systemInfo.cpuCount,
    cpuModel: systemInfo.cpuModel,
    optimalWorkerCount: freshOptimalWorkers,
    detectedAt: normalized?.detectedAt || now,
    lastUpdated: now,
  };

  if (hasBadPersistedConfig) {
    await saveSystemConfig(config);
  }

  return config;
}

/**
 * Per-operation tuning knobs.
 * Upload workers are cheap to batch (BATCH_SIZE=20 → 1 Python per 20 files).
 * Auto-valid-region workers import cv2 + scipy (~400 MB/child), so strict cap.
 */
const OPERATION_PROFILES = {
  'upload': { hardCap: 8,  memoryPerWorkerMB: 500, defaultCount: 8 },
  'auto-valid-region': { hardCap: 3, memoryPerWorkerMB: 500, defaultCount: 3 },
  'default': { hardCap: 6, memoryPerWorkerMB: 400, defaultCount: 4 },
};

/**
 * Get worker count for a specific operation
 * @param {string} operation - Operation type ('upload', 'auto-valid-region', etc.)
 * @param {number} defaultCount - Fallback if operation is unknown & no system config
 * @returns {number} Worker count to use
 */
export async function getWorkerCount(operation, defaultCount = 4) {
  const profile = OPERATION_PROFILES[operation] || OPERATION_PROFILES.default;

  const recommended = calculateOptimalWorkerCount({
    minWorkers: 1,
    maxWorkers: profile.hardCap,
    memoryPerWorkerMB: profile.memoryPerWorkerMB,
    hardCap: profile.hardCap,
  });

  return Math.max(1, Math.min(recommended, profile.hardCap));
}

/**
 * Check if system has enough memory for an operation
 * @param {number} estimatedMemoryMB - Estimated memory needed in MB
 * @returns {Object} Memory check result
 */
export function checkMemoryAvailability(estimatedMemoryMB) {
  const systemInfo = getSystemInfo();
  const availableMemoryMB = systemInfo.freeMemoryMB;
  // Dynamic threshold: use 5% of available memory or max 10MB
  const memoryThresholdMB = Math.min(10, Math.floor(availableMemoryMB * 0.05));

  // Allow proceeding as long as available memory covers the estimate + threshold, or at least 5MB available
  const canProceed = (availableMemoryMB >= (estimatedMemoryMB + memoryThresholdMB)) || (availableMemoryMB >= 5);

  return {
    canProceed,
    availableMemoryMB,
    requiredMemoryMB: estimatedMemoryMB,
    thresholdMB: memoryThresholdMB,
    totalMemoryMB: systemInfo.totalMemoryMB,
    usedMemoryMB: systemInfo.usedMemoryMB,
    memoryUsagePercent: systemInfo.memoryUsagePercent,
    recommendation: canProceed 
      ? null 
      : `Not enough memory. Need ${Math.round(estimatedMemoryMB + memoryThresholdMB)}MB but only ${availableMemoryMB}MB available. Consider reducing batch size.`
  };
}

/**
 * Get system health status
 */
export function getSystemHealth() {
  const systemInfo = getSystemInfo();
  
  const issues = [];
  
  if (systemInfo.memoryUsagePercent > 90) {
    issues.push('Memory usage is very high (>90%)');
  } else if (systemInfo.memoryUsagePercent > 75) {
    issues.push('Memory usage is elevated (>75%)');
  }
  
  if (systemInfo.freeMemoryMB < 500) {
    issues.push('Low available memory (<500MB)');
  }
  
  return {
    healthy: issues.length === 0,
    issues,
    systemInfo
  };
}