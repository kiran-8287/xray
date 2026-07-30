/**
 * JSON file-based storage layer with atomic writes.
 * 
 * Uses a write-ahead approach: writes to a temp file, then renames atomically.
 * This prevents partial writes and corruption from crashes/interruptions.
 * Includes a simple in-process write lock to prevent concurrent write races.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = config.dataDir;
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const SAVED_LAYOUTS_FILE = path.join(DATA_DIR, 'savedLayouts.json');
const CUSTOM_SUBCATEGORIES_FILE = path.join(DATA_DIR, 'customSubcategories.json');

// ---- Atomic write helpers ----

/**
 * In-process write locks to prevent concurrent write races.
 * Maps filePath -> Promise (serializes writes to the same file).
 */
const writeLocks = new Map();

/**
 * Acquire a write lock for a given file path.
 * Returns a function to release the lock.
 * 
 * @param {string} filePath
 * @returns {Promise<() => void>}
 */
async function acquireLock(filePath) {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });

  const existing = writeLocks.get(filePath);
  if (existing) {
    // Queue behind the existing lock
    const nextLock = existing.then(() => wait);
    writeLocks.set(filePath, nextLock);
    await nextLock;
  } else {
    writeLocks.set(filePath, wait);
  }

  return release;
}

/**
 * Atomically write data to a JSON file.
 * Writes to a temp file first, then renames to the target path.
 * This prevents partial writes from crashes mid-write.
 * 
 * @param {string} filePath - The target file path
 * @param {any} data - The data to serialize as JSON
 */
async function writeJSONFileAtomic(filePath, data) {
  const release = await acquireLock(filePath);
  try {
    // Generate a unique temp file name in the same directory (same filesystem = atomic rename)
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const tmpPath = path.join(dir, `${base}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}.tmp`);

    // Write to temp file
    const jsonStr = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, jsonStr, 'utf8');

    // Atomic rename (atomically replaces destination on most OS filesystems)
    await fs.rename(tmpPath, filePath);
  } finally {
    release();
  }
}

/**
 * Read a JSON file, returning a default value if it doesn't exist.
 * 
 * @param {string} filePath
 * @param {any} defaultValue
 * @returns {Promise<any>}
 */
async function readJSONFile(filePath, defaultValue = []) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultValue;
    }
    // If JSON is corrupted, return default (but log a warning)
    if (err instanceof SyntaxError) {
      console.warn(`[storage] Corrupted JSON file: ${filePath}. Returning default.`);
      return defaultValue;
    }
    throw err;
  }
}

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// ---- Items storage ----

async function getItems() {
  await ensureDataDir();
  return await readJSONFile(ITEMS_FILE, []);
}

async function getItemById(id) {
  const items = await getItems();
  return items.find(item => item.id === id);
}

async function getItemsPaginated(page = 1, limit = 100) {
  await ensureDataDir();
  const allItems = await getItems();
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * limit;
  const endIndex = startIndex + limit;

  return {
    items: allItems.slice(startIndex, endIndex),
    pagination: {
      page: safePage,
      limit,
      totalItems,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    },
  };
}

async function createItem(itemData) {
  await ensureDataDir();
  const items = await getItems();
  const newItem = {
    id: itemData.id,
    created_at: new Date().toISOString(),
    ...itemData,
  };
  items.push(newItem);
  await writeJSONFileAtomic(ITEMS_FILE, items);
  return newItem;
}

async function itemExists(id) {
  const items = await getItems();
  return items.some(item => item.id === id);
}

async function updateItem(id, itemData) {
  const items = await getItems();
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return null;

  items[index] = { ...items[index], ...itemData };
  await writeJSONFileAtomic(ITEMS_FILE, items);
  return items[index];
}

async function deleteItem(id) {
  const items = await getItems();
  const filteredItems = items.filter(item => item.id !== id);
  await writeJSONFileAtomic(ITEMS_FILE, filteredItems);
}

// ---- Bag valid region storage (merged into items) ----

async function getBagByItemId(itemId) {
  const item = await getItemById(itemId);
  if (!item || item.category !== 'bags') return null;
  return {
    item_id: item.id,
    valid_region_points: item.valid_region_points,
  };
}

async function createBag(bagData) {
  const item = await getItemById(bagData.item_id);
  if (!item) return null;
  await updateItem(bagData.item_id, { valid_region_points: bagData.valid_region_points });
  return {
    item_id: bagData.item_id,
    valid_region_points: bagData.valid_region_points,
  };
}

async function updateBag(itemId, bagData) {
  await updateItem(itemId, { valid_region_points: bagData.valid_region_points });
  return {
    item_id: itemId,
    valid_region_points: bagData.valid_region_points,
  };
}

// ---- Threat metadata storage (merged into items) ----

async function createThreat(threatData) {
  const item = await getItemById(threatData.item_id);
  if (!item) return null;
  await updateItem(threatData.item_id, {
    threat_type: threatData.threat_type,
    severity: threatData.severity,
  });
  return {
    item_id: threatData.item_id,
    threat_type: threatData.threat_type,
    severity: threatData.severity,
  };
}

// ---- Non-threat subcategory storage (merged into items) ----

async function createNonThreatItem(nonThreatData) {
  const item = await getItemById(nonThreatData.item_id);
  if (!item) return null;
  await updateItem(nonThreatData.item_id, {
    subcategory_slug: nonThreatData.subcategory_slug,
  });
  return {
    item_id: nonThreatData.item_id,
    subcategory_slug: nonThreatData.subcategory_slug,
  };
}

// ---- Saved layouts storage ----

async function getSavedLayouts() {
  await ensureDataDir();
  return await readJSONFile(SAVED_LAYOUTS_FILE, []);
}

async function getSavedLayoutById(id) {
  const layouts = await getSavedLayouts();
  return layouts.find(layout => layout.id === id);
}

async function createSavedLayout(layoutData) {
  await ensureDataDir();
  const layouts = await getSavedLayouts();
  const newLayout = {
    id: layoutData.id || crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...layoutData,
  };
  layouts.push(newLayout);
  await writeJSONFileAtomic(SAVED_LAYOUTS_FILE, layouts);
  return newLayout;
}

async function updateSavedLayout(id, layoutData) {
  const layouts = await getSavedLayouts();
  const index = layouts.findIndex(layout => layout.id === id);
  if (index === -1) return null;
  layouts[index] = { ...layouts[index], ...layoutData };
  await writeJSONFileAtomic(SAVED_LAYOUTS_FILE, layouts);
  return layouts[index];
}

async function deleteSavedLayout(id) {
  const layouts = await getSavedLayouts();
  const filteredLayouts = layouts.filter(layout => layout.id !== id);
  await writeJSONFileAtomic(SAVED_LAYOUTS_FILE, filteredLayouts);
}

// ---- Custom subcategories storage ----

async function getCustomSubcategories() {
  await ensureDataDir();
  return await readJSONFile(CUSTOM_SUBCATEGORIES_FILE, {
    bags: [],
    threats: [],
    'non-threats': [],
  });
}

async function addCustomSubcategory(category, name) {
  await ensureDataDir();
  const customSubs = await getCustomSubcategories();

  const slug = name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const categorySubs = customSubs[category] || [];
  const exists = categorySubs.some(sub => sub.slug === slug || sub.name.toLowerCase() === name.toLowerCase());

  if (exists) {
    return { success: false, error: 'Subcategory already exists' };
  }

  const newSubcategory = {
    slug,
    name,
    createdAt: new Date().toISOString(),
  };

  categorySubs.push(newSubcategory);
  customSubs[category] = categorySubs;
  await writeJSONFileAtomic(CUSTOM_SUBCATEGORIES_FILE, customSubs);

  return { success: true, subcategory: newSubcategory };
}

async function removeCustomSubcategory(category, slug) {
  await ensureDataDir();
  const customSubs = await getCustomSubcategories();

  if (customSubs[category]) {
    customSubs[category] = customSubs[category].filter(sub => sub.slug !== slug);
    await writeJSONFileAtomic(CUSTOM_SUBCATEGORIES_FILE, customSubs);
  }

  return { success: true };
}

export {
  getItems,
  getItemById,
  createItem,
  itemExists,
  updateItem,
  deleteItem,
  getBagByItemId,
  createBag,
  updateBag,
  createThreat,
  createNonThreatItem,
  getSavedLayouts,
  getSavedLayoutById,
  createSavedLayout,
  updateSavedLayout,
  deleteSavedLayout,
  getCustomSubcategories,
  addCustomSubcategory,
  removeCustomSubcategory,
  getItemsPaginated,
};