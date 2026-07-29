/**
 * Convert benchmark JSON reports to CSV
 * Usage: node perf/export_csv.mjs [input.json]
 *   If no input file specified, converts all benchmark JSON files in perf/reports/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.join(__dirname, 'reports');

/**
 * Convert a single JSON report to CSV
 */
async function jsonToCsv(jsonPath) {
  const content = await fs.readFile(jsonPath, 'utf-8');
  const report = JSON.parse(content);
  const results = report.results || [];
  
  if (results.length === 0) {
    console.log(`No results found in ${jsonPath}`);
    return;
  }
  
  const csvRows = [];
  csvRows.push('fileCount,status,httpStatus,filesUploaded,duration_s,throughput_fps,totalMemoryMB,freeMemoryMB');
  
  for (const r of results) {
    const u = r.upload || {};
    const m = r.systemMetrics || {};
    csvRows.push([
      r.fileCount,
      r.success ? 'SUCCESS' : 'FAILED',
      u.statusCode || '',
      u.filesUploaded || '',
      u.duration ? u.duration.toFixed(3) : '',
      u.throughput ? u.throughput.toFixed(2) : '',
      m.totalMemoryMB || '',
      m.freeMemoryMB || ''
    ].join(','));
  }
  
  const csvContent = csvRows.join('\n');
  const csvPath = jsonPath.replace(/\.json$/i, '.csv');
  
  await fs.writeFile(csvPath, csvContent);
  console.log(`CSV saved: ${csvPath}`);
  console.log(csvContent);
  console.log('');
}

/**
 * Convert all JSON reports to CSV
 */
async function convertAll() {
  const files = await fs.readdir(REPORTS_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  
  if (jsonFiles.length === 0) {
    console.log('No JSON benchmark reports found in perf/reports/');
    return;
  }
  
  for (const f of jsonFiles) {
    await jsonToCsv(path.join(REPORTS_DIR, f));
  }
}

async function main() {
  const inputFile = process.argv[2];
  
  if (inputFile) {
    await jsonToCsv(path.resolve(inputFile));
  } else {
    await convertAll();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});