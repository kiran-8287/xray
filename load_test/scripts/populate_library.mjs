// ============================================================================
// Populate library with test items from dump/tip files
// Processes files one at a time to avoid memory issues
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const BACKEND_URL = 'http://localhost:8080';
const PROJECT_DIR = 'B:/xray';
const SOURCE_DIR = path.join(PROJECT_DIR, 'dump and tip');

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
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
      .map(f => ({ fullPath: path.join(catDir, f), name: f, category: cat }));
    files.push(...catFiles);
  }
  return files;
}

function classifyCategory(fileType, filename) {
  const lower = filename.toLowerCase();
  if (fileType === 'dump') return 'bags';
  if (fileType === 'tip') {
    if (lower.includes('gun') || lower.includes('knife') || lower.includes('threat')) return 'threats';
    return 'non-threats';
  }
  return 'non-threats';
}

async function uploadSingleFile(fileInfo) {
  const buf = fs.readFileSync(fileInfo.fullPath);
  const formData = new FormData();
  formData.append('rawFiles', new Blob([buf]), fileInfo.name);

  try {
    const res = await fetch(`${BACKEND_URL}/api/process-raw-files`, {
      method: 'POST',
      headers: { 'User-Agent': 'XrayPopulate/1.0' },
      body: formData,
    });
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.status === 'done') {
          return e;
        }
      } catch {}
    }
  } catch (err) {
    log(`Upload error for ${fileInfo.name}: ${err.message}`);
  }
  return null;
}

async function saveItemsBatch(items) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/items/batch-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    return data.ok ? data.savedCount : 0;
  } catch (err) {
    log(`Save batch error: ${err.message}`);
    return 0;
  }
}

async function main() {
  log('Populating library from dump/tip files...');
  const sourceFiles = collectSourceFiles();
  log(`Found ${sourceFiles.length} source files`);

  const libraryItems = [];
  let processed = 0;

  for (const fileInfo of sourceFiles) {
    const result = await uploadSingleFile(fileInfo);
    if (result) {
      const category = classifyCategory(result.fileType, fileInfo.name);
      const subcat = category === 'bags' ? 'General' : category === 'threats' ? 'Electronics' : 'Accessories';
      libraryItems.push({
        id: result.id,
        created_at: new Date().toISOString(),
        filename: result.filepath,
        filepath: result.filepath,
        category,
        subcategory: subcat,
        name: result.id,
        width: result.width,
        height: result.height,
        pixelDataFilename: result.pixelDataFilename,
        tags: [],
        valid_region_points: null,
      });
      processed++;
      if (processed % 10 === 0) log(`Processed ${processed}/${sourceFiles.length} files`);
    }
  }

  log(`Processed ${processed} items, saving to library...`);

  // Save in batches of 50
  const SAVE_BATCH = 50;
  let savedCount = 0;
  for (let i = 0; i < libraryItems.length; i += SAVE_BATCH) {
    const batch = libraryItems.slice(i, i + SAVE_BATCH);
    const count = await saveItemsBatch(batch);
    savedCount += count;
    log(`Saved batch ${Math.floor(i/SAVE_BATCH) + 1}: ${count} items`);
  }

  log(`Total saved to library: ${savedCount} items`);
  log('Library population complete!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
