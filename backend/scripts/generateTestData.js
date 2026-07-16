import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const LIBRARY_IMAGES_DIR = path.join(DATA_DIR, 'library_images');
const PIXEL_DATA_DIR = path.join(DATA_DIR, 'pixel_data/highenrgy');

// Configuration
const COUNTS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];

// Category distribution (must sum to 100)
const CATEGORY_DISTRIBUTION = {
  bags: 40,
  threats: 35,
  nonThreats: 25
};

// Subcategories for each category
const SUBCATEGORIES = {
  bags: ['Backpack', 'Briefcase', 'Cabin Bag', 'Messenger Bag', 'Duffel Bag', 'Tote Bag', 'Laptop Bag', 'Gym Bag'],
  threats: ['Air Gun', 'Liquid', 'Powder', 'Electronics', 'Knife', 'Sharp Object', 'Flammable'],
  nonThreats: ['Beverage Can', 'Food', 'Clothing', 'Electronics Accessories', 'Tools', 'Medical', 'Miscellaneous']
};

// Tags for bags
const BAG_TAGS = [
  ['accessories', 'keys', 'gloves'],
  ['belt', 'keys', 'gloves'],
  ['beverage-can', 'keys', 'gloves'],
  ['laptop', 'charger', 'documents'],
  ['clothes', 'shoes', 'toiletries'],
  ['electronics', 'cables', 'charger'],
  ['books', 'notebook', 'pen'],
  ['food', 'snacks', 'water']
];

async function getExistingItems() {
  try {
    const data = await fs.readFile(ITEMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function getExistingImages() {
  try {
    const files = await fs.readdir(LIBRARY_IMAGES_DIR);
    return files.filter(f => f.endsWith('.png'));
  } catch {
    console.error('Error reading library_images directory');
    return [];
  }
}

async function getExistingPixelData() {
  try {
    const files = await fs.readdir(PIXEL_DATA_DIR);
    return files.filter(f => f.endsWith('.npz'));
  } catch {
    console.error('Error reading pixel_data directory');
    return [];
  }
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateValidRegionPoints(originalPoints) {
  // Use original valid region points if provided, otherwise generate new ones
  if (originalPoints && originalPoints.points && originalPoints.points.length > 0) {
    return {
      points: originalPoints.points,
      simplifiedPoints: originalPoints.simplifiedPoints || originalPoints.points
    };
  }
  
  // Generate a simplified polygon with 20-30 points
  const numPoints = 20 + Math.floor(Math.random() * 10);
  const points = [];
  const simplifiedPoints = [];
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const radius = 0.2 + Math.random() * 0.3;
    const x = 0.5 + Math.cos(angle) * radius;
    const y = 0.5 + Math.sin(angle) * radius;
    
    points.push({ x, y });
    simplifiedPoints.push({ x, y });
  }
  
  return { points, simplifiedPoints };
}

function generateItemId(index) {
  return `TEST-${String(index).padStart(5, '0')}`;
}

function generateFilename(itemId, imageFile) {
  const baseName = path.basename(imageFile, '.png');
  return `${itemId}-${baseName}`;
}

async function generateItems(count, bagItems, threatItems, nonThreatItems) {
  const items = [];
  
  // Calculate distribution
  const bagsCount = Math.floor(count * CATEGORY_DISTRIBUTION.bags / 100);
  const threatsCount = Math.floor(count * CATEGORY_DISTRIBUTION.threats / 100);
  const nonThreatsCount = count - bagsCount - threatsCount;
  
  let currentIndex = 0;
  
  // Generate bags - ONLY use actual bag items
  for (let i = 0; i < bagsCount; i++) {
    const itemId = generateItemId(currentIndex++);
    const sourceItem = getRandomItem(bagItems);
    const subcategory = getRandomItem(SUBCATEGORIES.bags);
    const tags = getRandomItem(BAG_TAGS);
    const validRegion = generateValidRegionPoints(sourceItem.valid_region_points);
    
    items.push({
      id: itemId,
      created_at: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
      filename: generateFilename(itemId, sourceItem.filepath),
      filepath: sourceItem.filepath, // Use actual bag image
      category: 'bags',
      subcategory: subcategory,
      name: itemId,
      width: sourceItem.width || 704,
      height: sourceItem.height || 480,
      pixel_data_path: sourceItem.pixel_data_path, // Use actual bag pixel data
      tags: tags,
      valid_region_points: validRegion
    });
  }
  
  // Generate threats - ONLY use actual threat items
  for (let i = 0; i < threatsCount; i++) {
    const itemId = generateItemId(currentIndex++);
    const sourceItem = getRandomItem(threatItems);
    const subcategory = getRandomItem(SUBCATEGORIES.threats);
    
    items.push({
      id: itemId,
      created_at: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
      filename: generateFilename(itemId, sourceItem.filepath),
      filepath: sourceItem.filepath, // Use actual threat image
      category: 'threats',
      subcategory: subcategory,
      name: itemId,
      width: sourceItem.width || 704,
      height: sourceItem.height || 480,
      pixel_data_path: sourceItem.pixel_data_path // Use actual threat pixel data
    });
  }
  
  // Generate non-threats - ONLY use actual non-threat items
  for (let i = 0; i < nonThreatsCount; i++) {
    const itemId = generateItemId(currentIndex++);
    const sourceItem = getRandomItem(nonThreatItems);
    const subcategory = getRandomItem(SUBCATEGORIES.nonThreats);
    
    items.push({
      id: itemId,
      created_at: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
      filename: generateFilename(itemId, sourceItem.filepath),
      filepath: sourceItem.filepath, // Use actual non-threat image
      category: 'non-threats',
      subcategory: subcategory,
      name: itemId,
      width: sourceItem.width || 704,
      height: sourceItem.height || 480,
      pixel_data_path: sourceItem.pixel_data_path // Use actual non-threat pixel data
    });
  }
  
  // Shuffle items to mix categories
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  
  return items;
}

async function main() {
  console.log('Starting test data generation with correct categorization...\n');
  
  // Get existing items from library
  const existingItems = await getExistingItems();
  console.log(`Found ${existingItems.length} items in library`);
  
  // Separate items by category
  const bagItems = existingItems.filter(item => item.category === 'bags');
  const threatItems = existingItems.filter(item => item.category === 'threats');
  const nonThreatItems = existingItems.filter(item => item.category === 'non-threats');
  
  console.log(`  - Bags: ${bagItems.length} items`);
  console.log(`  - Threats: ${threatItems.length} items`);
  console.log(`  - Non-threats: ${nonThreatItems.length} items\n`);
  
  if (bagItems.length === 0 || threatItems.length === 0 || nonThreatItems.length === 0) {
    console.error('Error: Need at least one item in each category!');
    console.error('Please add bags, threats, and non-threats to the library first.');
    process.exit(1);
  }
  
  // Generate test data for each count
  for (const count of COUNTS) {
    console.log(`Generating ${count} items...`);
    
    const items = await generateItems(count, bagItems, threatItems, nonThreatItems);
    
    // Write to file
    const outputFile = path.join(DATA_DIR, `items_${count}.json`);
    await fs.writeFile(outputFile, JSON.stringify(items, null, 2), 'utf8');
    
    // Count categories
    const bags = items.filter(i => i.category === 'bags').length;
    const threats = items.filter(i => i.category === 'threats').length;
    const nonThreats = items.filter(i => i.category === 'non-threats').length;
    
    console.log(`  ✓ Generated ${items.length} items:`);
    console.log(`    - Bags: ${bags} (using ${bagItems.length} real bag images)`);
    console.log(`    - Threats: ${threats} (using ${threatItems.length} real threat images)`);
    console.log(`    - Non-threats: ${nonThreats} (using ${nonThreatItems.length} real non-threat images)`);
    console.log(`    - Saved to: ${outputFile}\n`);
  }
  
  console.log('✅ Test data generation complete!');
  console.log('\nTo use a test dataset:');
  console.log('1. Backup current items.json: copy backend/data/items.json backend/data/items_backup.json');
  console.log('2. Copy desired test file: copy backend/data/items_1000.json backend/data/items.json');
  console.log('3. Restart the backend server');
  console.log('4. Load the library page to test UI performance\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});