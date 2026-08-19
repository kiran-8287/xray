// rawFileWorker.js — ESM Worker Thread that spawns a Python subprocess
// to process .dump.pgm, .tip files, and extract .npz pixel data.
// Supports batch processing: receives an array of tasks, sends as stdin JSON,
// and streams NDJSON results back per-file.

import { parentPort } from "node:worker_threads";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from 'pino';
import client from 'prom-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, "process_raw_file.py");
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
let pythonBatchDuration;
try {
  pythonBatchDuration = new client.Histogram({
    name: 'python_batch_duration_seconds',
    help: 'Duration of the Python subprocess batch processing',
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
  });
} catch (e) {}

/**
 * Spawn ONE Python process and feed it a batch of files via stdin.
 * The Python script processes files one-by-one and outputs NDJSON lines to stdout.
 * 
 * @param {Array<{filePath: string, itemId: string, fileType: string, pixelDataDir: string, libraryImagesDir: string}>} tasks
 * @returns {Promise<Array<object>>} Array of result objects
 */
function runPythonBatch(tasks) {
  return new Promise((resolve) => {
    const batchStart = process.hrtime.bigint();
    // Build the batch input for Python stdin
    const batchInput = tasks.map(t => ({
      filePath: t.filePath,
      itemId: t.itemId,
      fileType: t.fileType,
      pixelDataDir: t.pixelDataDir,
      libraryImagesDir: t.libraryImagesDir,
    }));

    const proc = spawn("python", [
      PYTHON_SCRIPT,
      "--batch",
    ], {
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
      const batchDuration = Number(process.hrtime.bigint() - batchStart) / 1e9;
      try { pythonBatchDuration && pythonBatchDuration.observe(batchDuration); } catch (e) {}
      logger.info({ batchSize: tasks.length, duration_s: batchDuration, exitCode: code }, 'python_batch_complete');
      const lines = stdout.trim().split("\n").filter(Boolean);
      const results = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { status: "error", id: "parse", reason: `Invalid JSON: ${line}` };
        }
      });

      resolve(results);
    });

    proc.on("error", (err) => {
      logger.error({ err: err.message }, 'python_process_error');
      // Return error for ALL tasks in the batch
      const errorResults = tasks.map(t => ({
        status: "error",
        id: t.itemId,
        reason: `Failed to start Python process: ${err.message}`,
      }));
      resolve(errorResults);
    });

    // Write batch input to stdin and close it
    proc.stdin.write(JSON.stringify(batchInput));
    proc.stdin.end();
  });
}

/**
 * Listen for inbound messages — each message is a BATCH of tasks to process.
 * The pool sends an array: { tasks: [...] }
 */
parentPort.on("message", async (message) => {
  // Support both single task (legacy) and batch task arrays
  const tasks = Array.isArray(message) ? message : (message.tasks || [message]);
  
  if (tasks.length === 0) {
    parentPort.postMessage({ status: "error", id: "batch", reason: "Empty task batch" });
    return;
  }

  const results = await runPythonBatch(tasks);

  // Post results back one at a time (each triggers a callback)
  for (const result of results) {
    parentPort.postMessage(result);
  }
});