/**
 * Concurrency Controller
 * Manages multiple named pools with different concurrency limits
 * Prevents event loop starvation by controlling parallel operations
 */

type TaskFunction<T> = () => Promise<T>;

interface PoolConfig {
  concurrency: number;
  tasks: TaskFunction<any>[];
  executing: number;
}

class ConcurrencyController {
  private pools: Map<string, PoolConfig> = new Map();

  /**
   * Register a pool with a specific concurrency limit
   * @param name - Pool name (e.g., 'upload', 'auto-generate')
   * @param concurrency - Max parallel tasks allowed
   */
  registerPool(name: string, concurrency: number): void {
    this.pools.set(name, {
      concurrency,
      tasks: [],
      executing: 0,
    });
  }

  /**
   * Add a task to a pool and execute it when concurrency allows
   * @param poolName - Name of the registered pool
   * @param task - Async function to execute
   * @returns Promise that resolves with task result
   */
  async execute<T>(poolName: string, task: TaskFunction<T>): Promise<T> {
    const pool = this.pools.get(poolName);
    
    if (!pool) {
      throw new Error(`Pool "${poolName}" not registered. Call registerPool() first.`);
    }

    // Wait until we have capacity (concurrency limit not reached)
    while (pool.executing >= pool.concurrency) {
      // Yield to event loop and check again
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Execute the task
    pool.executing++;
    try {
      return await task();
    } finally {
      pool.executing--;
      // Yield to event loop to allow other tasks to proceed
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /**
   * Execute multiple tasks in parallel with concurrency limit
   * @param poolName - Name of the registered pool
   * @param tasks - Array of async functions to execute
   * @returns Array of results in the same order as tasks
   */
  async executeAll<T>(poolName: string, tasks: TaskFunction<T>[]): Promise<T[]> {
    const pool = this.pools.get(poolName);
    
    if (!pool) {
      throw new Error(`Pool "${poolName}" not registered. Call registerPool() first.`);
    }

    // Execute all tasks with concurrency control
    const promises = tasks.map(task => this.execute(poolName, task));
    return Promise.all(promises);
  }

  /**
   * Get current status of a pool
   */
  getPoolStatus(poolName: string): { concurrency: number; executing: number; queued: number } | null {
    const pool = this.pools.get(poolName);
    if (!pool) return null;
    return {
      concurrency: pool.concurrency,
      executing: pool.executing,
      queued: pool.tasks.length,
    };
  }

  /**
   * Update concurrency limit for a pool
   */
  setConcurrency(poolName: string, concurrency: number): void {
    const pool = this.pools.get(poolName);
    if (pool) {
      pool.concurrency = concurrency;
    }
  }
}

// Export singleton instance
export const concurrencyController = new ConcurrencyController();

// Default pool configurations
export function initializeConcurrencyPools(): void {
  // Upload processing: 4-6 parallel workers (higher priority)
  concurrencyController.registerPool('upload', 4);
  
  // Auto-generate: 1-2 parallel workers (lower priority, x/4 of upload)
  concurrencyController.registerPool('auto-generate', 1);
}

/**
 * Dynamically adjust concurrency based on current load
 * @param uploadProcessing - Whether upload processing is currently active
 */
export function adjustConcurrencyForLoad(uploadProcessing: boolean): void {
  if (uploadProcessing) {
    // When processing: upload gets 10 workers (matches backend for maximum speed)
    // auto-generate gets 2 workers (2 parallel batch requests = max 10 files at a time)
    concurrencyController.setConcurrency('upload', 10);
    concurrencyController.setConcurrency('auto-generate', 2);
  } else {
    // When idle: both can use more resources
    concurrencyController.setConcurrency('upload', 10);
    concurrencyController.setConcurrency('auto-generate', 4);
  }
}
