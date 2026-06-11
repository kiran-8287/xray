
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const libraryImagesRoot = path.resolve(__dirname, '../data/library_images');

const customStencils = [
  // Bags
  { filename: 'bags_backpacks_daypack.svg', category: 'bags', subcategory: 'backpacks' },
  { filename: 'bags_backpacks_hiking.svg', category: 'bags', subcategory: 'backpacks' },
  { filename: 'bags_suitcases_hardshell.svg', category: 'bags', subcategory: 'suitcases' },
  { filename: 'bags_suitcases_vintage.svg', category: 'bags', subcategory: 'suitcases' },
  // Trays
  { filename: 'trays_standard_grey.svg', category: 'trays', subcategory: 'standard-plastic-tray' },
  { filename: 'trays_large_cargo.svg', category: 'trays', subcategory: 'standard-plastic-tray' },
  { filename: 'trays_kidney_metal.svg', category: 'trays', subcategory: 'metal-detection-tray' },
  { filename: 'trays_dental_metal.svg', category: 'trays', subcategory: 'metal-detection-tray' },
  // Clothes
  { filename: 'clothes_tops_tshirt.svg', category: 'clothes', subcategory: 'tops' },
  { filename: 'clothes_tops_hoodie.svg', category: 'clothes', subcategory: 'tops' },
  { filename: 'clothes_bottoms_jeans.svg', category: 'clothes', subcategory: 'bottoms' },
  { filename: 'clothes_bottoms_shorts.svg', category: 'clothes', subcategory: 'bottoms' },
  // Electronics
  { filename: 'electronics_computing_laptop.svg', category: 'electronics', subcategory: 'computing-devices' },
  { filename: 'electronics_computing_tablet.svg', category: 'electronics', subcategory: 'computing-devices' },
  { filename: 'electronics_phones_smartphone.svg', category: 'electronics', subcategory: 'phones-communication' },
  { filename: 'electronics_phones_walkietalkie.svg', category: 'electronics', subcategory: 'phones-communication' },
  // Food
  { filename: 'food_liquids_waterbottle.svg', category: 'food', subcategory: 'liquids-beverages' },
  { filename: 'food_liquids_sodacan.svg', category: 'food', subcategory: 'liquids-beverages' },
  { filename: 'food_fruits_banana.svg', category: 'food', subcategory: 'fruits-vegetables' },
  { filename: 'food_fruits_apple.svg', category: 'food', subcategory: 'fruits-vegetables' },
  // Threats
  { filename: 'threats_firearms_pistol.svg', category: 'threats', subcategory: 'firearms-pistols' },
  { filename: 'threats_firearms_revolver.svg', category: 'threats', subcategory: 'firearms-pistols' },
  { filename: 'threats_edged_knife.svg', category: 'threats', subcategory: 'edged-weapons' },
  { filename: 'threats_edged_scissors.svg', category: 'threats', subcategory: 'edged-weapons' },
  // Misc
  { filename: 'misc_items_umbrella.svg', category: 'misc', subcategory: 'miscellaneous-items' },
  { filename: 'misc_items_binoculars.svg', category: 'misc', subcategory: 'miscellaneous-items' },
  // Sports
  { filename: 'sports_fitness_dumbbell.svg', category: 'sports', subcategory: 'fitness-gym' },
  { filename: 'sports_fitness_kettlebell.svg', category: 'sports', subcategory: 'fitness-gym' },
  { filename: 'sports_racquets_racquet.svg', category: 'sports', subcategory: 'racquet-sports' },
  { filename: 'sports_racquets_paddle.svg', category: 'sports', subcategory: 'racquet-sports' },
  // Stationery
  { filename: 'stationery_office_stapler.svg', category: 'stationery', subcategory: 'office-tools' },
  { filename: 'stationery_office_holepunch.svg', category: 'stationery', subcategory: 'office-tools' },
  { filename: 'stationery_office_notebook.svg', category: 'stationery', subcategory: 'notebooks-paper' },
  { filename: 'stationery_office_book.svg', category: 'stationery', subcategory: 'notebooks-paper' },
];

async function organizeCustomStencils() {
  console.log('Organizing 34 custom stencils...');
  for (const stencil of customStencils) {
    const srcPath = path.join(libraryImagesRoot, stencil.filename);
    const destDir = path.join(libraryImagesRoot, stencil.category, stencil.subcategory);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, stencil.filename);
    await fs.rename(srcPath, destPath);
    console.log(`Moved ${stencil.filename} → ${stencil.category}/${stencil.subcategory}/`);
  }
  console.log('✅ All custom stencils organized!');
}

organizeCustomStencils().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
