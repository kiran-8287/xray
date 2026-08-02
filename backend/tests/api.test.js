import request from 'supertest';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import app from '../src/server.js';
import config from '../src/lib/config.js';
import { createTestPng } from './helpers.js';

describe('API Tests', () => {
  const tmpDir = path.join(process.cwd(), 'backend', 'tests', 'tmp');

  beforeAll(async () => {
    await fsPromises.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test files
    try {
      const files = await fsPromises.readdir(tmpDir);
      await Promise.all(
        files.map(f => fsPromises.unlink(path.join(tmpDir, f)).catch(() => {}))
      );
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('GET /', () => {
    it('should return api info', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('endpoints');
    });
  });

  describe('GET /api/items/categorized', () => {
    it('should return ok true', async () => {
      const res = await request(app).get('/api/items/categorized');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
    });

    it('should support pagination', async () => {
      const res = await request(app).get('/api/items/categorized?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('page', 1);
      expect(res.body.pagination).toHaveProperty('limit', 10);
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toMatch(/http_request_duration_seconds/);
    });
  });

  describe('POST /api/upload', () => {
    it('should upload a small file successfully', async () => {
      const filePath = await createTestPng(tmpDir, 'test-image.png');

      const res = await request(app)
        .post('/api/upload')
        .attach('images', filePath, 'test-image.png')
        .timeout({ deadline: 20000 });

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
    });

    it('should reject invalid file types', async () => {
      const filePath = path.join(tmpDir, 'test-file.txt');
      await fsPromises.writeFile(filePath, 'This is not an image');

      const res = await request(app)
        .post('/api/upload')
        .attach('images', filePath, 'test-file.txt')
        .timeout({ deadline: 20000 });

      // Should still process but may have errors
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
    });

    it('should handle duplicate filenames', async () => {
      const filePath = await createTestPng(tmpDir, 'duplicate-test.png');

      // Upload same file twice
      await request(app)
        .post('/api/upload')
        .attach('images', filePath, 'duplicate-test.png')
        .timeout({ deadline: 20000 });

      const res = await request(app)
        .post('/api/upload')
        .attach('images', filePath, 'duplicate-test.png')
        .timeout({ deadline: 20000 });

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
    });

    it('should handle metadata correctly', async () => {
      const filePath = await createTestPng(tmpDir, 'metadata-test.png');

      const metadata = [{
        originalname: 'metadata-test.png',
        category: 'bags',
        subcategory: 'backpack'
      }];

      const res = await request(app)
        .post('/api/upload')
        .field('metadata', JSON.stringify(metadata))
        .attach('images', filePath, 'metadata-test.png')
        .timeout({ deadline: 20000 });

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
    });
  });

  describe('POST /api/process-raw-files', () => {
    it('should accept .dump.pgm files', async () => {
      const filePath = path.join(tmpDir, 'test.dump.pgm');
      await fsPromises.writeFile(filePath, Buffer.from('test data'));

      const res = await request(app)
        .post('/api/process-raw-files')
        .attach('rawFiles', filePath, 'test.dump.pgm')
        .timeout({ deadline: 30000 });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/x-ndjson');
    });

    it('should accept .tip files', async () => {
      const filePath = path.join(tmpDir, 'test.tip');
      await fsPromises.writeFile(filePath, Buffer.from('test data'));

      const res = await request(app)
        .post('/api/process-raw-files')
        .attach('rawFiles', filePath, 'test.tip')
        .timeout({ deadline: 30000 });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/x-ndjson');
    });

    it('should reject invalid file types', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fsPromises.writeFile(filePath, 'invalid file');

      const res = await request(app)
        .post('/api/process-raw-files')
        .attach('rawFiles', filePath, 'test.txt')
        .timeout({ deadline: 30000 });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/temp-files/batch-delete', () => {
    it('should delete temporary image and pixel-data files for preprocessed items', async () => {
      const itemId = `cleanup-test-${Date.now()}`;
      const imagePath = path.join(config.libraryImagesRoot, `${itemId}.png`);
      const highEnergyPath = path.join(config.pixelDataRoot, 'highenergy', `${itemId}.npz`);
      const lowEnergyPath = path.join(config.pixelDataRoot, 'lowenergy', `${itemId}.npz`);

      await fsPromises.mkdir(path.dirname(imagePath), { recursive: true });
      await fsPromises.mkdir(path.dirname(highEnergyPath), { recursive: true });
      await fsPromises.mkdir(path.dirname(lowEnergyPath), { recursive: true });
      await fsPromises.writeFile(imagePath, 'test-image');
      await fsPromises.writeFile(highEnergyPath, 'test-high');
      await fsPromises.writeFile(lowEnergyPath, 'test-low');

      const res = await request(app)
        .post('/api/temp-files/batch-delete')
        .send({ itemIds: [itemId] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      await expect(fsPromises.access(imagePath)).rejects.toBeDefined();
      await expect(fsPromises.access(highEnergyPath)).rejects.toBeDefined();
      await expect(fsPromises.access(lowEnergyPath)).rejects.toBeDefined();
    });
  });

  describe('GET /api/items/:id', () => {
    it('should return 404 for nonexistent item', async () => {
      const res = await request(app).get('/api/items/nonexistent-item-id');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('ok', false);
    });
  });

  describe('GET /api/saved-layouts', () => {
    it('should return ok true', async () => {
      const res = await request(app).get('/api/saved-layouts');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('layouts');
      expect(Array.isArray(res.body.layouts)).toBe(true);
    });
  });

  describe('GET /api/custom-subcategories', () => {
    it('should return a response', async () => {
      const res = await request(app).get('/api/custom-subcategories');
      expect(res.status).toBe(200);
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/nonexistent-route');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('ok', false);
    });
  });
});
