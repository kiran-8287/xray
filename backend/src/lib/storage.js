import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const SAVED_LAYOUTS_FILE = path.join(DATA_DIR, 'savedLayouts.json');

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

async function readJSONFile(filePath, defaultValue = []) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return defaultValue;
  }
}

async function writeJSONFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Items storage
async function getItems() {
  await ensureDataDir();
  return await readJSONFile(ITEMS_FILE, []);
}

async function getItemById(id) {
  const items = await getItems();
  return items.find(item => item.id === id);
}

async function createItem(itemData) {
  await ensureDataDir();
  const items = await getItems();
  const newItem = {
    id: itemData.id, // We expect this to be passed now (filename without extension)
    created_at: new Date().toISOString(),
    ...itemData
  };
  items.push(newItem);
  await writeJSONFile(ITEMS_FILE, items);
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
  await writeJSONFile(ITEMS_FILE, items);
  return items[index];
}

async function deleteItem(id) {
  const items = await getItems();
  const filteredItems = items.filter(item => item.id !== id);
  await writeJSONFile(ITEMS_FILE, filteredItems);
}

// Bags storage (now merged into items)
async function getBags() {
  const items = await getItems();
  return items.filter(item => item.category === 'bags').map(item => ({
    item_id: item.id,
    valid_region_points: item.valid_region_points
  }));
}

async function getBagByItemId(itemId) {
  const item = await getItemById(itemId);
  if (!item || item.category !== 'bags') return null;
  return {
    item_id: item.id,
    valid_region_points: item.valid_region_points
  };
}

async function createBag(bagData) {
  const item = await getItemById(bagData.item_id);
  if (!item) return null;
  await updateItem(bagData.item_id, { valid_region_points: bagData.valid_region_points });
  return {
    item_id: bagData.item_id,
    valid_region_points: bagData.valid_region_points
  };
}

async function updateBag(itemId, bagData) {
  await updateItem(itemId, { valid_region_points: bagData.valid_region_points });
  return {
    item_id: itemId,
    valid_region_points: bagData.valid_region_points
  };
}

async function deleteBag(itemId) {
  await updateItem(itemId, { valid_region_points: null });
}

// Threats storage (now merged into items)
async function getThreats() {
  const items = await getItems();
  return items.filter(item => item.category === 'threats').map(item => ({
    item_id: item.id,
    threat_type: item.threat_type,
    severity: item.severity
  }));
}

async function getThreatByItemId(itemId) {
  const item = await getItemById(itemId);
  if (!item || item.category !== 'threats') return null;
  return {
    item_id: item.id,
    threat_type: item.threat_type,
    severity: item.severity
  };
}

async function createThreat(threatData) {
  const item = await getItemById(threatData.item_id);
  if (!item) return null;
  await updateItem(threatData.item_id, { 
    threat_type: threatData.threat_type,
    severity: threatData.severity
  });
  return {
    item_id: threatData.item_id,
    threat_type: threatData.threat_type,
    severity: threatData.severity
  };
}

async function updateThreat(itemId, threatData) {
  await updateItem(itemId, { 
    threat_type: threatData.threat_type,
    severity: threatData.severity
  });
  return {
    item_id: itemId,
    threat_type: threatData.threat_type,
    severity: threatData.severity
  };
}

async function deleteThreat(itemId) {
  await updateItem(itemId, { threat_type: null, severity: null });
}

// Non-threat items storage (now merged into items)
async function getNonThreatItems() {
  const items = await getItems();
  return items.filter(item => item.category === 'non-threats').map(item => ({
    item_id: item.id,
    subcategory_slug: item.subcategory_slug
  }));
}

async function getNonThreatItemByItemId(itemId) {
  const item = await getItemById(itemId);
  if (!item || item.category !== 'non-threats') return null;
  return {
    item_id: item.id,
    subcategory_slug: item.subcategory_slug
  };
}

async function createNonThreatItem(nonThreatData) {
  const item = await getItemById(nonThreatData.item_id);
  if (!item) return null;
  await updateItem(nonThreatData.item_id, { 
    subcategory_slug: nonThreatData.subcategory_slug
  });
  return {
    item_id: nonThreatData.item_id,
    subcategory_slug: nonThreatData.subcategory_slug
  };
}

async function updateNonThreatItem(itemId, nonThreatData) {
  await updateItem(itemId, { 
    subcategory_slug: nonThreatData.subcategory_slug
  });
  return {
    item_id: itemId,
    subcategory_slug: nonThreatData.subcategory_slug
  };
}

async function deleteNonThreatItem(itemId) {
  await updateItem(itemId, { subcategory_slug: null });
}

// Saved layouts storage
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
    ...layoutData
  };
  layouts.push(newLayout);
  await writeJSONFile(SAVED_LAYOUTS_FILE, layouts);
  return newLayout;
}

async function updateSavedLayout(id, layoutData) {
  const layouts = await getSavedLayouts();
  const index = layouts.findIndex(layout => layout.id === id);
  if (index === -1) return null;
  layouts[index] = { ...layouts[index], ...layoutData };
  await writeJSONFile(SAVED_LAYOUTS_FILE, layouts);
  return layouts[index];
}

async function deleteSavedLayout(id) {
  const layouts = await getSavedLayouts();
  const filteredLayouts = layouts.filter(layout => layout.id !== id);
  await writeJSONFile(SAVED_LAYOUTS_FILE, filteredLayouts);
}

export {
  getItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  getBags,
  getBagByItemId,
  createBag,
  updateBag,
  deleteBag,
  getThreats,
  getThreatByItemId,
  createThreat,
  updateThreat,
  deleteThreat,
  getNonThreatItems,
  getNonThreatItemByItemId,
  createNonThreatItem,
  updateNonThreatItem,
  deleteNonThreatItem,
  getSavedLayouts,
  getSavedLayoutById,
  createSavedLayout,
  updateSavedLayout,
  deleteSavedLayout
};
