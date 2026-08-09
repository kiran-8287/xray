/**
 * User configuration management
 * 
 * Stores user-specific settings like export paths, preferences, etc.
 * Persisted to data/user_config.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import config from './config.js';

const USER_CONFIG_FILE = path.join(config.dataDir, 'user_config.json');

// Default user config
const DEFAULT_USER_CONFIG = {
  exportsPath: null, // Will use config.exportsRoot if null
};

let userConfigCache = null;

/**
 * Load user config from disk
 */
async function loadUserConfig() {
  if (userConfigCache) return userConfigCache;
  
  try {
    const data = await fs.readFile(USER_CONFIG_FILE, 'utf8');
    userConfigCache = { ...DEFAULT_USER_CONFIG, ...JSON.parse(data) };
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
 * Get the configured exports path, or fall back to default
 */
async function getExportsPath() {
  const userConfig = await loadUserConfig();
  return userConfig.exportsPath || config.exportsRoot;
}

/**
 * Set the exports path
 */
async function setExportsPath(exportsPath) {
  const userConfig = await loadUserConfig();
  userConfig.exportsPath = exportsPath;
  await saveUserConfig(userConfig);
  return userConfig;
}

/**
 * Check if user has configured exports path
 */
async function hasConfiguredExportsPath() {
  const userConfig = await loadUserConfig();
  return userConfig.exportsPath !== null && userConfig.exportsPath !== undefined && userConfig.exportsPath !== '';
}

export {
  loadUserConfig,
  saveUserConfig,
  getExportsPath,
  setExportsPath,
  hasConfiguredExportsPath,
};
