import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const SAVED_LAYOUTS_FILE = path.join(DATA_DIR, 'savedLayouts.json');
const CUSTOM_SUBCATEGORIES_FILE = path.join(DATA_DIR, 'customSubcategories.json');

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

// Stream items in batches to avoid loading everything into memory at once
async function* streamItems(batchSize = 1000) {
  await ensureDataDir();
  
  try {
    const data = await fs.readFile(ITEMS_FILE, 'utf8');
    const items = JSON.parse(data);
    
    for (let i = 0; i < items.length; i += batchSize) {
      yield items.slice(i, i + batchSize);
    }
  } catch (err) {
    console.error('Error streaming items:', err);
    yield [];
  }
}

// Get items with pagination at the database level
async function getItemsPaginated(page = 1, limit = 100) {
  await ensureDataDir();
  
  try {
    const data = await fs.readFile(ITEMS_FILE, 'utf8');
    const allItems = JSON.parse(data);
    
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
        hasPreviousPage: safePage > 1
      }
    };
  } catch (err) {
    console.error('Error getting paginated items:', err);
    return {
      items: [],
      pagination: {
        page: 1,
        limit,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false
      }
    };
  }
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

// Bag valid region storage (merged into items)
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

// Threat metadata storage (merged into items)
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

// Non-threat subcategory storage (merged into items)
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

// Custom subcategories storage
async function getCustomSubcategories() {
  await ensureDataDir();
  return await readJSONFile(CUSTOM_SUBCATEGORIES_FILE, {
    bags: [],
    threats: [],
    "non-threats": []
  });
}

async function addCustomSubcategory(category, name) {
  await ensureDataDir();
  const customSubs = await getCustomSubcategories();
  
  // Generate slug from name
  const slug = name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  
  // Check if already exists in custom subcategories
  const categorySubs = customSubs[category] || [];
  const exists = categorySubs.some(sub => sub.slug === slug || sub.name.toLowerCase() === name.toLowerCase());
  
  if (exists) {
    return { success: false, error: "Subcategory already exists" };
  }
  
  const newSubcategory = {
    slug,
    name,
    createdAt: new Date().toISOString()
  };
  
  categorySubs.push(newSubcategory);
  customSubs[category] = categorySubs;
  await writeJSONFile(CUSTOM_SUBCATEGORIES_FILE, customSubs);
  
  return { success: true, subcategory: newSubcategory };
}

async function removeCustomSubcategory(category, slug) {
  await ensureDataDir();
  const customSubs = await getCustomSubcategories();
  
  if (customSubs[category]) {
    customSubs[category] = customSubs[category].filter(sub => sub.slug !== slug);
    await writeJSONFile(CUSTOM_SUBCATEGORIES_FILE, customSubs);
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
  streamItems,
  getItemsPaginated
};
