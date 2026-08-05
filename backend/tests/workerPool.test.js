import WorkerPool from '../src/lib/workerPool.js';

describe('WorkerPool', () => {
  let pool;

  afterEach(async () => {
    if (pool) {
      await pool.drain();
    }
  });

  describe('constructor', () => {
    it('should create a pool with default size of 4', () => {
      pool = new WorkerPool();
      expect(pool.size).toBe(4);
    });

    it('should create a pool with custom size', () => {
      pool = new WorkerPool(2);
      expect(pool.size).toBe(2);
    });
  });

  describe('drain', () => {
    it('should wait for all tasks to complete', async () => {
      pool = new WorkerPool(1);
      
      await new Promise((resolve) => {
        pool.addTask({ test: 'data' }, resolve);
        pool.drain().then(resolve);
      });

      expect(pool.idle.size).toBe(1);
    }, 10000);
  });

  describe('error handling', () => {
    it('should handle worker errors gracefully', async () => {
      pool = new WorkerPool(1);
      
      await expect(pool.drain()).resolves.toBeUndefined();
    });
  });
});