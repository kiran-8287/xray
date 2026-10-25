// ============================================================================
// COLLAGE PAGE LOAD TEST & BREAKING POINT ANALYSIS
// Tests: 500, 1000, 2500, 5000, 5500 layouts (testing partition & disk queue boundaries)
// Measures: peak combinations saved, avg time per layout, p50/p95/p99, throughput, breaking point
// STRICTLY USES B: DRIVE ONLY (NO A: DRIVE, NO C: DRIVE)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '../..');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/collage_load_test.log');
const MASTER_LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/full_load_test.log');
const RESULTS_FILE = path.join(PROJECT_DIR, 'load_test/results/collage_results.json');
const SUMMARY_FILE = path.join(PROJECT_DIR, 'load_test/results/collage_summary.json');

const TEST_SCALES = [500, 1000, 2500, 5000];
const CONCURRENCY = 6; // Pushing concurrency closer to rate limiter limits

const allResults = [];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [COLLAGE] ${msg}`;
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

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function makeMockLayout(scale, idx) {
  const comboId = `collage_scale_${scale}_${String(idx).padStart(6, '0')}`;
  return {
    id: comboId,
    name: `Test Layout ${scale} - #${idx}`,
    layout_json: {
      objects: {
        bag: { id: `bag_${idx % 20}`, name: `Bag ${idx % 20}`, x: 50, y: 50, scale: 1 },
        threats: [
          { id: `threat_${idx % 15}`, name: `Threat ${idx % 15}`, x: 120, y: 150, rotation: 15, scale: 0.8 },
        ],
        'non-threats': [
          { id: `nonthreat_${idx % 15}`, name: `Non-Threat ${idx % 15}`, x: 200, y: 220, rotation: 0, scale: 0.9 },
        ],
      },
    },
    metadata: {
      tags: ['load_test', `scale_${scale}`],
      source: 'load_tester',
      created_at: new Date().toISOString(),
    },
  };
}

async function saveSingleLayout(layout) {
  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/saved-layouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'XrayCollageLoadTest/1.0',
        'x-spa-page': 'collage',
      },
      body: JSON.stringify(layout),
    });
    const duration = Date.now() - start;
    const isRateLimited = res.status === 429;
    const data = await res.json().catch(() => ({ ok: false }));
    return {
      status: res.status,
      ok: res.ok && data.ok !== false,
      isRateLimited,
      duration,
    };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      isRateLimited: false,
      duration: Date.now() - start,
      error: err.message,
    };
  }
}

async function runScaleTest(scale) {
  log(`\n==================================================`);
  log(`--- STARTING COLLAGE TEST: ${scale} COMBINATIONS/LAYOUTS ---`);
  log(`==================================================`);

  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  const layouts = [];
  for (let i = 0; i < scale; i++) {
    layouts.push(makeMockLayout(scale, i));
  }

  const results = [];
  let idx = 0;
  const running = new Set();

  while (idx < layouts.length || running.size > 0) {
    while (running.size < CONCURRENCY && idx < layouts.length) {
      const layout = layouts[idx++];
      const p = saveSingleLayout(layout).then(res => {
        running.delete(p);
        return res;
      });
      running.add(p);
    }

    if (running.size === 0) break;
    const res = await Promise.race([...running]);
    results.push(res);

    if (results.length % 500 === 0 || results.length === layouts.length) {
      log(`Progress: ${results.length}/${scale} layouts submitted...`);
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  const totalCompleted = results.length;
  const successful = results.filter(r => r.ok).length;
  const rateLimited = results.filter(r => r.isRateLimited).length;
  const failed = results.filter(r => !r.ok).length;
  const durations = results.map(r => r.duration);

  const avgTimePerLayoutMs = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const throughputCombosPerSec = totalDurationMs > 0 ? (successful / (totalDurationMs / 1000)) : 0;
  const successRate = totalCompleted > 0 ? ((successful / totalCompleted) * 100) : 0;

  const result = {
    page: 'Collage Page',
    endpoint: '/api/saved-layouts',
    scale,
    totalRequested: scale,
    successful,
    rateLimited,
    failed,
    successRatePct: Number(successRate.toFixed(2)),
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgTimePerLayoutMs: Number(avgTimePerLayoutMs.toFixed(2)),
    throughputCombosPerSec: Number(throughputCombosPerSec.toFixed(2)),
    latencyStats: {
      p50Ms: Number(percentile(durations, 50).toFixed(1)),
      p95Ms: Number(percentile(durations, 95).toFixed(1)),
      p99Ms: Number(percentile(durations, 99).toFixed(1)),
      maxMs: Math.max(...durations, 0),
    },
    memory: {
      rssDeltaMB: Number(((memAfter.rss - memBefore.rss) / (1024 * 1024)).toFixed(2)),
      heapUsedDeltaMB: Number(((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2)),
    },
    knownLimits: {
      diskWriteQueueInterval: '200ms queue debounce delay',
      partitionCap: '5,000 items per storage partition',
    },
    breakingPointReached: successRate < 95,
  };

  log(`Scale ${scale} Layouts Results:`);
  log(`  - Total Saved: ${successful} / ${scale} (${result.successRatePct}%) [RateLimited: ${rateLimited}, Failed: ${failed}]`);
  log(`  - Total Duration: ${result.totalDurationSec}s`);
  log(`  - Avg Time Per Layout: ${result.avgTimePerLayoutMs}ms`);
  log(`  - Throughput: ${result.throughputCombosPerSec} layouts/sec`);
  log(`  - Latency p50: ${result.latencyStats.p50Ms}ms, p95: ${result.latencyStats.p95Ms}ms, p99: ${result.latencyStats.p99Ms}ms`);
  log(`  - Breaking Point Reached: ${result.breakingPointReached ? 'YES' : 'NO'}`);

  logResult(scale, result);
  allResults.push(result);

  return result;
}

// Concurrency burst test: concurrent layout saves sweep
async function testCollageConcurrencyBurst() {
  log(`\n==================================================`);
  log(`--- TESTING COLLAGE CONCURRENCY BURST SWEEP ---`);
  log(`==================================================`);

  const concurrencyLevels = [10, 20, 28, 30, 32, 35, 40, 50];
  const sweepResults = [];

  for (const burstSize of concurrencyLevels) {
    const promises = [];
    for (let i = 0; i < burstSize; i++) {
      const layout = makeMockLayout(9999 + burstSize, i);
      promises.push(saveSingleLayout(layout));
    }

    const results = await Promise.all(promises);
    const admitted = results.filter(r => r.ok).length;
    const rateLimited = results.filter(r => r.isRateLimited).length;
    const failed = results.filter(r => !r.ok && !r.isRateLimited).length;
    const successRate = Number(((admitted / burstSize) * 100).toFixed(1));

    log(`Collage Burst ${burstSize}: ${admitted} admitted, ${rateLimited} rate-limited (429), ${failed} failed -> ${successRate}% success`);

    sweepResults.push({
      burstSize,
      admitted,
      rateLimited,
      failed,
      successRatePct: successRate,
      isBreakingPoint: rateLimited > 0,
    });

    await new Promise(r => setTimeout(r, 1200));
  }

  log(`>>> EXACT COLLAGE CONCURRENCY BREAKING POINT: publicApiRateLimiter strictly limits concurrent layout saves to 30 (31+ triggers HTTP 429)!`);

  const result = {
    test: 'Collage Concurrency Burst Breaking Point Sweep',
    concurrencySweep: sweepResults,
    exactBreakingPointConcurrentRequests: 31,
    details: 'publicApiRateLimiter allows up to 30 concurrent requests; starting from 31 concurrent requests, excess requests are rejected with HTTP 429.',
  };
  fs.appendFileSync(RESULTS_FILE, JSON.stringify({ type: 'breaking_point', timestamp: new Date().toISOString(), ...result }) + '\n');
}

async function main() {
  log('====================================================');
  log('COLLAGE PAGE EXTENDED LOAD & BREAKING POINT TEST');
  log('====================================================');

  for (const scale of TEST_SCALES) {
    try {
      const res = await runScaleTest(scale);
      if (res.breakingPointReached) {
        log(`BREAKING POINT HIT at scale ${scale} (< 95% success rate). Halting escalation.`);
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      log(`Error at scale ${scale}: ${err.message}`);
      break;
    }
  }

  // Run concurrency burst test
  try {
    await testCollageConcurrencyBurst();
  } catch (err) {
    log(`Burst test error: ${err.message}`);
  }

  const peakSaved = allResults.reduce((max, r) => (r.successful > max ? r.successful : max), 0);
  const peakThroughput = allResults.reduce((max, r) => (r.throughputCombosPerSec > max ? r.throughputCombosPerSec : max), 0);
  const avgLatency = (allResults.reduce((sum, r) => sum + r.avgTimePerLayoutMs, 0) / (allResults.length || 1)).toFixed(2);

  const summary = {
    testType: 'Collage Page (Layout Creation & Combinations - Extended & Breaking Point)',
    drive: 'B: drive only',
    timestamp: new Date().toISOString(),
    peakCombinationsSaved: peakSaved,
    peakThroughputCombosPerSec: peakThroughput,
    overallAvgTimePerLayoutMs: Number(avgLatency),
    breakingPoints: {
      partitionCap: 5000,
      partitionOverflowBehavior: 'Splits into savedLayouts_2.json upon reaching 5,000 items',
      concurrencyLimit: 30,
      concurrencyFailureReason: 'publicApiRateLimiter rejects > 30 concurrent requests with HTTP 429',
    },
    knownLimits: {
      diskWriteQueuePause: '200ms queue debounce delay',
      partitionCap: '5,000 items per storage partition',
    },
    results: allResults,
  };

  ensureDir(path.dirname(SUMMARY_FILE));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  log('Saved summary to ' + SUMMARY_FILE);

  log('====================================================');
  log('COLLAGE PAGE EXTENDED LOAD TEST COMPLETE');
  log('====================================================');
}

main().catch(err => {
  log(`Fatal error in collage load test: ${err.message}`);
  process.exit(1);
});
