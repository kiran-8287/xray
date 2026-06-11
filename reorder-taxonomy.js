import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom stencils from seed-combined-library.js
const CUSTOM_STENCILS = [
  // Bags
  {
    category: "bags",
    subcategory: "backpacks",
    name: "Tactical Daypack",
    filename: "bags_backpacks_daypack.svg",
    pixel_value: 48000,
    width: 320,
    height: 380,
  },
  {
    category: "bags",
    subcategory: "backpacks",
    name: "Hiking Backpack",
    filename: "bags_backpacks_hiking.svg",
    pixel_value: 49000,
    width: 340,
    height: 420,
  },
  {
    category: "bags",
    subcategory: "suitcases",
    name: "Hard-shell Suitcase",
    filename: "bags_suitcases_hardshell.svg",
    pixel_value: 45000,
    width: 400,
    height: 300,
  },
  {
    category: "bags",
    subcategory: "suitcases",
    name: "Vintage Leather Suitcase",
    filename: "bags_suitcases_vintage.svg",
    pixel_value: 46000,
    width: 380,
    height: 280,
  },
  // Trays
  {
    category: "trays",
    subcategory: "standard-plastic-tray",
    name: "Standard PP Tray",
    filename: "trays_standard_grey.svg",
    pixel_value: 52000,
    width: 480,
    height: 360,
  },
  {
    category: "trays",
    subcategory: "standard-plastic-tray",
    name: "Large Cargo Tray",
    filename: "trays_large_cargo.svg",
    pixel_value: 53000,
    width: 520,
    height: 400,
  },
  {
    category: "trays",
    subcategory: "metal-detection-tray",
    name: "Kidney Bowl Tray",
    filename: "trays_kidney_metal.svg",
    pixel_value: 35000,
    width: 280,
    height: 180,
  },
  {
    category: "trays",
    subcategory: "metal-detection-tray",
    name: "Dental Instrument Tray",
    filename: "trays_dental_metal.svg",
    pixel_value: 36000,
    width: 240,
    height: 150,
  },
  // Clothing
  {
    category: "clothing",
    subcategory: "tops",
    name: "Cotton T-Shirt",
    filename: "clothes_tops_tshirt.svg",
    pixel_value: 62000,
    width: 120,
    height: 120,
  },
  {
    category: "clothing",
    subcategory: "tops",
    name: "Winter Hoodie",
    filename: "clothes_tops_hoodie.svg",
    pixel_value: 60000,
    width: 130,
    height: 130,
  },
  {
    category: "clothing",
    subcategory: "bottoms",
    name: "Denim Jeans",
    filename: "clothes_bottoms_jeans.svg",
    pixel_value: 58000,
    width: 140,
    height: 220,
  },
  {
    category: "clothing",
    subcategory: "bottoms",
    name: "Sport Shorts",
    filename: "clothes_bottoms_shorts.svg",
    pixel_value: 63000,
    width: 110,
    height: 90,
  },
  // Electronics
  {
    category: "electronics",
    subcategory: "computing-devices",
    name: "Detailed Laptop",
    filename: "electronics_computing_laptop.svg",
    pixel_value: 18000,
    width: 260,
    height: 180,
  },
  {
    category: "electronics",
    subcategory: "computing-devices",
    name: "Tablet Device",
    filename: "electronics_computing_tablet.svg",
    pixel_value: 21000,
    width: 160,
    height: 120,
  },
  {
    category: "electronics",
    subcategory: "phones-communication",
    name: "Smartphone",
    filename: "electronics_phones_smartphone.svg",
    pixel_value: 25000,
    width: 80,
    height: 150,
  },
  {
    category: "electronics",
    subcategory: "phones-communication",
    name: "Walkie Talkie",
    filename: "electronics_phones_walkietalkie.svg",
    pixel_value: 26000,
    width: 70,
    height: 180,
  },
  // Food & Drink
  {
    category: "food-drink",
    subcategory: "liquids-beverages",
    name: "Plastic Water Bottle",
    filename: "food_liquids_waterbottle.svg",
    pixel_value: 42000,
    width: 80,
    height: 200,
  },
  {
    category: "food-drink",
    subcategory: "liquids-beverages",
    name: "Soda Can",
    filename: "food_liquids_sodacan.svg",
    pixel_value: 39000,
    width: 70,
    height: 120,
  },
  {
    category: "food-drink",
    subcategory: "fruits-vegetables",
    name: "Organic Banana",
    filename: "food_fruits_banana.svg",
    pixel_value: 55000,
    width: 140,
    height: 100,
  },
  {
    category: "food-drink",
    subcategory: "fruits-vegetables",
    name: "Crunchy Apple",
    filename: "food_fruits_apple.svg",
    pixel_value: 56000,
    width: 90,
    height: 90,
  },
  // Threats
  {
    category: "threat-prohibited-objects",
    subcategory: "firearms-pistols",
    name: "Semi-Auto Pistol (9mm)",
    filename: "threats_firearms_pistol.svg",
    pixel_value: 10000,
    width: 180,
    height: 110,
  },
  {
    category: "threat-prohibited-objects",
    subcategory: "firearms-pistols",
    name: "Snub-nosed Revolver",
    filename: "threats_firearms_revolver.svg",
    pixel_value: 9000,
    width: 150,
    height: 100,
  },
  {
    category: "threat-prohibited-objects",
    subcategory: "edged-weapons",
    name: "Combat Knife",
    filename: "threats_edged_knife.svg",
    pixel_value: 15000,
    width: 200,
    height: 45,
  },
  {
    category: "threat-prohibited-objects",
    subcategory: "edged-weapons",
    name: "Metal Scissors",
    filename: "threats_edged_scissors.svg",
    pixel_value: 16000,
    width: 90,
    height: 160,
  },
  // Miscellaneous Items
  {
    category: "miscellaneous",
    subcategory: "miscellaneous-items",
    name: "Folded Umbrella",
    filename: "misc_items_umbrella.svg",
    pixel_value: 38000,
    width: 60,
    height: 220,
  },
  {
    category: "miscellaneous",
    subcategory: "miscellaneous-items",
    name: "Dual Binoculars",
    filename: "misc_items_binoculars.svg",
    pixel_value: 22000,
    width: 140,
    height: 120,
  },
  // Sports (under Miscellaneous)
  {
    category: "miscellaneous",
    subcategory: "fitness-gym",
    name: "Hex Dumbbell",
    filename: "sports_fitness_dumbbell.svg",
    pixel_value: 8000,
    width: 180,
    height: 80,
  },
  {
    category: "miscellaneous",
    subcategory: "fitness-gym",
    name: "Kettlebell",
    filename: "sports_fitness_kettlebell.svg",
    pixel_value: 7500,
    width: 110,
    height: 130,
  },
  {
    category: "miscellaneous",
    subcategory: "racquet-sports",
    name: "Tennis Racquet",
    filename: "sports_racquets_racquet.svg",
    pixel_value: 50000,
    width: 160,
    height: 320,
  },
  {
    category: "miscellaneous",
    subcategory: "racquet-sports",
    name: "Ping Pong Paddle",
    filename: "sports_racquets_paddle.svg",
    pixel_value: 52000,
    width: 100,
    height: 160,
  },
  // Stationery (under Miscellaneous)
  {
    category: "miscellaneous",
    subcategory: "office-tools",
    name: "Office Stapler",
    filename: "stationery_office_stapler.svg",
    pixel_value: 32000,
    width: 140,
    height: 70,
  },
  {
    category: "miscellaneous",
    subcategory: "office-tools",
    name: "Heavy Duty Hole Puncher",
    filename: "stationery_office_holepunch.svg",
    pixel_value: 31000,
    width: 130,
    height: 100,
  },
  {
    category: "miscellaneous",
    subcategory: "notebooks-paper",
    name: "Spiral Notebook",
    filename: "stationery_office_notebook.svg",
    pixel_value: 48000,
    width: 160,
    height: 200,
  },
  {
    category: "miscellaneous",
    subcategory: "notebooks-paper",
    name: "Paperback Novel / Book",
    filename: "stationery_office_book.svg",
    pixel_value: 47000,
    width: 140,
    height: 190,
  },
];

async function main() {
  const taxonomyPath = path.join(__dirname, 'taxonomy.json');
  const taxonomyData = await fs.readFile(taxonomyPath, 'utf8');
  const taxonomy = JSON.parse(taxonomyData);

  // Create a map of category slug -> category object
  const categoryMap = new Map();
  taxonomy.forEach(cat => {
    categoryMap.set(cat.slug, cat);
  });

  // Process each custom stencil
  CUSTOM_STENCILS.forEach(custom => {
    const category = categoryMap.get(custom.category);
    if (!category) {
      console.warn(`Category not found: ${custom.category}`);
      return;
    }

    const subcategory = category.subcategories.find(sub => sub.slug === custom.subcategory);
    if (!subcategory) {
      console.warn(`Subcategory not found: ${custom.category} / ${custom.subcategory}`);
      return;
    }

    // Create a proper taxonomy item
    const customItem = {
      name: custom.name,
      description: `${custom.name} (custom stencil)`,
      filename: custom.filename,
      category: custom.category,
      subcategory: custom.subcategory,
      displayCategory: category.name,
      displaySubcategory: subcategory.name,
    };

    // Check if the item already exists and remove it if it does
    const existingIndex = subcategory.items.findIndex(item => item.name === custom.name);
    if (existingIndex !== -1) {
      subcategory.items.splice(existingIndex, 1);
    }

    // Add to the BEGINNING of the items array
    subcategory.items.unshift(customItem);
    console.log(`✅ Added ${custom.name} to ${category.name} > ${subcategory.name}`);
  });

  // Write the updated taxonomy back to file
  await fs.writeFile(taxonomyPath, JSON.stringify(taxonomy, null, 2), 'utf8');
  console.log('\n✅ Done! Updated taxonomy.json');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
