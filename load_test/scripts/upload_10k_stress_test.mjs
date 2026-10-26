// ============================================================================
// UPLOAD PAGE EXTREME VOLUME STRESS TEST: 10,000 FILES
// Evaluates:
// 1. Raw file upload ingestion (10,000 files across batches of 100, 4 concurrent streams)
// 2. Python worker image & NPZ pixel data extraction pipeline
// 3. Mask points and segmentation valid region generation (/api/items/segmentation-masks)
// 4. Memory footprint (RSS & Heap Used), B: drive disk I/O, error rates, throughput
// STRICTLY USES B: DRIVE ONLY (NO A: DRIVE, NO C: DRIVE)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const BACKEND_URL = 'http://localhost:8080';
const UPLOAD_ENDPOINT = '/api/process-raw-files';
const MASKS_ENDPOINT = '/api/items/segmentation-masks';
const PROJECT_DIR = 'B:/xray';
const SOURCE_DIR = path.join(PROJECT_DIR, 'dump and tip');
const LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/upload_10k_stress_test.log');
const MASTER_LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/full_load_test.log');
const RESULTS_FILE = path.join(PROJECT_DIR, 'load_test/results/upload_10k_results.json');
const SUMMARY_FILE = path.join(PROJECT_DIR, 'load_test/results/upload_10k_summary.json');

const TARGET_SCALE = 10000;
const BATCH_SIZE = 100; // 100 files per batch (matches UploadPage.tsx PAGE_SIZE)
const CONCURRENCY = 4; // 4 concurrent batches (400 files in flight, well within strictRateLimiter 10 limit)

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [UPLOAD_10K] ${msg}`;
  console.log(line);
  ensureDir(path.dirname(LOG_FILE));
  ensureDir(path.dirname(MASTER_LOG_FILE));
  fs.appendFileSync(LOG_FILE, line + '\n');
  fs.appendFileSync(MASTER_LOG_FILE, line + '\n');
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function collectSourceFiles() {
  const files = [];
  const categories = fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const cat of categories) {
    const catDir = path.join(SOURCE_DIR, cat);
    const catFiles = fs.readdirSync(catDir)
      .filter(f => f.toLowerCase().endsWith('.dump.pgm') || f.toLowerCase().endsWith('.tip'))
      .map(f => {
        const fullPath = path.join(catDir, f);
        return {
          fullPath,
          name: f,
          category: cat,
          size: fs.statSync(fullPath).size,
          isTip: f.toLowerCase().endsWith('.tip'),
        };
      });
    files.push(...catFiles);
  }
  log(`Found ${files.length} real source dump/tip files across ${categories.length} categories on B: drive`);
  return files;
}

// Clean up test pixel data and library images to keep B: drive free space plentiful
function cleanupTestArtifacts() {
  try {
    const pixelDir = path.join(PROJECT_DIR, 'backend/data/pixel_data');
    const imgDir = path.join(PROJECT_DIR, 'backend/data/library_images');
    let cleaned = 0;
    if (fs.existsSync(pixelDir)) {
      const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (entry.name.includes('loadtest_10k_')) {
            try { fs.unlinkSync(p); cleaned++; } catch {}
          }
        }
      };
      walk(pixelDir);
    }
    if (fs.existsSync(imgDir)) {
      for (const f of fs.readdirSync(imgDir)) {
        if (f.includes('loadtest_10k_')) {
          try { fs.unlinkSync(path.join(imgDir, f)); cleaned++; } catch {}
        }
      }
    }
    log(`Cleaned up ${cleaned} temporary test artifact files from B: drive`);
  } catch (err) {
    log(`Cleanup warning: ${err.message}`);
  }
}

async function uploadBatch(batchItems) {
  const formData = new FormData();
  for (const item of batchItems) {
    const buf = fs.readFileSync(item.sourcePath);
    formData.append('rawFiles', new Blob([buf]), item.uploadName);
  }

  const start = Date.now();
  let res;
  try {
    res = await fetch(`${BACKEND_URL}${UPLOAD_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'XrayUpload10KStress/1.0',
        'x-spa-page': 'upload',
      },
      body: formData,
    });
  } catch (err) {
    return {
      status: 0,
      duration: Date.now() - start,
      error: err.message,
      done: 0,
      failed: batchItems.length,
      processedIds: [],
    };
  }

  const duration = Date.now() - start;
  let done = 0, failed = 0, duplicates = 0, skipped = 0;
  const processedIds = [];
  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    return {
      status: res.status,
      duration,
      error: `Failed to read stream: ${err.message}`,
      done: 0,
      failed: batchItems.length,
      processedIds: [],
    };
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.status === 'done') {
        done++;
        if (e.id) processedIds.push(e.id);
      } else if (e.status === 'duplicate') duplicates++;
      else if (e.status === 'skipped') skipped++;
      else if (e.status === 'error' || e.status === 'failed') failed++;
    } catch {}
  }

  return {
    status: res.status,
    duration,
    done,
    failed,
    duplicates,
    skipped,
    processedIds,
  };
}

async function testMaskPointGeneration(itemIds) {
  log(`\n--------------------------------------------------`);
  log(`--- STAGE 2: MASK POINT & SEGMENTATION GENERATION ---`);
  log(`Testing segmentation mask computation on sample of ${itemIds.length} processed items...`);

  const chunkSize = 50;
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += chunkSize) {
    chunks.push(itemIds.slice(i, i + chunkSize));
  }

  let totalMasksFound = 0;
  let totalRequests = 0;
  let maskErrors = 0;
  const maskLatencies = [];
  const start = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const idsParam = chunk.join(',');
    const t0 = Date.now();
    try {
      const res = await fetch(`${BACKEND_URL}${MASKS_ENDPOINT}?ids=${encodeURIComponent(idsParam)}`);
      const dur = Date.now() - t0;
      maskLatencies.push(dur);
      totalRequests++;
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const count = data.masks ? Object.keys(data.masks).length : 0;
        totalMasksFound += count;
      } else {
        maskErrors++;
      }
    } catch (err) {
      maskErrors++;
    }

    if ((i + 1) % 10 === 0 || (i + 1) === chunks.length) {
      log(`Mask Points Progress: Chunk ${i + 1}/${chunks.length} evaluated (${totalMasksFound} masks generated)`);
    }
  }

  const totalDurationMs = Date.now() - start;
  const avgMaskMs = maskLatencies.length > 0 ? (maskLatencies.reduce((a, b) => a + b, 0) / maskLatencies.length) : 0;

  const maskResult = {
    totalItemsTested: itemIds.length,
    totalChunks: chunks.length,
    totalMasksGenerated: totalMasksFound,
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgChunkLatencyMs: Number(avgMaskMs.toFixed(2)),
    p50ChunkMs: Number(percentile(maskLatencies, 50).toFixed(1)),
    p95ChunkMs: Number(percentile(maskLatencies, 95).toFixed(1)),
    maskErrors,
  };

  log(`Mask Point Generation Results:`);
  log(`  - Total Items Evaluated: ${maskResult.totalItemsTested}`);
  log(`  - Masks Successfully Generated: ${maskResult.totalMasksGenerated}`);
  log(`  - Total Duration: ${maskResult.totalDurationSec}s`);
  log(`  - Avg Chunk Latency: ${maskResult.avgChunkLatencyMs}ms`);
  log(`  - p95 Chunk Latency: ${maskResult.p95ChunkMs}ms`);
  log(`  - Errors: ${maskErrors}`);

  return maskResult;
}

async function main() {
  log('============================================================');
  log(`UPLOAD PAGE EXTREME STRESS TEST: ${TARGET_SCALE} FILES`);
  log('============================================================');

  const sourceFiles = collectSourceFiles();
  if (sourceFiles.length === 0) {
    log('FATAL: No source dump/tip files found on B: drive!');
    process.exit(1);
  }

  const memInitial = process.memoryUsage();
  log(`Initial Node.js Memory: RSS=${(memInitial.rss / 1024 / 1024).toFixed(1)}MB, HeapUsed=${(memInitial.heapUsed / 1024 / 1024).toFixed(1)}MB`);

  // Build 10,000 item descriptors
  const items = [];
  for (let i = 0; i < TARGET_SCALE; i++) {
    const src = sourceFiles[i % sourceFiles.length];
    const ext = src.isTip ? '.tip' : '.dump.pgm';
    const uploadName = `loadtest_10k_${String(i).padStart(6, '0')}${ext}`;
    items.push({
      index: i,
      sourcePath: src.fullPath,
      uploadName,
      category: src.category,
      size: src.size,
    });
  }

  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  log(`Divided ${TARGET_SCALE} files into ${batches.length} batches of ${BATCH_SIZE} files`);
  log(`Dispatching with ${CONCURRENCY} parallel pipelines...`);

  const startTime = Date.now();
  let totalDone = 0;
  let totalFailed = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let batchErrors = 0;
  const batchDurations = [];
  const allProcessedIds = [];

  let batchIdx = 0;
  const running = new Set();

  while (batchIdx < batches.length || running.size > 0) {
    while (running.size < CONCURRENCY && batchIdx < batches.length) {
      const bIndex = batchIdx++;
      const batchItems = batches[bIndex];
      const p = uploadBatch(batchItems).then(res => {
        running.delete(p);
        return { bIndex, ...res };
      });
      running.add(p);
    }

    if (running.size === 0) break;

    const res = await Promise.race([...running]);
    batchDurations.push(res.duration);
    totalDone += res.done;
    totalFailed += res.failed;
    totalDuplicates += res.duplicates;
    totalSkipped += res.skipped;
    if (res.processedIds && res.processedIds.length > 0) {
      allProcessedIds.push(...res.processedIds);
    }
    if (res.status !== 200) batchErrors++;

    if ((res.bIndex + 1) % 10 === 0 || (res.bIndex + 1) === batches.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const curThroughput = (totalDone / (elapsed > 0 ? elapsed : 1)).toFixed(1);
      const memNow = process.memoryUsage();
      log(`Progress: Batch ${res.bIndex + 1}/${batches.length} | Done: ${totalDone}/${TARGET_SCALE} (${((totalDone / TARGET_SCALE) * 100).toFixed(1)}%) | Failed: ${totalFailed} | Rate: ${curThroughput}/s | Heap: ${(memNow.heapUsed / 1024 / 1024).toFixed(1)}MB | Elapsed: ${elapsed}s`);
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const memFinal = process.memoryUsage();
  const successRate = Number(((totalDone / TARGET_SCALE) * 100).toFixed(2));
  const avgProcessingTimePerFileMs = totalDone > 0 ? Number((totalDurationMs / totalDone).toFixed(2)) : 0;
  const throughputFilesPerSec = Number((totalDone / (totalDurationMs / 1000)).toFixed(2));

  log(`\n============================================================`);
  log(`STAGE 1 COMPLETED: RAW INGESTION & EXTRACTION (${TARGET_SCALE} FILES)`);
  log(`============================================================`);
  log(`  - Total Ingested & Processed: ${totalDone} / ${TARGET_SCALE} (${successRate}%)`);
  log(`  - Total Failed: ${totalFailed}`);
  log(`  - Total Time: ${(totalDurationMs / 1000).toFixed(1)}s`);
  log(`  - Avg Processing Time Per File: ${avgProcessingTimePerFileMs}ms`);
  log(`  - Throughput: ${throughputFilesPerSec} files/sec`);
  log(`  - Batch p50: ${percentile(batchDurations, 50)}ms, p95: ${percentile(batchDurations, 95)}ms, p99: ${percentile(batchDurations, 99)}ms`);
  log(`  - Memory Delta: RSS=+${((memFinal.rss - memInitial.rss) / 1024 / 1024).toFixed(1)}MB, Heap=+${((memFinal.heapUsed - memInitial.heapUsed) / 1024 / 1024).toFixed(1)}MB`);

  // Stage 2: Mask points and valid region generation test
  const sampleMaskIds = allProcessedIds.slice(0, 1000); // Test mask generation on sample of 1,000 processed items
  let maskMetrics = null;
  if (sampleMaskIds.length > 0) {
    try {
      maskMetrics = await testMaskPointGeneration(sampleMaskIds);
    } catch (err) {
      log(`Mask generation error: ${err.message}`);
    }
  }

  const summary = {
    test: 'Upload Page Extreme Volume Stress Test (10,000 Files)',
    targetScale: TARGET_SCALE,
    totalDone,
    totalFailed,
    totalDuplicates,
    totalSkipped,
    successRatePct: successRate,
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgProcessingTimePerFileMs,
    throughputFilesPerSec,
    batchLatencyStats: {
      p50BatchMs: Number(percentile(batchDurations, 50).toFixed(1)),
      p95BatchMs: Number(percentile(batchDurations, 95).toFixed(1)),
      p99BatchMs: Number(percentile(batchDurations, 99).toFixed(1)),
    },
    memory: {
      initialHeapMB: Number((memInitial.heapUsed / 1024 / 1024).toFixed(1)),
      finalHeapMB: Number((memFinal.heapUsed / 1024 / 1024).toFixed(1)),
      heapDeltaMB: Number(((memFinal.heapUsed - memInitial.heapUsed) / 1024 / 1024).toFixed(1)),
      rssDeltaMB: Number(((memFinal.rss - memInitial.rss) / 1024 / 1024).toFixed(1)),
    },
    maskPointGeneration: maskMetrics,
    breakingPointHit: successRate < 95,
  };

  ensureDir(path.dirname(SUMMARY_FILE));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  ensureDir(path.dirname(RESULTS_FILE));
  fs.appendFileSync(RESULTS_FILE, JSON.stringify({ timestamp: new Date().toISOString(), ...summary }) + '\n');

  log(`Saved results to ${SUMMARY_FILE}`);

  // Cleanup test artifacts
  cleanupTestArtifacts();

  log('============================================================');
  log(`UPLOAD 10,000 FILES STRESS TEST COMPLETE`);
  log('============================================================');
}

main().catch(err => {
  log(`Fatal error in 10k stress test: ${err.message}`);
  process.exit(1);
});
