/**
 * Cache Manager - Handles one-time cache clearing on first startup
 * Clears any stale data from previous users when the app is freshly cloned/installed
 */

// X-Ray app storage keys that should be cleared on first run
const XRAY_LOCAL_STORAGE_KEYS = [
  'selectedItemIds',
  'libraryKValue',
  'libraryMaxThreats',
  'libraryThreatDistribution',
  'libraryMaxNonThreats',
  'libraryNonThreatDistribution',
  'libraryRequireAtLeastOneNonThreat',
  'selectedBags',
  'selectedThreats',
  'selectedOthers'
];

const XRAY_SESSION_STORAGE_KEYS = [
  'collageCombinations',
  'collageFailures',
  'orphanedPreprocessedItems',
  'refreshedCategorizedItems'
];

/**
 * Check if this is a fresh installation by looking for a marker in localStorage
 */
function isFreshInstall(): boolean {
  return !localStorage.getItem('xray_initialized');
}

/**
 * Clear all X-Ray app data from browser storage
 */
export function clearAllXRayStorage(): void {
  console.log('[CacheManager] Clearing all X-Ray storage...');
  
  let clearedCount = 0;

  // Clear localStorage
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (XRAY_LOCAL_STORAGE_KEYS.some(k => key.startsWith(k)) || key.startsWith('xray_workspace_'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    clearedCount++;
  });

  // Clear sessionStorage
  const sessionKeysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && (XRAY_SESSION_STORAGE_KEYS.some(k => key.startsWith(k)) || key.startsWith('xray_workspace_'))) {
      sessionKeysToRemove.push(key);
    }
  }
  sessionKeysToRemove.forEach(key => {
    sessionStorage.removeItem(key);
    clearedCount++;
  });

  console.log(`[CacheManager] Cleared ${clearedCount} storage items (${keysToRemove.length} localStorage, ${sessionKeysToRemove.length} sessionStorage)`);
}

/**
 * Mark the app as initialized to prevent future cache clears
 */
export function markAsInitialized(): void {
  localStorage.setItem('xray_initialized', 'true');
  console.log('[CacheManager] App marked as initialized');
}

/**
 * Initialize cache manager - call this on app startup
 * Clears stale data on first run, then marks as initialized
 */
export function initializeCacheManager(): void {
  if (isFreshInstall()) {
    console.log('[CacheManager] Fresh installation detected - clearing stale data');
    clearAllXRayStorage();
    markAsInitialized();
  } else {
    console.log('[CacheManager] App already initialized - skipping cache clear');
  }
}

/**
 * Reset the initialization flag (for testing or manual reset)
 */
export function resetInitialization(): void {
  localStorage.removeItem('xray_initialized');
  console.log('[CacheManager] Initialization flag reset');
}