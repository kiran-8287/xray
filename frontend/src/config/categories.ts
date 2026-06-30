// Category configuration - Single source of truth for all category/subcategory data
export interface LibraryCategory {
  slug: string;
  name: string;
  subcategories: { slug: string; name: string }[];
}

export interface CategoryConfig {
  bg: string;
  text: string;
  border: string;
  borderAccent: string;
  label: string;
  slug: string;
}

// Complete library category definitions with all subcategories
export const LIBRARIES: LibraryCategory[] = [
  {
    slug: "bags",
    name: "Bags",
    subcategories: [
      { slug: "backpack", name: "Backpack" },
      { slug: "briefcase", name: "Briefcase" },
      { slug: "cabin-bag", name: "Cabin Bag" },
      { slug: "camera-bag", name: "Camera Bag" },
      { slug: "cosmetic-bag", name: "Cosmetic Bag" },
      { slug: "duffel-bag", name: "Duffel Bag" },
      { slug: "general", name: "General" },
      { slug: "gym-bag", name: "Gym Bag" },
      { slug: "handbag", name: "Handbag" },
      { slug: "hiking-backpack", name: "Hiking Backpack" },
      { slug: "laptop-bag", name: "Laptop Bag" },
      { slug: "messenger-bag", name: "Messenger Bag" },
      { slug: "pouch", name: "Pouch" },
      { slug: "school-bag", name: "School Bag" },
      { slug: "shoulder-bag", name: "Shoulder Bag" },
      { slug: "sling-bag", name: "Sling Bag" },
      { slug: "suitcase", name: "Suitcase" },
      { slug: "tote-bag", name: "Tote Bag" },
      { slug: "travel-bag", name: "Travel Bag" },
      { slug: "trolley-bag", name: "Trolley Bag" },
    ],
  },
  {
    slug: "threats",
    name: "Threats",
    subcategories: [
      { slug: "air-gun", name: "Air Gun" },
      { slug: "ammunition", name: "Ammunition" },
      { slug: "axe", name: "Axe" },
      { slug: "baton", name: "Baton" },
      { slug: "box-cutter", name: "Box Cutter" },
      { slug: "brass-knuckles", name: "Brass Knuckles" },
      { slug: "bullet", name: "Bullet" },
      { slug: "cartridge", name: "Cartridge" },
      { slug: "combat-knife", name: "Combat Knife" },
      { slug: "crowbar", name: "Crowbar" },
      { slug: "dagger", name: "Dagger" },
      { slug: "detonator", name: "Detonator" },
      { slug: "dynamite", name: "Dynamite" },
      { slug: "explosive", name: "Explosive" },
      { slug: "explosive-charge", name: "Explosive Charge" },
      { slug: "firecracker", name: "Firecracker" },
      { slug: "folding-knife", name: "Folding Knife" },
      { slug: "general", name: "General" },
      { slug: "grenade", name: "Grenade" },
      { slug: "gun", name: "Gun" },
      { slug: "hammer", name: "Hammer" },
      { slug: "hand-grenade", name: "Hand Grenade" },
      { slug: "ice-pick", name: "Ice Pick" },
      { slug: "ied", name: "IED" },
      { slug: "kitchen-knife", name: "Kitchen Knife" },
      { slug: "knife", name: "Knife" },
      { slug: "machete", name: "Machete" },
      { slug: "magazine", name: "Magazine" },
      { slug: "nunchaku", name: "Nunchaku" },
      { slug: "pistol", name: "Pistol" },
      { slug: "razor-blade", name: "Razor Blade" },
      { slug: "revolver", name: "Revolver" },
      { slug: "rifle", name: "Rifle" },
      { slug: "scalpel", name: "Scalpel" },
      { slug: "shell", name: "Shell" },
      { slug: "shotgun", name: "Shotgun" },
      { slug: "shuriken", name: "Shuriken" },
      { slug: "submachine-gun", name: "Submachine Gun" },
      { slug: "sword", name: "Sword" },
      { slug: "taser", name: "Taser" },
    ],
  },
  {
    slug: "non-threats",
    name: "Non-Threats",
    subcategories: [
      { slug: "accessories", name: "Accessories" },
      { slug: "belt", name: "Belt" },
      { slug: "beverage-can", name: "Beverage Can" },
      { slug: "blanket", name: "Blanket" },
      { slug: "board-game", name: "Board Game" },
      { slug: "books", name: "Books" },
      { slug: "camera", name: "Camera" },
      { slug: "cap", name: "Cap" },
      { slug: "charger", name: "Charger" },
      { slug: "clothes", name: "Clothes" },
      { slug: "deodorant", name: "Deodorant" },
      { slug: "documents", name: "Documents" },
      { slug: "electronics", name: "Electronics" },
      { slug: "first-aid-kit", name: "First Aid Kit" },
      { slug: "food", name: "Food" },
      { slug: "fruits", name: "Fruits" },
      { slug: "gaming-console", name: "Gaming Console" },
      { slug: "general", name: "General" },
      { slug: "gloves", name: "Gloves" },
      { slug: "hard-drive", name: "Hard Drive" },
      { slug: "headphones", name: "Headphones" },
      { slug: "id-card", name: "ID Card" },
      { slug: "jacket", name: "Jacket" },
      { slug: "jewelry", name: "Jewelry" },
      { slug: "keyboard", name: "Keyboard" },
      { slug: "keys", name: "Keys" },
      { slug: "laptop", name: "Laptop" },
      { slug: "lock", name: "Lock" },
      { slug: "luggage-tag", name: "Luggage Tag" },
      { slug: "lunch-box", name: "Lunch Box" },
      { slug: "magazine", name: "Magazine" },
      { slug: "medical-equipment", name: "Medical Equipment" },
      { slug: "medication", name: "Medication" },
      { slug: "mobile-phone", name: "Mobile Phone" },
      { slug: "mouse", name: "Mouse" },
      { slug: "notebook", name: "Notebook" },
      { slug: "perfume", name: "Perfume" },
      { slug: "power-bank", name: "Power Bank" },
      { slug: "purse", name: "Purse" },
      { slug: "scarf", name: "Scarf" },
      { slug: "shampoo", name: "Shampoo" },
      { slug: "shoes", name: "Shoes" },
      { slug: "smartwatch", name: "Smartwatch" },
      { slug: "snacks", name: "Snacks" },
      { slug: "soap", name: "Soap" },
      { slug: "socks", name: "Socks" },
      { slug: "sports-equipment", name: "Sports Equipment" },
      { slug: "stuffed-toy", name: "Stuffed Toy" },
      { slug: "sunglasses", name: "Sunglasses" },
      { slug: "tablet", name: "Tablet" },
      { slug: "toiletries", name: "Toiletries" },
      { slug: "toothbrush", name: "Toothbrush" },
      { slug: "toothpaste", name: "Toothpaste" },
      { slug: "toys", name: "Toys" },
      { slug: "travel-pillow", name: "Travel Pillow" },
      { slug: "umbrella", name: "Umbrella" },
      { slug: "usb-drive", name: "USB Drive" },
      { slug: "wallet", name: "Wallet" },
      { slug: "watch", name: "Watch" },
      { slug: "water-bottle", name: "Water Bottle" },
    ],
  },
];

// Helper function to get subcategories for a library slug
export function getLibrarySubcategories(slug: string): { slug: string; name: string }[] {
  const lib = LIBRARIES.find((l) => l.slug === slug);
  return lib ? lib.subcategories : [];
}

// Normalize category names to standard slugs
export function normalizeCategoryName(cat: string): string {
  const normalized = (cat || "").toLowerCase().trim();
  if (normalized === "non-threats" || normalized === "non-threat" || normalized.includes("non threat")) {
    return "non-threats";
  }
  if (normalized.includes("bag")) return "bags";
  if (normalized.includes("threat") || normalized.includes("electronic") || normalized === "electronics") return "threats";
  return "non-threats";
}

// Normalize categorized items structure by merging subcategories under normalized category keys
export function normalizeCategorizedItems(categorized: any): any {
  if (!categorized) return null;
  const merged: any = {};
  for (const [catKey, subcats] of Object.entries(categorized)) {
    const normalized = normalizeCategoryName(catKey);
    if (!merged[normalized]) {
      merged[normalized] = {};
    }
    for (const [subKey, items] of Object.entries(subcats || {})) {
      if (!merged[normalized][subKey]) {
        merged[normalized][subKey] = [];
      }
      if (Array.isArray(items)) {
        merged[normalized][subKey].push(...items);
      }
    }
  }
  return merged;
}

// Category visual configuration map
const CATEGORY_MAP: Record<string, CategoryConfig> = {
  bags: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", borderAccent: "border-blue-500", label: "Bags", slug: "bags" },
  threats: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", borderAccent: "border-rose-500", label: "Threats", slug: "threats" },
  "non-threats": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", borderAccent: "border-emerald-500", label: "Non-Threats", slug: "non-threats" },
};

// Get visual configuration for a category
export function getCategoryConfig(category: string): CategoryConfig {
  const normalized = normalizeCategoryName(category);
  return CATEGORY_MAP[normalized] || CATEGORY_MAP["non-threats"];
}

// Export SUBCATEGORY_MAP for backward compatibility (used in UploadPage)
export const SUBCATEGORY_MAP: Record<string, { name: string; slug: string }[]> = {
  bags: LIBRARIES.find(l => l.slug === "bags")?.subcategories.map(s => ({ name: s.name, slug: s.slug })) || [],
  threats: LIBRARIES.find(l => l.slug === "threats")?.subcategories.map(s => ({ name: s.name, slug: s.slug })) || [],
  "non-threats": LIBRARIES.find(l => l.slug === "non-threats")?.subcategories.map(s => ({ name: s.name, slug: s.slug })) || [],
};

// Export library definitions for UI components
export const LIBRARIES_UI = [
  { slug: "bags", name: "Bags", colorCls: "bg-blue-50 text-blue-700 border-blue-200" },
  { slug: "threats", name: "Threats", colorCls: "bg-rose-50 text-rose-700 border-rose-200" },
  { slug: "non-threats", name: "Non-Threats", colorCls: "bg-gray-50 text-gray-700 border-gray-200" },
];
