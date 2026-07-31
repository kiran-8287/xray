/**
 * 1-Hour Stress Test & API Timeout Harness
 * 
 * Executes recursive long-running API calls to monitor memory, cache,
 * buffer sizes, and breaking points over a 1-hour time window.
 * 
 * Self-contained script (does not depend on stress-test.mjs imports
 * that would trigger side effects).
 * 
 * Phases:
 *   Phase 1 (0-5 min):   Warmup — 5 concurrent, simple GETs
 *   Phase 2 (5-20 min):  Ramp — 10→50 concurrent, mixed GET/POST
 *   Phase 3 (20-40 min): Sustained — 50→200 concurrent, write-heavy
 *   Phase 4 (40-55 min): Breaking Point — escalate until failure
 *   Phase 5 (55-60 min): Cooldown — monitor recovery
 * 
 * Usage:
 *   node perf/stress_timeout_loop.mjs
 *   node perf/stress_timeout_loop.mjs --quick          # 10-minute version
 *   node perf/stress_timeout_loop.mjs --target http://localhost:3000
 *   node perf/stress_timeout_loop.mjs --phase 2        # Start from specific phase
 *   node perf/stress_timeout_loop.mjs --dry-run         # Print plan, don't execute
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:8080';
const REPORTS_DIR = path.join(__dirname, 'reports');

// Parse CLI args
const args = process.argv.slice(2);
const QUICK_MODE = args.includes('--quick');
const DRY_RUN = args.includes('--dry-run');
const START_PHASE = args.includes('--phase')
  ? parseInt(args[args.indexOf('--phase') + 1], 10) || 1
  : 1;

const targetUrlIndex = args.indexOf('--target');
const BASE_URL = targetUrlIndex >= 0 ? args[targetUrlIndex + 1] : TARGET_URL;

// Time configuration
const PHASE_DURATIONS = QUICK_MODE
  ? {
      warmup: 30_000,        // 30s
      ramp: 120_000,         // 2min
      sustained: 180_000,    // 3min
      breaking: 180_000,     // 3min
      cooldown: 60_000,      // 1min
      total: 570_000,        // 9.5min
    }
  : {
      warmup: 300_000,       // 5min
      ramp: 900_000,         // 15min
      sustained: 1_200_000,  // 20min
      breaking: 900_000,     // 15min
      cooldown: 300_000,     // 5min
      total: 3_600_000,      // 1 hour
    };

const MAX_DURATION_MS = PHASE_DURATIONS.total;

// Breaking point thresholds
const THRESHOLDS = {
  errorRate60s: 0.50,        // >50% errors over 60s window
  memoryGrowthMB: 500,       // >500MB RSS growth from baseline
  responseTimeMs: 30_000,    // p95 > 30s
  consecutiveTimeouts: 15,   // 15 in a row (was 3 — too sensitive to non-timeout errors)
  heapUsageRatio: 0.90,      // heapUsed > 90% of heapTotal
  freeSystemMB: 500,         // <500MB free system memory
  concurrentMax: 200,        // >200 concurrent requests
};

// ──────────────────────────────────────────────
// HTTP Helper (copied from stress-test.mjs to avoid import side effects)
// ──────────────────────────────────────────────

export async function apiRequest(method, urlPath, body = null, contentType = null, retries = 2) {
  const url = new URL(urlPath, BASE_URL);

  async function attempt() {
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;

      const headers = {
        'Connection': 'close',
        'Accept': 'application/json',
      };

      if (body && contentType) {
        headers['Content-Type'] = contentType;
        headers['Content-Length'] = Buffer.byteLength(body);
      } else if (body && !contentType) {
        const jsonBody = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(jsonBody);
        body = jsonBody;
      }

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 30000,
      };

      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch {}
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            data: parsed,
            raw: data,
            timing: {
              start: startTime,
              end: Date.now(),
              duration_ms: Date.now() - startTime,
            },
          });
        });
      });

      const startTime = Date.now();
      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout after 30000ms: ${method} ${urlPath}`));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  try {
    return await attempt();
  } catch (err) {
    if (retries > 0 && (err.code === 'ECONNRESET' || err.message.includes('Timeout'))) {
      await new Promise(r => setTimeout(r, 500));
      return apiRequest(method, urlPath, body, contentType, retries - 1);
    }
    throw err;
  }
}

// ──────────────────────────────────────────────
// Memory Tracker (copied from stress-test.mjs)
// ──────────────────────────────────────────────

export class MemoryTracker {
  constructor() {
    this.snapshots = [];
  }

  snapshot(label) {
    const mem = process.memoryUsage();
    this.snapshots.push({
      label,
      timestamp: Date.now(),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heapUsed_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024),
      freeSystemMB: Math.round(os.freemem() / 1024 / 1024),
    });
  }

  detectLeak() {
    if (this.snapshots.length < 3) return { leaking: false };

    const heapValues = this.snapshots.map(s => s.heapUsed_mb);
    let growthCount = 0;
    for (let i = 1; i < heapValues.length; i++) {
      if (heapValues[i] > heapValues[i - 1] + 5) growthCount++;
    }

    const consecutiveGrowth = growthCount >= this.snapshots.length - 2;
    const totalGrowth = heapValues[heapValues.length - 1] - heapValues[0];

    return {
      leaking: consecutiveGrowth && totalGrowth > 50,
      totalGrowth_mb: Math.round(totalGrowth),
      growthCount,
      snapshotCount: this.snapshots.length,
      consecutiveGrowth,
    };
  }

  getPeakRSS() {
    return Math.max(...this.snapshots.map(s => s.rss_mb));
  }

  getFinalReport() {
    return {
      peakRSS_mb: this.getPeakRSS(),
      snapshotCount: this.snapshots.length,
      leakAnalysis: this.detectLeak(),
    };
  }
}

// ──────────────────────────────────────────────
// System Monitor (background interval)
// ──────────────────────────────────────────────

class SystemMonitor {
  constructor() {
    this.snapshots = [];
    this.responseTimes = [];       // { timestamp, ms, endpoint, status }
    this.errorWindow = [];         // rolling 60s window: { timestamp, isError }
    this.activeRequests = 0;
    this.consecutiveTimeouts = 0;
    this.intervalId = null;
    this.startTime = Date.now();
    this.baselineMem = process.memoryUsage();
    this.baselineFreeMem = os.freemem();
  }

  start() {
    this.intervalId = setInterval(() => this._collect(), 5000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  _collect() {
    const mem = process.memoryUsage();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const cpuLoad = cpus.reduce((sum, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return sum + (1 - idle / total);
    }, 0) / cpus.length;

    this.snapshots.push({
      timestamp: Date.now(),
      elapsed_ms: Date.now() - this.startTime,
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heapUsed_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024),
      freeSystemMB: Math.round(freeMem / 1024 / 1024),
      cpuLoad: Math.round(cpuLoad * 100),
      activeRequests: this.activeRequests,
      consecutiveTimeouts: this.consecutiveTimeouts,
    });
  }

  recordResponse(ms, endpoint, status) {
    // Lightweight metric: records latency sample with status for percentile / endpoint tracking.
    // DOES NOT touch errorWindow or consecutiveTimeouts — those are managed exclusively by
    // recordSuccess / recordError / recordTimeout so classification is explicit and unambiguous.
    this.responseTimes.push({ timestamp: Date.now(), ms, endpoint, status });
  }

  recordTimeout() {
    // TRUE TIMEOUT: no response received within request timeout window
    // (network hang, server unresponsive, socket error, etc.)
    // Increments the consecutive-timeout breaker.
    this.consecutiveTimeouts++;
    this.errorWindow.push({ timestamp: Date.now(), isError: true });
    this._pruneErrorWindow();
  }

  recordError(status) {
    // ERROR RESPONSE (non-2xx): server RESPONDED quickly, but with 4xx/5xx.
    // This is an APPLICATION error, NOT a timeout — do NOT increment consecutiveTimeouts,
    // but DO reset the streak (the server is clearly still reachable).
    // Still count it in the rolling error-rate window.
    this.consecutiveTimeouts = 0;
    if (status === undefined || status === 0 || status >= 400) {
      this.errorWindow.push({ timestamp: Date.now(), isError: true });
    } else {
      this.errorWindow.push({ timestamp: Date.now(), isError: false });
    }
    this._pruneErrorWindow();
  }

  recordSuccess() {
    // 2xx response: server healthy. Reset timeout streak, no error in window.
    this.consecutiveTimeouts = 0;
    this.errorWindow.push({ timestamp: Date.now(), isError: false });
    this._pruneErrorWindow();
  }

  _pruneErrorWindow() {
    const cutoff = Date.now() - 60_000;
    while (this.errorWindow.length > 0 && this.errorWindow[0].timestamp < cutoff) {
      this.errorWindow.shift();
    }
  }

  getErrorRate() {
    if (this.errorWindow.length === 0) return 0;
    const errors = this.errorWindow.filter(e => e.isError).length;
    return errors / this.errorWindow.length;
  }

  getResponseTimePercentiles() {
    const recent = this.responseTimes.slice(-100);
    if (recent.length === 0) return { p50: 0, p95: 0, p99: 0 };
    const sorted = [...recent].map(r => r.ms).sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
    };
  }

  getMemoryGrowthMB() {
    const current = process.memoryUsage();
    return Math.round((current.rss - this.baselineMem.rss) / 1024 / 1024);
  }

  getHeapUsageRatio() {
    const mem = process.memoryUsage();
    return mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;
  }

  checkBreakingConditions() {
    const issues = [];

    const errorRate = this.getErrorRate();
    if (errorRate > THRESHOLDS.errorRate60s) {
      issues.push(`Error rate ${(errorRate * 100).toFixed(0)}% exceeds threshold ${(THRESHOLDS.errorRate60s * 100).toFixed(0)}%`);
    }

    const memGrowth = this.getMemoryGrowthMB();
    if (memGrowth > THRESHOLDS.memoryGrowthMB) {
      issues.push(`Memory growth ${memGrowth}MB exceeds threshold ${THRESHOLDS.memoryGrowthMB}MB`);
    }

    const percentiles = this.getResponseTimePercentiles();
    if (percentiles.p95 > THRESHOLDS.responseTimeMs) {
      issues.push(`p95 response time ${percentiles.p95}ms exceeds threshold ${THRESHOLDS.responseTimeMs}ms`);
    }

    if (this.consecutiveTimeouts >= THRESHOLDS.consecutiveTimeouts) {
      issues.push(`${this.consecutiveTimeouts} consecutive timeouts`);
    }

    const heapRatio = this.getHeapUsageRatio();
    if (heapRatio > THRESHOLDS.heapUsageRatio) {
      issues.push(`Heap usage ${(heapRatio * 100).toFixed(0)}% exceeds threshold ${(THRESHOLDS.heapUsageRatio * 100).toFixed(0)}%`);
    }

    const freeMem = os.freemem() / 1024 / 1024;
    if (freeMem < THRESHOLDS.freeSystemMB) {
      issues.push(`Free system memory ${Math.round(freeMem)}MB below threshold ${THRESHOLDS.freeSystemMB}MB`);
    }

    if (this.activeRequests > THRESHOLDS.concurrentMax) {
      issues.push(`Concurrent requests ${this.activeRequests} exceeds threshold ${THRESHOLDS.concurrentMax}`);
    }

    return {
      breaking: issues.length > 0,
      issues,
      errorRate,
      memoryGrowthMB: memGrowth,
      p95Ms: percentiles.p95,
      consecutiveTimeouts: this.consecutiveTimeouts,
      heapRatio,
      freeSystemMB: Math.round(freeMem),
      activeRequests: this.activeRequests,
    };
  }

  getSummary() {
    const percentiles = this.getResponseTimePercentiles();
    return {
      snapshots: this.snapshots,
      totalResponses: this.responseTimes.length,
      responseTimePercentiles: percentiles,
      peakRSS_mb: this.snapshots.length > 0 ? Math.max(...this.snapshots.map(s => s.rss_mb)) : 0,
      peakHeap_mb: this.snapshots.length > 0 ? Math.max(...this.snapshots.map(s => s.heapUsed_mb)) : 0,
      finalMemoryGrowth_mb: this.getMemoryGrowthMB(),
      peakConcurrency: this.snapshots.length > 0 ? Math.max(...this.snapshots.map(s => s.activeRequests)) : 0,
      peakCpuLoad: this.snapshots.length > 0 ? Math.max(...this.snapshots.map(s => s.cpuLoad)) : 0,
    };
  }
}

// ──────────────────────────────────────────────
// API Call Patterns (recursive/long-running)
// ──────────────────────────────────────────────

/**
 * Pattern A: Paginated read — GET /api/items/categorized
 * Recursively fetches pages until all items are consumed.
 */
async function patternPaginatedRead(monitor) {
  const results = [];
  let page = 1;
  let totalPages = 1;
  const errors = [];

  while (page <= totalPages) {
    const start = Date.now();
    try {
      const res = await apiRequest('GET', `/api/items/categorized?page=${page}&limit=100`);
      const ms = Date.now() - start;
      monitor.recordResponse(ms, 'GET /api/items/categorized', res.status);

      if (res.ok && res.data?.pagination) {
        monitor.recordSuccess();
        totalPages = res.data.pagination.totalPages || 1;
        results.push({ page, itemCount: res.data.pagination.totalItems || 0, ok: true });
      } else {
        // Non-2xx or malformed response: ERROR, not a TIMEOUT.
        // Server responded quickly (we have a status code), so don't inflate consecutiveTimeouts.
        monitor.recordError(res.status);
        errors.push({ page, status: res.status });
        results.push({ page, ok: false, status: res.status });
      }
    } catch (err) {
      // True transport failure: socket error, timeout, DNS, connection refused, etc.
      const ms = Date.now() - start;
      monitor.recordResponse(ms, 'GET /api/items/categorized', 0);
      monitor.recordTimeout();
      errors.push({ page, error: err.message });
      results.push({ page, ok: false, error: err.message });
    }
    page++;
  }

  return { results, errors, totalPages: page - 1 };
}

/**
 * Pattern B: CPU-bound pixel processing — POST /api/auto-valid-region
 * Long-running operation that processes pixel data.
 */
async function patternAutoValidRegion(monitor, itemId, pixelDataPath) {
  const start = Date.now();
  try {
    const res = await apiRequest('POST', '/api/auto-valid-region', {
      itemId,
      pixelDataPath,
    });
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'POST /api/auto-valid-region', res.status);
    if (res.ok) {
      monitor.recordSuccess();
    } else {
      // Non-2xx HTTP response — server responded, so NOT a timeout.
      // Do NOT increment consecutiveTimeouts; DO record in error-rate window.
      monitor.recordError(res.status);
    }
    return { ok: res.ok, status: res.status, ms, data: res.data };
  } catch (err) {
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'POST /api/auto-valid-region', 0);
    monitor.recordTimeout();
    return { ok: false, error: err.message, ms };
  }
}

/**
 * Pattern C: Batch pixel processing — POST /api/auto-valid-region-batch
 */
async function patternAutoValidRegionBatch(monitor, items) {
  const start = Date.now();
  try {
    const res = await apiRequest('POST', '/api/auto-valid-region-batch', { items });
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'POST /api/auto-valid-region-batch', res.status);
    if (res.ok) monitor.recordSuccess();
    else monitor.recordError(res.status);
    return { ok: res.ok, status: res.status, ms, data: res.data };
  } catch (err) {
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'POST /api/auto-valid-region-batch', 0);
    monitor.recordTimeout();
    return { ok: false, error: err.message, ms };
  }
}

/**
 * Pattern D: Deep item fetch — GET /api/items/:id
 * Fetches individual items with bag enrichment.
 */
async function patternGetItem(monitor, itemId) {
  const start = Date.now();
  try {
    const res = await apiRequest('GET', `/api/items/${encodeURIComponent(itemId)}`);
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'GET /api/items/:id', res.status);
    if (res.ok) monitor.recordSuccess();
    else monitor.recordError(res.status);
    return { ok: res.ok, status: res.status, ms, data: res.data };
  } catch (err) {
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'GET /api/items/:id', 0);
    monitor.recordTimeout();
    return { ok: false, error: err.message, ms };
  }
}

/**
 * Pattern E: Heavy read/aggregation — GET /api/saved-layouts/integrity
 */
async function patternIntegrityCheck(monitor) {
  const start = Date.now();
  try {
    const res = await apiRequest('GET', '/api/saved-layouts/integrity');
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'GET /api/saved-layouts/integrity', res.status);
    if (res.ok) monitor.recordSuccess();
    else monitor.recordError(res.status);
    return { ok: res.ok, status: res.status, ms, data: res.data };
  } catch (err) {
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'GET /api/saved-layouts/integrity', 0);
    monitor.recordTimeout();
    return { ok: false, error: err.message, ms };
  }
}

/**
 * Pattern F: Rendering pipeline — POST /api/render-preview
 */
async function patternRenderPreview(monitor, objects) {
  const start = Date.now();
  try {
    const res = await apiRequest('POST', '/api/render-preview', { objects });
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'POST /api/render-preview', res.status);
    if (res.ok) monitor.recordSuccess();
    else monitor.recordError(res.status);
    return { ok: res.ok, status: res.status, ms, data: res.data };
  } catch (err) {
    const ms = Date.now() - start;
    monitor.recordResponse(ms, 'POST /api/render-preview', 0);
    monitor.recordTimeout();
    return { ok: false, error: err.message, ms };
  }
}

/**
 * Pattern G: System queries — GET /api/system/info + POST /api/system/memory-check
 */
async function patternSystemQueries(monitor) {
  const results = [];

  // GET /api/system/info
  const start1 = Date.now();
  try {
    const res = await apiRequest('GET', '/api/system/info');
    const ms = Date.now() - start1;
    monitor.recordResponse(ms, 'GET /api/system/info', res.status);
    if (res.ok) monitor.recordSuccess();
    else monitor.recordError(res.status);
    results.push({ endpoint: 'GET /api/system/info', ok: res.ok, status: res.status, ms });
  } catch (err) {
    const ms = Date.now() - start1;
    monitor.recordResponse(ms, 'GET /api/system/info', 0);
    monitor.recordTimeout();
    results.push({ endpoint: 'GET /api/system/info', ok: false, error: err.message, ms });
  }

  // POST /api/system/memory-check
  const start2 = Date.now();
  try {
    const res = await apiRequest('POST', '/api/system/memory-check', { fileCount: 100 });
    const ms = Date.now() - start2;
    monitor.recordResponse(ms, 'POST /api/system/memory-check', res.status);
    if (res.ok) monitor.recordSuccess();
    else monitor.recordError(res.status);
    results.push({ endpoint: 'POST /api/system/memory-check', ok: res.ok, status: res.status, ms });
  } catch (err) {
    const ms = Date.now() - start2;
    monitor.recordResponse(ms, 'POST /api/system/memory-check', 0);
    monitor.recordTimeout();
    results.push({ endpoint: 'POST /api/system/memory-check', ok: false, error: err.message, ms });
  }

  return results;
}

// ──────────────────────────────────────────────
// Recursive Call Chain Executor
// ──────────────────────────────────────────────

/**
 * Execute a single "operation set" — a recursive chain of API calls
 * that simulates a real user workflow.
 */
async function executeOperationChain(monitor, chainId, itemPool) {
  const chainStart = Date.now();
  const operations = [];

  // Step 1: Fetch system info (lightweight)
  const sysInfo = await patternSystemQueries(monitor);
  operations.push(...sysInfo);

  // Step 2: Paginated read (recursive, fetches all pages)
  const paginated = await patternPaginatedRead(monitor);
  operations.push({ pattern: 'paginated-read', pages: paginated.totalPages, errors: paginated.errors.length });

  // Step 3: Fetch individual items (if we have item IDs)
  if (itemPool.length > 0) {
    const sampleItems = itemPool.slice(0, Math.min(5, itemPool.length));
    for (const itemId of sampleItems) {
      const itemResult = await patternGetItem(monitor, itemId);
      operations.push({ pattern: 'get-item', itemId, ok: itemResult.ok, ms: itemResult.ms });
    }
  }

  // Step 4: Integrity check (heavy read/aggregation)
  const integrity = await patternIntegrityCheck(monitor);
  operations.push({ pattern: 'integrity-check', ok: integrity.ok, ms: integrity.ms });

  // Step 5: Auto-valid-region (CPU-bound, if we have pixel data paths)
  if (itemPool.length > 0) {
    const sampleItems = itemPool.slice(0, Math.min(3, itemPool.length));
    for (const itemId of sampleItems) {
      const pixelPath = `highenergy/${itemId}.npz`;
      const vrResult = await patternAutoValidRegion(monitor, itemId, pixelPath);
      operations.push({ pattern: 'auto-valid-region', itemId, ok: vrResult.ok, ms: vrResult.ms });
    }
  }

  // Step 6: Render preview (rendering pipeline)
  if (itemPool.length > 0) {
    const bagItem = itemPool[0];
    const threatItems = itemPool.slice(1, Math.min(4, itemPool.length));
    const renderObjects = {
      bag: { id: bagItem, center: { x: 400, y: 300 }, size: { width: 200, height: 150 } },
      threats: threatItems.map(id => ({ id, center: { x: 200, y: 200 }, size: { width: 50, height: 50 }, rotation: 0 })),
      'non-threats': [],
    };
    const renderResult = await patternRenderPreview(monitor, renderObjects);
    operations.push({ pattern: 'render-preview', ok: renderResult.ok, ms: renderResult.ms });
  }

  return {
    chainId,
    duration_ms: Date.now() - chainStart,
    operations,
    allOk: operations.every(o => o.ok !== false),
    failedCount: operations.filter(o => o.ok === false).length,
  };
}

// ──────────────────────────────────────────────
// Phase Executors
// ──────────────────────────────────────────────

async function executePhase(monitor, phaseConfig, itemPool) {
  const { name, duration, concurrency } = phaseConfig;
  const phaseStart = Date.now();
  const phaseResults = [];
  let chainCounter = 0;
  let breakingDetected = false;
  let breakingReason = null;

  console.log(`\n  ── Phase: ${name} (${(duration / 1000).toFixed(0)}s, ${concurrency} concurrent) ──`);

  // Run until phase duration expires or breaking point detected
  while (Date.now() - phaseStart < duration) {
    const remaining = duration - (Date.now() - phaseStart);
    if (remaining <= 0) break;

    // Check for breaking conditions every iteration
    const check = monitor.checkBreakingConditions();
    if (check.breaking) {
      breakingDetected = true;
      breakingReason = check.issues.join('; ');
      console.log(`    ⚠️  Breaking condition detected: ${breakingReason}`);
      break;
    }

    // Launch concurrent operation chains
    const chainPromises = [];
    const batchSize = Math.min(concurrency, 20); // Cap batch to avoid overwhelming

    for (let i = 0; i < batchSize; i++) {
      chainCounter++;
      monitor.activeRequests++;
      chainPromises.push(
        executeOperationChain(monitor, chainCounter, itemPool)
          .finally(() => { monitor.activeRequests--; })
      );
    }

    const chainResults = await Promise.allSettled(chainPromises);
    for (const result of chainResults) {
      if (result.status === 'fulfilled') {
        phaseResults.push(result.value);
      } else {
        phaseResults.push({
          chainId: chainCounter,
          error: result.reason?.message || 'Chain execution failed',
          allOk: false,
          failedCount: 1,
        });
      }
    }

    // Brief pause between batches to let the system breathe
    await new Promise(resolve => setTimeout(resolve, 500));

    // Log progress every ~30s
    const elapsed = Date.now() - phaseStart;
    if (elapsed % 30_000 < 1000) {
      const check = monitor.checkBreakingConditions();
      const percentiles = monitor.getResponseTimePercentiles();
      const memGrowth = monitor.getMemoryGrowthMB();
      console.log(`    [${(elapsed / 1000).toFixed(0)}s] Chains: ${chainCounter} | Mem: +${memGrowth}MB | p95: ${percentiles.p95}ms | Errors: ${(check.errorRate * 100).toFixed(0)}%`);
    }
  }

  const phaseDuration = Date.now() - phaseStart;
  const successful = phaseResults.filter(r => r.allOk).length;
  const failed = phaseResults.filter(r => !r.allOk).length;

  console.log(`    ✅ Phase complete: ${chainCounter} chains, ${successful} OK, ${failed} failed in ${(phaseDuration / 1000).toFixed(0)}s`);

  return {
    phaseName: name,
    duration_ms: phaseDuration,
    chainsExecuted: chainCounter,
    chainsSuccessful: successful,
    chainsFailed: failed,
    breakingDetected,
    breakingReason,
    results: phaseResults,
  };
}

// ──────────────────────────────────────────────
// Fetch Item Pool from Server
// ──────────────────────────────────────────────

async function fetchItemPool() {
  try {
    const res = await apiRequest('GET', '/api/items/categorized?limit=200');
    if (res.ok && res.data?.categorized) {
      const cats = res.data.categorized;
      const allItems = [
        ...Object.values(cats.bags || {}).flat(),
        ...Object.values(cats.threats || {}).flat(),
        ...Object.values(cats['non-threats'] || {}).flat(),
      ];
      return allItems.map(i => i.id).filter(Boolean);
    }
  } catch (err) {
    console.warn('  ⚠️  Could not fetch items from server:', err.message);
  }
  return [];
}

// ──────────────────────────────────────────────
// Report Helpers
// ──────────────────────────────────────────────

async function saveReportFile(scenarioName, report) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORTS_DIR, `${scenarioName}-${timestamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved: ${reportPath}`);

  // Save as latest
  const latestPath = path.join(REPORTS_DIR, `${scenarioName}-latest.json`);
  await fs.writeFile(latestPath, JSON.stringify(report, null, 2));
  console.log(`📄 Latest report: ${latestPath}`);

  // Save CSV
  const csvPath = path.join(REPORTS_DIR, `${scenarioName}-${timestamp}.csv`);
  if (report.phases && report.phases.length > 0) {
    const csvHeader = 'phase,chainsExecuted,chainsSuccessful,chainsFailed,breakingDetected,duration_ms\n';
    const csvRows = report.phases.map(p =>
      `${p.phaseName},${p.chainsExecuted},${p.chainsSuccessful},${p.chainsFailed},${p.breakingDetected},${p.duration_ms}`
    ).join('\n');
    await fs.writeFile(csvPath, csvHeader + csvRows + '\n');
    console.log(`📄 CSV saved: ${csvPath}`);
  }

  return reportPath;
}

// ──────────────────────────────────────────────
// Main Runner
// ──────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║        1-HOUR STRESS TEST & API TIMEOUT HARNESS                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  Target:     ${BASE_URL}`);
  console.log(`  Mode:       ${QUICK_MODE ? 'QUICK (10 min)' : 'FULL (1 hour)'}`);
  console.log(`  Start Phase: ${START_PHASE}`);
  console.log(`  Reports:    ${REPORTS_DIR}`);
  console.log(`  Dry Run:    ${DRY_RUN ? 'YES' : 'NO'}`);
  console.log('');

  if (DRY_RUN) {
    console.log('── Dry Run: Phase Plan ──');
    const phaseNames = ['warmup', 'ramp', 'sustained', 'breaking', 'cooldown'];
    for (let i = 0; i < phaseNames.length; i++) {
      const name = phaseNames[i];
      const dur = PHASE_DURATIONS[name];
      const concurrency = [5, 50, 100, 200, 10][i];
      console.log(`  Phase ${i + 1}: ${name.padEnd(12)} ${(dur / 1000).toFixed(0)}s  ${concurrency} concurrent`);
    }
    console.log(`  Total: ${(PHASE_DURATIONS.total / 1000 / 60).toFixed(1)} minutes`);
    console.log('');

    // Thresholds summary
    console.log('── Breaking Point Thresholds ──');
    console.log(`  Error rate (60s window):  >${(THRESHOLDS.errorRate60s * 100).toFixed(0)}%`);
    console.log(`  Memory growth (RSS):      >${THRESHOLDS.memoryGrowthMB}MB`);
    console.log(`  p95 response time:         >${THRESHOLDS.responseTimeMs / 1000}s`);
    console.log(`  Consecutive timeouts:      >${THRESHOLDS.consecutiveTimeouts}`);
    console.log(`  Heap usage ratio:          >${(THRESHOLDS.heapUsageRatio * 100).toFixed(0)}%`);
    console.log(`  Free system memory:        <${THRESHOLDS.freeSystemMB}MB`);
    console.log(`  Concurrent requests:       >${THRESHOLDS.concurrentMax}`);
    console.log('');

    // API patterns summary
    console.log('── API Call Patterns ──');
    console.log('  A: GET /api/items/categorized  (paginated/recursive read)');
    console.log('  B: POST /api/auto-valid-region  (CPU-bound pixel processing)');
    console.log('  C: POST /api/auto-valid-region-batch  (batch pixel processing)');
    console.log('  D: GET /api/items/:id  (deep item fetch with enrichment)');
    console.log('  E: GET /api/saved-layouts/integrity  (heavy read/aggregation)');
    console.log('  F: POST /api/render-preview  (rendering pipeline)');
    console.log('  G: GET /api/system/info + POST /api/system/memory-check  (system queries)');
    console.log('');

    console.log('  Dry run complete. Use no --dry-run flag to execute the test.');
    return;
  }

  // Initialize
  const memoryTracker = new MemoryTracker();
  const monitor = new SystemMonitor();
  const overallStart = Date.now();

  // Fetch item pool
  console.log('  Fetching item pool from server...');
  const itemPool = await fetchItemPool();
  console.log(`  Item pool: ${itemPool.length} items available`);

  // Phase configurations
  const phaseConfigs = [
    {
      name: 'warmup',
      duration: PHASE_DURATIONS.warmup,
      concurrency: 5,
      operationWeight: 'light',
    },
    {
      name: 'ramp',
      duration: PHASE_DURATIONS.ramp,
      concurrency: 50,
      operationWeight: 'mixed',
    },
    {
      name: 'sustained',
      duration: PHASE_DURATIONS.sustained,
      concurrency: 100,
      operationWeight: 'heavy',
    },
    {
      name: 'breaking',
      duration: PHASE_DURATIONS.breaking,
      concurrency: 200,
      operationWeight: 'aggressive',
    },
    {
      name: 'cooldown',
      duration: PHASE_DURATIONS.cooldown,
      concurrency: 10,
      operationWeight: 'light',
    },
  ];

  // Start background monitoring
  monitor.start();
  memoryTracker.snapshot('before-all');

  const phaseResults = [];
  let overallBreakingDetected = false;
  let overallBreakingReason = null;
  let breakingPhase = null;

  // Execute phases
  for (let i = START_PHASE - 1; i < phaseConfigs.length; i++) {
    const config = phaseConfigs[i];
    const elapsed = Date.now() - overallStart;

    // Check if we've exceeded total duration
    if (elapsed >= MAX_DURATION_MS) {
      console.log(`\n  ⏰ Total duration ${(MAX_DURATION_MS / 1000 / 60).toFixed(0)}min reached. Stopping.`);
      break;
    }

    // Adjust phase duration to not exceed total
    const adjustedDuration = Math.min(config.duration, MAX_DURATION_MS - elapsed);

    memoryTracker.snapshot(`phase-${config.name}-start`);

    const phaseResult = await executePhase(monitor, {
      ...config,
      duration: adjustedDuration,
    }, itemPool);

    memoryTracker.snapshot(`phase-${config.name}-end`);
    phaseResults.push(phaseResult);

    if (phaseResult.breakingDetected) {
      overallBreakingDetected = true;
      overallBreakingReason = phaseResult.breakingReason;
      breakingPhase = config.name;
      console.log(`\n  ❌ Breaking point detected in phase "${config.name}": ${phaseResult.breakingReason}`);
      break;
    }
  }

  // Stop monitoring
  monitor.stop();

  // Final memory snapshot
  memoryTracker.snapshot('after-all');

  // Build report
  const monitorSummary = monitor.getSummary();
  const totalDuration = Date.now() - overallStart;

  const report = {
    scenario: 'stress-timeout-loop',
    timestamp: new Date().toISOString(),
    targetUrl: BASE_URL,
    quickMode: QUICK_MODE,
    startPhase: START_PHASE,
    totalDuration_ms: totalDuration,
    totalDuration_formatted: `${(totalDuration / 1000 / 60).toFixed(1)} min`,
    phasesCompleted: phaseResults.length,
    phaseConfigs: phaseConfigs.map(c => ({
      name: c.name,
      duration_ms: c.duration,
      concurrency: c.concurrency,
    })),
    phases: phaseResults,
    breakingPoint: overallBreakingDetected
      ? {
          detected: true,
          phase: breakingPhase,
          reason: overallBreakingReason,
        }
      : {
          detected: false,
          reason: 'No breaking point within tested limits',
        },
    monitor: monitorSummary,
    memoryTracker: memoryTracker.getFinalReport(),
    thresholds: THRESHOLDS,
  };

  // Save report
  await saveReportFile('stress-timeout-loop', report);

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log(' 📊 STRESS TIMEOUT LOOP SUMMARY');
  console.log('='.repeat(80));
  console.log(`   Total duration: ${report.totalDuration_formatted}`);
  console.log(`   Phases completed: ${phaseResults.length}/5`);
  console.log(`   Total chains executed: ${phaseResults.reduce((s, p) => s + p.chainsExecuted, 0)}`);
  console.log(`   Peak RSS memory: ${monitorSummary.peakRSS_mb} MB`);
  console.log(`   Peak heap: ${monitorSummary.peakHeap_mb} MB`);
  console.log(`   Final memory growth: ${monitorSummary.finalMemoryGrowth_mb} MB`);
  console.log(`   Peak concurrency: ${monitorSummary.peakConcurrency}`);
  console.log(`   Peak CPU load: ${monitorSummary.peakCpuLoad}%`);
  console.log(`   Response time p50/p95/p99: ${monitorSummary.responseTimePercentiles.p50}/${monitorSummary.responseTimePercentiles.p95}/${monitorSummary.responseTimePercentiles.p99} ms`);

  if (overallBreakingDetected) {
    console.log(`\n   ❌ BREAKING POINT in phase "${breakingPhase}":`);
    console.log(`      ${overallBreakingReason}`);
  } else {
    console.log(`\n   ✅ No breaking point detected within ${report.totalDuration_formatted}`);
  }

  console.log('='.repeat(80));
  console.log('\n✅ Stress timeout loop completed.');
}

main().catch(err => {
  console.error('\n❌ Stress timeout loop failed:', err);
  process.exit(1);
});