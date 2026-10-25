#!/usr/bin/env node
// ============================================================================
// MASTER LOAD TEST ORCHESTRATOR (CROSS-PLATFORM)
// - Automatically profiles the host computer (Linux / Windows / macOS).
// - Prepares or verifies seed files.
// - Executes all 6 page load tests sequentially.
// - Generates SVG charts and the HTML dashboard.
// - Produces consolidated master summary JSON and Markdown report.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateAllGraphs } from './generate_graphs.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '../..');
const LOG_FILE = path.join(PROJECT_DIR, 'load_test/logs/full_load_test.log');
const RESULTS_DIR = path.join(PROJECT_DIR, 'load_test/results');
const SCRIPTS_DIR = path.join(PROJECT_DIR, 'load_test/scripts');

const TESTS = [
  { name: 'System Hardware Extraction', script: 'extract_system_info.mjs', page: 'System Spec' },
  { name: 'Upload Page (Seed-Looping Volume Stress)', script: 'upload_volume_stress_test.mjs', page: 'Upload' },
  { name: 'Library Page (Categorized Pagination)', script: 'library_load_test.mjs', page: 'Library' },
  { name: 'Collage Page (Layout Creation & Bulk)', script: 'collage_load_test.mjs', page: 'Collage' },
  { name: 'Customization Page (Preview Rendering)', script: 'customization_load_test.mjs', page: 'Customize' },
  { name: 'Saved Page (Filtered Layout Queries)', script: 'saved_load_test.mjs', page: 'Saved' },
  { name: 'Load Page (Combinatorial Exports)', script: 'load_page_load_test.mjs', page: 'Load' },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [ORCHESTRATOR] ${msg}`;
  console.log(line);
  ensureDir(path.dirname(LOG_FILE));
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function runTest(test) {
  log(`\n============================================================`);
  log(`STARTING EXECUTION: ${test.name}`);
  log(`============================================================`);

  const scriptPath = path.join(SCRIPTS_DIR, test.script);
  const start = Date.now();

  try {
    execSync(`node "${scriptPath}"`, {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      timeout: 1800000, // 30 mins per test suite
      env: { ...process.env, BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:8080' },
    });
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    log(`>>> ${test.name} COMPLETED SUCCESSFULLY in ${duration}s`);
    return { name: test.name, page: test.page, status: 'completed', durationSec: duration };
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    log(`>>> ${test.name} FAILED in ${duration}s: ${err.message}`);
    return { name: test.name, page: test.page, status: 'failed', durationSec: duration, error: err.message };
  }
}

async function main() {
  log('============================================================');
  log('MASTER LOAD TEST SUITE INITIATED (CROSS-PLATFORM / LAB READY)');
  log('============================================================');
  log(`Host OS: ${process.platform} (${process.arch})`);
  log(`Project Directory: ${PROJECT_DIR}`);
  log(`Master Log File: ${LOG_FILE}`);

  const executionResults = [];

  for (const test of TESTS) {
    const res = await runTest(test);
    executionResults.push(res);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Generate all graphs & dashboard
  log('\n============================================================');
  log('GENERATING PERFORMANCE GRAPHS AND DASHBOARD');
  log('============================================================');
  try {
    generateAllGraphs();
    log(`All SVG charts and HTML dashboard successfully updated in ${path.join(PROJECT_DIR, 'load_test/graphs')}`);
  } catch (err) {
    log(`Failed to generate graphs: ${err.message}`);
  }

  // Master Summary JSON
  const masterSummary = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    projectDir: PROJECT_DIR,
    tests: executionResults,
  };
  ensureDir(RESULTS_DIR);
  fs.writeFileSync(path.join(RESULTS_DIR, 'master_summary.json'), JSON.stringify(masterSummary, null, 2));

  log('\n============================================================');
  log('MASTER LOAD TEST COMPLETED ACROSS ALL PAGES');
  log('============================================================');
  for (const r of executionResults) {
    log(`  - ${r.page}: ${r.status.toUpperCase()} (${r.durationSec}s)`);
  }
}

main().catch(err => {
  log(`Fatal error in orchestrator: ${err.message}`);
  process.exit(1);
});
