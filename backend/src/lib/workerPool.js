// workerPool.js — ESM Worker Pool Manager
// Manages a pool of 4 worker threads for parallel raw file processing

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Derive __dirname equivalent in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the worker script path
const workerScriptPath = path.join(__dirname, "rawFileWorker.js");

/**
 * WorkerPool - Manages a fixed pool of Worker Threads
 * 
 * Maintains exactly 4 concurrent workers for processing raw files.
 * Queues additional tasks when all workers are busy.
 */
class WorkerPool {
  /**
   * Create a new WorkerPool
   * @param {number} size - Number of workers to create (default: 4)
   */
  constructor(size = 4) {
    this.size = size;
    this.idle = new Set();
    this.queue = [];
    this._drainResolvers = [];
    this._activeTaskForWorker = new Map();

    // Pre-create workers and add them to idle set
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScriptPath);
      
      // Attach pool-level error handler for uncaught worker errors
      worker.on("error", (err) => {
        // Get the active task for this worker (if any)
        const activeTask = this._activeTaskForWorker.get(worker);
        
        if (activeTask) {
          // Synthesize an error result for the active task
          const errorResult = {
            status: "error",
            id: activeTask.itemId,
            reason: err.message || "Worker thread error"
          };
          
          // Call the onResult callback
          if (activeTask.onResult) {
            activeTask.onResult(errorResult);
          }
          
          // Clean up the active task mapping
          this._activeTaskForWorker.delete(worker);
        }
        
        // Replace the crashed worker with a fresh one
        const wasInIdle = this.idle.has(worker);
        this.idle.delete(worker);
        
        // Create a new worker to replace the crashed one
        const newWorker = new Worker(workerScriptPath);
        
        // Attach the same error handler to the new worker
        newWorker.on("error", (err) => {
          const task = this._activeTaskForWorker.get(newWorker);
          if (task) {
            const result = {
              status: "error",
              id: task.itemId,
              reason: err.message || "Worker thread error"
            };
            if (task.onResult) {
              task.onResult(result);
            }
            this._activeTaskForWorker.delete(newWorker);
          }
          this.idle.delete(newWorker);
          const replacement = new Worker(workerScriptPath);
          // Re-attach error handler recursively
          this._attachErrorHandler(replacement);
          this.idle.add(replacement);
          this._checkDrain();
        });
        
        // Add the new worker to idle
        this.idle.add(newWorker);
        
        // Check if we're now drained
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
      const activeTask = this._activeTaskForWorker.get(worker);
      
      if (activeTask) {
        const errorResult = {
          status: "error",
          id: activeTask.itemId,
          reason: err.message || "Worker thread error"
        };
        
        if (activeTask.onResult) {
          activeTask.onResult(errorResult);
        }
        
        this._activeTaskForWorker.delete(worker);
      }
      
      this.idle.delete(worker);
      
      // Create replacement worker
      const newWorker = new Worker(workerScriptPath);
      this._attachErrorHandler(newWorker);
      this.idle.add(newWorker);
      this._checkDrain();
    });
  }

  /**
   * Add a task to be processed by the worker pool
   * @param {Object} task - The task object to process
   * @param {Function} onResult - Callback to invoke when the task completes
   */
  addTask(task, onResult) {
    this._runTask(task, onResult);
  }

  /**
   * Internal method to run a task on an available worker
   * @param {Object} task - The task object to process
   * @param {Function} onResult - Callback to invoke when the task completes
   * @private
   */
  _runTask(task, onResult) {
    if (this.idle.size > 0) {
      // Get an idle worker
      const worker = this.idle.values().next().value;
      this.idle.delete(worker);
      
      // Track the active task for this worker
      this._activeTaskForWorker.set(worker, { task, onResult, itemId: task.itemId });
      
      // Send the task to the worker
      worker.postMessage(task);
      
      // Listen for the result
      worker.once("message", (result) => {
        // Clean up the active task mapping
        this._activeTaskForWorker.delete(worker);
        
        // Call the onResult callback
        if (onResult) {
          onResult(result);
        }
        
        // Return worker to idle
        this.idle.add(worker);
        
        // Process the queue if there are pending tasks
        if (this.queue.length > 0) {
          const nextTask = this.queue.shift();
          this._runTask(nextTask.task, nextTask.onResult);
        }
        
        // Check if we're now drained
        this._checkDrain();
      });
    } else {
      // No idle workers, queue the task
      this.queue.push({ task, onResult });
    }
  }

  /**
   * Returns a Promise that resolves when all workers are idle and queue is empty
   * @returns {Promise<void>}
   */
  drain() {
    return new Promise((resolve) => {
      // If already drained, resolve immediately
      if (this.idle.size === this.size && this.queue.length === 0) {
        resolve();
        return;
      }
      
      // Otherwise, add resolver to be called later
      this._drainResolvers.push(resolve);
    });
  }

  /**
   * Check if the pool is fully drained and resolve any pending drain promises
   * @private
   */
  _checkDrain() {
    if (this.idle.size === this.size && this.queue.length === 0) {
      // Resolve all pending drain promises
      const resolvers = this._drainResolvers;
      this._drainResolvers = [];
      resolvers.forEach(resolve => resolve());
    }
  }
}

export default WorkerPool;
