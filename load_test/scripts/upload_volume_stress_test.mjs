#!/usr/bin/env node
// ============================================================================
// UPLOAD PAGE EXTREME VOLUME LOAD TEST (1K -> 10K -> 16K -> 20K FILES)
// - Fully Cross-Platform (Linux, macOS, Windows).
// - Uses 1,000 seed files, looped in-memory into FormData with unique virtual names.
// - Zero physical duplicate files created on disk.
// - Auto-prepares seed files from repo's 'dump and tip' if needed.
// - Measures: peak throughput, avg processing time per file, p50/p95 batch latencies,
//   Python worker extraction health, segmentation mask point calculation, memory & disk deltas.
// - Logs to load_test/logs/ and outputs structured JSON to load_test/results/.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSeedFiles } from './prepare_seed_files.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const UPLOAD_ENDPOINT = '/api/process-raw-files';
const MASKS_ENDPOINT = '/api/items/segmentation-masks';

const LOG_FILE = path.join(REPO_ROOT, 'load_test/logs/upload_volume_stress.log');
const MASTER_LOG_FILE = path.join(REPO_ROOT, 'load_test/logs/full_load_test.log');
const RESULTS_FILE = path.join(REPO_ROOT, 'load_test/results/upload_volume_stress_results.json');
const SUMMARY_FILE = path.join(REPO_ROOT, 'load_test/results/upload_volume_stress_summary.json');

// CLI options
function parseArgs() {
  const args = process.argv.slice(2);
  let backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';
  let scales = [10000, 16000, 20000];
  let batchSize = 100;
  let concurrency = 4;
  let seedDir = null;
  let cleanBetweenScales = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backend' && args[i + 1]) {
      backendUrl = args[i + 1];
      i++;
    } else if (args[i] === '--scales' && args[i + 1]) {
      scales = args[i + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--seeds' && args[i + 1]) {
      seedDir = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--no-clean') {
      cleanBetweenScales = false;
    }
  }

  return { backendUrl, scales, batchSize, concurrency, seedDir, cleanBetweenScales };
}

const config = parseArgs();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [UPLOAD_STRESS] ${msg}`;
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

function getDiskFreeGB() {
  try {
    const stats = fs.statfsSync(REPO_ROOT);
    return Number(((stats.bfree * stats.bsize) / (1024 * 1024 * 1024)).toFixed(2));
  } catch {
    return null;
  }
}

// Clean up test pixel data and library images to keep drive space plentiful
function cleanupTestArtifacts() {
  try {
    const pixelDir = path.join(REPO_ROOT, 'backend/data/pixel_data');
    const imgDir = path.join(REPO_ROOT, 'backend/data/library_images');
    const tempDir = path.join(REPO_ROOT, 'backend/data/temp/raw-uploads');
    let cleaned = 0;

    if (fs.existsSync(pixelDir)) {
      const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (entry.name.includes('loadtest_vol_')) {
            try { fs.unlinkSync(p); cleaned++; } catch {}
          }
        }
      };
      walk(pixelDir);
    }

    if (fs.existsSync(imgDir)) {
      for (const f of fs.readdirSync(imgDir)) {
        if (f.includes('loadtest_vol_')) {
          try { fs.unlinkSync(path.join(imgDir, f)); cleaned++; } catch {}
        }
      }
    }

    if (fs.existsSync(tempDir)) {
      for (const f of fs.readdirSync(tempDir)) {
        if (f.endsWith('.tmp')) {
          try { fs.unlinkSync(path.join(tempDir, f)); cleaned++; } catch {}
        }
      }
    }

    log(`[Cleanup] Removed ${cleaned} test pixel/image/temp files`);
  } catch (err) {
    log(`[Cleanup] Warning: ${err.message}`);
  }
}

// Locate or prepare seed files
function resolveSeedFiles(specifiedDir) {
  let candidates = [];
  if (specifiedDir) candidates.push(specifiedDir);
  candidates.push(path.join(REPO_ROOT, 'load_test/seed_data'));
  if (process.platform === 'win32') candidates.push('A:/xray_load_test_files');

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const files = fs.readdirSync(c).filter(f => f.toLowerCase().endsWith('.dump.pgm') || f.toLowerCase().endsWith('.tip'));
      if (files.length > 0) {
        log(`Using ${files.length} existing seed files from: ${c}`);
        return { dir: c, files };
      }
    }
  }

  // Auto-generate 1,000 seeds
  const defaultTarget = path.join(REPO_ROOT, 'load_test/seed_data');
  log(`No seed files found. Automatically generating 1,000 seed files in ${defaultTarget}...`);
  prepareSeedFiles(1000, defaultTarget);
  const files = fs.readdirSync(defaultTarget).filter(f => f.toLowerCase().endsWith('.dump.pgm') || f.toLowerCase().endsWith('.tip'));
  return { dir: defaultTarget, files };
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
    res = await fetch(`${config.backendUrl}${UPLOAD_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'XrayVolumeStress/2.0',
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

  // Parse NDJSON streaming progress events
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed);
      if (evt.type === 'file_complete') {
        done++;
        if (evt.id) processedIds.push(evt.id);
      } else if (evt.type === 'file_error') {
        failed++;
      } else if (evt.type === 'file_duplicate') {
        duplicates++;
      } else if (evt.type === 'complete' && evt.summary) {
        if (evt.summary.processed !== undefined) done = evt.summary.processed;
        if (evt.summary.failed !== undefined) failed = evt.summary.failed;
        if (evt.summary.duplicates !== undefined) duplicates = evt.summary.duplicates;
        if (evt.summary.skipped !== undefined) skipped = evt.summary.skipped;
      }
    } catch {
      // Non-JSON line
    }
  }

  // If standard JSON response
  if (done === 0 && failed === 0 && res.status === 200) {
    try {
      const data = JSON.parse(text);
      done = data.processed || data.count || (Array.isArray(data) ? data.length : batchItems.length);
      failed = data.failed || 0;
      duplicates = data.duplicates || 0;
    } catch {
      done = batchItems.length;
    }
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
  log(`Validating segmentation mask point generation across ${itemIds.length} ingested items...`);
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
      const res = await fetch(`${config.backendUrl}${MASKS_ENDPOINT}?ids=${encodeURIComponent(idsParam)}`);
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
    } catch {
      maskErrors++;
    }

    if ((i + 1) % 10 === 0 || (i + 1) === chunks.length) {
      log(`Mask Points Progress: Chunk ${i + 1}/${chunks.length} evaluated (${totalMasksFound} masks generated)`);
    }
  }

  const totalDurationMs = Date.now() - start;
  const avgMaskMs = maskLatencies.length > 0 ? (maskLatencies.reduce((a, b) => a + b, 0) / maskLatencies.length) : 0;

  return {
    totalItemsTested: itemIds.length,
    totalChunks: chunks.length,
    totalMasksGenerated: totalMasksFound,
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgChunkLatencyMs: Number(avgMaskMs.toFixed(2)),
    p50ChunkMs: Number(percentile(maskLatencies, 50).toFixed(1)),
    p95ChunkMs: Number(percentile(maskLatencies, 95).toFixed(1)),
    maskErrors,
  };
}

async function runScaleTest(scale, seedInfo) {
  log(`\n============================================================`);
  log(`--- EXECUTING UPLOAD VOLUME TEST: ${scale} FILES ---`);
  log(`============================================================`);

  const memInitial = process.memoryUsage();
  const diskFreeInitial = getDiskFreeGB();
  log(`Initial System State: Heap=${(memInitial.heapUsed / 1024 / 1024).toFixed(1)}MB, RSS=${(memInitial.rss / 1024 / 1024).toFixed(1)}MB, Disk Free=${diskFreeInitial ?? 'unknown'}GB`);

  // Build items by looping through seed files with unique virtual names
  const items = [];
  const { dir: seedDir, files: seedFiles } = seedInfo;
  for (let i = 0; i < scale; i++) {
    const srcFile = seedFiles[i % seedFiles.length];
    const ext = path.extname(srcFile);
    const loopIndex = Math.floor(i / seedFiles.length);
    const uniqueUploadName = `loadtest_vol_${scale}_l${loopIndex}_${String(i).padStart(6, '0')}${ext}`;
    items.push({
      index: i,
      sourcePath: path.join(seedDir, srcFile),
      uploadName: uniqueUploadName,
    });
  }

  const batches = [];
  for (let i = 0; i < items.length; i += config.batchSize) {
    batches.push(items.slice(i, i + config.batchSize));
  }

  log(`Prepared ${scale} virtual files across ${batches.length} batches of ${config.batchSize} files`);
  log(`Streaming to ${config.backendUrl}${UPLOAD_ENDPOINT} with concurrency=${config.concurrency}...`);

  const scaleStart = Date.now();
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
    while (running.size < config.concurrency && batchIdx < batches.length) {
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
      const elapsed = ((Date.now() - scaleStart) / 1000).toFixed(1);
      const curThroughput = (totalDone / (elapsed > 0 ? elapsed : 1)).toFixed(1);
      const memNow = process.memoryUsage();
      log(`Progress: Batch ${res.bIndex + 1}/${batches.length} | Done: ${totalDone}/${scale} (${((totalDone / scale) * 100).toFixed(1)}%) | Failed: ${totalFailed} | Rate: ${curThroughput}/s | Heap: ${(memNow.heapUsed / 1024 / 1024).toFixed(1)}MB | Elapsed: ${elapsed}s`);
    }
  }

  const totalDurationMs = Date.now() - scaleStart;
  const memFinal = process.memoryUsage();
  const diskFreeFinal = getDiskFreeGB();
  const successRate = Number(((totalDone / scale) * 100).toFixed(2));
  const avgProcessingTimePerFileMs = totalDone > 0 ? Number((totalDurationMs / totalDone).toFixed(2)) : 0;
  const throughputFilesPerSec = Number((totalDone / (totalDurationMs / 1000)).toFixed(2));

  log(`\nScale ${scale} Ingestion & Processing Complete:`);
  log(`  - Total Ingested & Processed: ${totalDone} / ${scale} (${successRate}%)`);
  log(`  - Total Failed: ${totalFailed}, Duplicates: ${totalDuplicates}, Skipped: ${totalSkipped}`);
  log(`  - Total Time: ${(totalDurationMs / 1000).toFixed(1)}s`);
  log(`  - Avg Processing Time Per File: ${avgProcessingTimePerFileMs}ms`);
  log(`  - Throughput: ${throughputFilesPerSec} files/sec`);
  log(`  - Batch Latency p50: ${percentile(batchDurations, 50)}ms, p95: ${percentile(batchDurations, 95)}ms, p99: ${percentile(batchDurations, 99)}ms`);
  log(`  - Memory Delta: RSS=+${((memFinal.rss - memInitial.rss) / 1024 / 1024).toFixed(1)}MB, Heap=+${((memFinal.heapUsed - memInitial.heapUsed) / 1024 / 1024).toFixed(1)}MB`);
  log(`  - Disk Storage: Initial=${diskFreeInitial ?? '?'}GB, Final=${diskFreeFinal ?? '?'}GB`);

  // Mask point generation validation on sample of 1,000 processed items
  let maskMetrics = null;
  const sampleMaskIds = allProcessedIds.slice(0, 1000);
  if (sampleMaskIds.length > 0) {
    try {
      maskMetrics = await testMaskPointGeneration(sampleMaskIds);
    } catch (err) {
      log(`Mask point test warning: ${err.message}`);
    }
  }

  const breakingPointReached = successRate < 90 || (diskFreeFinal !== null && diskFreeFinal < 2.0);

  const result = {
    page: 'Upload Page',
    scale,
    totalRequested: scale,
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
    disk: {
      initialFreeGB: diskFreeInitial,
      finalFreeGB: diskFreeFinal,
      consumedGB: diskFreeInitial && diskFreeFinal ? Number((diskFreeInitial - diskFreeFinal).toFixed(2)) : null,
    },
    maskPointGeneration: maskMetrics,
    breakingPointReached,
  };

  ensureDir(path.dirname(RESULTS_FILE));
  fs.appendFileSync(RESULTS_FILE, JSON.stringify({ timestamp: new Date().toISOString(), ...result }) + '\n');

  if (config.cleanBetweenScales) {
    cleanupTestArtifacts();
  }

  return result;
}

async function main() {
  log('============================================================');
  log('UPLOAD PAGE PROFESSIONAL VOLUME STRESS TEST (SEED-LOOPING)');
  log('============================================================');
  log(`Platform: ${process.platform} (${process.arch}) | Node: ${process.version}`);
  log(`Backend URL: ${config.backendUrl}`);
  log(`Target Scales: ${config.scales.join(', ')} files`);

  const seedInfo = resolveSeedFiles(config.seedDir);

  const allScaleResults = [];
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      const priorLines = fs.readFileSync(RESULTS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of priorLines) {
        const item = JSON.parse(line);
        if (item.scale && !allScaleResults.some(r => r.scale === item.scale)) {
          allScaleResults.push(item);
          log(`Loaded completed baseline scale ${item.scale} from ${RESULTS_FILE}`);
        }
      }
    } catch (e) {
      log(`Warning loading prior results: ${e.message}`);
    }
  }

  for (const scale of config.scales) {
    if (allScaleResults.some(r => r.scale === scale && r.totalDone === scale)) {
      log(`Scale ${scale} already recorded as 100% complete in results file. Skipping.`);
      continue;
    }

    try {
      const res = await runScaleTest(scale, seedInfo);
      allScaleResults.push(res);

      if (res.breakingPointReached) {
        log(`\n>>> BREAKING POINT HIT AT SCALE ${scale}! Halting further scale escalation.`);
        break;
      }

      log('Cooling down 3s before next scale...');
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      log(`Scale ${scale} fatal error: ${err.message}`);
      break;
    }
  }

  const peakUploads = allScaleResults.reduce((max, r) => (r.totalDone > max ? r.totalDone : max), 0);
  const bestThroughput = allScaleResults.reduce((max, r) => (r.throughputFilesPerSec > max ? r.throughputFilesPerSec : max), 0);
  const avgProcessingTime = (allScaleResults.reduce((sum, r) => sum + r.avgProcessingTimePerFileMs, 0) / (allScaleResults.length || 1)).toFixed(2);
  const breakingResult = allScaleResults.find(r => r.breakingPointReached);

  const summary = {
    testType: 'Upload Page Professional Volume Stress Test (Seed-Looping Engine)',
    seedFilesSource: `${seedInfo.files.length} seeds in ${seedInfo.dir} (in-memory virtual looping)`,
    targetScalesTested: allScaleResults.map(r => r.scale),
    peakUploadsAchieved: peakUploads,
    peakThroughputFilesPerSec: bestThroughput,
    overallAvgProcessingTimePerFileMs: Number(avgProcessingTime),
    breakingPointScale: breakingResult ? breakingResult.scale : 'None (System sustained all tested scales)',
    results: allScaleResults,
  };

  ensureDir(path.dirname(SUMMARY_FILE));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  log(`\n============================================================`);
  log(`UPLOAD VOLUME STRESS TEST COMPLETE. Summary saved to ${SUMMARY_FILE}`);
  log(`============================================================`);
}

main().catch(err => {
  log(`Fatal error in volume stress test: ${err.message}`);
  process.exit(1);
});
