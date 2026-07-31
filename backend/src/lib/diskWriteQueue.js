/**
 * DiskWriteQueue — Serial batch write queue for savedLayouts.json
 *
 * Prevents read/write race conditions and lock-queue buildups when
 * auto-saving thousands of generated combinations by:
 *  1. Serializing all batch writes (one at a time, no parallel writes)
 *  2. Inserting a configurable sleep between consecutive batch writes
 *     so in-flight GET reads can complete before the next write starts.
 *  3. Coalescing any batches that arrive while a write is in-progress
 *     into a pending queue (FIFO order preserved).
 *
 * Usage:
 *   import { enqueue, getDiskWriteQueueStatus } from './diskWriteQueue.js';
 *   const { depth, inFlight } = await enqueue(layouts);
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = config.dataDir;
const SAVED_LAYOUTS_FILE = path.join(DATA_DIR, 'savedLayouts.json');

// How long to pause between consecutive batch writes (ms).
// Gives any in-flight GET /api/saved-layouts time to finish reading
// before we overwrite the file again.
const BATCH_WRITE_PAUSE_MS = 200;

// Maximum layouts per partition file (matches items.json partitioning strategy)
const PARTITION_CAP = 5000;

// ---- Internal state ----

/** Pending batches waiting to be written */
const queue = [];

/** Whether a write is currently in progress */
let inFlight = false;

/** Total layouts queued since server start (monotonic counter) */
let totalQueued = 0;

/** Total layouts successfully written since server start */
let totalWritten = 0;

/** Total number of batches successfully written */
let batchesWritten = 0;

// ---- Atomic helpers (local, self-contained — no import from storage.js
//      to avoid cross-module lock conflicts) ----

const localWriteLocks = new Map();

function acquireLocalLock(filePath) {
  const previous = localWriteLocks.get(filePath) ?? Promise.resolve();
  let release;
  const ownLock = new Promise((res) => { release = res; });
  const tail = ownLock.catch(() => {});
  localWriteLocks.set(filePath, tail);
  return previous.then(() => () => {
    release();
    if (localWriteLocks.get(filePath) === tail) {
      localWriteLocks.delete(filePath);
    }
  });
}

async function writeJSONAtomic(filePath, data) {
  const release = await acquireLocalLock(filePath);
  try {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const tmp = path.join(dir, `${base}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, filePath);
  } finally {
    release();
  }
}

async function readJSONSafe(filePath, defaultValue = []) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return defaultValue;
    return JSON.parse(trimmed);
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return defaultValue;
    throw err;
  }
}

// ---- Partition helpers ----

function getLayoutPartitionPath(partNum) {
  if (partNum === 1) return SAVED_LAYOUTS_FILE; // legacy first partition = savedLayouts.json
  return path.join(DATA_DIR, `savedLayouts_${partNum}.json`);
}

/**
 * Read the saved-layouts catalog (how many partitions, total count)
 */
async function readLayoutCatalog() {
  const catalogPath = path.join(DATA_DIR, 'savedLayouts_catalog.json');
  return await readJSONSafe(catalogPath, {
    activePartition: 1,
    totalCount: 0,
    partitions: [1],
  });
}

async function writeLayoutCatalog(catalog) {
  const catalogPath = path.join(DATA_DIR, 'savedLayouts_catalog.json');
  await writeJSONAtomic(catalogPath, catalog);
}

// ---- Core write logic ----

/**
 * Write one batch of layouts to the appropriate partition file(s).
 * Handles partition overflow automatically (>5000 per file → new file).
 */
async function writeBatch(layouts) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const catalog = await readLayoutCatalog();
  let pNum = catalog.activePartition;
  let currentPath = getLayoutPartitionPath(pNum);
  let currentItems = await readJSONSafe(currentPath, []);

  for (const layout of layouts) {
    if (currentItems.length >= PARTITION_CAP) {
      // Save full partition
      await writeJSONAtomic(currentPath, currentItems);
      pNum++;
      if (!catalog.partitions.includes(pNum)) {
        catalog.partitions.push(pNum);
      }
      currentPath = getLayoutPartitionPath(pNum);
      currentItems = await readJSONSafe(currentPath, []);
    }
    currentItems.push(layout);
    catalog.totalCount++;
  }

  // Flush active partition
  await writeJSONAtomic(currentPath, currentItems);
  catalog.activePartition = pNum;
  await writeLayoutCatalog(catalog);

  totalWritten += layouts.length;
  batchesWritten++;

  console.log(`[DiskWriteQueue] Wrote batch of ${layouts.length}. Total written: ${totalWritten}. Partition: savedLayouts_${pNum}`);
}

/**
 * Process the next batch from the queue.
 * Tail-calls itself (without await) to avoid stack buildup.
 */
async function processNext() {
  if (inFlight || queue.length === 0) return;

  inFlight = true;
  const batch = queue.shift();

  try {
    await writeBatch(batch);
  } catch (err) {
    console.error('[DiskWriteQueue] Write error:', err.message);
    // On error, put the batch back at the front so it retries next time
    queue.unshift(batch);
  }

  // Pace between writes to allow reads to complete
  if (BATCH_WRITE_PAUSE_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, BATCH_WRITE_PAUSE_MS));
  }

  inFlight = false;

  // Schedule next batch (non-blocking tail call)
  if (queue.length > 0) {
    setImmediate(processNext);
  }
}

// ---- Public API ----

/**
 * Enqueue a batch of layouts for sequential disk write.
 * Returns immediately with queue status (non-blocking).
 *
 * @param {object[]} layouts - Array of layout objects to persist
 * @returns {{ depth: number, inFlight: boolean, totalQueued: number }}
 */
export function enqueue(layouts) {
  if (!Array.isArray(layouts) || layouts.length === 0) {
    return { depth: queue.length, inFlight, totalQueued };
  }

  queue.push(layouts);
  totalQueued += layouts.length;

  // Kick off processing if not already running (non-blocking)
  setImmediate(processNext);

  return { depth: queue.length, inFlight, totalQueued };
}

/**
 * Get current queue status for polling endpoint.
 */
export function getDiskWriteQueueStatus() {
  return {
    depth: queue.length,
    inFlight,
    totalQueued,
    totalWritten,
    batchesWritten,
    isDrained: queue.length === 0 && !inFlight,
  };
}

/**
 * Read all saved layouts from all partition files.
 * Used by GET /api/saved-layouts to aggregate across partitions.
 */
export async function getAllSavedLayouts() {
  const catalog = await readLayoutCatalog();
  const all = [];
  for (const pNum of catalog.partitions) {
    const pPath = getLayoutPartitionPath(pNum);
    const items = await readJSONSafe(pPath, []);
    all.push(...items);
  }
  return all;
}

/**
 * Drain the queue — wait until all pending writes complete.
 * Use before manual bulk saves to avoid double-write.
 */
export function drain() {
  return new Promise((resolve) => {
    function check() {
      if (queue.length === 0 && !inFlight) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    }
    check();
  });
}
