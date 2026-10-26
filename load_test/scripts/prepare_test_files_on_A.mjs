// ============================================================================
// GENERATE & PERSIST TEST FILES ON A: DRIVE FOR REUSABLE LOAD TESTING
// Generates files incrementally:
// - Generates up to targetCount (10,000 / 15,000 / 20,000)
// - NEVER deletes existing files — reuses them across runs
// - Cycles through real .dump.pgm and .tip source files from B:/xray/dump and tip
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const PROJECT_DIR = 'B:/xray';
const SOURCE_DIR = path.join(PROJECT_DIR, 'dump and tip');
const TARGET_DIR = 'A:/xray_load_test_files';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function collectSourceFiles() {
  const files = [];
  const categories = fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const cat of categories) {
    const catDir = path.join(SOURCE_DIR, cat);
    const catFiles = fs.readdirSync(catDir)
      .filter(f => f.toLowerCase().endsWith('.dump.pgm') || f.toLowerCase().endsWith('.tip'))
      .map(f => ({
        fullPath: path.join(catDir, f),
        name: f,
        isTip: f.toLowerCase().endsWith('.tip'),
      }));
    files.push(...catFiles);
  }
  return files;
}

export function prepareFilesOnA(targetCount = 10000) {
  ensureDir(TARGET_DIR);
  const sourceFiles = collectSourceFiles();
  if (sourceFiles.length === 0) {
    throw new Error('No source dump or tip files found in ' + SOURCE_DIR);
  }

  const existingFiles = fs.readdirSync(TARGET_DIR);
  console.log(`[A: Drive Storage] Currently existing files in ${TARGET_DIR}: ${existingFiles.length}`);

  if (existingFiles.length >= targetCount) {
    console.log(`[A: Drive Storage] Already have ${existingFiles.length} files (>= ${targetCount}). Reusing existing files without regeneration.`);
    return TARGET_DIR;
  }

  const needed = targetCount - existingFiles.length;
  console.log(`[A: Drive Storage] Generating ${needed} additional test files on A: drive (total target: ${targetCount})...`);

  const startIndex = existingFiles.length;
  const t0 = Date.now();

  for (let i = startIndex; i < targetCount; i++) {
    const src = sourceFiles[i % sourceFiles.length];
    const ext = src.isTip ? '.tip' : '.dump.pgm';
    const filename = `xray_loadtest_${String(i + 1).padStart(6, '0')}${ext}`;
    const dest = path.join(TARGET_DIR, filename);

    // Fast copy
    fs.copyFileSync(src.fullPath, dest);

    if ((i + 1) % 1000 === 0 || (i + 1) === targetCount) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[A: Drive Storage] Generated ${i + 1} / ${targetCount} files (${elapsed}s)...`);
    }
  }

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[A: Drive Storage] Successfully prepared ${targetCount} persistent test files on A: drive in ${totalTime}s`);
  return TARGET_DIR;
}

// If executed directly from CLI
if (process.argv[1]?.endsWith('prepare_test_files_on_A.mjs')) {
  const count = parseInt(process.argv[2], 10) || 10000;
  prepareFilesOnA(count);
}
