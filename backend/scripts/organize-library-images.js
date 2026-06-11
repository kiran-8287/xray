
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new pg.Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'xray_db',
  password: process.env.PGPASSWORD || 'SaiKiran2166',
  port: process.env.PGPORT || 5432,
});

// Helper to flatten taxonomy into a map: itemName -> { category, subcategory }
function buildTaxonomyMap(taxonomy) {
  const map = new Map();
  for (const cat of taxonomy) {
    for (const subcat of cat.subcategories) {
      for (const item of subcat.items) {
        // Normalize item name for easier matching
        const normalizedName = item.name.toLowerCase().trim();
        map.set(normalizedName, {
          category: item.category,
          subcategory: item.subcategory
        });
      }
    }
  }
  return map;
}

// Extract item name from SVG content
function extractItemNameFromSVG(svgContent) {
  // Try to extract from first text tag (the item name is usually first)
  const textMatch = svgContent.match(/<text[^>]*>([^<]+)<\/text>/i);
  if (textMatch) {
    return textMatch[1].trim().toLowerCase();
  }
  return null;
}

async function main() {
  console.log('🔧 Organizing library images with taxonomy.json...');

  const libraryImagesRoot = path.resolve(__dirname, '../data/library_images');
  
  // Load taxonomy
  const taxonomyPath = path.resolve(__dirname, '../../taxonomy.json');
  const taxonomyData = await fs.readFile(taxonomyPath, 'utf8');
  const taxonomy = JSON.parse(taxonomyData);
  const taxonomyMap = buildTaxonomyMap(taxonomy);
  console.log(`📚 Loaded taxonomy with ${taxonomyMap.size} items`);
  
  // First try to get database items
  let dbItems = [];
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM items');
    dbItems = result.rows;
    client.release();
    console.log(`📊 Found ${dbItems.length} items in database`);
  } catch (err) {
    console.log('⚠️  Could not connect to database, proceeding with taxonomy only');
  }
  
  // Collect all files to organize (including those in subdirs from previous run)
  const filesToOrganize = [];
  async function collectFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(fullPath);
      } else if (entry.name.endsWith('.svg')) {
        filesToOrganize.push({
          filename: entry.name,
          fullPath: fullPath
        });
      }
    }
  }
  await collectFiles(libraryImagesRoot);
  console.log(`📂 Found ${filesToOrganize.length} SVG files to organize`);
  
  let movedCount = 0;
  let skippedCount = 0;
  let notFoundCount = 0;
  
  for (const file of filesToOrganize) {
    const { filename, fullPath } = file;
    
    // First check database
    let categoryInfo = null;
    const dbItem = dbItems.find(item => item.filepath === filename);
    
    if (dbItem) {
      categoryInfo = {
        category: dbItem.category,
        subcategory: dbItem.subcategory
      };
    } else {
      // Extract item name from SVG and look up in taxonomy
      const svgContent = await fs.readFile(fullPath, 'utf8');
      const itemName = extractItemNameFromSVG(svgContent);
      if (itemName) {
        categoryInfo = taxonomyMap.get(itemName);
      }
    }
    
    // If still no info, default to miscellaneous
    if (!categoryInfo) {
      categoryInfo = { category: 'miscellaneous', subcategory: 'general' };
      notFoundCount++;
    }
    
    // Normalize folder names
    const category = (categoryInfo.category || 'miscellaneous').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const subcategory = (categoryInfo.subcategory || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // Create target directory
    const targetDir = path.join(libraryImagesRoot, category, subcategory);
    await fs.mkdir(targetDir, { recursive: true });
    
    // Move file
    const targetPath = path.join(targetDir, filename);
    if (fullPath !== targetPath) { // Only move if not already in correct place
      try {
        await fs.rename(fullPath, targetPath);
        movedCount++;
        console.log(`✅ Moved: ${filename} → ${category}/${subcategory}/`);
      } catch (err) {
        console.log(`❌ Failed to move ${filename}:`, err.message);
        skippedCount++;
      }
    } else {
      console.log(`⏭️  Already in place: ${filename} → ${category}/${subcategory}/`);
    }
  }
  
  console.log(`\n🎉 Done! Moved ${movedCount} files, skipped ${skippedCount}, ${notFoundCount} not found in taxonomy.`);
  
  await pool.end();
}

main().catch(err => {
  console.error('❌ Error organizing images:', err);
  process.exit(1);
});
