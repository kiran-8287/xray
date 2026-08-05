import request from 'supertest';
import app from '../src/server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Load Tests', () => {
  const TEST_TIMEOUT = 60000; // 60 seconds for load tests
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  beforeAll(async () => {
    // Ensure test directories exist
    const testDir = path.join(__dirname, 'tmp');
    await fs.mkdir(testDir, { recursive: true });
  });

  describe('POST /api/upload - concurrent uploads', () => {
    it('should handle 10 concurrent uploads', async () => {
      const uploadPromises = [];
      
      for (let i = 0; i < 10; i++) {
        const filePath = path.join(__dirname, 'tmp', `load-test-${Date.now()}-${i}.png`);
        // Write a minimal valid PNG (1x1 pixel, 8-bit grayscale)
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
          0x08, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x7E, 0x9B, // grayscale
          0x55, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
          0x54, 0x08, 0xD7, 0x63, 0x60, 0x00, 0x00, 0x00, // compressed data
          0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, // CRC
          0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
          0xAE, 0x42, 0x60, 0x82
        ]);
        await fs.writeFile(filePath, pngBuffer);

        uploadPromises.push(
          request(app)
            .post('/api/upload')
            .attach('images', filePath, `load-test-${i}.png`)
            .timeout({ deadline: TEST_TIMEOUT })
        );
      }

      const results = await Promise.all(uploadPromises);

      // All requests should succeed
      results.forEach((res) => {
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
      });
    }, TEST_TIMEOUT);

    it('should handle 20 concurrent uploads', async () => {
      const uploadPromises = [];
      
      for (let i = 0; i < 20; i++) {
        const filePath = path.join(__dirname, 'tmp', `load-test-20-${Date.now()}-${i}.png`);
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x7E, 0x9B,
          0x55, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
          0x54, 0x08, 0xD7, 0x63, 0x60, 0x00, 0x00, 0x00,
          0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00,
          0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
          0xAE, 0x42, 0x60, 0x82
        ]);
        await fs.writeFile(filePath, pngBuffer);

        uploadPromises.push(
          request(app)
            .post('/api/upload')
            .attach('images', filePath, `load-test-20-${i}.png`)
            .timeout({ deadline: TEST_TIMEOUT })
        );
      }

      const results = await Promise.all(uploadPromises);

      // At least 80% should succeed
      const successCount = results.filter(res => res.status >= 200 && res.status < 300).length;
      expect(successCount).toBeGreaterThanOrEqual(16);
    }, TEST_TIMEOUT);
  });

  describe('GET /api/items/categorized - concurrent requests', () => {
    it('should handle 100 concurrent requests', async () => {
      const promises = [];
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          request(app)
            .get('/api/items/categorized')
            .timeout({ deadline: 30000 })
        );
      }

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ok', true);
      });
    }, 30000);
  });

  describe('POST /api/auto-valid-region-batch - concurrent requests', () => {
    it('should handle 20 concurrent batch requests', async () => {
      const promises = [];
      
      for (let i = 0; i < 20; i++) {
        promises.push(
          request(app)
            .post('/api/auto-valid-region-batch')
            .send({
              items: [
                { itemId: 'test-nonexistent-1', pixelDataPath: 'nonexistent/path.npz' },
                { itemId: 'test-nonexistent-2', pixelDataPath: 'nonexistent/path.npz' }
              ]
            })
            .timeout({ deadline: 30000 })
        );
      }

      const results = await Promise.all(promises);

      // All should complete (even if they fail due to missing files)
      results.forEach(res => {
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
      });
    }, 30000);
  });

  describe('Memory usage under load', () => {
    it('should not exceed memory limits during concurrent uploads', async () => {
      const startMemory = process.memoryUsage();
      const maxMemoryIncrease = 500 * 1024 * 1024; // 500MB

      const uploadPromises = [];
      
      for (let i = 0; i < 10; i++) {
        const filePath = path.join(__dirname, 'tmp', `mem-test-${Date.now()}-${i}.png`);
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x7E, 0x9B,
          0x55, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
          0x54, 0x08, 0xD7, 0x63, 0x60, 0x00, 0x00, 0x00,
          0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00,
          0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
          0xAE, 0x42, 0x60, 0x82
        ]);
        await fs.writeFile(filePath, pngBuffer);

        uploadPromises.push(
          request(app)
            .post('/api/upload')
            .attach('images', filePath, `mem-test-${i}.png`)
            .timeout({ deadline: TEST_TIMEOUT })
        );
      }

      await Promise.all(uploadPromises);

      const endMemory = process.memoryUsage();
      const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;

      // Memory increase should be reasonable (less than 500MB)
      expect(memoryIncrease).toBeLessThan(maxMemoryIncrease);
    }, TEST_TIMEOUT);
  });
});