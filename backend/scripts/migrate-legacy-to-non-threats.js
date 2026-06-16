import pg from 'pg';

// Use environment-driven configuration (no empty password passed)
const pool = new pg.Pool();

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Move electronics -> non_threat_items
    await client.query(`
      INSERT INTO non_threat_items (item_id, subcategory_slug)
      SELECT item_id, device_type FROM electronics
      ON CONFLICT (item_id) DO NOTHING
    `);

    // Move clothes -> non_threat_items
    await client.query(`
      INSERT INTO non_threat_items (item_id, subcategory_slug)
      SELECT item_id, garment_type FROM clothes
      ON CONFLICT (item_id) DO NOTHING
    `);

    // Move trays -> non_threat_items
    await client.query(`
      INSERT INTO non_threat_items (item_id, subcategory_slug)
      SELECT item_id, tray_type FROM trays
      ON CONFLICT (item_id) DO NOTHING
    `);

    // Drop legacy tables if they exist
    await client.query('DROP TABLE IF EXISTS electronics CASCADE');
    await client.query('DROP TABLE IF EXISTS clothes CASCADE');
    await client.query('DROP TABLE IF EXISTS trays CASCADE');

    await client.query('COMMIT');
    console.log('Migration complete: legacy tables consolidated into non_threat_items.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration when executed as a script
migrate().catch(err => { console.error(err); process.exit(1); });
