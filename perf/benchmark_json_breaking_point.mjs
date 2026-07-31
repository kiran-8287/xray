import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, 'temp_bench_data');

function generateSampleItem(index, category = 'bags') {
  return {
    id: `item_${category}_${index}_${crypto.randomBytes(4).toString('hex')}`,
    filename: `scan_${index}.dump.pgm`,
    category,
    subcategory: category === 'bags' ? 'backpack' : (category === 'threats' ? 'knife' : 'clothes'),
    filepath: `/library/images/scan_${index}.dump.pgm`,
    original_filepath: `/raw/scan_${index}.dump.pgm`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    valid_region_points: [
      [100, 100], [500, 100], [500, 600], [100, 600]
    ],
    metadata: {
      width: 1024,
      height: 768,
      fileSize: 1048576,
      checksum: crypto.randomBytes(16).toString('hex')
    }
  };
}

async function runBenchmarkForSize(itemCount) {
  const items = Array.from({ length: itemCount }, (_, i) => generateSampleItem(i));
  const testFile = path.join(TEST_DIR, `test_items_${itemCount}.json`);
  const tmpFile = path.join(TEST_DIR, `test_items_${itemCount}.tmp`);

  // 1. JSON Stringify
  const memBefore = process.memoryUsage().heapUsed;
  const startStr = process.hrtime.bigint();
  const jsonStr = JSON.stringify(items, null, 2);
  const endStr = process.hrtime.bigint();
  const strMs = Number(endStr - startStr) / 1e6;
  const fileSizeBytes = Buffer.byteLength(jsonStr, 'utf8');
  const fileSizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(2);

  // 2. File Write & Atomic Rename
  const startWrite = process.hrtime.bigint();
  await fs.writeFile(tmpFile, jsonStr, 'utf8');
  await fs.rename(tmpFile, testFile);
  const endWrite = process.hrtime.bigint();
  const writeMs = Number(endWrite - startWrite) / 1e6;

  // 3. File Read
  const startRead = process.hrtime.bigint();
  const rawData = await fs.readFile(testFile, 'utf8');
  const endRead = process.hrtime.bigint();
  const readMs = Number(endRead - startRead) / 1e6;

  // 4. JSON Parse
  const startParse = process.hrtime.bigint();
  const parsedItems = JSON.parse(rawData);
  const endParse = process.hrtime.bigint();
  const parseMs = Number(endParse - startParse) / 1e6;

  const memAfter = process.memoryUsage().heapUsed;
  const memDeltaMb = ((memAfter - memBefore) / (1024 * 1024)).toFixed(2);

  // 5. Simulate 50 small appends (reading whole file, adding 5 items, re-writing whole file)
  const appendCycleCount = 20;
  const startAppendCycle = process.hrtime.bigint();
  let currentItems = parsedItems;
  for (let c = 0; c < appendCycleCount; c++) {
    const freshData = JSON.parse(await fs.readFile(testFile, 'utf8'));
    for (let k = 0; k < 5; k++) {
      freshData.push(generateSampleItem(itemCount + c * 5 + k));
    }
    const updatedStr = JSON.stringify(freshData, null, 2);
    await fs.writeFile(tmpFile, updatedStr, 'utf8');
    await fs.rename(tmpFile, testFile);
  }
  const endAppendCycle = process.hrtime.bigint();
  const avgAppendMs = (Number(endAppendCycle - startAppendCycle) / 1e6 / appendCycleCount).toFixed(2);

  // Cleanup
  try { await fs.unlink(testFile); } catch {}

  return {
    itemCount,
    fileSizeMb,
    strMs: strMs.toFixed(2),
    writeMs: writeMs.toFixed(2),
    readMs: readMs.toFixed(2),
    parseMs: parseMs.toFixed(2),
    memDeltaMb,
    avgAppendMs
  };
}

async function main() {
  console.log('=== JSON Storage Scale & Breaking Point Benchmark ===\n');
  await fs.mkdir(TEST_DIR, { recursive: true });

  const testSizes = [500, 1000, 5000, 10000, 20000, 50000];
  const results = [];

  for (const size of testSizes) {
    console.log(`Running benchmark for ${size} items...`);
    const res = await runBenchmarkForSize(size);
    results.push(res);
  }

  console.log('\n================ BENCHMARK RESULTS SUMMARY ================');
  console.table(results);

  console.log('\nKey Analysis:');
  for (const r of results) {
    console.log(
      `• ${r.itemCount} items -> File Size: ${r.fileSizeMb} MB | Read+Parse: ${(parseFloat(r.readMs) + parseFloat(r.parseMs)).toFixed(2)} ms | Atomic Write: ${r.writeMs} ms | Avg Append (+5 items) Cycle: ${r.avgAppendMs} ms`
    );
  }

  await fs.rm(TEST_DIR, { recursive: true, force: true });
}

main().catch(console.error);
