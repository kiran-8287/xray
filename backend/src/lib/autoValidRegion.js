// backend/src/lib/autoValidRegion.js
// Auto-generates valid region polygons from raw pixel data (.npz files).
//
// Two entry points:
//   (1) generateValidRegion(npzPath)          — legacy single-file API
//   (2) generateValidRegionBatch([{itemId, npzPath}, ...])
//                                            — BATCH MODE: one Python process
//                                              handles up to BATCH_SIZE files
//                                              via stdin NDJSON, amortising the
//                                              expensive scipy + cv2 import cost
//                                              and (critically) keeping total
//                                              child-process commit low.
//
// The Python script (auto_valid_region.py) already supports --batch mode:
//   * stdin  → JSON array of {itemId, npzPath}
//   * stdout → one NDJSON result line per task
//
// This is far more memory-efficient than spawning one Python-per-NPZ, where
// cv2 + scipy import overhead (~300-500 MB per child) easily exhausts the
// Windows commit limit at any realistic parallelism.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTO_VALID_REGION_SCRIPT = path.join(__dirname, 'auto_valid_region.py');

// Max files sent to a single python interpreter before recycling. Keeps any
// accidental per-file Python leak bounded without giving up the amortization
// win of the scipy/cv2 imports.
export const BATCH_FILES_PER_PROCESS = 20;

// ---------------------------------------------------------------------------
// Shared: run auto_valid_region.py in --batch mode against a list of tasks
// ---------------------------------------------------------------------------

/**
 * Run a batch of valid-region tasks through ONE Python interpreter.
 *
 * @param {Array<{itemId: string, npzPath: string}>} tasks — must have itemId
 *   set so results can be correlated deterministically.
 * @returns {Promise<Array<{itemId:string, status:'ok'|'error', ok:boolean,
 *   error?:string, data?:{points:{x:number,y:number}[], width:number,
 *   height:number, pixelCount:number}}>>}
 */
export function generateValidRegionBatch(tasks) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      resolve([]);
      return;
    }

    // Every task needs a stable id for routing
    const normalized = tasks.map((t, idx) => ({
      itemId: t.itemId ?? `__idx_${idx}__`,
      npzPath: t.npzPath,
    }));

    const proc = spawn('python', [AUTO_VALID_REGION_SCRIPT, '--batch'], {
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';
    let rejected = false;

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (rejected) return;
      rejected = true;
      reject(new Error(`Failed to start auto_valid_region.py: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (rejected) return;

      const lines = stdout
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      // Parse NDJSON, fall back to error placeholders for malformed lines
      const parsedLines = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { status: 'error', reason: `Invalid JSON from Python: ${line.slice(0, 200)}` };
        }
      });

      // Index results by itemId, then match back to input-task order.
      const byId = new Map();
      for (const r of parsedLines) {
        if (r && typeof r.itemId === 'string') {
          byId.set(r.itemId, r);
        }
      }

      const results = normalized.map((task) => {
        const r = byId.get(task.itemId);
        if (!r) {
          return {
            itemId: task.itemId,
            status: 'error',
            ok: false,
            error: `auto_valid_region.py did not return a result (exit ${code}). stderr: ${stderr.slice(-300)}`,
          };
        }
        if (r.status === 'error') {
          return {
            itemId: task.itemId,
            status: 'error',
            ok: false,
            error: r.reason || 'Unknown error in auto_valid_region.py',
          };
        }
        const points = Array.isArray(r.points)
          ? r.points.map(([x, y]) => ({ x: Number(x), y: Number(y) }))
          : [];
        return {
          itemId: task.itemId,
          status: 'ok',
          ok: true,
          data: {
            points,
            width: Number(r.width),
            height: Number(r.height),
            pixelCount: Number(r.pixelCount),
          },
        };
      });

      resolve(results);
    });

    // Send the task list as a JSON array and close stdin so Python knows EOF
    const payload = normalized.map((t) => ({ itemId: t.itemId, npzPath: t.npzPath }));
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Single-file wrapper (original API surface preserved for other callers)
// ---------------------------------------------------------------------------

/**
 * Auto-generate a valid region polygon from raw pixel data.
 *
 * Delegates to Python batch-mode with a single-element batch so callers that
 * only need one file still benefit from import amortization when many calls
 * arrive close together (batching happens at the higher-level call-site now).
 *
 * @param {string} pixelDataPath - Absolute path to the pixel data .npz file
 * @returns {Promise<{points: Array<{x:number,y:number}>, width: number,
 *   height: number, pixelCount: number}>}
 */
export async function generateValidRegion(pixelDataPath) {
  const [result] = await generateValidRegionBatch([
    { itemId: '__single__', npzPath: pixelDataPath },
  ]);
  if (!result) {
    throw new Error('auto_valid_region.py returned no result');
  }
  if (!result.ok) {
    throw new Error(result.error || 'Unknown error in auto_valid_region.py');
  }
  return result.data;
}
