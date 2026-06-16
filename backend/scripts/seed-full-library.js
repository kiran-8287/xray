
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

// Recursively find all SVG files in library_images
async function findAllSvgs(dir, fileList = []) {
  const files = await fs.readdir(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await findAllSvgs(fullPath, fileList);
    } else if (file.name.endsWith('.svg')) {
      fileList.push({
        name: file.name,
        path: fullPath,
        relPath: path.relative(path.join(__dirname, '../data/library_images'), fullPath)
      });
    }
  }
  return fileList;
}

// Extract item name from SVG content
function extractNameFromSvg(svgContent) {
  const match = svgContent.match(/<text[^>]*>([^<]+)<\/text>/i);
  if (match) {
    return match[1].trim().toLowerCase();
  }
  return null;
}

// Build map from taxonomy: normalized item name → item
function buildTaxonomyMap(taxonomy) {
  const map = new Map();
  for (const cat of taxonomy) {
    for (const subcat of cat.subcategories) {
      for (const item of subcat.items) {
        const normalizedName = item.name.toLowerCase().trim();
        map.set(normalizedName, item);
      }
    }
  }
  return map;
}

async function main() {
  console.log('🚀 Starting full library seed (unique taxonomy items only)...');

  // 1. Load taxonomy
  const taxonomyPath = path.join(__dirname, '../../taxonomy.json');
  const taxonomyData = await fs.readFile(taxonomyPath, 'utf8');
  const taxonomy = JSON.parse(taxonomyData);
  const taxonomyMap = buildTaxonomyMap(taxonomy);
  console.log(`📚 Loaded taxonomy with ${taxonomyMap.size} unique items`);

  // 2. Find all SVGs
  const libraryDir = path.join(__dirname, '../data/library_images');
  const allSvgs = await findAllSvgs(libraryDir);
  console.log(`📁 Found ${allSvgs.length} SVG files in library_images`);

  // 3. Connect to DB
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing items
    console.log('🧹 Clearing existing items...');
    await client.query('DELETE FROM non_threat_items');
    await client.query('DELETE FROM bags');
    await client.query('DELETE FROM threats');
    await client.query('DELETE FROM items');

    // 4. Match SVGs to taxonomy items and insert ONE PER TAXONOMY ITEM
    const seededTaxonomyKeys = new Set();
    let matched = 0;
    let unmatched = 0;

    for (const svg of allSvgs) {
      // If we already have all taxonomy items, break early
      if (seededTaxonomyKeys.size >= taxonomyMap.size) {
        break;
      }

      // Read SVG to get name
      let svgContent;
      try {
        svgContent = await fs.readFile(svg.path, 'utf8');
      } catch (e) {
        continue;
      }

      const itemName = extractNameFromSvg(svgContent);
      let taxonomyItem = null;

      if (itemName) {
        taxonomyItem = taxonomyMap.get(itemName);
      }

      if (!taxonomyItem) {
        // Try fuzzy match
        for (const [key, val] of taxonomyMap.entries()) {
          if (key.includes(itemName) || (itemName && itemName.includes(key))) {
            taxonomyItem = val;
            break;
          }
        }
      }

      if (taxonomyItem) {
        const itemKey = taxonomyItem.name.toLowerCase().trim();
        // Skip if we already added this taxonomy item
        if (seededTaxonomyKeys.has(itemKey)) {
          continue;
        }
        
        seededTaxonomyKeys.add(itemKey);
        matched++;
        console.log(`✅ [${matched}/${taxonomyMap.size}] Matched: ${taxonomyItem.name} → ${svg.name}`);

        // Generate random pixel value based on category
        let pixelValue = 32767;
        if (taxonomyItem.category === 'threats') {
          pixelValue = 10000 + Math.floor(Math.random() * 15000);
        } else if (taxonomyItem.category === 'bags') {
          pixelValue = 35000 + Math.floor(Math.random() * 20000);
        } else if (taxonomyItem.category === 'electronics') {
          pixelValue = 15000 + Math.floor(Math.random() * 20000);
        } else if (taxonomyItem.category === 'food') {
          pixelValue = 42000 + Math.floor(Math.random() * 20000);
        } else {
          pixelValue = 30000 + Math.floor(Math.random() * 25000);
        }

        // Insert into items table
        const result = await client.query(
          `INSERT INTO items (
            filename, filepath, category, subcategory, name, pixel_value, width, height
          ) VALUES ($1, $2, $3, $4, $5, $6, 512, 512)
          RETURNING id`,
          [
            svg.name,
            svg.relPath.replace(/\\/g, '/'),
            taxonomyItem.category,
            taxonomyItem.subcategory,
            taxonomyItem.name,
            pixelValue
          ]
        );
        const itemId = result.rows[0].id;

        // Insert into child tables
        if (taxonomyItem.category === 'bags') {
          const defaultValidRegion = {
            simplifiedPoints: [
              {x: -0.4, y: -0.4}, {x: 0.4, y: -0.4},
              {x: 0.4, y: 0.4}, {x: -0.4, y: 0.4}
            ],
            version: 2
          };
          await client.query(
            `INSERT INTO bags (item_id, valid_region_points) VALUES ($1, $2)`,
            [itemId, JSON.stringify(defaultValidRegion)]
          );
        }
        if (taxonomyItem.category === 'threats') {
          await client.query(
            `INSERT INTO threats (item_id, threat_type, severity) VALUES ($1, $2, 'high')`,
            [itemId, taxonomyItem.subcategory]
          );
        }
        if (taxonomyItem.category === 'electronics' || taxonomyItem.category === 'clothes' || taxonomyItem.category === 'trays' || taxonomyItem.category === 'misc' || taxonomyItem.category === 'food') {
          const subSlug = taxonomyItem.subcategory ? taxonomyItem.subcategory : null;
          await client.query(
            `INSERT INTO non_threat_items (item_id, subcategory_slug) VALUES ($1, $2)`,
            [itemId, subSlug]
          );
        }
        }
      }
    }

    await client.query('COMMIT');

    console.log('\n🎉 Done!');
    console.log(`✅ Successfully added ${matched} unique taxonomy items`);
    console.log(`❌ ${taxonomyMap.size - matched} taxonomy items not matched to an SVG`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', err);
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
