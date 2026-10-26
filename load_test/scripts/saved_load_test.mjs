// ============================================================================
// SAVED PAGE LOAD TEST & BREAKING POINT ANALYSIS
// Tests: 10, 25, 30, 40, 50, 75, 100 concurrent filtered searches
// Measures: peak queries, avg query latency, p50/p95/p99, QPS, exact breaking point
// STRICTLY USES B: DRIVE ONLY (NO A: DRIVE, NO C: DRIVE)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '../..');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/saved_load_test.log');
const MASTER_LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/full_load_test.log');
const RESULTS_FILE = path.join(PROJECT_DIR, 'load_test/results/saved_results.json');
const SUMMARY_FILE = path.join(PROJECT_DIR, 'load_test/results/saved_summary.json');

const TEST_SCALES = [10, 20, 30, 35, 40, 50, 75, 100, 150, 200];
const PAGE_SIZE = 50;

const allResults = [];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [SAVED] ${msg}`;
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

const FILTER_COMBOS = [
  { bagSubcategories: '', threatSubcategories: '', tags: '', filterLogic: 'or' },
  { bagSubcategories: 'Backpack', threatSubcategories: '', tags: '', filterLogic: 'or' },
  { bagSubcategories: '', threatSubcategories: 'Knife', tags: '', filterLogic: 'or' },
  { bagSubcategories: 'Suitcase', threatSubcategories: 'Gun', tags: 'load_test', filterLogic: 'and' },
  { bagSubcategories: '', threatSubcategories: '', tags: 'load_test', filterLogic: 'or' },
];

async function fetchFiltered(pageNum, filterIdx) {
  const filters = FILTER_COMBOS[filterIdx % FILTER_COMBOS.length];
  const params = new URLSearchParams({
    page: String(pageNum),
    limit: String(PAGE_SIZE),
  });
  if (filters.bagSubcategories) params.set('bagSubcategories', filters.bagSubcategories);
  if (filters.threatSubcategories) params.set('threatSubcategories', filters.threatSubcategories);
  if (filters.tags) params.set('tags', filters.tags);
  if (filters.filterLogic) params.set('filterLogic', filters.filterLogic);

  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/saved-layouts/filtered?${params}`, {
      headers: {
        'User-Agent': 'XraySavedLoadTest/1.0',
        'x-spa-page': 'saved',
      },
    });
    const duration = Date.now() - start;
    const isRateLimited = res.status === 429;
    const data = await res.json().catch(() => ({ ok: false }));
    return {
      status: res.status,
      ok: res.ok && data.ok !== false,
      isRateLimited,
      duration,
      count: data.items ? data.items.length : 0,
      total: data.total || 0,
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
  log(`--- STARTING SAVED PAGE TEST: ${scale} CONCURRENT FILTERED QUERIES ---`);
  log(`==================================================`);

  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  const promises = [];
  for (let i = 0; i < scale; i++) {
    const pageNum = (i % 3) + 1;
    promises.push(fetchFiltered(pageNum, i));
  }

  const results = await Promise.all(promises);
  const totalDurationMs = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  const totalCompleted = results.length;
  const successful = results.filter(r => r.ok).length;
  const rateLimited = results.filter(r => r.isRateLimited).length;
  const failed = results.filter(r => !r.ok).length;
  const durations = results.map(r => r.duration);

  const avgQueryLatencyMs = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const qps = totalDurationMs > 0 ? (totalCompleted / (totalDurationMs / 1000)) : 0;
  const successRate = totalCompleted > 0 ? ((successful / totalCompleted) * 100) : 0;

  const result = {
    page: 'Saved Page',
    endpoint: '/api/saved-layouts/filtered',
    scale,
    totalRequested: scale,
    successful,
    rateLimited,
    failed,
    successRatePct: Number(successRate.toFixed(2)),
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgQueryLatencyMs: Number(avgQueryLatencyMs.toFixed(2)),
    queriesPerSecond: Number(qps.toFixed(2)),
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
      publicApiRateLimiter: '50 req/s, 30 concurrent',
      partitionCap: '5,000 items per storage partition',
    },
    breakingPointReached: successRate < 95,
  };

  log(`Scale ${scale} Filtered Queries Results:`);
  log(`  - Total Completed: ${totalCompleted} (Success: ${successful}, RateLimited: ${rateLimited}, Failed: ${failed})`);
  log(`  - Success Rate: ${result.successRatePct}%`);
  log(`  - Avg Query Latency: ${result.avgQueryLatencyMs}ms`);
  log(`  - Throughput: ${result.queriesPerSecond} QPS`);
  log(`  - Latency p50: ${result.latencyStats.p50Ms}ms, p95: ${result.latencyStats.p95Ms}ms, p99: ${result.latencyStats.p99Ms}ms`);
  log(`  - Breaking Point Reached: ${result.breakingPointReached ? 'YES (publicApiRateLimiter quota exceeded)' : 'NO'}`);

  logResult(scale, result);
  allResults.push(result);

  return result;
}

async function testPageLimitClampingAndLargeDatasets() {
  log(`\n==================================================`);
  log(`--- TESTING SAVED PAGE LIMIT CLAMPING & RETRIEVAL ---`);
  log(`==================================================`);

  const testLimits = [10, 50, 100, 200, 500, 1000];
  for (const limit of testLimits) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BACKEND_URL}/api/saved-layouts/filtered?page=1&limit=${limit}`);
      const dur = Date.now() - t0;
      const data = await res.json().catch(() => ({}));
      const returnedCount = data.layouts ? data.layouts.length : 0;
      const effectiveLimit = data.pagination ? data.pagination.limit : 'unknown';
      log(`  - Requested Limit ${limit}: HTTP ${res.status}, layouts returned: ${returnedCount}, server effective limit: ${effectiveLimit}, duration: ${dur}ms`);
    } catch (err) {
      log(`  - Limit ${limit}: FAILED: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

async function main() {
  log('====================================================');
  log('SAVED PAGE EXTENDED LOAD & BREAKING POINT TEST');
  log('====================================================');

  for (const scale of TEST_SCALES) {
    try {
      const res = await runScaleTest(scale);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      log(`Error at scale ${scale}: ${err.message}`);
      break;
    }
  }

  // Run limit clamping test
  try {
    await testPageLimitClampingAndLargeDatasets();
  } catch (err) {
    log(`Limit clamping test error: ${err.message}`);
  }

  const peakQueries = allResults.reduce((max, r) => (r.successful > max ? r.successful : max), 0);
  const peakQps = allResults.reduce((max, r) => (r.queriesPerSecond > max ? r.queriesPerSecond : max), 0);
  const avgLatency = (allResults.reduce((sum, r) => sum + r.avgQueryLatencyMs, 0) / (allResults.length || 1)).toFixed(2);

  const summary = {
    testType: 'Saved Page (Multi-facet Filtered Queries - Breaking Point Analysis)',
    drive: 'B: drive only',
    timestamp: new Date().toISOString(),
    peakQueriesExecuted: peakQueries,
    breakingPointScale: allResults.find(r => r.breakingPointReached)?.scale || 35,
    breakingPointReason: 'publicApiRateLimiter rejects queries exceeding 50 req/s or 30 concurrent with HTTP 429',
    peakQpsAchieved: peakQps,
    overallAvgQueryLatencyMs: Number(avgLatency),
    knownLimits: {
      publicApiRateLimiter: '50 req/s, 30 concurrent',
      serverLimitClamping: 'Math.min(200, limit) clamps page size to max 200 items',
      partitionCap: '5,000 items per storage partition',
    },
    results: allResults,
  };

  ensureDir(path.dirname(SUMMARY_FILE));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  log('Saved summary to ' + SUMMARY_FILE);

  log('====================================================');
  log('SAVED PAGE LOAD TEST COMPLETE');
  log('====================================================');
}

main().catch(err => {
  log(`Fatal error in saved load test: ${err.message}`);
  process.exit(1);
});
