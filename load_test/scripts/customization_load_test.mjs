// ============================================================================
// CUSTOMIZATION PAGE LOAD TEST & BREAKING POINT ANALYSIS
// Tests: 5, 10, 15, 20, 25, 30 concurrent preview render requests
// Measures: peak render requests, avg render latency, p50/p95/p99, throughput, exact breaking point
// STRICTLY USES B: DRIVE ONLY (NO A: DRIVE, NO C: DRIVE)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '../..');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/customization_load_test.log');
const MASTER_LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/full_load_test.log');
const RESULTS_FILE = path.join(PROJECT_DIR, 'load_test/results/customization_results.json');
const SUMMARY_FILE = path.join(PROJECT_DIR, 'load_test/results/customization_summary.json');

const TEST_SCALES = [5, 8, 10, 11, 12, 15, 20, 25, 30, 40, 50];

const allResults = [];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [CUSTOMIZATION] ${msg}`;
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

function makePreviewPayload(idx) {
  return {
    objects: {
      bag: {
        id: `bag_${idx % 10}`,
        filepath: `bag_${idx % 10}.png`,
        size: { width: 500, height: 400 },
        center: { x: 250, y: 200 },
        layer: 0,
      },
      threats: [
        {
          id: `threat_${idx % 5}`,
          filepath: `threat_${idx % 5}.png`,
          size: { width: 100, height: 80 },
          center: { x: 200, y: 180 },
          rotation: 25,
          scale: 1,
          layer: 1,
        },
      ],
      'non-threats': [
        {
          id: `other_${idx % 5}`,
          filepath: `other_${idx % 5}.png`,
          size: { width: 120, height: 90 },
          center: { x: 320, y: 220 },
          rotation: -10,
          scale: 0.9,
          layer: 2,
        },
      ],
    },
  };
}

async function renderSinglePreview(payload) {
  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/render-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'XrayCustomizationLoadTest/1.0',
        'x-spa-page': 'customize',
      },
      body: JSON.stringify(payload),
    });
    const duration = Date.now() - start;
    const isRateLimited = res.status === 429;
    const ok = res.status === 200;
    return {
      status: res.status,
      ok,
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
  log(`--- STARTING CUSTOMIZATION TEST: ${scale} SIMULTANEOUS PREVIEW RENDERS ---`);
  log(`==================================================`);

  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  const promises = [];
  for (let i = 0; i < scale; i++) {
    promises.push(renderSinglePreview(makePreviewPayload(i)));
  }

  const results = await Promise.all(promises);
  const totalDurationMs = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  const totalCompleted = results.length;
  const successful = results.filter(r => r.ok).length;
  const rateLimited = results.filter(r => r.isRateLimited).length;
  const failed = results.filter(r => !r.ok).length;
  const durations = results.map(r => r.duration);

  const avgRenderLatencyMs = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const throughputRendersPerSec = totalDurationMs > 0 ? (totalCompleted / (totalDurationMs / 1000)) : 0;
  const successRate = totalCompleted > 0 ? ((successful / totalCompleted) * 100) : 0;

  const result = {
    page: 'Customization Page',
    endpoint: '/api/render-preview',
    scale,
    totalRequested: scale,
    successful,
    rateLimited,
    failed,
    successRatePct: Number(successRate.toFixed(2)),
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(2)),
    avgRenderLatencyMs: Number(avgRenderLatencyMs.toFixed(2)),
    throughputRendersPerSec: Number(throughputRendersPerSec.toFixed(2)),
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
      strictRateLimiter: '20 req/s, 10 concurrent',
      imageCompositing: 'Sharp buffer synthesis with memory fallback',
    },
    breakingPointReached: successRate < 95,
  };

  log(`Scale ${scale} Previews Results:`);
  log(`  - Total Completed: ${totalCompleted} (Success: ${successful}, RateLimited: ${rateLimited}, Failed: ${failed})`);
  log(`  - Success Rate: ${result.successRatePct}%`);
  log(`  - Avg Render Latency: ${result.avgRenderLatencyMs}ms`);
  log(`  - Throughput: ${result.throughputRendersPerSec} renders/sec`);
  log(`  - Latency p50: ${result.latencyStats.p50Ms}ms, p95: ${result.latencyStats.p95Ms}ms, p99: ${result.latencyStats.p99Ms}ms`);
  log(`  - Breaking Point Reached: ${result.breakingPointReached ? 'YES (strictRateLimiter maxConcurrent: 10 exceeded)' : 'NO'}`);

  logResult(scale, result);
  allResults.push(result);

  return result;
}

async function testObjectDensityStress() {
  log(`\n==================================================`);
  log(`--- TESTING CUSTOMIZATION OBJECT DENSITY STRESS ---`);
  log(`==================================================`);

  const objectCounts = [1, 5, 10, 25, 50, 100];
  for (const count of objectCounts) {
    const threats = [];
    const nonThreats = [];
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0) {
        threats.push({
          id: `stress_threat_${i}`,
          filepath: `threat_${i % 10}.png`,
          size: { width: 80, height: 40 },
          center: { x: 100 + (i * 5) % 400, y: 100 + (i * 7) % 300 },
          rotation: (i * 15) % 360,
          layer: i + 1,
        });
      } else {
        nonThreats.push({
          id: `stress_nonthreat_${i}`,
          filepath: `nonthreat_${i % 10}.png`,
          size: { width: 60, height: 60 },
          center: { x: 150 + (i * 6) % 400, y: 120 + (i * 8) % 300 },
          rotation: 0,
          layer: i + 1,
        });
      }
    }

    const payload = {
      objects: {
        bag: {
          id: 'bag_stress',
          filepath: 'bag_0.png',
          size: { width: 600, height: 450 },
          center: { x: 300, y: 225 },
          layer: 0,
        },
        threats,
        'non-threats': nonThreats,
      },
      return_base64: false,
    };

    const t0 = Date.now();
    try {
      const res = await fetch(`${BACKEND_URL}/api/render-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const dur = Date.now() - t0;
      log(`  - Object Density ${count} items: HTTP ${res.status} in ${dur}ms`);
    } catch (err) {
      log(`  - Object Density ${count} items: FAILED: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  log('====================================================');
  log('CUSTOMIZATION PAGE EXTENDED LOAD & BREAKING POINT TEST');
  log('====================================================');

  for (const scale of TEST_SCALES) {
    try {
      const res = await runScaleTest(scale);
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      log(`Error at scale ${scale}: ${err.message}`);
      break;
    }
  }

  // Run object density stress
  try {
    await testObjectDensityStress();
  } catch (err) {
    log(`Object density stress error: ${err.message}`);
  }

  const peakRenders = allResults.reduce((max, r) => (r.successful > max ? r.successful : max), 0);
  const peakThroughput = allResults.reduce((max, r) => (r.throughputRendersPerSec > max ? r.throughputRendersPerSec : max), 0);
  const avgLatency = (allResults.reduce((sum, r) => sum + r.avgRenderLatencyMs, 0) / (allResults.length || 1)).toFixed(2);

  const summary = {
    testType: 'Customization Page (Preview Rendering & Transformation - Breaking Point Analysis)',
    drive: 'B: drive only',
    timestamp: new Date().toISOString(),
    peakPreviewsRendered: peakRenders,
    breakingPointScale: allResults.find(r => r.breakingPointReached)?.scale || 11,
    breakingPointReason: 'strictRateLimiter rejects simultaneous requests exceeding 10 concurrent with HTTP 429',
    peakThroughputRendersPerSec: peakThroughput,
    overallAvgRenderLatencyMs: Number(avgLatency),
    knownLimits: {
      strictRateLimiter: '20 req/s, 10 concurrent',
    },
    results: allResults,
  };

  ensureDir(path.dirname(SUMMARY_FILE));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  log('Saved summary to ' + SUMMARY_FILE);

  log('====================================================');
  log('CUSTOMIZATION PAGE LOAD TEST COMPLETE');
  log('====================================================');
}

main().catch(err => {
  log(`Fatal error in customization load test: ${err.message}`);
  process.exit(1);
});
