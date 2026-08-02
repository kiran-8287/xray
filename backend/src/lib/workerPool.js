// workerPool.js — ESM Worker Pool Manager
// Manages a pool of worker threads for parallel raw file processing.
// Now supports BATCH task dispatch: each worker receives an array of tasks,
// which reduces Python process spawn overhead by ~20x.

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pino from 'pino';
import client from 'prom-client';
import { PIPELINE_STAGES } from './instrumentation.js';

// Derive __dirname equivalent in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the worker script path
const workerScriptPath = path.join(__dirname, "rawFileWorker.js");

// Controls how many raw files are sent per Python process spawn.
//
// MEMORY / PERF TRADEOFF
// ----------------------
// Each Python child imports numpy + PIL (and dumpread/tipread modules) once,
// costing ~200–350 MB of commit regardless of the number of files it then
// processes.  Per-file work (reading bytes + png/npz save + small vectorized
// numpy ops) adds only ~2 MB/child of transient peak.
//
// Therefore:
//   * BATCH_SIZE=1  =>  pay the 200–350 MB import cost PER FILE.
//                        100 files  →  100 spawns  →  ~20–35 GB commit transient
//   * BATCH_SIZE=20 =>  pay import cost once per 20 files.
//                        100 files  →    5 spawns  →  ~1–1.75 GB commit  (≈20× less!)
//
// The constant 20 keeps per-process runtime bounded (protects against any
// minor leak within process_raw_file.py) while still giving ~20× reduction
// in interpreter-spawn overhead and commit pressure.
const BATCH_SIZE = 20;

/**
 * WorkerPool - Manages a fixed pool of Worker Threads
 * 
 * Maintains N concurrent workers. Tasks are batched together (up to BATCH_SIZE)
 * before being dispatched to a worker, reducing Python process spawn overhead.
 */
class WorkerPool {
  /**
   * Create a new WorkerPool
   * @param {number} size - Number of workers to create (default: 4)
   */
  constructor(size = 4) {
    this.logger = pino({ level: process.env.LOG_LEVEL || 'info' });

    // Metrics
    try {
      this.batchDuration = new client.Histogram({
        name: 'worker_batch_duration_seconds',
        help: 'Time to process a worker batch',
        buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
      });
    } catch (e) {
      // metrics lib may be initialized elsewhere; ignore if fails
    }
    this.size = size;
    this.idle = new Set();
    this.queue = [];           // Array of { tasks, onResult } batches waiting
    this._drainResolvers = [];
    this._pendingBatches = 0;  // Track total outstanding batches
    
    // Accumulation buffer for incoming single tasks
    this._batchBuffer = [];         // Array of { item, callback }
    this._batchTimer = null;
    
    // Pre-create workers and add them to idle set
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScriptPath);
      
      // Attach pool-level error handler for uncaught worker errors
      worker.on("error", (err) => {
        // Replace the crashed worker with a fresh one
        this.idle.delete(worker);
        
        const newWorker = new Worker(workerScriptPath);
        this._attachErrorHandler(newWorker);
        this.idle.add(newWorker);
        this._checkDrain();
      });
      
      this.idle.add(worker);
    }
  }

  /**
   * Attach error handler to a worker (used for replacement workers)
   * @param {Worker} worker - The worker to attach the error handler to
   * @private
   */
  _attachErrorHandler(worker) {
    worker.on("error", (err) => {
      this.idle.delete(worker);
      const newWorker = new Worker(workerScriptPath);
      this._attachErrorHandler(newWorker);
      this.idle.add(newWorker);
      this._checkDrain();
    });
  }

  /**
   * Flush the batch buffer and send accumulated tasks to a worker
   * @private
   */
  _flushBatch() {
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    
    if (this._batchBuffer.length === 0) return;
    
    const buffer = this._batchBuffer;
    this._batchBuffer = [];
    this._sendBatch(buffer);
  }

  /**
   * Send a pre-assembled batch of tasks to an idle worker
   * @param {Array<{item: object, callback: Function}>} batchEntries
   * @private
   */
  _sendBatch(batchEntries) {
    if (this.idle.size > 0) {
      // Get an idle worker
      const worker = this.idle.values().next().value;
      this.idle.delete(worker);
      this._pendingBatches++;
      this.logger.info({ batchSize: batchEntries.length, pending: this._pendingBatches, stage: PIPELINE_STAGES.WORKER_DISPATCH }, 'workerpool_send_batch');
      const batchStart = process.hrtime.bigint();
      
      // Send the tasks array to the worker (worker expects an array)
      worker.postMessage({ tasks: batchEntries.map(e => e.item) });
      
      // Track how many results we expect
      let resultsReceived = 0;
      const totalExpected = batchEntries.length;
      let batchFailed = false;
      
      // Listen for multiple results from this batch
      const messageHandler = (result) => {
        // Ignore results if batch already failed (worker crashed)
        if (batchFailed) return;

        resultsReceived++;

        // Route the result to the matching callback by itemId.
        // Python result IDs should match entry.item.itemId for successes.
        // For generic errors (id="parse", id="batch", or unknown IDs)
        // fall back to the next remaining entry that hasn't been routed yet,
        // so no task is ever left dangling.
        let routed = false;
        const entryId = entry => entry.item.itemId;
        for (const entry of batchEntries) {
          if (!entry._routed && entryId(entry) === result.id) {
            entry._routed = true;
            routed = true;
            if (entry.callback) entry.callback(result);
            break;
          }
        }
        if (!routed) {
          // Fallback: assign to the next unrouted entry regardless of id.
          // This preserves per-file progress even when the worker reports
          // errors that aren't keyed by itemId.
          for (const entry of batchEntries) {
            if (!entry._routed) {
              entry._routed = true;
              routed = true;
              // Preserve the originating itemId so server.js writes the correct filename.
              const normalized = {
                ...result,
                id: entryId(entry),
              };
              if (entry.callback) entry.callback(normalized);
              break;
            }
          }
        }
        
        // If all results received, return worker to idle
        if (resultsReceived >= totalExpected) {
          // Safety: any still-unrouted entries (e.g. worker said fewer results than expected)
          // produce a synthetic error so they don't hang forever.
          for (const entry of batchEntries) {
            if (!entry._routed) {
              entry._routed = true;
              if (entry.callback) {
                entry.callback({
                  status: "error",
                  id: entryId(entry),
                  reason: `Worker did not return a result for this file (got ${resultsReceived}/${totalExpected})`,
                });
              }
            }
          }

          this._pendingBatches--;
          worker.removeListener("message", messageHandler);
          this.idle.add(worker);
          const batchDurationSec = Number(process.hrtime.bigint() - batchStart) / 1e9;
          try { this.batchDuration && this.batchDuration.observe(batchDurationSec); } catch (e) {}
          this.logger.info({ 
            resultsReceived, 
            totalExpected, 
            pending: this._pendingBatches, 
            duration_s: batchDurationSec,
            stage: PIPELINE_STAGES.WORKER_DISPATCH 
          }, 'workerpool_batch_complete');
          
          // Process next queued batch if any
          if (this.queue.length > 0) {
            const nextBatch = this.queue.shift();
            this._sendBatch(nextBatch);
          }
          
          this._checkDrain();
        }
      };
      
      // Handle worker errors - retry the entire batch with a different worker
      const errorHandler = (err) => {
        if (batchFailed) return; // Already handled
        batchFailed = true;
        
        console.error(`[WorkerPool] Worker crashed mid-batch (${resultsReceived}/${totalExpected} results received). Retrying ${batchEntries.length} tasks...`, err);
        
        this._pendingBatches--;
        worker.removeListener("message", messageHandler);
        worker.removeListener("error", errorHandler);
        
        // Retry all tasks in the batch (even ones that succeeded, to ensure consistency)
        for (const entry of batchEntries) {
          this.addTask(entry.item, entry.callback);
        }
        
        // Process next queued batch
        if (this.queue.length > 0) {
          const nextBatch = this.queue.shift();
          this._sendBatch(nextBatch);
        }
        
        this._checkDrain();
      };
      
      worker.on("message", messageHandler);
      worker.on("error", errorHandler);
    } else {
      // No idle workers, queue entire batch
      this.queue.push(batchEntries);
      this.logger.info({ queuedSize: batchEntries.length, queueLength: this.queue.length }, 'workerpool_queued_batch');
    }
  }

  /**
   * Add a task to be processed by the worker pool.
   * Tasks are accumulated into batches before dispatch.
   * @param {Object} task - The task object to process
   * @param {Function} onResult - Callback to invoke when the task completes
   */
  addTask(task, onResult) {
    this._batchBuffer.push({ item: task, callback: onResult });
    
    // If buffer reaches BATCH_SIZE, flush immediately
    if (this._batchBuffer.length >= BATCH_SIZE) {
      this._flushBatch();
    } else if (this.idle.size > 0 && this.queue.length === 0) {
      // Workers are idle and no queued batches, flush after a short delay
      // to allow more tasks to accumulate
      if (!this._batchTimer) {
        this._batchTimer = setTimeout(() => this._flushBatch(), 50);
      }
    }
  }

  /**
   * Returns a Promise that resolves when all workers are idle and queue is empty
   * @returns {Promise<void>}
   */
  drain() {
    // Flush any remaining tasks in the buffer
    this._flushBatch();
    
    return new Promise((resolve) => {
      if (this.idle.size === this.size && this.queue.length === 0 && this._pendingBatches === 0) {
        resolve();
        return;
      }
      this._drainResolvers.push(resolve);
    });
  }

  /**
   * Check if the pool is fully drained and resolve any pending drain promises
   * @private
   */
  _checkDrain() {
    if (this.idle.size === this.size && this.queue.length === 0 && this._pendingBatches === 0) {
      const resolvers = this._drainResolvers;
      this._drainResolvers = [];
      resolvers.forEach(resolve => resolve());
    }
  }
}

export default WorkerPool;