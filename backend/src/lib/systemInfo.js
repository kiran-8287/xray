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
 * Calculate recommended worker count based on system resources
 * @param {Object} options - Configuration options
 * @param {number} options.minWorkers - Minimum workers (default: 1)
 * @param {number} options.maxWorkers - Maximum workers (default: CPU count)
 * @param {number} options.memoryPerWorkerMB - Estimated memory per worker in MB (default: 100)
 * @returns {number} Recommended worker count
 */
export function calculateOptimalWorkerCount(options = {}) {
  const {
    minWorkers = 1,
    maxWorkers,
    memoryPerWorkerMB = 100
  } = options;

  const systemInfo = getSystemInfo();
  const cpuBasedWorkers = maxWorkers || systemInfo.cpuCount;
  
  // Memory-based calculation: how many workers can we fit?
  const availableMemoryMB = systemInfo.freeMemoryMB;
  const memoryBasedWorkers = Math.floor(availableMemoryMB / memoryPerWorkerMB);
  
  // Use the more conservative of CPU count vs memory capacity
  const recommendedWorkers = Math.min(cpuBasedWorkers, memoryBasedWorkers);
  
  // Ensure we're within bounds
  return Math.max(minWorkers, Math.min(recommendedWorkers, cpuBasedWorkers));
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
  
  if (existingConfig && existingConfig.cpuCount) {
    // Config exists, return it
    return existingConfig;
  }
  
  // First run - detect and save
  const systemInfo = getSystemInfo();
  const optimalWorkers = calculateOptimalWorkerCount();
  
  const config = {
    cpuCount: systemInfo.cpuCount,
    cpuModel: systemInfo.cpuModel,
    optimalWorkerCount: optimalWorkers,
    detectedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };
  
  await saveSystemConfig(config);
  
  return config;
}

/**
 * Get worker count for a specific operation
 * @param {string} operation - Operation type ('upload', 'auto-generate', etc.)
 * @param {number} defaultCount - Default worker count if not configured
 * @returns {number} Worker count to use
 */
export async function getWorkerCount(operation, defaultCount = 4) {
  const config = await loadSystemConfig();
  
  if (!config) {
    // No config yet, use default
    return defaultCount;
  }
  
  // Return configured worker count, or calculate if not set
  return config.optimalWorkerCount || calculateOptimalWorkerCount();
}

/**
 * Check if system has enough memory for an operation
 * @param {number} estimatedMemoryMB - Estimated memory needed in MB
 * @returns {Object} Memory check result
 */
export function checkMemoryAvailability(estimatedMemoryMB) {
  const systemInfo = getSystemInfo();
  const availableMemoryMB = systemInfo.freeMemoryMB;
  // Dynamic threshold: use 10% of available memory, max 100MB
  const memoryThresholdMB = Math.min(100, Math.floor(availableMemoryMB * 0.1));

  const canProceed = availableMemoryMB >= (estimatedMemoryMB + memoryThresholdMB);

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