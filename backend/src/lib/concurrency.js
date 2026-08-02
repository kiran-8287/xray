// concurrency.js — Tiny zero-dep async semaphore / task-runner utilities.
//
// Usage:
//   import { Semaphore, withSemaphore, chunked } from './concurrency.js';
//   const sem = new Semaphore(4);
//   await Promise.all(items.map(item => sem.run(() => work(item))));
//
// Or equivalently:
//   const results = await withSemaphore(4, items, work);
//

export class Semaphore {
  /**
   * @param {number} concurrency — max number of callers executing at once
   */
  constructor(concurrency) {
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new TypeError('Semaphore concurrency must be >= 1');
    }
    this._concurrency = concurrency;
    this._running = 0;
    /** @type {Array<() => void>} */
    this._queue = [];
  }

  /** Acquire a slot. Resolves when the caller may run. */
  async acquire() {
    if (this._running < this._concurrency) {
      this._running++;
      return;
    }
    await new Promise((resolve) => this._queue.push(resolve));
    this._running++;
  }

  /** Release a slot, waking the next waiter if any. */
  release() {
    this._running--;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      // caller is just about to increment running after resolving
      next();
    }
  }

  /**
   * Run fn under the semaphore. Equivalent to acquire → await fn → release,
   * with release guaranteed via try/finally.
   */
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Number of currently executing callers (introspection / metrics). */
  get running() {
    return this._running;
  }

  /** Number of waiters queued (introspection / metrics). */
  get queued() {
    return this._queue.length;
  }
}

/**
 * Map `items` through `worker` with at most `concurrency` concurrent workers.
 * Returns an array of results matching the `Promise.allSettled` shape so the
 * caller can inspect individual successes/failures.
 *
 * @template T, U
 * @param {number} concurrency
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<U>} worker
 * @returns {Promise<Array<PromiseSettledResult<U>>>}
 */
export async function withSemaphore(concurrency, items, worker) {
  const sem = new Semaphore(concurrency);
  return Promise.allSettled(
    items.map((item, i) => sem.run(() => worker(item, i)))
  );
}

/**
 * Split an array into chunks of at most `size` elements each. Last chunk may
 * be smaller. Preserves input order.
 *
 * @template T
 * @param {T[]} arr
 * @param {number} size — must be >= 1
 * @returns {T[][]}
 */
export function chunked(arr, size) {
  if (!Number.isFinite(size) || size < 1) {
    throw new TypeError('chunk size must be >= 1');
  }
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
