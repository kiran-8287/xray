/**
 * User configuration management
 * 
 * Stores user-specific settings like export paths, preferences, etc.
 * Persisted to data/user_config.json
 *
 * Each destination is INDEPENDENT so the user can pick a different folder for
 * each page without affecting the others:
 *   - load   → where Load-page exports (Save All / Save Selected / individual).
 *              Defaults to backend/data/load_layouts (high+low PNGs in one folder).
 *   - saved  → where Saved-page exports (Save All / Save Selected / individual)
 *   - collage→ where Collage-page images are rendered and saved
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import config from './config.js';

const USER_CONFIG_FILE = path.join(config.dataDir, 'user_config.json');

export const EXPORT_SCOPES = ['load', 'saved', 'collage'];

const SCOPE_KEYS = {
  load: 'loadExportsPath',
  saved: 'savedExportsPath',
  collage: 'collageExportsPath',
};

// Default user config. null means "use the built-in default for that scope".
const DEFAULT_USER_CONFIG = {
  loadExportsPath: null,     // default: config.loadLayoutsDir (backend/data/load_layouts)
  savedExportsPath: null,    // default: config.exportsRoot  (backend/data/exports)
  collageExportsPath: null,  // default: config.collageImagesRoot (backend/data/collage_images)
};

let userConfigCache = null;

function scopeKey(scope) {
  return SCOPE_KEYS[scope] || SCOPE_KEYS.saved;
}

/** Built-in default folder for a scope (used when the user hasn't set one). */
function defaultPathForScope(scope) {
  if (scope === 'load') return config.loadLayoutsDir;
  if (scope === 'collage') return config.collageImagesRoot;
  return config.exportsRoot;
}

/**
 * Load user config from disk
 */
async function loadUserConfig() {
  if (userConfigCache) return userConfigCache;

  try {
    const data = await fs.readFile(USER_CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(data);
    userConfigCache = { ...DEFAULT_USER_CONFIG, ...parsed };

    // Migrate the legacy single `exportsPath` (from previous versions) onto the
    // load + saved scopes so an already-configured folder keeps working. The
    // collage scope stays independent (keeps its default) as before.
    if (parsed.exportsPath && !userConfigCache.savedExportsPath && !userConfigCache.loadExportsPath) {
      userConfigCache.savedExportsPath = parsed.exportsPath;
      userConfigCache.loadExportsPath = parsed.exportsPath;
    }
    return userConfigCache;
  } catch {
    // File doesn't exist yet, use defaults
    userConfigCache = { ...DEFAULT_USER_CONFIG };
    return userConfigCache;
  }
}

/**
 * Save user config to disk
 */
async function saveUserConfig(configData) {
  userConfigCache = { ...DEFAULT_USER_CONFIG, ...configData };
  await fs.writeFile(USER_CONFIG_FILE, JSON.stringify(userConfigCache, null, 2));
  return userConfigCache;
}

/**
 * Get the configured folder for a scope, or its built-in default.
 */
async function getExportsPath(scope = 'saved') {
  const key = scopeKey(scope);
  const userConfig = await loadUserConfig();
  const raw = userConfig[key] || defaultPathForScope(scope);
  return path.resolve(raw);
}

/**
 * Set the folder for a scope. Pass null (or '') to reset to the default.
 */
async function setExportsPath(scope, exportsPath) {
  const key = scopeKey(scope);
  const userConfig = await loadUserConfig();
  userConfig[key] = exportsPath ? String(exportsPath) : null;
  await saveUserConfig(userConfig);
  return userConfig;
}

/**
 * Check if the user has configured a folder for a scope.
 */
async function hasConfiguredExportsPath(scope = 'saved') {
  const key = scopeKey(scope);
  const userConfig = await loadUserConfig();
  const val = userConfig[key];
  return val !== null && val !== undefined && val !== '';
}

export {
  loadUserConfig,
  saveUserConfig,
  getExportsPath,
  setExportsPath,
  hasConfiguredExportsPath,
};
