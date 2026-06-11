
import pg from 'pg';

const pool = new pg.Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'xray_db',
  password: process.env.PGPASSWORD || 'SaiKiran2166',
  port: process.env.PGPORT || 5432,
});

const stencilPathUpdates = [
  { oldPath: 'bags_backpacks_daypack.svg', newPath: 'bags/backpacks/bags_backpacks_daypack.svg' },
  { oldPath: 'bags_backpacks_hiking.svg', newPath: 'bags/backpacks/bags_backpacks_hiking.svg' },
  { oldPath: 'bags_suitcases_hardshell.svg', newPath: 'bags/suitcases/bags_suitcases_hardshell.svg' },
  { oldPath: 'bags_suitcases_vintage.svg', newPath: 'bags/suitcases/bags_suitcases_vintage.svg' },
  { oldPath: 'trays_standard_grey.svg', newPath: 'trays/standard-plastic-tray/trays_standard_grey.svg' },
  { oldPath: 'trays_large_cargo.svg', newPath: 'trays/standard-plastic-tray/trays_large_cargo.svg' },
  { oldPath: 'trays_kidney_metal.svg', newPath: 'trays/metal-detection-tray/trays_kidney_metal.svg' },
  { oldPath: 'trays_dental_metal.svg', newPath: 'trays/metal-detection-tray/trays_dental_metal.svg' },
  { oldPath: 'clothes_tops_tshirt.svg', newPath: 'clothes/tops/clothes_tops_tshirt.svg' },
  { oldPath: 'clothes_tops_hoodie.svg', newPath: 'clothes/tops/clothes_tops_hoodie.svg' },
  { oldPath: 'clothes_bottoms_jeans.svg', newPath: 'clothes/bottoms/clothes_bottoms_jeans.svg' },
  { oldPath: 'clothes_bottoms_shorts.svg', newPath: 'clothes/bottoms/clothes_bottoms_shorts.svg' },
  { oldPath: 'electronics_computing_laptop.svg', newPath: 'electronics/computing-devices/electronics_computing_laptop.svg' },
  { oldPath: 'electronics_computing_tablet.svg', newPath: 'electronics/computing-devices/electronics_computing_tablet.svg' },
  { oldPath: 'electronics_phones_smartphone.svg', newPath: 'electronics/phones-communication/electronics_phones_smartphone.svg' },
  { oldPath: 'electronics_phones_walkietalkie.svg', newPath: 'electronics/phones-communication/electronics_phones_walkietalkie.svg' },
  { oldPath: 'food_liquids_waterbottle.svg', newPath: 'food/liquids-beverages/food_liquids_waterbottle.svg' },
  { oldPath: 'food_liquids_sodacan.svg', newPath: 'food/liquids-beverages/food_liquids_sodacan.svg' },
  { oldPath: 'food_fruits_banana.svg', newPath: 'food/fruits-vegetables/food_fruits_banana.svg' },
  { oldPath: 'food_fruits_apple.svg', newPath: 'food/fruits-vegetables/food_fruits_apple.svg' },
  { oldPath: 'threats_firearms_pistol.svg', newPath: 'threats/firearms-pistols/threats_firearms_pistol.svg' },
  { oldPath: 'threats_firearms_revolver.svg', newPath: 'threats/firearms-pistols/threats_firearms_revolver.svg' },
  { oldPath: 'threats_edged_knife.svg', newPath: 'threats/edged-weapons/threats_edged_knife.svg' },
  { oldPath: 'threats_edged_scissors.svg', newPath: 'threats/edged-weapons/threats_edged_scissors.svg' },
  { oldPath: 'misc_items_umbrella.svg', newPath: 'misc/miscellaneous-items/misc_items_umbrella.svg' },
  { oldPath: 'misc_items_binoculars.svg', newPath: 'misc/miscellaneous-items/misc_items_binoculars.svg' },
  { oldPath: 'sports_fitness_dumbbell.svg', newPath: 'sports/fitness-gym/sports_fitness_dumbbell.svg' },
  { oldPath: 'sports_fitness_kettlebell.svg', newPath: 'sports/fitness-gym/sports_fitness_kettlebell.svg' },
  { oldPath: 'sports_racquets_racquet.svg', newPath: 'sports/racquet-sports/sports_racquets_racquet.svg' },
  { oldPath: 'sports_racquets_paddle.svg', newPath: 'sports/racquet-sports/sports_racquets_paddle.svg' },
  { oldPath: 'stationery_office_stapler.svg', newPath: 'stationery/office-tools/stationery_office_stapler.svg' },
  { oldPath: 'stationery_office_holepunch.svg', newPath: 'stationery/office-tools/stationery_office_holepunch.svg' },
  { oldPath: 'stationery_office_notebook.svg', newPath: 'stationery/notebooks-paper/stationery_office_notebook.svg' },
  { oldPath: 'stationery_office_book.svg', newPath: 'stationery/notebooks-paper/stationery_office_book.svg' },
];

async function updateDatabasePaths() {
  console.log('Updating database paths for 34 custom stencils...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const update of stencilPathUpdates) {
      await client.query(
        'UPDATE items SET filepath = $1 WHERE filepath = $2',
        [update.newPath, update.oldPath]
      );
      console.log(`Updated: ${update.oldPath} → ${update.newPath}`);
    }
    await client.query('COMMIT');
    console.log('✅ Database paths updated successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

updateDatabasePaths().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
