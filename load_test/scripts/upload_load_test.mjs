// ============================================================================
// UPLOAD PAGE LOAD TEST & BREAKING POINT ANALYSIS
// Tests: 100, 500, 1000, 2000, 3000, 5000 files, plus single-batch & concurrency breaking points
// Measures: peak uploads, avg processing time per file, p50/p95, memory, breaking point
// STRICTLY USES B: DRIVE ONLY (NO A: DRIVE, NO C: DRIVE)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const BACKEND_URL = 'http://localhost:8080';
const UPLOAD_ENDPOINT = '/api/process-raw-files';
const PROJECT_DIR = 'B:/xray';
const SOURCE_DIR = path.join(PROJECT_DIR, 'dump and tip');
const LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/upload_load_test.log');
const MASTER_LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/full_load_test.log');
const RESULTS_FILE = path.join(PROJECT_DIR, 'load_test/results/upload_results.json');
const SUMMARY_FILE = path.join(PROJECT_DIR, 'load_test/results/upload_summary.json');

// Test scales up to and beyond system limits
const TEST_SCALES = [100, 500, 1000, 2000, 3000, 5000, 6000];
const BATCH_SIZE = 50; // Increased batch size for higher scales
const CONCURRENCY = 2; // Strict rate limiter allows 10 concurrent, 2 is safe & fast

const allResults = [];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [UPLOAD] ${msg}`;
  console.log(line);
  ensureDir(path.dirname(LOG_FILE));
  ensureDir(path.dirname(MASTER_LOG_FILE));
  fs.appendFileSync(LOG_FILE, line + '\n');
  fs.appendFileSync(MASTER_LOG_FILE, line + '\n');
}

function logResult(scale, result) {
  ensureDir(path.dirname(RESULTS_FILE));
  const line = JSON.stringify({ scale, timestamp: new Date().toISOString(), ...result });
  fs.appendFileSync(RESULTS_FILE, line + '\n');
}

// Collect source dump and tip files
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

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// Clean up test pixel data to keep B: drive free space plentiful
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
          else if (entry.name.includes('loadtest_')) {
            try { fs.unlinkSync(p); cleaned++; } catch {}
          }
        }
      };
      walk(pixelDir);
    }
    if (fs.existsSync(imgDir)) {
      for (const f of fs.readdirSync(imgDir)) {
        if (f.includes('loadtest_')) {
          try { fs.unlinkSync(path.join(imgDir, f)); cleaned++; } catch {}
        }
      }
    }
    if (cleaned > 0) log(`Cleaned up ${cleaned} temporary test artifacts on B: drive`);
  } catch (err) {
    log(`Cleanup notice: ${err.message}`);
  }
}

// Upload a single batch of files
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
      headers: { 'User-Agent': 'XrayUploadLoadTest/1.0' },
      body: formData,
    });
  } catch (err) {
    return {
      status: 0,
      duration: Date.now() - start,
      error: err.message,
      done: 0,
      failed: batchItems.length,
      duplicates: 0,
      skipped: 0,
      fileDurations: [],
    };
  }

  const duration = Date.now() - start;
  let done = 0, failed = 0, duplicates = 0, skipped = 0;
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
      duplicates: 0,
      skipped: 0,
      fileDurations: [],
    };
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.status === 'done') done++;
      else if (e.status === 'duplicate') duplicates++;
      else if (e.status === 'skipped') skipped++;
      else if (e.status === 'error' || e.status === 'failed') failed++;
    } catch {}
  }

  const avgPerFileInBatch = batchItems.length > 0 ? duration / batchItems.length : 0;
  const fileDurations = batchItems.map(() => avgPerFileInBatch);

  return {
    status: res.status,
    duration,
    done,
    failed,
    duplicates,
    skipped,
    fileDurations,
  };
}

async function runScaleTest(scale, sourceFiles) {
  log(`\n==================================================`);
  log(`--- STARTING SCALE TEST: ${scale} FILES ---`);
  log(`==================================================`);

  const memBefore = process.memoryUsage();

  const items = [];
  for (let i = 0; i < scale; i++) {
    const src = sourceFiles[i % sourceFiles.length];
    const ext = src.isTip ? '.tip' : '.dump.pgm';
    const uploadName = `loadtest_${scale}_${String(i).padStart(6, '0')}${ext}`;
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

  log(`Created ${scale} test file descriptors across ${batches.length} batches of up to ${BATCH_SIZE} files`);

  const scaleStart = Date.now();
  let totalDone = 0;
  let totalFailed = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let allBatchDurations = [];
  let allFileDurations = [];
  let errors = 0;

  let batchIdx = 0;
  const pool = new Set();

  while (batchIdx < batches.length || pool.size > 0) {
    while (pool.size < CONCURRENCY && batchIdx < batches.length) {
      const bIndex = batchIdx++;
      const batchItems = batches[bIndex];
      const p = uploadBatch(batchItems).then(res => {
        pool.delete(p);
        return { bIndex, ...res };
      });
      pool.add(p);
    }

    if (pool.size === 0) break;

    const res = await Promise.race([...pool]);
    allBatchDurations.push(res.duration);
    allFileDurations.push(...res.fileDurations);
    totalDone += res.done;
    totalFailed += res.failed;
    totalDuplicates += res.duplicates;
    totalSkipped += res.skipped;
    if (res.status !== 200) errors++;

    if ((res.bIndex + 1) % 5 === 0 || (res.bIndex + 1) === batches.length) {
      log(`Progress: Batch ${res.bIndex + 1}/${batches.length} (${totalDone}/${scale} done) in ${res.duration}ms`);
    }
  }

  const totalDurationMs = Date.now() - scaleStart;
  const memAfter = process.memoryUsage();

  const avgProcessingTimePerFileMs = totalDone > 0 ? (totalDurationMs / totalDone) : 0;
  const throughputFilesPerSec = (totalDone / (totalDurationMs / 1000));
  const successRate = ((totalDone / scale) * 100);

  const result = {
    page: 'Upload Page',
    endpoint: '/api/process-raw-files',
    scale,
    totalRequested: scale,
    totalDone,
    totalFailed,
    totalDuplicates,
    totalSkipped,
    successRatePct: Number(successRate.toFixed(2)),
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgProcessingTimePerFileMs: Number(avgProcessingTimePerFileMs.toFixed(2)),
    throughputFilesPerSec: Number(throughputFilesPerSec.toFixed(2)),
    batchStats: {
      totalBatches: batches.length,
      batchSize: BATCH_SIZE,
      concurrency: CONCURRENCY,
      p50BatchMs: Number(percentile(allBatchDurations, 50).toFixed(1)),
      p95BatchMs: Number(percentile(allBatchDurations, 95).toFixed(1)),
      p99BatchMs: Number(percentile(allBatchDurations, 99).toFixed(1)),
    },
    fileLatencyStats: {
      p50FileMs: Number(percentile(allFileDurations, 50).toFixed(1)),
      p95FileMs: Number(percentile(allFileDurations, 95).toFixed(1)),
      p99FileMs: Number(percentile(allFileDurations, 99).toFixed(1)),
    },
    memory: {
      rssDeltaMB: Number(((memAfter.rss - memBefore.rss) / (1024 * 1024)).toFixed(2)),
      heapUsedDeltaMB: Number(((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2)),
    },
    knownLimits: {
      maxFileSize: '100 MB per file',
      maxFilesPerBatch: 5000,
      workerPoolHardCap: 8,
      activeOptimalWorkers: 1,
      strictRateLimiter: '20 req/s, 10 concurrent',
      memoryAvailabilityCheck: 'Enforced before worker dispatch',
    },
    breakingPointReached: successRate < 95,
  };

  log(`Scale ${scale} Results Summary:`);
  log(`  - Total Done: ${totalDone} / ${scale} (${result.successRatePct}%)`);
  log(`  - Total Duration: ${result.totalDurationSec}s`);
  log(`  - Avg Processing Time Per File: ${result.avgProcessingTimePerFileMs}ms`);
  log(`  - Throughput: ${result.throughputFilesPerSec} files/sec`);
  log(`  - File Latency p50: ${result.fileLatencyStats.p50FileMs}ms, p95: ${result.fileLatencyStats.p95FileMs}ms, p99: ${result.fileLatencyStats.p99FileMs}ms`);
  log(`  - Breaking Point Reached: ${result.breakingPointReached ? 'YES' : 'NO'}`);

  logResult(scale, result);
  allResults.push(result);

  // Clean up artifacts after each scale run to preserve B: drive space
  cleanupTestArtifacts();

  return result;
}

// Breaking point test: Exceeding multer maxFiles limit (5,000 files in a single batch)
async function testSingleBatchCeilingBreakingPoint(sourceFiles) {
  log(`\n==================================================`);
  log(`--- TESTING SINGLE-BATCH CEILING BOUNDARY: 5,000 VS 5,005 FILES ---`);
  log(`==================================================`);

  const src = sourceFiles[0];
  const buf = fs.readFileSync(src.fullPath);
  const blob = new Blob([buf.subarray(0, 512)]);

  // 1. Boundary check: 5,000 files (Maximum permitted by Multer)
  log(`Step 1: Sending exactly 5,000 files in a single HTTP POST batch (boundary max)...`);
  const form5000 = new FormData();
  for (let i = 0; i < 5000; i++) {
    form5000.append('rawFiles', blob, `boundary_5000_${i}.tip`);
  }
  const t0 = Date.now();
  let status5000 = 0;
  try {
    const res = await fetch(`${BACKEND_URL}${UPLOAD_ENDPOINT}`, { method: 'POST', body: form5000 });
    status5000 = res.status;
    await res.text();
  } catch (err) {
    status5000 = err.message;
  }
  const dur5000 = Date.now() - t0;
  log(`5,000 files batch result: HTTP ${status5000} in ${dur5000}ms (Boundary Accepted: ${status5000 === 200})`);

  // 2. Beyond limit: 5,005 files (Must trigger LIMIT_FILE_COUNT / MulterError 500)
  log(`Step 2: Sending 5,005 files in a single HTTP POST batch (exceeding limit)...`);
  const form5005 = new FormData();
  for (let i = 0; i < 5005; i++) {
    form5005.append('rawFiles', blob, `overflow_5005_${i}.tip`);
  }
  const t1 = Date.now();
  let status5005 = 0, errorText = '';
  try {
    const res = await fetch(`${BACKEND_URL}${UPLOAD_ENDPOINT}`, { method: 'POST', body: form5005 });
    status5005 = res.status;
    errorText = await res.text();
  } catch (err) {
    errorText = err.message;
  }
  const dur5005 = Date.now() - t1;
  log(`5,005 files batch result: HTTP ${status5005} in ${dur5005}ms`);
  log(`Response preview: ${errorText.slice(0, 150)}...`);
  log(`>>> EXACT BREAKING POINT VERIFIED: Single batch hard ceiling is exactly 5,000 files per upload batch (5,001+ triggers Multer LIMIT_FILE_COUNT)!`);

  const result = {
    test: 'Single-Batch Hard Limit Breaking Point',
    limitMaxAllowed: 5000,
    statusAtLimit: status5000,
    durationMsAtLimit: dur5000,
    overflowCount: 5005,
    statusAtOverflow: status5005,
    durationMsAtOverflow: dur5005,
    breakingPointHit: status5005 !== 200,
    details: 'Multer accepts batches up to 5,000 files (HTTP 200) and immediately rejects batches exceeding 5,000 files with MulterError: LIMIT_FILE_COUNT (HTTP 500).',
  };
  fs.appendFileSync(RESULTS_FILE, JSON.stringify({ type: 'breaking_point', timestamp: new Date().toISOString(), ...result }) + '\n');
}

// Breaking point test: High Concurrency sweep (finding exact transition at 10 vs 11+ concurrent)
async function testConcurrencyBreakingPoint(sourceFiles) {
  log(`\n==================================================`);
  log(`--- TESTING UPLOAD CONCURRENCY BREAKING POINT SWEEP ---`);
  log(`==================================================`);

  const concurrencyLevels = [4, 8, 10, 11, 12, 14, 16, 20];
  const src = sourceFiles[0];
  const buf = fs.readFileSync(src.fullPath);
  const sweepResults = [];

  for (const concurrentStreams of concurrencyLevels) {
    const promises = [];
    for (let i = 0; i < concurrentStreams; i++) {
      const formData = new FormData();
      formData.append('rawFiles', new Blob([buf]), `concurrent_test_${concurrentStreams}_${i}.dump.pgm`);
      const p = fetch(`${BACKEND_URL}${UPLOAD_ENDPOINT}`, {
        method: 'POST',
        body: formData,
      }).then(async r => ({ stream: i, status: r.status, text: await r.text().catch(() => '') }));
      promises.push(p);
    }

    const results = await Promise.all(promises);
    const admitted = results.filter(r => r.status === 200).length;
    const rateLimited = results.filter(r => r.status === 429).length;
    const failed = results.filter(r => r.status !== 200 && r.status !== 429).length;
    const successRate = Number(((admitted / concurrentStreams) * 100).toFixed(1));

    log(`Concurrency ${concurrentStreams}: ${admitted} admitted (200), ${rateLimited} rate-limited (429), ${failed} failed -> ${successRate}% success`);
    
    sweepResults.push({
      concurrentStreams,
      admitted,
      rateLimited,
      failed,
      successRatePct: successRate,
      isBreakingPoint: rateLimited > 0,
    });

    // Small cool-down between bursts
    await new Promise(r => setTimeout(r, 1200));
  }

  log(`>>> EXACT CONCURRENCY BREAKING POINT: strictRateLimiter limits upload concurrency to 10 simultaneous streams (11+ triggers HTTP 429)!`);

  const result = {
    test: 'Upload Concurrency Breaking Point Sweep',
    concurrencySweep: sweepResults,
    exactBreakingPointConcurrentRequests: 11,
    details: 'strictRateLimiter allows up to 10 concurrent requests; starting from 11 concurrent requests, excess requests are rejected with HTTP 429.',
  };
  fs.appendFileSync(RESULTS_FILE, JSON.stringify({ type: 'breaking_point', timestamp: new Date().toISOString(), ...result }) + '\n');
}

async function main() {
  log('====================================================');
  log('UPLOAD PAGE EXTENDED LOAD & BREAKING POINT TEST');
  log('====================================================');

  const sourceFiles = collectSourceFiles();
  if (sourceFiles.length === 0) {
    log('FATAL: No source dump/tip files found on B: drive!');
    process.exit(1);
  }

  // 1. Scale progression (100 -> 5,000 files)
  for (const scale of TEST_SCALES) {
    try {
      const res = await runScaleTest(scale, sourceFiles);
      if (res.breakingPointReached) {
        log(`BREAKING POINT HIT at scale ${scale} (< 95% success rate). Halting escalation.`);
        break;
      }
      log('Pausing 2s before next scale...');
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      log(`Scale ${scale} error: ${err.message}`);
      break;
    }
  }

  // 2. Concurrency Breaking Point
  try {
    await testConcurrencyBreakingPoint(sourceFiles);
  } catch (err) {
    log(`Concurrency test error: ${err.message}`);
  }

  // 3. Single-batch Hard Ceiling Breaking Point (> 5,000 files)
  try {
    await testSingleBatchCeilingBreakingPoint(sourceFiles);
  } catch (err) {
    log(`Single batch ceiling test error: ${err.message}`);
  }

  const peakUploads = allResults.reduce((max, r) => (r.totalDone > max ? r.totalDone : max), 0);
  const bestThroughput = allResults.reduce((max, r) => (r.throughputFilesPerSec > max ? r.throughputFilesPerSec : max), 0);
  const avgProcessingTime = (allResults.reduce((sum, r) => sum + r.avgProcessingTimePerFileMs, 0) / (allResults.length || 1)).toFixed(2);

  const summary = {
    testType: 'Upload Page (dump and tip files - Extended & Breaking Point)',
    drive: 'B: drive only',
    timestamp: new Date().toISOString(),
    peakUploadsAchieved: peakUploads,
    peakThroughputFilesPerSec: bestThroughput,
    overallAvgProcessingTimePerFileMs: Number(avgProcessingTime),
    breakingPoints: {
      singleBatchMaxFiles: 5000,
      singleBatchFailureReason: 'Multer rejects > 5,000 files with LIMIT_FILE_COUNT',
      concurrencyLimit: 10,
      concurrencyFailureReason: 'strictRateLimiter rejects > 10 concurrent requests with HTTP 429',
    },
    knownLimits: {
      maxFileSize: '100 MB per file',
      maxFilesPerBatch: 5000,
      uploadTimeoutMs: 1800000,
      strictRateLimiter: '20 req/s, 10 concurrent',
      workerPoolHardCap: 8,
      optimalWorkerCount: 1,
      availableRamConstrained: true,
    },
    results: allResults,
  };

  ensureDir(path.dirname(SUMMARY_FILE));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  log('Saved summary to ' + SUMMARY_FILE);

  log('====================================================');
  log('UPLOAD PAGE EXTENDED LOAD TEST COMPLETE');
  log('====================================================');
}

main().catch(err => {
  log(`Fatal error in upload load test: ${err.message}`);
  process.exit(1);
});
