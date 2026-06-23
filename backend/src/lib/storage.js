import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const BAGS_FILE = path.join(DATA_DIR, 'bags.json');
const THREATS_FILE = path.join(DATA_DIR, 'threats.json');
const NON_THREAT_ITEMS_FILE = path.join(DATA_DIR, 'nonThreatItems.json');
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
    
    // Also delete from related tables
    await deleteBag(id);
    await deleteThreat(id);
    await deleteNonThreatItem(id);
}

// Bags storage
async function getBags() {
    await ensureDataDir();
    return await readJSONFile(BAGS_FILE, []);
}

async function getBagByItemId(itemId) {
    const bags = await getBags();
    return bags.find(bag => bag.item_id === itemId);
}

async function createBag(bagData) {
    await ensureDataDir();
    const bags = await getBags();
    const newBag = { ...bagData };
    bags.push(newBag);
    await writeJSONFile(BAGS_FILE, bags);
    return newBag;
}

async function updateBag(itemId, bagData) {
    const bags = await getBags();
    const index = bags.findIndex(bag => bag.item_id === itemId);
    if (index === -1) {
        return await createBag({ item_id: itemId, ...bagData });
    }
    bags[index] = { ...bags[index], ...bagData };
    await writeJSONFile(BAGS_FILE, bags);
    return bags[index];
}

async function deleteBag(itemId) {
    const bags = await getBags();
    const filteredBags = bags.filter(bag => bag.item_id !== itemId);
    await writeJSONFile(BAGS_FILE, filteredBags);
}

// Threats storage
async function getThreats() {
    await ensureDataDir();
    return await readJSONFile(THREATS_FILE, []);
}

async function getThreatByItemId(itemId) {
    const threats = await getThreats();
    return threats.find(threat => threat.item_id === itemId);
}

async function createThreat(threatData) {
    await ensureDataDir();
    const threats = await getThreats();
    const newThreat = { ...threatData };
    threats.push(newThreat);
    await writeJSONFile(THREATS_FILE, threats);
    return newThreat;
}

async function updateThreat(itemId, threatData) {
    const threats = await getThreats();
    const index = threats.findIndex(threat => threat.item_id === itemId);
    if (index === -1) {
        return await createThreat({ item_id: itemId, ...threatData });
    }
    threats[index] = { ...threats[index], ...threatData };
    await writeJSONFile(THREATS_FILE, threats);
    return threats[index];
}

async function deleteThreat(itemId) {
    const threats = await getThreats();
    const filteredThreats = threats.filter(threat => threat.item_id !== itemId);
    await writeJSONFile(THREATS_FILE, filteredThreats);
}

// Non-threat items storage
async function getNonThreatItems() {
    await ensureDataDir();
    return await readJSONFile(NON_THREAT_ITEMS_FILE, []);
}

async function getNonThreatItemByItemId(itemId) {
    const nonThreatItems = await getNonThreatItems();
    return nonThreatItems.find(item => item.item_id === itemId);
}

async function createNonThreatItem(nonThreatData) {
    await ensureDataDir();
    const nonThreatItems = await getNonThreatItems();
    const newItem = { ...nonThreatData };
    nonThreatItems.push(newItem);
    await writeJSONFile(NON_THREAT_ITEMS_FILE, nonThreatItems);
    return newItem;
}

async function updateNonThreatItem(itemId, nonThreatData) {
    const nonThreatItems = await getNonThreatItems();
    const index = nonThreatItems.findIndex(item => item.item_id === itemId);
    if (index === -1) {
        return await createNonThreatItem({ item_id: itemId, ...nonThreatData });
    }
    nonThreatItems[index] = { ...nonThreatItems[index], ...nonThreatData };
    await writeJSONFile(NON_THREAT_ITEMS_FILE, nonThreatItems);
    return nonThreatItems[index];
}

async function deleteNonThreatItem(itemId) {
    const nonThreatItems = await getNonThreatItems();
    const filteredNonThreatItems = nonThreatItems.filter(item => item.item_id !== itemId);
    await writeJSONFile(NON_THREAT_ITEMS_FILE, filteredNonThreatItems);
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
