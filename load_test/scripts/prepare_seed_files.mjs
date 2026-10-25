#!/usr/bin/env node
// ============================================================================
// CROSS-PLATFORM SEED FILE GENERATOR FOR LOAD TESTING (DEFAULT: 1,000 FILES)
// - Works on Linux, macOS, and Windows.
// - Takes genuine .dump.pgm and .tip files from './dump and tip' in the repo.
// - Generates exactly N seed files (default 1,000 files, ~3.4 GB).
// - These 1,000 seed files are then looped in-memory by the load test engine
//   to simulate 10,000, 20,000, or 50,000 uploads without needing 50+ GB of disk.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const DEFAULT_SOURCE_DIR = path.join(REPO_ROOT, 'dump and tip');
const DEFAULT_SEED_DIR = path.join(REPO_ROOT, 'load_test/seed_data');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseArgs() {
  const args = process.argv.slice(2);
  let count = 1000;
  let dest = DEFAULT_SEED_DIR;
  let source = DEFAULT_SOURCE_DIR;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dest' && args[i + 1]) {
      dest = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--source' && args[i + 1]) {
      source = path.resolve(args[i + 1]);
      i++;
    } else if (!isNaN(parseInt(args[i], 10))) {
      count = parseInt(args[i], 10);
    }
  }
  return { count, dest, source };
}

function collectSourceFiles(sourceDir) {
  const files = [];
  if (!fs.existsSync(sourceDir)) {
    return files;
  }

  // Check subdirectories or flat directory
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      const subEntries = fs.readdirSync(fullPath);
      for (const f of subEntries) {
        if (f.toLowerCase().endsWith('.dump.pgm') || f.toLowerCase().endsWith('.tip')) {
          files.push({
            fullPath: path.join(fullPath, f),
            name: f,
            isTip: f.toLowerCase().endsWith('.tip'),
          });
        }
      }
    } else if (entry.isFile()) {
      if (entry.name.toLowerCase().endsWith('.dump.pgm') || entry.name.toLowerCase().endsWith('.tip')) {
        files.push({
          fullPath,
          name: entry.name,
          isTip: entry.name.toLowerCase().endsWith('.tip'),
        });
      }
    }
  }
  return files;
}

export function prepareSeedFiles(targetCount = 1000, targetDir = DEFAULT_SEED_DIR, sourceDir = DEFAULT_SOURCE_DIR) {
  ensureDir(targetDir);

  // If fallback drive A: exists with files on this machine, check it
  if (fs.existsSync('A:/xray_load_test_files') && targetDir === DEFAULT_SEED_DIR) {
    const aFiles = fs.readdirSync('A:/xray_load_test_files');
    if (aFiles.length >= targetCount) {
      console.log(`[Seed Prep] Found existing local archive on A: drive (${aFiles.length} files).`);
      console.log(`[Seed Prep] Copying ${targetCount} seed files to ${targetDir}...`);
      const t0 = Date.now();
      for (let i = 0; i < targetCount; i++) {
        const src = path.join('A:/xray_load_test_files', aFiles[i]);
        const dest = path.join(targetDir, `seed_${String(i + 1).padStart(5, '0')}${path.extname(aFiles[i])}`);
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      }
      console.log(`[Seed Prep] Ready with ${targetCount} seeds in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return targetDir;
    }
  }

  // Check if targetDir already has enough seed files
  const existingFiles = fs.readdirSync(targetDir).filter(f => f.toLowerCase().endsWith('.dump.pgm') || f.toLowerCase().endsWith('.tip'));
  if (existingFiles.length >= targetCount) {
    console.log(`[Seed Prep] Already have ${existingFiles.length} seed files in ${targetDir} (>= ${targetCount}). Reusing existing files.`);
    return targetDir;
  }

  const sources = collectSourceFiles(sourceDir);
  if (sources.length === 0) {
    throw new Error(`No source .dump.pgm or .tip files found in ${sourceDir}. Please ensure the repository's 'dump and tip' folder is present.`);
  }

  console.log(`[Seed Prep] Found ${sources.length} original source files in ${sourceDir}`);
  const needed = targetCount - existingFiles.length;
  console.log(`[Seed Prep] Generating ${needed} seed files in ${targetDir} (total: ${targetCount})...`);

  const startIndex = existingFiles.length;
  const t0 = Date.now();

  for (let i = startIndex; i < targetCount; i++) {
    const src = sources[i % sources.length];
    const ext = src.isTip ? '.tip' : '.dump.pgm';
    const filename = `seed_${String(i + 1).padStart(5, '0')}${ext}`;
    const dest = path.join(targetDir, filename);

    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src.fullPath, dest);
    }

    if ((i + 1) % 250 === 0 || (i + 1) === targetCount) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[Seed Prep] Progress: ${i + 1} / ${targetCount} seed files prepared (${elapsed}s)...`);
    }
  }

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[Seed Prep] Successfully prepared ${targetCount} seed files in ${targetDir} in ${totalTime}s`);
  return targetDir;
}

// CLI Execution
if (process.argv[1]?.endsWith('prepare_seed_files.mjs')) {
  const { count, dest, source } = parseArgs();
  try {
    prepareSeedFiles(count, dest, source);
  } catch (err) {
    console.error(`[Seed Prep] Error: ${err.message}`);
    process.exit(1);
  }
}
