
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_PIXEL = 65535;

// Define all 29 stencils with their paths, names, and render functions
const PREDEFINED_STENCILS = [
  // --- Bags ---
  {
    category: 'bags',
    subcategory: 'handbags',
    name: 'Suitcase',
    id: 'suitcase',
    pixelValue: 45000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="25" width="80" height="65" rx="8" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="35" y="18" width="30" height="10" rx="5" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="12" y="82" width="12" height="6" rx="2" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
  <rect x="76" y="82" width="12" height="6" rx="2" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },
  {
    category: 'bags',
    subcategory: 'backpacks',
    name: 'Backpack',
    id: 'backpack',
    pixelValue: 48000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M30,90 C25,75 28,25 50,15 C72,25 75,75 70,90 C68,95 60,97 50,97 C40,97 32,95 30,90 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="35" y="55" width="30" height="25" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <path d="M40,25 C30,20 28,40 30,55" fill="none" stroke="${grayColor}" stroke-width="4" stroke-linecap="round" />
  <path d="M60,25 C70,20 72,40 70,55" fill="none" stroke="${grayColor}" stroke-width="4" stroke-linecap="round" />
</svg>`
  },
  {
    category: 'bags',
    subcategory: 'duffels',
    name: 'Duffel',
    id: 'duffel',
    pixelValue: 42000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="55" rx="40" ry="28" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <ellipse cx="15" cy="55" rx="10" ry="20" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <ellipse cx="85" cy="55" rx="10" ry="20" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <path d="M30,35 Q50,15 70,35" fill="none" stroke="${grayColor}" stroke-width="4" stroke-linecap="round" />
</svg>`
  },
  {
    category: 'bags',
    subcategory: 'trolleys',
    name: 'Trolley',
    id: 'trolley',
    pixelValue: 46000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="18" y="20" width="64" height="68" rx="6" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="42" y="8" width="16" height="14" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="38" y="2" width="24" height="8" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <ellipse cx="25" cy="90" rx="8" ry="6" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
  <ellipse cx="75" cy="90" rx="8" ry="6" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },
  {
    category: 'bags',
    subcategory: 'handbags',
    name: 'Handbag',
    id: 'handbag',
    pixelValue: 44000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M20,45 Q20,75 50,78 Q80,75 80,45 L80,40 Q80,35 50,35 Q20,35 20,40 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M30,40 Q30,20 50,15 Q70,20 70,40" fill="none" stroke="${grayColor}" stroke-width="3" stroke-linecap="round" />
</svg>`
  },
  {
    category: 'bags',
    subcategory: 'laptop-bags',
    name: 'Laptop Bag',
    id: 'laptopBag',
    pixelValue: 47000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="15" y="20" width="70" height="70" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="20" y="50" width="60" height="25" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="40" y="12" width="20" height="10" rx="5" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <circle cx="20" cy="30" r="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
  <circle cx="80" cy="30" r="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },

  // --- Trays ---
  {
    category: 'trays',
    subcategory: 'standard',
    name: 'Standard Tray',
    id: 'trayStandard',
    pixelValue: 52000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="80" height="80" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="15" y="15" width="70" height="70" rx="3" fill="none" stroke="${grayColor}" stroke-width="1" stroke-dasharray="3 3" />
</svg>`
  },
  {
    category: 'trays',
    subcategory: 'metal',
    name: 'Metal Tray',
    id: 'trayMetal',
    pixelValue: 55000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="8" width="84" height="84" rx="6" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="3" />
  <rect x="14" y="14" width="72" height="72" rx="4" fill="none" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },

  // --- Clothes ---
  {
    category: 'clothes',
    subcategory: 'shirts',
    name: 'T-Shirt',
    id: 'tshirt',
    pixelValue: 35000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M35,20 L35,35 L20,45 L20,85 L80,85 L80,45 L65,35 L65,20 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M40,20 Q50,10 60,20" fill="none" stroke="${grayColor}" stroke-width="2" />
</svg>`
  },
  {
    category: 'clothes',
    subcategory: 'pants',
    name: 'Jeans',
    id: 'jeans',
    pixelValue: 32000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M30,15 L70,15 L70,40 L60,40 L60,90 L40,90 L40,40 L30,40 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="38" y="18" width="24" height="8" rx="2" fill="none" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },
  {
    category: 'clothes',
    subcategory: 'sweaters',
    name: 'Sweater',
    id: 'sweater',
    pixelValue: 38000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M30,20 L30,38 L18,48 L18,88 L82,88 L82,48 L70,38 L70,20 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M35,20 Q50,12 65,20" fill="none" stroke="${grayColor}" stroke-width="2.5" />
</svg>`
  },
  {
    category: 'clothes',
    subcategory: 'coats',
    name: 'Coat',
    id: 'coat',
    pixelValue: 40000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M25,18 L75,18 L78,40 L82,90 L50,90 L18,90 L22,40 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M38,18 L38,45" fill="none" stroke="${grayColor}" stroke-width="2" />
  <path d="M62,18 L62,45" fill="none" stroke="${grayColor}" stroke-width="2" />
</svg>`
  },

  // --- Electronics ---
  {
    category: 'electronics',
    subcategory: 'laptops',
    name: 'Laptop',
    id: 'laptop',
    pixelValue: 18000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="15" y="10" width="70" height="50" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="18" y="60" width="64" height="8" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <circle cx="50" cy="30" r="2" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },
  {
    category: 'electronics',
    subcategory: 'phones',
    name: 'Phone',
    id: 'phone',
    pixelValue: 15000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="30" y="10" width="40" height="80" rx="8" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="33" y="15" width="34" height="65" rx="5" fill="none" stroke="${grayColor}" stroke-width="1" />
  <circle cx="50" cy="86" r="3" fill="none" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },
  {
    category: 'electronics',
    subcategory: 'chargers',
    name: 'Charger',
    id: 'charger',
    pixelValue: 20000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="30" y="20" width="40" height="45" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="35" y="70" width="12" height="10" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="53" y="70" width="12" height="10" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },
  {
    category: 'electronics',
    subcategory: 'heating-coils',
    name: 'Heating Coil',
    id: 'heatingCoil',
    pixelValue: 25000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="35" y="10" width="30" height="20" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M35,30 Q25,45 35,60 Q45,75 35,90" fill="none" stroke="${grayColor}" stroke-width="4" stroke-linecap="round" />
  <path d="M65,30 Q75,45 65,60 Q55,75 65,90" fill="none" stroke="${grayColor}" stroke-width="4" stroke-linecap="round" />
</svg>`
  },
  {
    category: 'electronics',
    subcategory: 'hair-dryers',
    name: 'Hair Dryer',
    id: 'hairDryer',
    pixelValue: 22000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="40" y="20" width="20" height="55" rx="10" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <ellipse cx="60" cy="30" rx="25" ry="18" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <circle cx="40" cy="75" r="6" fill="none" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },

  // --- Food ---
  {
    category: 'food',
    subcategory: 'snacks',
    name: 'Energy Bar',
    id: 'energyBar',
    pixelValue: 40000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="25" y="35" width="50" height="30" rx="6" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="28" y="38" width="44" height="24" rx="4" fill="none" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },
  {
    category: 'food',
    subcategory: 'fruits',
    name: 'Banana',
    id: 'banana',
    pixelValue: 45000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M30,65 Q20,40 40,20 Q60,10 75,30 Q65,50 60,70 Q50,85 35,75 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <ellipse cx="40" cy="18" rx="6" ry="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },
  {
    category: 'food',
    subcategory: 'beverages',
    name: 'Water Bottle',
    id: 'waterBottle',
    pixelValue: 38000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="38" y="30" width="24" height="55" rx="6" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="43" y="18" width="14" height="15" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="42" y="12" width="16" height="8" rx="2" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },

  // --- Threats ---
  {
    category: 'threats',
    subcategory: 'firearms',
    name: 'Gun',
    id: 'gun',
    pixelValue: 12000,
    viewBox: '0 0 230 120',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 230 120" xmlns="http://www.w3.org/2000/svg">
  <rect x="120" y="22" width="98" height="14" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="80" y="18" width="136" height="22" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M80 38 L185 38 L185 58 L175 58 L175 48 L80 48 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <path d="M80 38 L90 38 L95 100 L55 104 L48 60 L60 38 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },
  {
    category: 'threats',
    subcategory: 'blades',
    name: 'Knife',
    id: 'knife',
    pixelValue: 14000,
    viewBox: '0 0 230 70',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 230 70" xmlns="http://www.w3.org/2000/svg">
  <path d="M52 28 L195 14 L210 28 L195 42 L52 36 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="44" y="20" width="10" height="16" rx="2" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <rect x="5" y="22" width="40" height="12" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },
  {
    category: 'threats',
    subcategory: 'suspicious',
    name: 'Generic Threat',
    id: 'generic',
    pixelValue: 16000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="30" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="3" />
  <circle cx="50" cy="50" r="18" fill="none" stroke="${grayColor}" stroke-width="2" />
</svg>`
  },

  // --- Stationary ---
  {
    category: 'miscellaneous',
    subcategory: 'office-supplies',
    name: 'Notebook',
    id: 'notebook',
    pixelValue: 43000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="20" y="15" width="60" height="75" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <line x1="28" y1="15" x2="28" y2="90" stroke="${grayColor}" stroke-width="4" />
  <circle cx="28" cy="25" r="3" fill="white" stroke="${grayColor}" stroke-width="1" />
  <circle cx="28" cy="35" r="3" fill="white" stroke="${grayColor}" stroke-width="1" />
  <circle cx="28" cy="45" r="3" fill="white" stroke="${grayColor}" stroke-width="1" />
  <circle cx="28" cy="55" r="3" fill="white" stroke="${grayColor}" stroke-width="1" />
  <circle cx="28" cy="65" r="3" fill="white" stroke="${grayColor}" stroke-width="1" />
  <circle cx="28" cy="75" r="3" fill="white" stroke="${grayColor}" stroke-width="1" />
  <circle cx="28" cy="85" r="3" fill="white" stroke="${grayColor}" stroke-width="1" />
</svg>`
  },
  {
    category: 'miscellaneous',
    subcategory: 'office-supplies',
    name: 'Pen',
    id: 'pen',
    pixelValue: 41000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="35" y="12" width="30" height="8" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="35" y="20" width="30" height="60" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="50" y="15" width="12" height="25" rx="2" fill="none" stroke="${grayColor}" stroke-width="1.5" />
  <polygon points="40,80 50,90 60,80" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },
  {
    category: 'miscellaneous',
    subcategory: 'office-supplies',
    name: 'Stapler',
    id: 'stapler',
    pixelValue: 44000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="20" y="45" width="65" height="20" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M25,45 L40,25 L80,25 L85,45" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="70" y="50" width="10" height="10" rx="2" fill="none" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },

  // --- LAG ---
  {
    category: 'miscellaneous',
    subcategory: 'toiletries',
    name: 'Toothpaste',
    id: 'toothpaste',
    pixelValue: 25000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="35" y="75" width="30" height="15" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <path d="M30,30 Q30,75 50,78 Q70,75 70,30 Z" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="42" y="15" width="16" height="18" rx="3" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },
  {
    category: 'miscellaneous',
    subcategory: 'toiletries',
    name: 'Perfume',
    id: 'perfume',
    pixelValue: 22000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="32" y="40" width="36" height="45" rx="6" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="42" y="25" width="16" height="18" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <ellipse cx="50" cy="18" rx="8" ry="5" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  },
  {
    category: 'miscellaneous',
    subcategory: 'toiletries',
    name: 'Shampoo',
    id: 'shampoo',
    pixelValue: 28000,
    viewBox: '0 0 100 100',
    renderSvg: (grayColor) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="30" y="35" width="40" height="50" rx="8" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="2" />
  <rect x="40" y="20" width="20" height="18" rx="4" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
  <ellipse cx="50" cy="14" rx="8" ry="5" fill="${grayColor}" fill-opacity="1" stroke="${grayColor}" stroke-width="1.5" />
</svg>`
  }
];

async function main() {
  console.log('🚀 Generating 29 predefined stencils...\n');
  const libraryImagesRoot = path.resolve(__dirname, '../data/library_images');
  let saved = 0;

  for (const stencil of PREDEFINED_STENCILS) {
    const grayValue = Math.round((stencil.pixelValue / MAX_PIXEL) * 255);
    const grayColor = `rgb(${grayValue}, ${grayValue}, ${grayValue})`;
    
    const targetDir = path.join(libraryImagesRoot, stencil.category, stencil.subcategory);
    await fs.mkdir(targetDir, { recursive: true });

    const fileName = `${stencil.id}.svg`;
    const filePath = path.join(targetDir, fileName);
    
    await fs.writeFile(filePath, stencil.renderSvg(grayColor));
    
    console.log(`✅ Saved: ${stencil.name} -> ${stencil.category}/${stencil.subcategory}/${fileName}`);
    saved++;
  }

  console.log(`\n🎉 Done! Successfully generated and saved ${saved} predefined stencils!`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
