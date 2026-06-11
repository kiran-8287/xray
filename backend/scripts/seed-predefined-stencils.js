
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

const PREDEFINED_STENCILS = [
  // Bags
  {
    category: 'bags',
    subcategory: 'handbags',
    name: 'Suitcase',
    filename: 'bags/handbags/suitcase.svg',
    pixel_value: 45000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.36, y: -0.22 },
      { x: 0.36, y: -0.22 },
      { x: 0.36, y: 0.36 },
      { x: -0.36, y: 0.36 }
    ]
  },
  {
    category: 'bags',
    subcategory: 'backpacks',
    name: 'Backpack',
    filename: 'bags/backpacks/backpack.svg',
    pixel_value: 48000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.24, y: -0.22 },
      { x: 0.24, y: -0.22 },
      { x: 0.28, y: 0.12 },
      { x: 0.22, y: 0.4 },
      { x: -0.22, y: 0.4 },
      { x: -0.28, y: 0.12 }
    ]
  },
  {
    category: 'bags',
    subcategory: 'duffels',
    name: 'Duffel',
    filename: 'bags/duffels/duffel.svg',
    pixel_value: 42000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.32, y: -0.18 },
      { x: 0.32, y: -0.18 },
      { x: 0.32, y: 0.3 },
      { x: -0.32, y: 0.3 }
    ]
  },
  {
    category: 'bags',
    subcategory: 'trolleys',
    name: 'Trolley',
    filename: 'bags/trolleys/trolley.svg',
    pixel_value: 46000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.32, y: -0.3 },
      { x: 0.32, y: -0.3 },
      { x: 0.32, y: 0.38 },
      { x: -0.32, y: 0.38 }
    ]
  },
  {
    category: 'bags',
    subcategory: 'handbags',
    name: 'Handbag',
    filename: 'bags/handbags/handbag.svg',
    pixel_value: 44000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.3, y: -0.1 },
      { x: 0.3, y: -0.1 },
      { x: 0.3, y: 0.28 },
      { x: -0.3, y: 0.28 }
    ]
  },
  {
    category: 'bags',
    subcategory: 'laptop-bags',
    name: 'Laptop Bag',
    filename: 'bags/laptop-bags/laptopBag.svg',
    pixel_value: 47000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.35, y: -0.3 },
      { x: 0.35, y: -0.3 },
      { x: 0.35, y: 0.4 },
      { x: -0.35, y: 0.4 }
    ]
  },
  // Trays
  {
    category: 'trays',
    subcategory: 'standard',
    name: 'Standard Tray',
    filename: 'trays/standard/trayStandard.svg',
    pixel_value: 52000,
    width: 480,
    height: 360,
    valid_region_points: [
      { x: -0.4, y: -0.4 },
      { x: 0.4, y: -0.4 },
      { x: 0.4, y: 0.4 },
      { x: -0.4, y: 0.4 }
    ]
  },
  {
    category: 'trays',
    subcategory: 'metal',
    name: 'Metal Tray',
    filename: 'trays/metal/trayMetal.svg',
    pixel_value: 55000,
    width: 480,
    height: 360,
    valid_region_points: [
      { x: -0.42, y: -0.42 },
      { x: 0.42, y: -0.42 },
      { x: 0.42, y: 0.42 },
      { x: -0.42, y: 0.42 }
    ]
  },
  // Clothes
  {
    category: 'clothes',
    subcategory: 'shirts',
    name: 'T-Shirt',
    filename: 'clothes/shirts/tshirt.svg',
    pixel_value: 35000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.3, y: -0.3 },
      { x: 0.3, y: -0.3 },
      { x: 0.3, y: 0.35 },
      { x: -0.3, y: 0.35 }
    ]
  },
  {
    category: 'clothes',
    subcategory: 'pants',
    name: 'Jeans',
    filename: 'clothes/pants/jeans.svg',
    pixel_value: 32000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.2, y: -0.35 },
      { x: 0.2, y: -0.35 },
      { x: 0.2, y: 0.4 },
      { x: -0.2, y: 0.4 }
    ]
  },
  {
    category: 'clothes',
    subcategory: 'sweaters',
    name: 'Sweater',
    filename: 'clothes/sweaters/sweater.svg',
    pixel_value: 38000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.32, y: -0.3 },
      { x: 0.32, y: -0.3 },
      { x: 0.32, y: 0.38 },
      { x: -0.32, y: 0.38 }
    ]
  },
  {
    category: 'clothes',
    subcategory: 'coats',
    name: 'Coat',
    filename: 'clothes/coats/coat.svg',
    pixel_value: 40000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.35, y: -0.32 },
      { x: 0.35, y: -0.32 },
      { x: 0.32, y: 0.4 },
      { x: -0.32, y: 0.4 }
    ]
  },
  // Electronics
  {
    category: 'electronics',
    subcategory: 'laptops',
    name: 'Laptop',
    filename: 'electronics/laptops/laptop.svg',
    pixel_value: 18000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.35, y: -0.4 },
      { x: 0.35, y: -0.4 },
      { x: 0.35, y: 0.2 },
      { x: -0.35, y: 0.2 }
    ]
  },
  {
    category: 'electronics',
    subcategory: 'phones',
    name: 'Phone',
    filename: 'electronics/phones/phone.svg',
    pixel_value: 15000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.1, y: -0.4 },
      { x: 0.1, y: -0.4 },
      { x: 0.1, y: 0.4 },
      { x: -0.1, y: 0.4 }
    ]
  },
  {
    category: 'electronics',
    subcategory: 'chargers',
    name: 'Charger',
    filename: 'electronics/chargers/charger.svg',
    pixel_value: 20000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.2, y: -0.3 },
      { x: 0.2, y: -0.3 },
      { x: 0.2, y: 0.35 },
      { x: -0.2, y: 0.35 }
    ]
  },
  {
    category: 'electronics',
    subcategory: 'heating-coils',
    name: 'Heating Coil',
    filename: 'electronics/heating-coils/heatingCoil.svg',
    pixel_value: 25000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.3, y: -0.4 },
      { x: 0.3, y: -0.4 },
      { x: 0.3, y: 0.4 },
      { x: -0.3, y: 0.4 }
    ]
  },
  {
    category: 'electronics',
    subcategory: 'hair-dryers',
    name: 'Hair Dryer',
    filename: 'electronics/hair-dryers/hairDryer.svg',
    pixel_value: 22000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.1, y: -0.3 },
      { x: 0.4, y: -0.2 },
      { x: 0.4, y: 0.3 },
      { x: -0.1, y: 0.4 }
    ]
  },
  // Food
  {
    category: 'food',
    subcategory: 'snacks',
    name: 'Energy Bar',
    filename: 'food/snacks/energyBar.svg',
    pixel_value: 40000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.25, y: -0.15 },
      { x: 0.25, y: -0.15 },
      { x: 0.25, y: 0.15 },
      { x: -0.25, y: 0.15 }
    ]
  },
  {
    category: 'food',
    subcategory: 'fruits',
    name: 'Banana',
    filename: 'food/fruits/banana.svg',
    pixel_value: 45000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.2, y: 0.15 },
      { x: -0.3, y: -0.1 },
      { x: -0.1, y: -0.3 },
      { x: 0.25, y: -0.2 },
      { x: 0.1, y: 0.2 },
      { x: 0.2, y: 0.35 },
      { x: -0.15, y: 0.25 }
    ]
  },
  {
    category: 'food',
    subcategory: 'beverages',
    name: 'Water Bottle',
    filename: 'food/beverages/waterBottle.svg',
    pixel_value: 38000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.12, y: -0.38 },
      { x: 0.12, y: -0.38 },
      { x: 0.12, y: 0.3 },
      { x: -0.12, y: 0.3 }
    ]
  },
  // Threats
  {
    category: 'threats',
    subcategory: 'firearms',
    name: 'Gun',
    filename: 'threats/firearms/gun.svg',
    pixel_value: 12000,
    width: 460,
    height: 240,
    valid_region_points: [
      { x: -0.5, y: -0.2 },
      { x: 0.5, y: -0.2 },
      { x: 0.5, y: 0.3 },
      { x: -0.5, y: 0.3 }
    ]
  },
  {
    category: 'threats',
    subcategory: 'blades',
    name: 'Knife',
    filename: 'threats/blades/knife.svg',
    pixel_value: 14000,
    width: 460,
    height: 140,
    valid_region_points: [
      { x: -0.5, y: -0.15 },
      { x: 0.5, y: -0.15 },
      { x: 0.5, y: 0.15 },
      { x: -0.5, y: 0.15 }
    ]
  },
  {
    category: 'threats',
    subcategory: 'suspicious',
    name: 'Generic Threat',
    filename: 'threats/suspicious/generic.svg',
    pixel_value: 16000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.3, y: -0.3 },
      { x: 0.3, y: -0.3 },
      { x: 0.3, y: 0.3 },
      { x: -0.3, y: 0.3 }
    ]
  },
  // Miscellaneous (Stationery)
  {
    category: 'miscellaneous',
    subcategory: 'office-supplies',
    name: 'Notebook',
    filename: 'miscellaneous/office-supplies/notebook.svg',
    pixel_value: 43000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.3, y: -0.35 },
      { x: 0.3, y: -0.35 },
      { x: 0.3, y: 0.4 },
      { x: -0.3, y: 0.4 }
    ]
  },
  {
    category: 'miscellaneous',
    subcategory: 'office-supplies',
    name: 'Pen',
    filename: 'miscellaneous/office-supplies/pen.svg',
    pixel_value: 41000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.15, y: -0.38 },
      { x: 0.15, y: -0.38 },
      { x: 0.15, y: 0.4 },
      { x: -0.15, y: 0.4 }
    ]
  },
  {
    category: 'miscellaneous',
    subcategory: 'office-supplies',
    name: 'Stapler',
    filename: 'miscellaneous/office-supplies/stapler.svg',
    pixel_value: 44000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.3, y: -0.25 },
      { x: 0.35, y: -0.25 },
      { x: 0.35, y: 0.15 },
      { x: -0.3, y: 0.15 }
    ]
  },
  // Miscellaneous (LAG)
  {
    category: 'miscellaneous',
    subcategory: 'toiletries',
    name: 'Toothpaste',
    filename: 'miscellaneous/toiletries/toothpaste.svg',
    pixel_value: 25000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.2, y: -0.35 },
      { x: 0.2, y: -0.35 },
      { x: 0.2, y: 0.35 },
      { x: -0.2, y: 0.35 }
    ]
  },
  {
    category: 'miscellaneous',
    subcategory: 'toiletries',
    name: 'Perfume',
    filename: 'miscellaneous/toiletries/perfume.svg',
    pixel_value: 22000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.18, y: -0.32 },
      { x: 0.18, y: -0.32 },
      { x: 0.18, y: 0.35 },
      { x: -0.18, y: 0.35 }
    ]
  },
  {
    category: 'miscellaneous',
    subcategory: 'toiletries',
    name: 'Shampoo',
    filename: 'miscellaneous/toiletries/shampoo.svg',
    pixel_value: 28000,
    width: 320,
    height: 320,
    valid_region_points: [
      { x: -0.2, y: -0.36 },
      { x: 0.2, y: -0.36 },
      { x: 0.2, y: 0.35 },
      { x: -0.2, y: 0.35 }
    ]
  }
];

async function seedPredefinedStencils() {
  const client = await pool.connect();
  try {
    console.log('🗂️  Clearing existing library items...');
    await client.query('DELETE FROM items');

    // First create an upload session
    const sessionResult = await client.query(
      'INSERT INTO upload_sessions (folder_name) VALUES ($1) RETURNING id',
      ['predefined-stencils']
    );
    const sessionId = sessionResult.rows[0].id;

    console.log('📦 Seeding predefined stencils...');
    for (const stencil of PREDEFINED_STENCILS) {
      // Extract just the filename (basename) from the full path
      const filename = path.basename(stencil.filename);

      const result = await client.query(
        `INSERT INTO items (
           filename, filepath, category, subcategory, name,
           upload_session_id, pixel_value, width, height
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          filename,
          stencil.filename,
          stencil.category,
          stencil.subcategory,
          stencil.name,
          sessionId,
          stencil.pixel_value,
          stencil.width,
          stencil.height
        ]
      );
      const itemId = result.rows[0].id;

      // Insert bag-specific data if it's a bag
      if (stencil.category === 'bags' && stencil.valid_region_points) {
        const defaultValidRegion = {
          simplifiedPoints: stencil.valid_region_points,
          version: 2
        };
        await client.query(
          'INSERT INTO bags (item_id, valid_region_points) VALUES ($1, $2)',
          [itemId, JSON.stringify(defaultValidRegion)]
        );
      } else if (stencil.category === 'threats') {
        await client.query(
          'INSERT INTO threats (item_id, threat_type, severity) VALUES ($1, $2, $3)',
          [itemId, stencil.subcategory, 'high']
        );
      } else if (stencil.category === 'electronics') {
        await client.query(
          'INSERT INTO electronics (item_id, device_type) VALUES ($1, $2)',
          [itemId, stencil.subcategory]
        );
      } else if (stencil.category === 'clothes') {
        await client.query(
          'INSERT INTO clothes (item_id, garment_type) VALUES ($1, $2)',
          [itemId, stencil.subcategory]
        );
      } else if (stencil.category === 'trays') {
        await client.query(
          'INSERT INTO trays (item_id, tray_type) VALUES ($1, $2)',
          [itemId, stencil.subcategory]
        );
      }

      console.log(`✅ Inserted: ${stencil.name}`);
    }

    console.log('\n🎉 Successfully seeded all predefined stencils!');
  } catch (error) {
    console.error('❌ Error seeding stencils:', error);
    throw error;
  } finally {
    client.release();
  }
}

seedPredefinedStencils()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

