/**
 * Stress Test Runner
 * 
 * Orchestrates all stress test scenarios and generates reports.
 * Each scenario simulates real user flows and finds breaking points.
 * 
 * Usage:
 *   node perf/stress-test.mjs                        # Run all scenarios
 *   node perf/stress-test.mjs --scenario upload       # Run specific scenario
 *   node perf/stress-test.mjs --quick                 # Quick test (lower limits)
 *   node perf/stress-test.mjs --target http://...     # Custom target
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:8080';
const REPORTS_DIR = path.join(__dirname, 'reports');

// Parse CLI args
const args = process.argv.slice(2);
const QUICK_MODE = args.includes('--quick');
const SPECIFIC_SCENARIO = args.includes('--scenario')
  ? args[args.indexOf('--scenario') + 1]
  : null;

// Override target if provided
const targetUrlIndex = args.indexOf('--target');
const BASE_URL = targetUrlIndex >= 0 ? args[targetUrlIndex + 1] : TARGET_URL;

// ---- Memory Tracking ----

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

// ---- HTTP Helper ----

export async function apiRequest(method, urlPath, body = null, contentType = null, retries = 2) {
  const url = new URL(urlPath, BASE_URL);

  async function attempt() {
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;

      const headers = {
        'Connection': 'close', // Avoid keep-alive issues under stress
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
      // Wait briefly and retry
      await new Promise(r => setTimeout(r, 500));
      return apiRequest(method, urlPath, body, contentType, retries - 1);
    }
    throw err;
  }
}

// ---- Report Helpers ----

export async function saveReport(scenarioName, results) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORTS_DIR, `stress-${scenarioName}-${timestamp}.json`);

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const peakMem = Math.max(...results.map(r => r.peakRSS_mb || 0));

  const report = {
    scenario: scenarioName,
    timestamp: new Date().toISOString(),
    targetUrl: BASE_URL,
    quickMode: QUICK_MODE,
    results,
    summary: {
      totalRuns: results.length,
      passed,
      failed,
      peakMemoryMB: peakMem,
      breakingPoint: results.find(r => !r.passed)
        ? {
            runNumber: results.findIndex(r => !r.passed) + 1,
            error: results.find(r => !r.passed)?.error || 'Unknown',
          }
        : null,
    },
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved: ${reportPath}`);

  // Also save CSV
  const csvPath = path.join(REPORTS_DIR, `stress-${scenarioName}-${timestamp}.csv`);
  if (results.length > 0) {
    const keys = [...new Set(results.flatMap(Object.keys))];
    const header = keys.join(',');
    const rows = results.map(r =>
      keys.map(k => {
        const v = r[k];
        if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
        return String(v ?? '');
      }).join(',')
    );
    await fs.writeFile(csvPath, header + '\n' + rows.join('\n'));
    console.log(`📄 CSV saved: ${csvPath}`);
  }

  // Save as latest
  const latestPath = path.join(REPORTS_DIR, `stress-${scenarioName}-latest.json`);
  await fs.writeFile(latestPath, JSON.stringify(report, null, 2));

  return reportPath;
}

export function printSummary(scenarioName, results) {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const peakMem = Math.max(...results.map(r => r.peakRSS_mb || 0));

  console.log('\n' + '='.repeat(80));
  console.log(` 📊 SCENARIO: ${scenarioName}`);
  console.log('='.repeat(80));
  console.log(`   Total runs:    ${results.length}`);
  console.log(`   Passed:        ${passed}`);
  console.log(`   Failed:        ${failed}`);
  console.log(`   Peak memory:   ${peakMem} MB`);

  if (failed > 0) {
    const firstFail = results.find(r => !r.passed);
    const failIdx = results.findIndex(r => !r.passed) + 1;
    console.log(`\n   ❌ BREAKING POINT at run #${failIdx}`);
    console.log(`      Error: ${firstFail?.error || 'Unknown'}`);
  } else {
    console.log(`\n   ✅ No breaking point within tested limits`);
  }

  const memGrowth = results.reduce((sum, r) => sum + (r.memoryGrowth_mb || 0), 0);
  if (memGrowth > 100) {
    console.log(`   ⚠️  Memory growth: ${Math.round(memGrowth)} MB total (possible leak)`);
  } else {
    console.log(`   ✅ Memory stable: ${Math.round(memGrowth)} MB total growth`);
  }
  console.log('='.repeat(80));
}

// ---- Main Runner ----

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         X-RAY STRESS TEST SUITE                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Mode:   ${QUICK_MODE ? 'QUICK' : 'FULL'}`);
  console.log(`  Reports: ${REPORTS_DIR}\n`);

  const scenarios = [];

  if (!SPECIFIC_SCENARIO || SPECIFIC_SCENARIO === 'upload') {
    const { runUploadStress } = await import('./scenarios/upload-stress.mjs');
    scenarios.push({ name: 'upload-stress', fn: runUploadStress });
  }
  if (!SPECIFIC_SCENARIO || SPECIFIC_SCENARIO === 'generation') {
    const { runGenerationStress } = await import('./scenarios/generation-stress.mjs');
    scenarios.push({ name: 'generation-stress', fn: runGenerationStress });
  }
  if (!SPECIFIC_SCENARIO || SPECIFIC_SCENARIO === 'buffer') {
    const { runBufferStress } = await import('./scenarios/buffer-stress.mjs');
    scenarios.push({ name: 'buffer-stress', fn: runBufferStress });
  }
  if (!SPECIFIC_SCENARIO || SPECIFIC_SCENARIO === 'api-timeout') {
    const { runApiTimeoutTest } = await import('./scenarios/api-timeout-test.mjs');
    scenarios.push({ name: 'api-timeout', fn: runApiTimeoutTest });
  }
  if (!SPECIFIC_SCENARIO || SPECIFIC_SCENARIO === 'concurrent-ops') {
    const { runConcurrentOpsStress } = await import('./scenarios/concurrent-ops-stress.mjs');
    scenarios.push({ name: 'concurrent-ops', fn: runConcurrentOpsStress });
  }

  if (scenarios.length === 0) {
    console.error(`Unknown scenario: ${SPECIFIC_SCENARIO}`);
    console.log('Available: upload, generation, buffer, api-timeout, concurrent-ops');
    process.exit(1);
  }

  for (const scenario of scenarios) {
    console.log(`\n▶ Running scenario: ${scenario.name}`);
    const memoryTracker = new MemoryTracker();

    try {
      memoryTracker.snapshot('before');
      const results = await scenario.fn(BASE_URL, QUICK_MODE, memoryTracker);
      memoryTracker.snapshot('after');
      await saveReport(scenario.name, results);
      printSummary(scenario.name, results);
    } catch (err) {
      console.error(`\n❌ Scenario ${scenario.name} failed:`, err.message);
    }
  }

  console.log('\n✅ All stress scenarios completed.');
}

main().catch(console.error);