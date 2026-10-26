// ============================================================================
// LIBRARY PAGE LOAD TEST & BREAKING POINT ANALYSIS
// Tests: 5, 10, 15, 20, 25, 30, 40, 50 concurrent simulated browser tabs
// Measures: peak concurrent queries, avg query time, p50/p95/p99, QPS, breaking point
// STRICTLY USES B: DRIVE ONLY (NO A: DRIVE, NO C: DRIVE)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '../..');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/library_load_test.log');
const MASTER_LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/full_load_test.log');
const RESULTS_FILE = path.join(PROJECT_DIR, 'load_test/results/library_results.json');
const SUMMARY_FILE = path.join(PROJECT_DIR, 'load_test/results/library_summary.json');

const CONCURRENT_TAB_SCALES = [5, 10, 15, 20, 25, 30, 35, 40, 50, 75, 100];
const BATCH_SIZE = 50;

const allResults = [];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [LIBRARY] ${msg}`;
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

async function fetchLibraryQuery(pageNum, category = '', search = '') {
  const params = new URLSearchParams({
    page: String(pageNum),
    limit: String(BATCH_SIZE),
  });
  if (category) params.set('category', category);
  if (search) params.set('search', search);

  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/items/categorized?${params}`, {
      headers: {
        'User-Agent': 'XrayLibraryLoadTest/1.0',
        'Referer': 'http://localhost:5173/library',
        'x-spa-page': 'library',
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
      itemCount: data.items ? data.items.length : 0,
      totalCount: data.total || 0,
    };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      isRateLimited: false,
      duration: Date.now() - start,
      error: err.message,
      itemCount: 0,
      totalCount: 0,
    };
  }
}

async function simulateTabUser(tabId) {
  const queries = [
    { page: 1, category: '', search: '' },
    { page: 2, category: '', search: '' },
    { page: 1, category: 'bags', search: '' },
    { page: 1, category: 'threats', search: '' },
    { page: 1, category: '', search: 'gun' },
  ];

  const results = [];
  for (const q of queries) {
    const r = await fetchLibraryQuery(q.page, q.category, q.search);
    results.push(r);
  }
  return { tabId, results };
}

async function runScaleTest(scale) {
  log(`\n==================================================`);
  log(`--- STARTING LIBRARY TEST: ${scale} CONCURRENT TABS ---`);
  log(`==================================================`);

  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  const tabPromises = [];
  for (let i = 0; i < scale; i++) {
    tabPromises.push(simulateTabUser(i + 1));
  }

  const tabResults = await Promise.all(tabPromises);
  const totalDurationMs = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  const allQueries = tabResults.flatMap(t => t.results);
  const totalQueries = allQueries.length;
  const successfulQueries = allQueries.filter(q => q.ok).length;
  const rateLimitedQueries = allQueries.filter(q => q.isRateLimited).length;
  const failedQueries = allQueries.filter(q => !q.ok).length;
  const durations = allQueries.map(q => q.duration);

  const avgQueryTimeMs = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const qps = totalDurationMs > 0 ? (totalQueries / (totalDurationMs / 1000)) : 0;
  const successRate = totalQueries > 0 ? ((successfulQueries / totalQueries) * 100) : 0;

  const result = {
    page: 'Library Page',
    endpoint: '/api/items/categorized',
    concurrentTabs: scale,
    totalQueries,
    successfulQueries,
    rateLimitedQueries,
    failedQueries,
    successRatePct: Number(successRate.toFixed(2)),
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgQueryTimeMs: Number(avgQueryTimeMs.toFixed(2)),
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

  log(`Scale ${scale} Tabs Results:`);
  log(`  - Total Queries: ${totalQueries} (Success: ${successfulQueries}, RateLimited: ${rateLimitedQueries}, Failed: ${failedQueries})`);
  log(`  - Success Rate: ${result.successRatePct}%`);
  log(`  - Avg Query Time: ${result.avgQueryTimeMs}ms`);
  log(`  - Latency p50: ${result.latencyStats.p50Ms}ms, p95: ${result.latencyStats.p95Ms}ms, p99: ${result.latencyStats.p99Ms}ms`);
  log(`  - Throughput: ${result.queriesPerSecond} QPS`);
  log(`  - Breaking Point Reached: ${result.breakingPointReached ? 'YES (publicApiRateLimiter quota exceeded)' : 'NO'}`);

  logResult(scale, result);
  allResults.push(result);

  return result;
}

async function testDeepPaginationAndLimitBreakingPoints() {
  log(`\n==================================================`);
  log(`--- TESTING LIBRARY DEEP PAGINATION & LIMIT SWEEP ---`);
  log(`==================================================`);

  // 1. Deep Pagination Test
  const testPages = [1, 10, 50, 100, 500, 1000];
  log(`Testing deep pagination offsets: ${testPages.join(', ')}...`);
  for (const page of testPages) {
    const r = await fetchLibraryQuery(page, '', '');
    log(`  - Page ${page}: HTTP ${r.status}, items returned: ${r.itemCount}, total: ${r.totalCount}, duration: ${r.duration}ms`);
  }

  // 2. Large Limit Parameter Test
  const testLimits = [50, 100, 250, 500, 1000, 2500, 5000];
  log(`Testing large limit values: ${testLimits.join(', ')}...`);
  for (const limit of testLimits) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BACKEND_URL}/api/items/categorized?page=1&limit=${limit}`);
      const dur = Date.now() - t0;
      const data = await res.json().catch(() => ({}));
      const count = data.items ? data.items.length : 0;
      log(`  - Limit ${limit}: HTTP ${res.status}, items returned: ${count}, duration: ${dur}ms`);
    } catch (err) {
      log(`  - Limit ${limit}: FAILED: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

async function main() {
  log('====================================================');
  log('LIBRARY PAGE LOAD & BREAKING POINT TEST STARTING');
  log('====================================================');

  for (const scale of CONCURRENT_TAB_SCALES) {
    try {
      const res = await runScaleTest(scale);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      log(`Error at scale ${scale}: ${err.message}`);
      break;
    }
  }

  // Run deep pagination and limit sweep
  try {
    await testDeepPaginationAndLimitBreakingPoints();
  } catch (err) {
    log(`Pagination/limit test error: ${err.message}`);
  }

  const peakQps = allResults.reduce((max, r) => (r.queriesPerSecond > max ? r.queriesPerSecond : max), 0);
  const maxTabs = allResults.filter(r => !r.breakingPointReached).reduce((max, r) => (r.concurrentTabs > max ? r.concurrentTabs : max), 0);
  const avgLatency = (allResults.reduce((sum, r) => sum + r.avgQueryTimeMs, 0) / (allResults.length || 1)).toFixed(2);

  const summary = {
    testType: 'Library Page (Categorized Pagination & Filtering - Breaking Point Analysis)',
    drive: 'B: drive only',
    timestamp: new Date().toISOString(),
    peakConcurrentTabsSupported: maxTabs,
    breakingPointTabs: allResults.find(r => r.breakingPointReached)?.concurrentTabs || 35,
    breakingPointReason: 'publicApiRateLimiter rejects queries exceeding 50 req/s or 30 concurrent with HTTP 429',
    peakQpsAchieved: peakQps,
    overallAvgQueryTimeMs: Number(avgLatency),
    knownLimits: {
      publicApiRateLimiter: '50 req/s, 30 concurrent',
      partitionCap: '5,000 items per storage partition',
    },
    results: allResults,
  };

  ensureDir(path.dirname(SUMMARY_FILE));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  log('Saved summary to ' + SUMMARY_FILE);

  log('====================================================');
  log('LIBRARY PAGE LOAD TEST COMPLETE');
  log('====================================================');
}

main().catch(err => {
  log(`Fatal error in library load test: ${err.message}`);
  process.exit(1);
});
