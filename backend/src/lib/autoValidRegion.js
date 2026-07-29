// backend/src/lib/autoValidRegion.js
// Auto-generates a valid region polygon from raw pixel data (2D float arrays: 0-65535)
// 65535 = white (background/air), anything < 65535 = bag material
//
// CRITICAL: This module now delegates ALL pixel processing to a Python script
// (auto_valid_region.py) to avoid sending the entire pixel array through JSON.
// The old approach (read_npz.py → Node.js processing) caused memory allocation
// errors because the pixel array was duplicated in both Python and Node.js memory.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTO_VALID_REGION_SCRIPT = path.join(__dirname, 'auto_valid_region.py');

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Auto-generate a valid region polygon from raw pixel data.
 * Delegates to Python to avoid sending the entire pixel array through JSON.
 *
 * @param {string} pixelDataPath - Absolute path to the pixel data .npz file
 * @returns {Promise<{points: Array<{x:number,y:number}>, width: number, height: number, pixelCount: number}>}
 */
export async function generateValidRegion(pixelDataPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [AUTO_VALID_REGION_SCRIPT, '--npz-path', pixelDataPath], {
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      const lines = stdout.trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';

      if (code !== 0 || !lastLine) {
        reject(new Error(stderr.trim() || lastLine || 'Python process failed'));
        return;
      }

      try {
        const parsed = JSON.parse(lastLine);
        if (parsed.status === 'error') {
          reject(new Error(parsed.reason || 'Auto-valid-region script returned error'));
        } else {
          // Convert points from [[x,y], ...] format to [{x, y}, ...] format
          const points = parsed.points.map(([x, y]) => ({ x, y }));
          resolve({
            points,
            width: parsed.width,
            height: parsed.height,
            pixelCount: parsed.pixelCount,
          });
        }
      } catch (err) {
        reject(new Error(`Invalid JSON from Python: ${err.message}. Output: ${lastLine.substring(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Python: ${err.message}`));
    });
  });
}
