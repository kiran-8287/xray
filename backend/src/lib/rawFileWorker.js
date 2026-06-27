// rawFileWorker.js — ESM Worker Thread that spawns a Python subprocess
// to process .dump.pgm and .tip files, replacing the CJS reader bridge.

import { parentPort } from "node:worker_threads";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, "process_raw_file.py");

/**
 * Spawn the Python processing script as a child process and capture its stdout.
 * @param {string} filePath
 * @param {string} itemId
 * @param {string} fileType  "dump" | "tip"
 * @param {string} pixelDataDir
 * @param {string} libraryImagesDir
 * @returns {Promise<string>} The JSON result line from Python stdout
 */
function runPythonScript(filePath, itemId, fileType, pixelDataDir, libraryImagesDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [
      PYTHON_SCRIPT,
      "--file-path", filePath,
      "--file-type", fileType,
      "--item-id", itemId,
      "--library-images-dir", libraryImagesDir,
      "--pixel-data-dir", pixelDataDir,
    ], {
      // Set CWD to the script directory so data_synthesis resolution works
      cwd: __dirname,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      // Get the last non-empty line from stdout (the JSON result)
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";

      if (code === 0 && lastLine) {
        // Verify it's valid JSON
        try {
          const parsed = JSON.parse(lastLine);
          if (parsed.status === "error") {
            reject(new Error(parsed.reason || "Python script returned error status"));
          } else {
            resolve(lastLine);
          }
        } catch {
          reject(new Error(`Python output was not valid JSON: ${lastLine}`));
        }
      } else {
        // Try to parse error from the JSON output even on non-zero exit
        try {
          const parsed = JSON.parse(lastLine);
          if (parsed.status === "error") {
            reject(new Error(parsed.reason || "Unknown Python error"));
          } else {
            reject(new Error(stderr.trim() || lastLine || "Python process failed"));
          }
        } catch {
          reject(new Error(stderr.trim() || lastLine || "Python process failed"));
        }
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
  });
}

/**
 * Listen for multiple inbound messages (worker pool reuses workers)
 */
parentPort.on("message", async (task) => {
  const { filePath, itemId, fileType, pixelDataDir, libraryImagesDir } = task;

  console.log(`[worker] Starting task: ${itemId} (${fileType})`);

  try {
    const resultJson = await runPythonScript(
      filePath,
      itemId,
      fileType,
      pixelDataDir,
      libraryImagesDir
    );

    console.log(`[worker] Python output for ${itemId}: ${resultJson}`);
    const result = JSON.parse(resultJson);
    parentPort.postMessage(result);
    console.log(`[worker] Posted result for ${itemId}: ${result.status}`);
  } catch (err) {
    console.error(`[worker] Error for ${itemId}:`, err.message);
    parentPort.postMessage({
      status: "error",
      id: itemId,
      reason: err.message,
    });
  }
});
