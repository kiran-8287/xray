/**
 * Test script for the duplicate-ID fix in storage.js.
 *
 * Simulates the user's reported bug:
 *   - 300 bags across 2 subcategories (100 + 200)
 *   - 100 of the 200 in subcat2 share IDs with subcat1 items (duplicates)
 *   - Verifies createItemsBatch re-assigns fresh IDs for collisions
 *   - Verifies healDuplicateItemIds() repairs existing duplicate data
 *
 * Uses a temporary DATA_DIR so the real backend data is never touched.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Point DATA_DIR at a temp folder BEFORE importing storage.js
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xray-dedup-test-'));
process.env.DATA_DIR = tmpRoot;

const storage = await import('../src/lib/storage.js');

let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
};

// ---- Test 1: createItemsBatch prevents duplicate IDs ----
console.log('\n[Test 1] createItemsBatch re-assigns colliding IDs');
{
  // Build 300 bags: 100 in subcat1, 200 in subcat2.
  // The first 100 of subcat2 intentionally reuse subcat1's IDs (the bug).
  const items = [];
  for (let i = 0; i < 100; i++) {
    items.push({ id: `dup_${i}`, category: 'bags', subcategory: 'subcat1', filepath: `a_${i}.png` });
  }
  for (let i = 0; i < 200; i++) {
    items.push({ id: i < 100 ? `dup_${i}` : `unique_${i}`, category: 'bags', subcategory: 'subcat2', filepath: `b_${i}.png` });
  }

  const saved = await storage.createItemsBatch(items);
  assert(saved.length === 300, `saved ${saved.length} items (expected 300)`);

  const ids = saved.map((s) => s.id);
  const unique = new Set(ids);
  assert(unique.size === 300, `all 300 IDs unique (got ${unique.size})`);

  // The 100 colliding items in subcat2 must have been re-assigned fresh IDs
  const subcat2 = saved.filter((s) => s.subcategory === 'subcat2');
  const subcat2Ids = new Set(subcat2.map((s) => s.id));
  const subcat1Ids = new Set(saved.filter((s) => s.subcategory === 'subcat1').map((s) => s.id));
  const overlap = [...subcat2Ids].filter((id) => subcat1Ids.has(id));
  assert(overlap.length === 0, `no ID overlap between subcategories (overlap=${overlap.length})`);
}

// ---- Test 2: healDuplicateItemIds repairs existing data ----
console.log('\n[Test 2] healDuplicateItemIds repairs existing duplicates');
{
  // Manually write a partition file with duplicate IDs (simulating old corrupted data)
  const partPath = path.join(tmpRoot, 'bags_1.json');
  const dupItems = [];
  for (let i = 0; i < 100; i++) {
    dupItems.push({ id: `old_${i}`, category: 'bags', subcategory: 'subcat1', filepath: `a_${i}.png` });
  }
  for (let i = 0; i < 200; i++) {
    dupItems.push({ id: i < 100 ? `old_${i}` : `old_unique_${i}`, category: 'bags', subcategory: 'subcat2', filepath: `b_${i}.png` });
  }
  await fs.writeFile(partPath, JSON.stringify(dupItems), 'utf8');

  // Update catalog to reflect 300 bags
  const catalog = await storage.getCatalog();
  catalog.categories.bags.totalCount = 300;
  catalog.categories.bags.partitions = [1];
  await fs.writeFile(path.join(tmpRoot, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');

  // Remove the marker so healing runs
  try { await fs.unlink(path.join(tmpRoot, '.dedup_healed')); } catch {}

  // Trigger healing via getItems (which calls ensureDataDir -> healDuplicateItemIds)
  const items = await storage.getItems('bags');
  const ids = items.map((i) => i.id);
  const unique = new Set(ids);
  assert(items.length === 300, `loaded ${items.length} items (expected 300)`);
  assert(unique.size === 300, `all 300 IDs unique after healing (got ${unique.size})`);

  // Verify the marker was written (healing runs only once)
  try {
    await fs.access(path.join(tmpRoot, '.dedup_healed'));
    assert(true, 'healing marker written');
  } catch {
    assert(false, 'healing marker written');
  }
}

// ---- Test 3: healing is idempotent (marker prevents re-run) ----
console.log('\n[Test 3] healing does not re-run (marker guard)');
{
  const before = await storage.getItems('bags');
  const beforeIds = before.map((i) => i.id).join('|');
  const after = await storage.getItems('bags');
  const afterIds = after.map((i) => i.id).join('|');
  assert(beforeIds === afterIds, 'IDs unchanged on second load (no re-heal)');
}

// ---- Cleanup ----
await fs.rm(tmpRoot, { recursive: true, force: true });

console.log(failures === 0 ? '\n✅ ALL TESTS PASSED' : `\n❌ ${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);