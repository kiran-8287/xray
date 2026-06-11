import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new pg.Pool({
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "xray_db",
  password: process.env.PGPASSWORD || "SaiKiran2166",
  port: process.env.PGPORT || 5432,
});

const libraryImagesRoot = path.resolve(__dirname, "../data/library_images");

// Ensure the directory exists
await fs.mkdir(libraryImagesRoot, { recursive: true });

// Grayscale attenuation palette logic:
// SVG elements should be black/gray with stroke and fill opacity representing relative material thickness.
// This allows the pixel-level canvas compositing engine to sum densities using the alpha channel.
const OBJECTS = [
  // ==================== BAGS ====================
  // 1. backpacks (2 items)
  {
    category: 'bags',
    subcategory: 'backpacks',
    name: 'Tactical Daypack',
    filename: 'bags_backpacks_daypack.svg',
    pixel_value: 48000,
    width: 320,
    height: 380,
    polygon_json: [
      { x: -0.3, y: -0.45 },
      { x: 0.3, y: -0.45 },
      { x: 0.45, y: -0.2 },
      { x: 0.45, y: 0.45 },
      { x: -0.45, y: 0.45 },
      { x: -0.45, y: -0.2 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="M 30 15 C 25 25, 20 45, 20 85 C 20 90, 25 95, 30 95 L 70 95 C 75 95, 80 90, 80 85 C 80 45, 75 25, 70 15 C 65 10, 35 10, 30 15 Z" fill="#000000" fill-opacity="0.3" stroke="#000000" stroke-width="2" stroke-opacity="0.8" />
      <path d="M 35 50 L 65 50 L 65 85 L 35 85 Z" fill="#000000" fill-opacity="0.4" stroke="#000000" stroke-width="1.5" stroke-opacity="0.8" />
      <path d="M 30 15 Q 50 5, 70 15" fill="none" stroke="#000000" stroke-width="3" stroke-opacity="0.9" />
      <path d="M 28 35 L 72 35" fill="none" stroke="#000000" stroke-width="1.5" stroke-opacity="0.6" stroke-dasharray="2 2" />
    </svg>`
  },
  {
    category: 'bags',
    subcategory: 'backpacks',
    name: 'Hiking Backpack',
    filename: 'bags_backpacks_hiking.svg',
    pixel_value: 49000,
    width: 340,
    height: 420,
    polygon_json: [
      { x: -0.35, y: -0.48 },
      { x: 0.35, y: -0.48 },
      { x: 0.45, y: -0.2 },
      { x: 0.42, y: 0.48 },
      { x: -0.42, y: 0.48 },
      { x: -0.45, y: -0.2 }
    ],
    svg: `<svg viewBox="0 0 100 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Main body -->
      <rect x="20" y="25" width="60" height="85" rx="8" fill="#000000" fill-opacity="0.28" stroke="#000000" stroke-width="2" />
      <!-- Sleeping bag roll at bottom -->
      <rect x="15" y="112" width="70" height="18" rx="5" fill="#000000" fill-opacity="0.4" stroke="#000000" stroke-width="1.5" />
      <!-- Side pockets -->
      <rect x="12" y="45" width="8" height="40" rx="2" fill="#000000" fill-opacity="0.35" stroke="#000000" stroke-width="1" />
      <rect x="80" y="45" width="8" height="40" rx="2" fill="#000000" fill-opacity="0.35" stroke="#000000" stroke-width="1" />
      <!-- Top lid flap -->
      <path d="M 20 25 L 80 25 C 80 15, 20 15, 20 25 Z" fill="#000000" fill-opacity="0.45" stroke="#000000" stroke-width="1.5" />
      <!-- Horizontal compression straps -->
      <line x1="20" y1="50" x2="80" y2="50" stroke="#000000" stroke-width="2.5" stroke-opacity="0.75" />
      <line x1="20" y1="75" x2="80" y2="75" stroke="#000000" stroke-width="2.5" stroke-opacity="0.75" />
    </svg>`
  },
  // 2. suitcases (2 items)
  {
    category: 'bags',
    subcategory: 'suitcases',
    name: 'Hard-shell Suitcase',
    filename: 'bags_suitcases_hardshell.svg',
    pixel_value: 45000,
    width: 400,
    height: 300,
    polygon_json: [
      { x: -0.48, y: -0.38 },
      { x: 0.48, y: -0.38 },
      { x: 0.48, y: 0.45 },
      { x: -0.48, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="20" width="80" height="70" rx="8" fill="#000000" fill-opacity="0.35" stroke="#000000" stroke-width="3" stroke-opacity="0.9" />
      <rect x="35" y="10" width="30" height="10" rx="3" fill="none" stroke="#000000" stroke-width="2.5" stroke-opacity="0.9" />
      <line x1="20" y1="20" x2="20" y2="90" stroke="#000000" stroke-width="2" stroke-opacity="0.7" />
      <line x1="80" y1="20" x2="80" y2="90" stroke="#000000" stroke-width="2" stroke-opacity="0.7" />
      <circle cx="20" cy="92" r="4" fill="#000000" fill-opacity="0.8" />
      <circle cx="80" cy="92" r="4" fill="#000000" fill-opacity="0.8" />
    </svg>`
  },
  {
    category: 'bags',
    subcategory: 'suitcases',
    name: 'Vintage Leather Suitcase',
    filename: 'bags_suitcases_vintage.svg',
    pixel_value: 46000,
    width: 380,
    height: 280,
    polygon_json: [
      { x: -0.48, y: -0.42 },
      { x: 0.48, y: -0.42 },
      { x: 0.48, y: 0.45 },
      { x: -0.48, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Main body -->
      <rect x="8" y="22" width="84" height="66" rx="4" fill="#000000" fill-opacity="0.38" stroke="#000000" stroke-width="2" />
      <!-- Top handle -->
      <path d="M 40 22 L 40 12 C 40 10, 60 10, 60 12 L 60 22" fill="none" stroke="#000000" stroke-width="3" stroke-linecap="round" />
      <!-- Leather straps (dense) -->
      <rect x="22" y="20" width="10" height="70" rx="1" fill="#000000" fill-opacity="0.65" stroke="#000000" stroke-width="1" />
      <rect x="68" y="20" width="10" height="70" rx="1" fill="#000000" fill-opacity="0.65" stroke="#000000" stroke-width="1" />
      <!-- Buckles -->
      <rect x="20" y="50" width="14" height="10" rx="1" fill="none" stroke="#000000" stroke-width="2.5" />
      <rect x="66" y="50" width="14" height="10" rx="1" fill="none" stroke="#000000" stroke-width="2.5" />
    </svg>`
  },

  // ==================== TRAYS ====================
  // 3. standard-plastic-tray (2 items)
  {
    category: 'trays',
    subcategory: 'standard-plastic-tray',
    name: 'Standard PP Tray',
    filename: 'trays_standard_grey.svg',
    pixel_value: 52000,
    width: 480,
    height: 360,
    polygon_json: [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="5" width="90" height="90" rx="4" fill="#000000" fill-opacity="0.15" stroke="#000000" stroke-width="3" stroke-opacity="0.8" />
      <rect x="12" y="12" width="76" height="76" rx="2" fill="none" stroke="#000000" stroke-width="1" stroke-opacity="0.5" stroke-dasharray="3 2" />
    </svg>`
  },
  {
    category: 'trays',
    subcategory: 'standard-plastic-tray',
    name: 'Large Cargo Tray',
    filename: 'trays_large_cargo.svg',
    pixel_value: 53000,
    width: 520,
    height: 400,
    polygon_json: [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 }
    ],
    svg: `<svg viewBox="0 0 120 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Outer boundary -->
      <rect x="4" y="6" width="112" height="88" rx="6" fill="#000000" fill-opacity="0.12" stroke="#000000" stroke-width="3.5" />
      <!-- Ribbed structure lines -->
      <line x1="20" y1="18" x2="100" y2="18" stroke="#000000" stroke-width="1" stroke-opacity="0.4" />
      <line x1="20" y1="34" x2="100" y2="34" stroke="#000000" stroke-width="1" stroke-opacity="0.4" />
      <line x1="20" y1="50" x2="100" y2="50" stroke="#000000" stroke-width="1" stroke-opacity="0.4" />
      <line x1="20" y1="66" x2="100" y2="66" stroke="#000000" stroke-width="1" stroke-opacity="0.4" />
      <line x1="20" y1="82" x2="100" y2="82" stroke="#000000" stroke-width="1" stroke-opacity="0.4" />
      <!-- Side handles -->
      <rect x="6" y="40" width="4" height="20" rx="1" fill="#000000" fill-opacity="0.5" />
      <rect x="110" y="40" width="4" height="20" rx="1" fill="#000000" fill-opacity="0.5" />
    </svg>`
  },
  // 4. metal-detection-tray (2 items)
  {
    category: 'trays',
    subcategory: 'metal-detection-tray',
    name: 'Kidney Bowl Tray',
    filename: 'trays_kidney_metal.svg',
    pixel_value: 35000,
    width: 280,
    height: 180,
    polygon_json: [
      { x: -0.45, y: -0.35 },
      { x: 0.45, y: -0.35 },
      { x: 0.48, y: 0.4 },
      { x: -0.48, y: 0.4 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="M 10 50 C 10 20, 90 20, 90 50 C 90 70, 70 85, 50 75 C 30 85, 10 70, 10 50 Z" fill="#000000" fill-opacity="0.5" stroke="#000000" stroke-width="2" stroke-opacity="0.9" />
      <path d="M 18 50 C 18 28, 82 28, 82 50 C 82 65, 68 76, 50 68 C 32 76, 18 65, 18 50 Z" fill="none" stroke="#000000" stroke-width="1" stroke-opacity="0.6" />
    </svg>`
  },
  {
    category: 'trays',
    subcategory: 'metal-detection-tray',
    name: 'Dental Instrument Tray',
    filename: 'trays_dental_metal.svg',
    pixel_value: 36000,
    width: 240,
    height: 150,
    polygon_json: [
      { x: -0.48, y: -0.45 },
      { x: 0.48, y: -0.45 },
      { x: 0.48, y: 0.45 },
      { x: -0.48, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 70" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Steel frame -->
      <rect x="5" y="5" width="90" height="60" rx="3" fill="#000000" fill-opacity="0.48" stroke="#000000" stroke-width="2" />
      <!-- Horizontal dividers -->
      <line x1="5" y1="20" x2="95" y2="20" stroke="#000000" stroke-width="1.5" stroke-opacity="0.75" />
      <line x1="5" y1="40" x2="95" y2="40" stroke="#000000" stroke-width="1.5" stroke-opacity="0.75" />
      <line x1="5" y1="52" x2="95" y2="52" stroke="#000000" stroke-width="1.5" stroke-opacity="0.75" />
    </svg>`
  },

  // ==================== CLOTHING ====================
  // 5. tops (2 items)
  {
    category: 'clothes',
    subcategory: 'tops',
    name: 'Cotton T-Shirt',
    filename: 'clothes_tops_tshirt.svg',
    pixel_value: 62000,
    width: 120,
    height: 120,
    polygon_json: [
      { x: -0.2, y: -0.45 },
      { x: 0.2, y: -0.45 },
      { x: 0.45, y: -0.25 },
      { x: 0.3, y: -0.1 },
      { x: 0.25, y: 0.45 },
      { x: -0.25, y: 0.45 },
      { x: -0.3, y: -0.1 },
      { x: -0.45, y: -0.25 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="M 35 15 L 65 15 L 85 30 L 72 45 L 65 40 L 65 85 L 35 85 L 35 40 L 28 45 L 15 30 Z" fill="#000000" fill-opacity="0.1" stroke="#000000" stroke-width="1" stroke-opacity="0.5" />
      <path d="M 38 15 C 45 22, 55 22, 62 15" fill="none" stroke="#000000" stroke-width="1.2" stroke-opacity="0.6" />
    </svg>`
  },
  {
    category: 'clothes',
    subcategory: 'tops',
    name: 'Winter Hoodie',
    filename: 'clothes_tops_hoodie.svg',
    pixel_value: 60000,
    width: 130,
    height: 130,
    polygon_json: [
      { x: -0.22, y: -0.48 },
      { x: 0.22, y: -0.48 },
      { x: 0.45, y: -0.25 },
      { x: 0.3, y: 0.0 },
      { x: 0.25, y: 0.48 },
      { x: -0.25, y: 0.48 },
      { x: -0.3, y: 0.0 },
      { x: -0.45, y: -0.25 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Body outline -->
      <path d="M 35 18 L 65 18 L 88 32 L 76 45 L 68 40 L 68 90 L 32 90 L 32 40 L 24 45 L 12 32 Z" fill="#000000" fill-opacity="0.18" stroke="#000000" stroke-width="1" />
      <!-- Hood details -->
      <path d="M 32 18 C 30 2, 70 2, 68 18 C 65 22, 35 22, 32 18 Z" fill="#000000" fill-opacity="0.22" stroke="#000000" stroke-width="0.8" />
      <!-- Front pocket -->
      <path d="M 38 65 L 62 65 L 66 82 L 34 82 Z" fill="none" stroke="#000000" stroke-width="1" stroke-opacity="0.6" />
    </svg>`
  },
  // 6. bottoms (2 items)
  {
    category: 'clothes',
    subcategory: 'bottoms',
    name: 'Denim Jeans',
    filename: 'clothes_bottoms_jeans.svg',
    pixel_value: 58000,
    width: 140,
    height: 220,
    polygon_json: [
      { x: -0.4, y: -0.48 },
      { x: 0.4, y: -0.48 },
      { x: 0.45, y: -0.1 },
      { x: 0.35, y: 0.48 },
      { x: 0.02, y: 0.48 },
      { x: 0.0, y: -0.1 },
      { x: -0.02, y: 0.48 },
      { x: -0.35, y: 0.48 },
      { x: -0.45, y: -0.1 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="M 25 5 L 75 5 L 80 40 L 70 95 L 52 95 L 50 45 L 48 95 L 30 95 L 20 40 Z" fill="#000000" fill-opacity="0.15" stroke="#000000" stroke-width="1.2" stroke-opacity="0.6" />
      <rect x="35" y="8" width="30" height="8" fill="none" stroke="#000000" stroke-width="1" stroke-opacity="0.5" />
      <line x1="50" y1="5" x2="50" y2="35" stroke="#000000" stroke-width="1" stroke-opacity="0.5" />
    </svg>`
  },
  {
    category: 'clothes',
    subcategory: 'bottoms',
    name: 'Sport Shorts',
    filename: 'clothes_bottoms_shorts.svg',
    pixel_value: 63000,
    width: 110,
    height: 90,
    polygon_json: [
      { x: -0.45, y: -0.45 },
      { x: 0.45, y: -0.45 },
      { x: 0.48, y: 0.45 },
      { x: 0.05, y: 0.45 },
      { x: 0.0, y: -0.1 },
      { x: -0.05, y: 0.45 },
      { x: -0.48, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 70" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Shorts body -->
      <path d="M 15 5 L 85 5 L 90 60 L 53 60 L 50 25 L 47 60 L 10 60 Z" fill="#000000" fill-opacity="0.1" stroke="#000000" stroke-width="1.2" />
      <!-- Elastic waistband -->
      <rect x="15" y="5" width="70" height="8" fill="#000000" fill-opacity="0.2" stroke="#000000" stroke-width="0.8" />
    </svg>`
  },

  // ==================== ELECTRONICS ====================
  // 7. computing-devices (2 items)
  {
    category: 'electronics',
    subcategory: 'computing-devices',
    name: 'Detailed Laptop',
    filename: 'electronics_computing_laptop.svg',
    pixel_value: 18000,
    width: 260,
    height: 180,
    polygon_json: [
      { x: -0.48, y: -0.35 },
      { x: 0.48, y: -0.35 },
      { x: 0.48, y: 0.35 },
      { x: -0.48, y: 0.35 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Laptop body chassis -->
      <rect x="5" y="15" width="90" height="70" rx="4" fill="#000000" fill-opacity="0.3" stroke="#000000" stroke-width="2" stroke-opacity="0.8" />
      <!-- High-density internal Lithium battery pack (highly absorbing) -->
      <rect x="8" y="65" width="84" height="16" fill="#000000" fill-opacity="0.85" stroke="#000000" stroke-width="1" stroke-opacity="0.9" />
      <!-- Motherboard and hard drive area (inorganic/electronics) -->
      <rect x="15" y="25" width="35" height="30" rx="2" fill="#000000" fill-opacity="0.6" stroke="#000000" stroke-width="1.2" stroke-opacity="0.8" />
      <rect x="55" y="28" width="30" height="25" fill="#000000" fill-opacity="0.5" stroke="#000000" stroke-width="1" stroke-opacity="0.8" />
      <!-- Copper heat sink pipes -->
      <path d="M 25 35 L 75 35 L 75 40" fill="none" stroke="#000000" stroke-width="3" stroke-opacity="0.95" />
    </svg>`
  },
  {
    category: 'electronics',
    subcategory: 'computing-devices',
    name: 'Tablet Device',
    filename: 'electronics_computing_tablet.svg',
    pixel_value: 21000,
    width: 160,
    height: 120,
    polygon_json: [
      { x: -0.48, y: -0.48 },
      { x: 0.48, y: -0.48 },
      { x: 0.48, y: 0.48 },
      { x: -0.48, y: 0.48 }
    ],
    svg: `<svg viewBox="0 0 100 80" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Flat body chassis -->
      <rect x="4" y="4" width="92" height="72" rx="5" fill="#000000" fill-opacity="0.32" stroke="#000000" stroke-width="1.8" />
      <!-- Lithium pouch battery inside (absorbing) -->
      <rect x="12" y="15" width="55" height="50" rx="1" fill="#000000" fill-opacity="0.8" stroke="#000000" stroke-width="0.8" />
      <!-- Controller board -->
      <rect x="72" y="15" width="16" height="50" rx="1" fill="#000000" fill-opacity="0.58" stroke="#000000" stroke-width="0.8" />
    </svg>`
  },
  // 8. phones-communication (2 items)
  {
    category: 'electronics',
    subcategory: 'phones-communication',
    name: 'Smartphone',
    filename: 'electronics_phones_smartphone.svg',
    pixel_value: 25000,
    width: 80,
    height: 150,
    polygon_json: [
      { x: -0.22, y: -0.48 },
      { x: 0.22, y: -0.48 },
      { x: 0.22, y: 0.48 },
      { x: -0.22, y: 0.48 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="25" y="5" width="50" height="90" rx="6" fill="#000000" fill-opacity="0.35" stroke="#000000" stroke-width="2" stroke-opacity="0.9" />
      <!-- Battery cell inside -->
      <rect x="30" y="20" width="40" height="55" fill="#000000" fill-opacity="0.8" stroke="#000000" stroke-width="1" stroke-opacity="0.9" />
      <circle cx="50" cy="88" r="3" fill="none" stroke="#000000" stroke-width="1" />
    </svg>`
  },
  {
    category: 'electronics',
    subcategory: 'phones-communication',
    name: 'Walkie Talkie',
    filename: 'electronics_phones_walkietalkie.svg',
    pixel_value: 26000,
    width: 70,
    height: 180,
    polygon_json: [
      { x: -0.2, y: -0.48 },
      { x: -0.1, y: -0.48 },
      { x: -0.1, y: -0.2 },
      { x: 0.25, y: -0.2 },
      { x: 0.25, y: 0.48 },
      { x: -0.25, y: 0.48 }
    ],
    svg: `<svg viewBox="0 0 100 130" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Antenna -->
      <rect x="30" y="2" width="6" height="36" rx="1" fill="#000000" fill-opacity="0.85" />
      <!-- Main plastic case -->
      <rect x="20" y="38" width="50" height="88" rx="5" fill="#000000" fill-opacity="0.35" stroke="#000000" stroke-width="1.8" />
      <!-- Battery compartment (highly absorbing) -->
      <rect x="25" y="70" width="40" height="50" fill="#000000" fill-opacity="0.75" />
      <!-- Speaker grill pattern -->
      <circle cx="45" cy="52" r="8" fill="none" stroke="#000000" stroke-width="1" stroke-dasharray="2 1" />
      <!-- Channel selector knob -->
      <rect x="58" y="28" width="8" height="10" rx="1" fill="#000000" fill-opacity="0.8" />
    </svg>`
  },

  // ==================== FOOD ====================
  // 9. liquids-beverages (2 items)
  {
    category: 'food',
    subcategory: 'liquids-beverages',
    name: 'Plastic Water Bottle',
    filename: 'food_liquids_waterbottle.svg',
    pixel_value: 42000,
    width: 80,
    height: 200,
    polygon_json: [
      { x: -0.15, y: -0.48 },
      { x: 0.15, y: -0.48 },
      { x: 0.25, y: -0.25 },
      { x: 0.25, y: 0.48 },
      { x: -0.25, y: 0.48 },
      { x: -0.25, y: -0.25 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="M 40 5 L 60 5 L 60 15 L 70 25 L 70 90 L 30 90 L 30 25 L 40 15 Z" fill="#000000" fill-opacity="0.2" stroke="#000000" stroke-width="1.5" stroke-opacity="0.7" />
      <!-- Water level -->
      <path d="M 30 40 L 70 40 L 70 90 L 30 90 Z" fill="#000000" fill-opacity="0.3" stroke="none" />
      <line x1="30" y1="55" x2="70" y2="55" stroke="#000000" stroke-width="1" stroke-opacity="0.4" />
      <line x1="30" y1="70" x2="70" y2="70" stroke="#000000" stroke-width="1" stroke-opacity="0.4" />
    </svg>`
  },
  {
    category: 'food',
    subcategory: 'liquids-beverages',
    name: 'Soda Can',
    filename: 'food_liquids_sodacan.svg',
    pixel_value: 39000,
    width: 70,
    height: 120,
    polygon_json: [
      { x: -0.3, y: -0.48 },
      { x: 0.3, y: -0.48 },
      { x: 0.35, y: 0.48 },
      { x: -0.35, y: 0.48 }
    ],
    svg: `<svg viewBox="0 0 80 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Aluminum walls -->
      <rect x="8" y="6" width="64" height="108" rx="5" fill="#000000" fill-opacity="0.18" stroke="#000000" stroke-width="2.5" />
      <!-- Liquid contents -->
      <rect x="9" y="15" width="62" height="98" fill="#000000" fill-opacity="0.38" stroke="none" />
      <!-- Top opening tab -->
      <path d="M 34 6 L 46 6 L 40 12 Z" fill="#000000" fill-opacity="0.6" />
    </svg>`
  },
  // 10. fruits-vegetables (2 items)
  {
    category: 'food',
    subcategory: 'fruits-vegetables',
    name: 'Organic Banana',
    filename: 'food_fruits_banana.svg',
    pixel_value: 55000,
    width: 140,
    height: 100,
    polygon_json: [
      { x: -0.35, y: -0.4 },
      { x: 0.15, y: -0.45 },
      { x: 0.45, y: -0.1 },
      { x: 0.3, y: 0.3 },
      { x: -0.1, y: 0.45 },
      { x: -0.4, y: 0.1 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="M 15 70 C 25 45, 50 20, 80 15 C 75 35, 55 65, 30 85 C 20 88, 12 80, 15 70 Z" fill="#000000" fill-opacity="0.25" stroke="#000000" stroke-width="1.5" stroke-opacity="0.7" />
      <path d="M 12 76 C 14 74, 15 73, 17 74" fill="none" stroke="#000000" stroke-width="3" stroke-linecap="round" />
    </svg>`
  },
  {
    category: 'food',
    subcategory: 'fruits-vegetables',
    name: 'Crunchy Apple',
    filename: 'food_fruits_apple.svg',
    pixel_value: 56000,
    width: 90,
    height: 90,
    polygon_json: [
      { x: -0.2, y: -0.48 },
      { x: 0.2, y: -0.48 },
      { x: 0.45, y: -0.2 },
      { x: 0.35, y: 0.45 },
      { x: -0.35, y: 0.45 },
      { x: -0.45, y: -0.2 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Apple contour (organic filling) -->
      <path d="M 50 25 C 25 20, 10 38, 12 65 C 15 88, 45 92, 50 84 C 55 92, 85 88, 88 65 C 90 38, 75 20, 50 25 Z" fill="#000000" fill-opacity="0.22" stroke="#000000" stroke-width="1.5" />
      <!-- Stem -->
      <path d="M 50 25 Q 46 12, 38 10" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
    </svg>`
  },

  // ==================== THREATS ====================
  // 11. firearms-pistols (2 items)
  {
    category: 'threats',
    subcategory: 'firearms-pistols',
    name: 'Semi-Auto Pistol (9mm)',
    filename: 'threats_firearms_pistol.svg',
    pixel_value: 10000, // Very dense metal (highly absorbing)
    width: 180,
    height: 110,
    polygon_json: [
      { x: -0.45, y: -0.45 },
      { x: 0.48, y: -0.45 },
      { x: 0.48, y: -0.1 },
      { x: 0.15, y: 0.05 },
      { x: -0.15, y: 0.45 },
      { x: -0.4, y: 0.45 },
      { x: -0.35, y: 0.1 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="15" width="90" height="25" rx="2" fill="#000000" fill-opacity="0.85" stroke="#000000" stroke-width="2" stroke-opacity="0.95" />
      <path d="M 55 40 L 85 90 C 88 95, 78 98, 70 98 L 45 48 Z" fill="#000000" fill-opacity="0.8" stroke="#000000" stroke-width="1.5" stroke-opacity="0.9" />
      <path d="M 35 40 Q 25 50, 48 50" fill="none" stroke="#000000" stroke-width="3" stroke-opacity="0.95" />
      <path d="M 38 42 Q 32 46, 38 48" fill="none" stroke="#000000" stroke-width="2" stroke-opacity="0.95" />
      <rect x="58" y="48" width="12" height="42" transform="rotate(-30 58 48)" fill="#000000" fill-opacity="0.95" stroke="#000000" stroke-width="0.8" />
    </svg>`
  },
  {
    category: 'threats',
    subcategory: 'firearms-pistols',
    name: 'Snub-nosed Revolver',
    filename: 'threats_firearms_revolver.svg',
    pixel_value: 9000,
    width: 150,
    height: 100,
    polygon_json: [
      { x: -0.45, y: -0.35 },
      { x: 0.45, y: -0.35 },
      { x: 0.48, y: 0.1 },
      { x: 0.15, y: 0.1 },
      { x: -0.2, y: 0.48 },
      { x: -0.45, y: 0.48 },
      { x: -0.35, y: 0.1 }
    ],
    svg: `<svg viewBox="0 0 100 70" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Short Barrel -->
      <rect x="5" y="15" width="35" height="15" rx="1" fill="#000000" fill-opacity="0.8" stroke="#000000" stroke-width="1.8" />
      <!-- Rotating Chamber (Very Dense cylinder) -->
      <rect x="40" y="8" width="28" height="28" rx="3" fill="#000000" fill-opacity="0.95" stroke="#000000" stroke-width="2" />
      <circle cx="54" cy="22" r="3" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.8" />
      <!-- Grip -->
      <path d="M 60 36 C 65 36, 80 42, 74 65 C 70 70, 52 68, 48 58 L 48 36 Z" fill="#000000" fill-opacity="0.85" stroke="#000000" stroke-width="1.5" />
      <!-- Trigger Guard -->
      <path d="M 28 30 Q 22 45, 45 42" fill="none" stroke="#000000" stroke-width="2.5" />
    </svg>`
  },
  // 12. edged-weapons (2 items)
  {
    category: 'threats',
    subcategory: 'edged-weapons',
    name: 'Combat Knife',
    filename: 'threats_edged_knife.svg',
    pixel_value: 15000,
    width: 200,
    height: 45,
    polygon_json: [
      { x: -0.48, y: -0.15 },
      { x: 0.48, y: -0.45 },
      { x: 0.48, y: -0.1 },
      { x: -0.15, y: 0.15 },
      { x: -0.45, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="M 40 40 L 95 25 Q 90 45, 40 48 Z" fill="#000000" fill-opacity="0.75" stroke="#000000" stroke-width="1.5" stroke-opacity="0.9" />
      <rect x="35" y="30" width="6" height="25" fill="#000000" fill-opacity="0.9" stroke="#000000" stroke-width="1" />
      <rect x="5" y="38" width="30" height="10" rx="2" fill="#000000" fill-opacity="0.45" stroke="#000000" stroke-width="1" stroke-opacity="0.8" />
    </svg>`
  },
  {
    category: 'threats',
    subcategory: 'edged-weapons',
    name: 'Metal Scissors',
    filename: 'threats_edged_scissors.svg',
    pixel_value: 16000,
    width: 90,
    height: 160,
    polygon_json: [
      { x: -0.1, y: -0.48 },
      { x: 0.1, y: -0.48 },
      { x: 0.25, y: 0.0 },
      { x: 0.45, y: 0.35 },
      { x: 0.3, y: 0.48 },
      { x: 0.0, y: 0.15 },
      { x: -0.3, y: 0.48 },
      { x: -0.45, y: 0.35 },
      { x: -0.25, y: 0.0 }
    ],
    svg: `<svg viewBox="0 0 100 160" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Two blades pivoted (dense steel) -->
      <path d="M 46 70 L 40 10 L 48 10 Q 52 40, 48 70 Z" fill="#000000" fill-opacity="0.78" stroke="#000000" stroke-width="1" />
      <path d="M 54 70 L 60 10 L 52 10 Q 48 40, 52 70 Z" fill="#000000" fill-opacity="0.78" stroke="#000000" stroke-width="1" />
      <!-- Center pivot screw -->
      <circle cx="50" cy="70" r="3" fill="#000000" fill-opacity="0.95" />
      <!-- Finger loops (dense metal handles) -->
      <path d="M 46 70 L 32 120 C 18 120, 15 150, 35 150 C 48 150, 48 130, 48 120 M 35 128 C 28 128, 25 142, 35 142 C 42 142, 42 135, 40 128" fill="#000000" fill-opacity="0.8" stroke="#000000" stroke-width="1.2" />
      <path d="M 54 70 L 68 120 C 82 120, 85 150, 65 150 C 52 150, 52 130, 52 120 M 65 128 C 72 128, 75 142, 65 142 C 58 142, 58 135, 60 128" fill="#000000" fill-opacity="0.8" stroke="#000000" stroke-width="1.2" />
    </svg>`
  },

  // ==================== MISCELLANEOUS ====================
  // 13. miscellaneous-items (2 items)
  {
    category: 'misc',
    subcategory: 'miscellaneous-items',
    name: 'Folded Umbrella',
    filename: 'misc_items_umbrella.svg',
    pixel_value: 38000,
    width: 60,
    height: 220,
    polygon_json: [
      { x: -0.1, y: -0.48 },
      { x: 0.1, y: -0.48 },
      { x: 0.15, y: 0.35 },
      { x: -0.15, y: 0.35 },
      { x: -0.2, y: 0.48 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="42" y="5" width="16" height="75" rx="3" fill="#000000" fill-opacity="0.3" stroke="#000000" stroke-width="1.2" stroke-opacity="0.7" />
      <line x1="50" y1="5" x2="50" y2="85" stroke="#000000" stroke-width="3.5" stroke-opacity="0.9" />
      <path d="M 50 80 A 10 10 0 0 1 30 80" fill="none" stroke="#000000" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.85" />
    </svg>`
  },
  {
    category: 'misc',
    subcategory: 'miscellaneous-items',
    name: 'Dual Binoculars',
    filename: 'misc_items_binoculars.svg',
    pixel_value: 22000,
    width: 140,
    height: 120,
    polygon_json: [
      { x: -0.45, y: -0.35 },
      { x: 0.45, y: -0.35 },
      { x: 0.48, y: 0.4 },
      { x: -0.48, y: 0.4 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="10" width="25" height="75" rx="3" fill="#000000" fill-opacity="0.4" stroke="#000000" stroke-width="1.5" stroke-opacity="0.8" />
      <rect x="60" y="10" width="25" height="75" rx="3" fill="#000000" fill-opacity="0.4" stroke="#000000" stroke-width="1.5" stroke-opacity="0.8" />
      <polygon points="18,30 38,30 33,60 18,60" fill="#000000" fill-opacity="0.8" />
      <polygon points="62,30 82,30 82,60 67,60" fill="#000000" fill-opacity="0.8" />
      <rect x="40" y="25" width="20" height="8" fill="#000000" fill-opacity="0.75" stroke="#000000" stroke-width="1" />
      <rect x="40" y="60" width="20" height="8" fill="#000000" fill-opacity="0.75" stroke="#000000" stroke-width="1" />
    </svg>`
  },

  // ==================== SPORTS ====================
  // 14. fitness-gym (2 items)
  {
    category: 'sports',
    subcategory: 'fitness-gym',
    name: 'Hex Dumbbell',
    filename: 'sports_fitness_dumbbell.svg',
    pixel_value: 8000, // Solid steel plates, very heavy
    width: 180,
    height: 80,
    polygon_json: [
      { x: -0.48, y: -0.48 },
      { x: -0.35, y: -0.48 },
      { x: -0.35, y: -0.1 },
      { x: 0.35, y: -0.1 },
      { x: 0.35, y: -0.48 },
      { x: 0.48, y: -0.48 },
      { x: 0.48, y: 0.48 },
      { x: 0.35, y: 0.48 },
      { x: 0.35, y: 0.1 },
      { x: -0.35, y: 0.1 },
      { x: -0.35, y: 0.48 },
      { x: -0.48, y: 0.48 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="25" y="42" width="50" height="16" fill="#000000" fill-opacity="0.8" stroke="#000000" stroke-width="1.5" />
      <rect x="5" y="20" width="20" height="60" rx="3" fill="#000000" fill-opacity="0.95" stroke="#000000" stroke-width="2" />
      <rect x="75" y="20" width="20" height="60" rx="3" fill="#000000" fill-opacity="0.95" stroke="#000000" stroke-width="2" />
    </svg>`
  },
  {
    category: 'sports',
    subcategory: 'fitness-gym',
    name: 'Kettlebell',
    filename: 'sports_fitness_kettlebell.svg',
    pixel_value: 7500, // Dense cast iron (absorbing)
    width: 110,
    height: 130,
    polygon_json: [
      { x: -0.3, y: -0.48 },
      { x: 0.3, y: -0.48 },
      { x: 0.45, y: -0.1 },
      { x: 0.48, y: 0.48 },
      { x: -0.48, y: 0.48 },
      { x: -0.45, y: -0.1 }
    ],
    svg: `<svg viewBox="0 0 100 110" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Handle -->
      <path d="M 30 40 L 30 18 C 30 10, 70 10, 70 18 L 70 40" fill="none" stroke="#000000" stroke-width="7" stroke-linecap="round" />
      <!-- Solid iron ball -->
      <circle cx="50" cy="65" r="38" fill="#000000" fill-opacity="0.95" stroke="#000000" stroke-width="2.5" />
      <!-- Text label (molded iron) -->
      <text x="50" y="72" text-anchor="middle" fill="white" font-size="14" font-weight="bold">16KG</text>
    </svg>`
  },
  // 15. racquet-sports (2 items)
  {
    category: 'sports',
    subcategory: 'racquet-sports',
    name: 'Tennis Racquet',
    filename: 'sports_racquets_racquet.svg',
    pixel_value: 50000,
    width: 160,
    height: 320,
    polygon_json: [
      { x: -0.25, y: -0.48 },
      { x: 0.25, y: -0.48 },
      { x: 0.35, y: -0.1 },
      { x: 0.08, y: 0.05 },
      { x: 0.08, y: 0.48 },
      { x: -0.08, y: 0.48 },
      { x: -0.08, y: 0.05 },
      { x: -0.35, y: -0.1 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="30" rx="30" ry="25" fill="none" stroke="#000000" stroke-width="3.5" stroke-opacity="0.8" />
      <path d="M 30 30 L 70 30 M 35 20 L 65 20 M 35 40 L 65 40 M 50 5 L 50 55 M 40 8 L 40 52 M 60 8 L 60 52" fill="none" stroke="#000000" stroke-width="0.8" stroke-opacity="0.4" />
      <line x1="50" y1="55" x2="50" y2="95" stroke="#000000" stroke-width="5.5" stroke-opacity="0.85" />
      <rect x="46" y="80" width="8" height="15" rx="1" fill="#000000" fill-opacity="0.5" />
    </svg>`
  },
  {
    category: 'sports',
    subcategory: 'racquet-sports',
    name: 'Ping Pong Paddle',
    filename: 'sports_racquets_paddle.svg',
    pixel_value: 52000,
    width: 100,
    height: 160,
    polygon_json: [
      { x: -0.35, y: -0.45 },
      { x: 0.35, y: -0.45 },
      { x: 0.45, y: -0.1 },
      { x: 0.1, y: 0.1 },
      { x: 0.1, y: 0.48 },
      { x: -0.1, y: 0.48 },
      { x: -0.1, y: 0.1 },
      { x: -0.45, y: -0.1 }
    ],
    svg: `<svg viewBox="0 0 100 130" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Paddle face (rubber/wood laminate) -->
      <circle cx="50" cy="40" r="32" fill="#000000" fill-opacity="0.32" stroke="#000000" stroke-width="1.8" />
      <circle cx="50" cy="40" r="30" fill="none" stroke="#000000" stroke-width="1" stroke-dasharray="2 1" />
      <!-- Handle (dense wood) -->
      <rect x="44" y="72" width="12" height="52" rx="2" fill="#000000" fill-opacity="0.58" stroke="#000000" stroke-width="1.5" />
    </svg>`
  },

  // ==================== STATIONERY ====================
  // 16. office-tools (2 items)
  {
    category: 'stationery',
    subcategory: 'office-tools',
    name: 'Office Stapler',
    filename: 'stationery_office_stapler.svg',
    pixel_value: 32000,
    width: 140,
    height: 70,
    polygon_json: [
      { x: -0.45, y: -0.25 },
      { x: 0.45, y: -0.25 },
      { x: 0.45, y: 0.35 },
      { x: -0.45, y: 0.35 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="65" width="80" height="12" rx="2" fill="#000000" fill-opacity="0.65" stroke="#000000" stroke-width="1.5" stroke-opacity="0.8" />
      <path d="M 10 65 L 10 30 Q 30 25, 85 35 L 85 55" fill="#000000" fill-opacity="0.5" stroke="#000000" stroke-width="1.5" stroke-opacity="0.8" />
      <path d="M 20 60 Q 25 45, 30 60 Q 35 45, 40 60" fill="none" stroke="#000000" stroke-width="2.5" stroke-opacity="0.85" />
    </svg>`
  },
  {
    category: 'stationery',
    subcategory: 'office-tools',
    name: 'Heavy Duty Hole Puncher',
    filename: 'stationery_office_holepunch.svg',
    pixel_value: 31000,
    width: 130,
    height: 100,
    polygon_json: [
      { x: -0.48, y: -0.35 },
      { x: 0.48, y: -0.35 },
      { x: 0.48, y: 0.45 },
      { x: -0.48, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 80" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Steel base -->
      <rect x="8" y="55" width="84" height="18" rx="2" fill="#000000" fill-opacity="0.68" stroke="#000000" stroke-width="1.5" />
      <!-- Punching pins (dense cylinders) -->
      <rect x="25" y="32" width="10" height="23" fill="#000000" fill-opacity="0.9" stroke="#000000" stroke-width="1" />
      <rect x="65" y="32" width="10" height="23" fill="#000000" fill-opacity="0.9" stroke="#000000" stroke-width="1" />
      <!-- Lever handle -->
      <path d="M 8 50 C 15 28, 75 15, 90 28" fill="none" stroke="#000000" stroke-width="4.5" stroke-linecap="round" />
    </svg>`
  },
  // 17. notebooks-paper (2 items)
  {
    category: 'stationery',
    subcategory: 'notebooks-paper',
    name: 'Spiral Notebook',
    filename: 'stationery_office_notebook.svg',
    pixel_value: 48000,
    width: 160,
    height: 200,
    polygon_json: [
      { x: -0.45, y: -0.45 },
      { x: 0.45, y: -0.45 },
      { x: 0.45, y: 0.45 },
      { x: -0.45, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="10" width="72" height="80" rx="3" fill="#000000" fill-opacity="0.25" stroke="#000000" stroke-width="1.5" stroke-opacity="0.7" />
      <path d="M 12 15 C 14 10, 18 10, 18 15 M 12 25 C 14 20, 18 20, 18 25 M 12 35 C 14 30, 18 30, 18 35 M 12 45 C 14 40, 18 40, 18 45 M 12 55 C 14 50, 18 50, 18 55 M 12 65 C 14 60, 18 60, 18 65 M 12 75 C 14 70, 18 70, 18 75 M 12 85 C 14 80, 18 80, 18 85" fill="none" stroke="#000000" stroke-width="2.5" stroke-opacity="0.9" />
    </svg>`
  },
  {
    category: 'stationery',
    subcategory: 'notebooks-paper',
    name: 'Paperback Novel / Book',
    filename: 'stationery_office_book.svg',
    pixel_value: 47000,
    width: 140,
    height: 190,
    polygon_json: [
      { x: -0.45, y: -0.45 },
      { x: 0.45, y: -0.45 },
      { x: 0.45, y: 0.45 },
      { x: -0.45, y: 0.45 }
    ],
    svg: `<svg viewBox="0 0 100 130" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <!-- Spine (highly absorbing) -->
      <rect x="10" y="8" width="8" height="114" rx="1" fill="#000000" fill-opacity="0.5" stroke="#000000" stroke-width="1" />
      <!-- Paper block -->
      <rect x="18" y="10" width="72" height="110" rx="2" fill="#000000" fill-opacity="0.22" stroke="#000000" stroke-width="1.5" />
      <!-- Book cover details -->
      <rect x="24" y="18" width="60" height="94" fill="none" stroke="#000000" stroke-width="0.8" stroke-opacity="0.5" />
      <line x1="32" y1="40" x2="76" y2="40" stroke="#000000" stroke-width="1.8" stroke-opacity="0.6" />
      <line x1="32" y1="52" x2="76" y2="52" stroke="#000000" stroke-width="1" stroke-opacity="0.5" />
      <line x1="32" y1="64" x2="76" y2="64" stroke="#000000" stroke-width="1" stroke-opacity="0.5" />
    </svg>`
  }
];

async function main() {
  console.log('🚀 Seeding 34 detailed stencils (2 per subcategory) to database...');
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Ensure table has the new columns
    await client.query("ALTER TABLE items ADD COLUMN IF NOT EXISTS polygon_json JSONB");
    await client.query("ALTER TABLE items ADD COLUMN IF NOT EXISTS mask_path VARCHAR(255)");
    
    // Clear out previous system stencils to prevent duplicates
    await client.query("DELETE FROM upload_sessions WHERE folder_name = 'Default System Stencils'");
    
    // Create a new clean upload session for default stencils
    const sessionRes = await client.query(
      `INSERT INTO upload_sessions (folder_name, uploaded_at, item_count) 
       VALUES ('Default System Stencils', NOW(), $1) 
       RETURNING id`,
      [OBJECTS.length]
    );
    const sessionId = sessionRes.rows[0].id;
    
    for (const obj of OBJECTS) {
      // 1. Write the SVG file
      const outPath = path.join(libraryImagesRoot, obj.filename);
      await fs.writeFile(outPath, obj.svg, 'utf8');
      
      // 2. Insert into items
      const itemRes = await client.query(
        `INSERT INTO items (
          filename, filepath, category, subcategory, name, 
          upload_session_id, created_at, pixel_value, width, height, polygon_json
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10) RETURNING id`,
        [
          obj.filename, 
          obj.filename, 
          obj.category, 
          obj.subcategory, 
          obj.name, 
          sessionId, 
          obj.pixel_value, 
          obj.width, 
          obj.height, 
          JSON.stringify(obj.polygon_json)
        ]
      );
      const itemId = itemRes.rows[0].id;
      
      // 3. Insert into child tables depending on category
      if (obj.category === 'bags') {
        // Bags valid region starts as matching its outer outline
        const validRegion = {
          simplifiedPoints: obj.polygon_json,
          shapes: [{ id: 'outer-contour', type: 'polygon', points: obj.polygon_json, operation: 'add' }],
          version: 2
        };
        await client.query(
          `INSERT INTO bags (item_id, valid_region_points) VALUES ($1, $2)`,
          [itemId, JSON.stringify(validRegion)]
        );
      } else if (obj.category === 'threats') {
        await client.query(
          `INSERT INTO threats (item_id, threat_type, severity) VALUES ($1, $2, 'high')`,
          [itemId, obj.subcategory]
        );
      } else if (obj.category === 'electronics') {
        await client.query(
          `INSERT INTO electronics (item_id, device_type) VALUES ($1, $2)`,
          [itemId, obj.subcategory]
        );
      } else if (obj.category === 'clothes') {
        await client.query(
          `INSERT INTO clothes (item_id, garment_type) VALUES ($1, $2)`,
          [itemId, obj.subcategory]
        );
      } else if (obj.category === 'trays') {
        await client.query(
          `INSERT INTO trays (item_id, tray_type) VALUES ($1, $2)`,
          [itemId, obj.subcategory]
        );
      }
      
      console.log(`  Added item: ${obj.name} (${obj.category} -> ${obj.subcategory})`);
    }
    
    await client.query('COMMIT');
    console.log('✅ Seeding completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding stencils:', err);
  } finally {
    client.release();
    pool.end();
  }
}

main();
