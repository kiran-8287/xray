/**
 * JSON file-based storage layer with atomic writes and category partitioning.
 * 
 * Segregates items into category-specific partitioned JSON files:
 * - data/bags_1.json, data/bags_2.json ... (Cap: 5000 items per JSON file)
 * - data/threats_1.json, data/threats_2.json ...
 * - data/non_threats_1.json, data/non_threats_2.json ...
 * - data/catalog.json (Catalog index tracking partition counts)
 * 
 * Uses a write-ahead atomic approach (write to temp, then rename).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = config.dataDir;
const LEGACY_ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const SAVED_LAYOUTS_FILE = path.join(DATA_DIR, 'savedLayouts.json');
const CUSTOM_SUBCATEGORIES_FILE = path.join(DATA_DIR, 'customSubcategories.json');

const DEFAULT_PARTITION_CAP = 5000;

// ---- Duplicate ID helpers ----

// Generate a fresh unique item ID (used when healing duplicate IDs or when a
// batch item collides with an existing stored item).
function generateFreshItemId(catKey, existingIds, salt = '') {
  let id;
  do {
    id = `item_${catKey}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${salt ? `_${salt}` : ''}`;
  } while (existingIds.has(id));
  return id;
}

// Heal duplicate item IDs across all category partition files.
// Returns the number of duplicate occurrences that were re-assigned fresh IDs.
// Runs once (guarded by a marker file) so existing corrupted data is repaired
// without rewriting files on every startup.
async function healDuplicateItemIds() {
  const markerPath = path.join(DATA_DIR, '.dedup_healed');
  try {
    await fs.access(markerPath);
    return 0; // Already healed on a previous run
  } catch {
    // Marker missing — proceed with healing
  }

  const catalog = await getCatalog();
  let healedCount = 0;

  for (const catKey of ['bags', 'threats', 'non_threats']) {
    const catMeta = catalog.categories[catKey];
    if (!catMeta) continue;

    for (const pNum of catMeta.partitions) {
      const partPath = getPartitionFilePath(catKey, pNum);
      const items = await readJSONFile(partPath, []);
      if (items.length === 0) continue;

      const seen = new Set();
      let changed = false;

      for (let i = 0; i < items.length; i++) {
        const id = items[i]?.id;
        if (!id) {
          // Missing ID — assign a fresh one
          items[i].id = generateFreshItemId(catKey, seen, `heal_${i}`);
          seen.add(items[i].id);
          changed = true;
          healedCount++;
        } else if (seen.has(id)) {
          // Duplicate ID — re-assign a fresh unique one
          items[i].id = generateFreshItemId(catKey, seen, `heal_${i}`);
          seen.add(items[i].id);
          changed = true;
          healedCount++;
        } else {
          seen.add(id);
        }
      }

      if (changed) {
        await writeJSONFileAtomic(partPath, items);
      }
    }
  }

  // Write marker so healing only runs once
  try {
    await fs.writeFile(markerPath, JSON.stringify({ healedAt: new Date().toISOString(), healedCount }), 'utf8');
  } catch (err) {
    console.warn('[storage] Failed to write dedup marker:', err);
  }

  if (healedCount > 0) {
    console.log(`[storage] Healed ${healedCount} duplicate/missing item ID(s) across category partitions.`);
  }
  return healedCount;
}

// ---- Atomic write helpers & Locks ----

// Self-clearing mutex per file path.
// Each entry is a Promise that resolves when the current holder finishes.
// The Map entry is deleted once no waiter remains, preventing unbounded chain buildup.
const writeLocks = new Map();

function acquireLock(filePath) {
  // Get the promise for the current tail of the queue (or resolve immediately)
  const previous = writeLocks.get(filePath) ?? Promise.resolve();

  let release;
  // This promise will resolve when the CURRENT caller's critical section ends.
  const ownLock = new Promise((res) => { release = res; });

  // Cache the caught version so we can compare the same object reference later
  const tail = ownLock.catch(() => {});
  writeLocks.set(filePath, tail);

  // Return a promise that resolves (with the release fn) once the previous holder is done.
  return previous.then(() => {
    return () => {
      release();
      // Clean up Map entry if we're still the tail (no newer waiter registered)
      if (writeLocks.get(filePath) === tail) {
        writeLocks.delete(filePath);
      }
    };
  });
}

async function writeJSONFileAtomic(filePath, data) {
  // Acquire lock with a 15-second timeout to prevent permanent hangs
  let release;
  const lockPromise = acquireLock(filePath);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`[storage] Lock timeout for ${filePath}`)), 15000)
  );

  try {
    release = await Promise.race([lockPromise, timeoutPromise]);
  } catch (err) {
    console.error(err.message);
    // Force-clear the stale lock so future writes can proceed
    writeLocks.delete(filePath);
    throw err;
  }

  try {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const tmpPath = path.join(dir, `${base}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}.tmp`);

    const jsonStr = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, jsonStr, 'utf8');
    await fs.rename(tmpPath, filePath);
  } finally {
    if (release) release();
  }
}

async function readJSONFile(filePath, defaultValue = []) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      // File exists but is empty — treat as default
      return defaultValue;
    }
    return JSON.parse(trimmed);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultValue;
    }
    if (err instanceof SyntaxError) {
      console.warn(`[storage] Corrupted JSON file: ${filePath}. Returning default.`);
      return defaultValue;
    }
    throw err;
  }
}

// Category normalization helper
function normalizeCategoryKey(cat) {
  if (!cat) return 'non_threats';
  const c = String(cat).toLowerCase().trim();
  if (c === 'bags' || c === 'bag') return 'bags';
  if (c === 'threats' || c === 'threat' || c === 'threads') return 'threats';
  return 'non_threats';
}

function getPartitionFilePath(categoryKey, partitionNum) {
  return path.join(DATA_DIR, `${categoryKey}_${partitionNum}.json`);
}

// ---- Catalog & Partition Initialization & Legacy Migration ----

async function getCatalog() {
  const defaultCatalog = {
    categories: {
      bags: { activePartition: 1, partitionCap: DEFAULT_PARTITION_CAP, totalCount: 0, partitions: [1] },
      threats: { activePartition: 1, partitionCap: DEFAULT_PARTITION_CAP, totalCount: 0, partitions: [1] },
      non_threats: { activePartition: 1, partitionCap: DEFAULT_PARTITION_CAP, totalCount: 0, partitions: [1] }
    }
  };
  return await readJSONFile(CATALOG_FILE, defaultCatalog);
}

async function saveCatalog(catalog) {
  await writeJSONFileAtomic(CATALOG_FILE, catalog);
}

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  // Check if catalog exists
  try {
    await fs.access(CATALOG_FILE);
  } catch {
    // Check if legacy items.json exists and needs migration
    let legacyItems = [];
    try {
      const data = await fs.readFile(LEGACY_ITEMS_FILE, 'utf8');
      legacyItems = JSON.parse(data);
    } catch {}

    const catalog = {
      categories: {
        bags: { activePartition: 1, partitionCap: DEFAULT_PARTITION_CAP, totalCount: 0, partitions: [1] },
        threats: { activePartition: 1, partitionCap: DEFAULT_PARTITION_CAP, totalCount: 0, partitions: [1] },
        non_threats: { activePartition: 1, partitionCap: DEFAULT_PARTITION_CAP, totalCount: 0, partitions: [1] }
      }
    };

    if (Array.isArray(legacyItems) && legacyItems.length > 0) {
      console.log(`[storage] Migrating ${legacyItems.length} legacy items into partitioned JSON storage...`);
      // Partition legacy items by category
      const byCat = { bags: [], threats: [], non_threats: [] };
      for (const item of legacyItems) {
        const catKey = normalizeCategoryKey(item.category);
        byCat[catKey].push(item);
      }

      for (const [catKey, items] of Object.entries(byCat)) {
        if (items.length === 0) continue;
        let pNum = 1;
        let count = 0;
        for (let i = 0; i < items.length; i += DEFAULT_PARTITION_CAP) {
          const chunk = items.slice(i, i + DEFAULT_PARTITION_CAP);
          await writeJSONFileAtomic(getPartitionFilePath(catKey, pNum), chunk);
          count += chunk.length;
          if (i + DEFAULT_PARTITION_CAP < items.length) {
            pNum++;
            catalog.categories[catKey].partitions.push(pNum);
          }
        }
        catalog.categories[catKey].activePartition = pNum;
        catalog.categories[catKey].totalCount = count;
      }
    }

    await saveCatalog(catalog);
  }

  // Heal any duplicate/missing item IDs from previous uploads (runs once)
  await healDuplicateItemIds();
}

// ---- Items Partitioned Storage Core ----

async function getItemsForCategory(categoryKey) {
  await ensureDataDir();
  const catalog = await getCatalog();
  const catConfig = catalog.categories[categoryKey] || { partitions: [1] };
  const allCategoryItems = [];

  for (const pNum of catConfig.partitions) {
    const partPath = getPartitionFilePath(categoryKey, pNum);
    const partItems = await readJSONFile(partPath, []);
    allCategoryItems.push(...partItems);
  }

  return allCategoryItems;
}

async function getItems(categoryFilter = null) {
  await ensureDataDir();
  if (categoryFilter) {
    const catKey = normalizeCategoryKey(categoryFilter);
    return await getItemsForCategory(catKey);
  }

  // Load from all category partitions
  const [bags, threats, nonThreats] = await Promise.all([
    getItemsForCategory('bags'),
    getItemsForCategory('threats'),
    getItemsForCategory('non_threats')
  ]);

  return [...bags, ...threats, ...nonThreats];
}

async function getItemById(id) {
  const items = await getItems();
  return items.find(item => item.id === id);
}

async function getItemsPaginated(page = 1, limit = 100, category = null) {
  await ensureDataDir();
  const allItems = await getItems(category);
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
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

/**
 * Batch insert items directly into appropriate category partitions.
 * Enforces the 5000 items capacity limit per partition file.
 */
async function createItemsBatch(itemsArray) {
  if (!Array.isArray(itemsArray) || itemsArray.length === 0) return [];
  await ensureDataDir();

  const catalog = await getCatalog();
  const createdItems = [];

  // Build a set of ALL existing item IDs across every category partition so we
  // never store a duplicate ID (duplicates silently collapse the frontend's
  // Set-based selection, e.g. "SELECT ALL" selecting only 200 of 300 items).
  const existingIds = new Set();
  for (const catKey of ['bags', 'threats', 'non_threats']) {
    const catMeta = catalog.categories[catKey];
    if (!catMeta) continue;
    for (const pNum of catMeta.partitions) {
      const partPath = getPartitionFilePath(catKey, pNum);
      const partItems = await readJSONFile(partPath, []);
      for (const it of partItems) {
        if (it && it.id) existingIds.add(it.id);
      }
    }
  }

  // Group items by category, re-assigning any ID that collides with an existing
  // stored item OR with another item in the same batch.
  const grouped = { bags: [], threats: [], non_threats: [] };
  for (const rawItem of itemsArray) {
    const catKey = normalizeCategoryKey(rawItem.category);
    let id = rawItem.id;
    if (!id || existingIds.has(id)) {
      id = generateFreshItemId(catKey, existingIds);
    }
    existingIds.add(id);
    const item = {
      created_at: rawItem.created_at || new Date().toISOString(),
      ...rawItem,
      id, // id must come AFTER the spread so a rawItem.id can never clobber our unique ID
    };
    grouped[catKey].push(item);
    createdItems.push(item);
  }

  // Process each category partition write
  for (const [catKey, newItems] of Object.entries(grouped)) {
    if (newItems.length === 0) continue;

    const catMeta = catalog.categories[catKey] || {
      activePartition: 1,
      partitionCap: DEFAULT_PARTITION_CAP,
      totalCount: 0,
      partitions: [1]
    };

    let pNum = catMeta.activePartition;
    let currentPartPath = getPartitionFilePath(catKey, pNum);
    let currentPartItems = await readJSONFile(currentPartPath, []);

    for (const newItem of newItems) {
      if (currentPartItems.length >= catMeta.partitionCap) {
        // Save full partition
        await writeJSONFileAtomic(currentPartPath, currentPartItems);
        // Spin up next partition file
        pNum++;
        if (!catMeta.partitions.includes(pNum)) {
          catMeta.partitions.push(pNum);
        }
        currentPartPath = getPartitionFilePath(catKey, pNum);
        currentPartItems = [];
      }
      currentPartItems.push(newItem);
      catMeta.totalCount++;
    }

    // Save remaining items to current active partition file
    await writeJSONFileAtomic(currentPartPath, currentPartItems);
    catMeta.activePartition = pNum;
    catalog.categories[catKey] = catMeta;
  }

  await saveCatalog(catalog);
  return createdItems;
}

async function createItem(itemData) {
  const result = await createItemsBatch([itemData]);
  return result[0];
}

async function itemExists(id) {
  const item = await getItemById(id);
  return Boolean(item);
}

async function updateItem(id, itemData) {
  await ensureDataDir();
  const catalog = await getCatalog();

  for (const catKey of ['bags', 'threats', 'non_threats']) {
    const catMeta = catalog.categories[catKey];
    if (!catMeta) continue;

    for (const pNum of catMeta.partitions) {
      const partPath = getPartitionFilePath(catKey, pNum);
      const items = await readJSONFile(partPath, []);
      const index = items.findIndex(item => item.id === id);
      if (index !== -1) {
        items[index] = { ...items[index], ...itemData };
        await writeJSONFileAtomic(partPath, items);
        return items[index];
      }
    }
  }

  return null;
}

async function deleteItem(id) {
  await ensureDataDir();
  const catalog = await getCatalog();

  for (const catKey of ['bags', 'threats', 'non_threats']) {
    const catMeta = catalog.categories[catKey];
    if (!catMeta) continue;

    for (const pNum of catMeta.partitions) {
      const partPath = getPartitionFilePath(catKey, pNum);
      const items = await readJSONFile(partPath, []);
      const index = items.findIndex(item => item.id === id);
      if (index !== -1) {
        items.splice(index, 1);
        await writeJSONFileAtomic(partPath, items);
        catMeta.totalCount = Math.max(0, catMeta.totalCount - 1);
        await saveCatalog(catalog);
        return true;
      }
    }
  }

  return false;
}

/**
 * Bulk-delete multiple items efficiently: reads each partition ONCE, removes
 * all matching IDs, then rewrites. Also returns metadata (item records) so
 * callers can clean up files in one pass.
 * @param {string[]} ids
 * @returns {Promise<{ deleted: string[]; items: any[] }>}
 */
async function bulkDeleteItems(ids) {
  if (!ids || ids.length === 0) return { deleted: [], items: [] };
  await ensureDataDir();
  const catalog = await getCatalog();
  const idSet = new Set(ids);
  const deletedIds = [];
  const deletedItems = [];

  for (const catKey of ['bags', 'threats', 'non_threats']) {
    const catMeta = catalog.categories[catKey];
    if (!catMeta) continue;

    for (const pNum of catMeta.partitions) {
      const partPath = getPartitionFilePath(catKey, pNum);
      const items = await readJSONFile(partPath, []);
      if (!Array.isArray(items) || items.length === 0) continue;

      let partitionChanged = false;
      const kept = [];
      for (const it of items) {
        if (it && it.id && idSet.has(it.id)) {
          deletedIds.push(it.id);
          deletedItems.push(it);
          idSet.delete(it.id);
          partitionChanged = true;
        } else {
          kept.push(it);
        }
      }

      if (partitionChanged) {
        await writeJSONFileAtomic(partPath, kept);
      }
    }
  }

  if (deletedIds.length > 0) {
    // Rebuild catalog counts for affected categories from partition totals (accurate)
    for (const catKey of ['bags', 'threats', 'non_threats']) {
      const catMeta = catalog.categories[catKey];
      if (!catMeta) continue;
      let count = 0;
      for (const pNum of catMeta.partitions) {
        const partPath = getPartitionFilePath(catKey, pNum);
        try {
          const part = await readJSONFile(partPath, []);
          count += (part || []).length;
        } catch (_) { /* ignore */ }
      }
      catMeta.totalCount = count;
    }
    await saveCatalog(catalog);
  }

  return { deleted: deletedIds, items: deletedItems };
}

// ---- Bag valid region storage ----

async function getBagByItemId(itemId) {
  const item = await getItemById(itemId);
  if (!item || normalizeCategoryKey(item.category) !== 'bags') return null;
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

// ---- Threat metadata storage ----

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

// ---- Non-threat subcategory storage ----

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
  createItemsBatch,
  itemExists,
  updateItem,
  deleteItem,
  bulkDeleteItems,
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
  getCatalog,
};