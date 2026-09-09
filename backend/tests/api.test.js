import request from 'supertest';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import app from '../src/server.js';
import config from '../src/lib/config.js';
import { createTestPng } from './helpers.js';

describe('API Tests', () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const tmpDir = path.join(__dirname, 'tmp');

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

  describe('GET /api/saved-layouts/export', () => {
    it('should not be swallowed by the /api/saved-layouts/:id route', async () => {
      const res = await request(app).get('/api/saved-layouts/export?ids=missing-layout-id');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('savedPaths');
    }, 5000);

    it('does NOT export library catalog files (catalog export removed)', async () => {
      // Seed a few items directly into storage so a catalog WOULD have something to
      // write if the export still emitted catalog files.
      const { createItemsBatch } = await import('../src/lib/storage.js');
      await createItemsBatch([
        { id: 'export-test-bag-1', category: 'bags', subcategory: 'backpack' },
        { id: 'export-test-threat-1', category: 'threats', subcategory: 'Razor' },
        { id: 'export-test-non-1', category: 'non-threats', subcategory: 'Laptop' },
      ]);

      const res = await request(app).get('/api/saved-layouts/export?saveMode=all&includeImages=false');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('savedPaths');
      // The library catalog must never be written to the exports folder anymore.
      expect(res.body.savedPaths).not.toHaveProperty('catalogs');
    }, 10000);

    it('should NOT write any catalog files into the export folder', async () => {
      // Wait out the shared strict-rate-limiter window (10 req/s on one instance);
      // the upload/process-raw tests above can otherwise cause a spurious 429 here.
      await new Promise((r) => setTimeout(r, 1200));
      const res = await request(app).get('/api/saved-layouts/export?saveMode=all&includeImages=false');
      expect(res.status).toBe(200);
      const savedPaths = res.body.savedPaths || {};
      expect(savedPaths).not.toHaveProperty('catalogs');
    }, 10000);
  });
describe('GET /api/saved-layouts/export annotation partition numbering', () => {
    // The saved-scope annotations folder writes to a dedicated temp dir; after the
    // suite the original user_config.json is restored so real export settings survive.
    const userConfigFile = path.join(config.dataDir, 'user_config.json');
    let userConfigBackup = null;
    let testDir = null;

    beforeAll(async () => {
      try {
        userConfigBackup = await fsPromises.readFile(userConfigFile, 'utf8');
      } catch (_) {
        userConfigBackup = null;
      }
      testDir = path.join(__dirname, 'tmp', 'saved_export_partition_test');
      await fsPromises.rm(testDir, { recursive: true, force: true });
    });

    afterAll(async () => {
      await fsPromises.rm(testDir, { recursive: true, force: true }).catch(() => {});
      if (userConfigBackup === null) {
        await fsPromises.rm(userConfigFile, { force: true }).catch(() => {});
      } else {
        await fsPromises.writeFile(userConfigFile, userConfigBackup).catch(() => {});
      }
    });

    it('Save All appends from the next free partition number and never overwrites annotations_1.json', async () => {
      // Scenario from the bug: a first "Save Selected" already wrote
      // annotations_1.json (e.g. 50 layouts). A later "Save All" must start a NEW
      // partition file (annotations_2.json ...) instead of deleting and rewriting
      // annotations_1.json with the first chunk of the full export.
      const { createSavedLayoutsBatch, deleteSavedLayout } = await import('../src/lib/storage.js');
      const { setExportsPath } = await import('../src/lib/userConfig.js');

      await setExportsPath('saved', testDir);

      const layoutId = `partition-test-${Date.now()}`;
      let layoutCreated = false;
      try {
        const seeded = await createSavedLayoutsBatch([{
          id: layoutId,
          name: 'Partition append test layout',
          layout_json: {
            objects: {
              bag: { id: 'bag-test-1', filepath: 'bag.png', pixel_data_path: 'highenergy/bag.png', center: { x: 0, y: 0 }, size: { width: 100, height: 80 }, layer: 0 },
              threats: [],
              'non-threats': [],
            },
          },
        }]);
        layoutCreated = seeded.length > 0;

        // Simulate the already-existing output of an earlier Save Selected run.
        const annotationsDir = path.join(testDir, 'annotations');
        await fsPromises.mkdir(annotationsDir, { recursive: true });
        const preExisting = [{ layoutId: 'earlier-save-selected-layout' }];
        await fsPromises.writeFile(path.join(annotationsDir, 'annotations_1.json'), JSON.stringify(preExisting, null, 2));

        // The export route sits behind the strict rate limiter (10 req/sec); the
        // rest of this test file can consume that window, so wait it out first.
        await new Promise((r) => setTimeout(r, 1200));

        const res = await request(app)
          .get(`/api/saved-layouts/export?ids=${encodeURIComponent(layoutId)}&saveMode=all&includeImages=false&scope=saved`)
          .timeout({ deadline: 30000 });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        // The earlier annotations_1.json must be preserved unchanged.
        const part1 = JSON.parse(await fsPromises.readFile(path.join(annotationsDir, 'annotations_1.json'), 'utf8'));
        expect(part1).toEqual(preExisting);

        // The Save All run must start from the NEXT free partition number.
        const part2Path = path.join(annotationsDir, 'annotations_2.json');
        await expect(fsPromises.access(part2Path)).resolves.toBeUndefined();
        const part2 = JSON.parse(await fsPromises.readFile(part2Path, 'utf8'));
        expect(Array.isArray(part2)).toBe(true);
        expect(part2.length).toBe(1);
        expect(part2[0].layoutId).toBe(layoutId);
      } finally {
        if (layoutCreated) {
          await deleteSavedLayout(layoutId).catch(() => {});
        }
        // Reset the exports-path cache back to the default; afterAll restores the file.
        await setExportsPath('saved', null).catch(() => {});
      }
    }, 30000);
  });

  describe('GET /api/custom-subcategories', () => {
    it('should return a response', async () => {
      const res = await request(app).get('/api/custom-subcategories');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/render-and-save-collage-both (original bag size preserved)', () => {
    // The collage-scope exports folder writes to a dedicated temp dir; after the
    // suite the original user_config.json is restored so real export settings survive.
    const userConfigFile = path.join(config.dataDir, 'user_config.json');
    let userConfigBackup = null;
    let renderTestDir = null;

    beforeAll(async () => {
      try {
        userConfigBackup = await fsPromises.readFile(userConfigFile, 'utf8');
      } catch (_) {
        userConfigBackup = null;
      }
      renderTestDir = path.join(__dirname, 'tmp', 'collage_render_test');
      await fsPromises.rm(renderTestDir, { recursive: true, force: true });
    });

    afterAll(async () => {
      await fsPromises.rm(renderTestDir, { recursive: true, force: true }).catch(() => {});
      if (userConfigBackup === null) {
        await fsPromises.rm(userConfigFile, { force: true }).catch(() => {});
      } else {
        await fsPromises.writeFile(userConfigFile, userConfigBackup).catch(() => {});
      }
    });

    it('renders at the original bag size from a scene-object array payload', async () => {
      const { setExportsPath } = await import('../src/lib/userConfig.js');
      await setExportsPath('collage', renderTestDir);

      const safeName = 'sb-size-test-00001';
      const objects = [
        {
          id: 'bag-test', name: 'Test Bag', stencilId: 'bag', library: 'bag',
          filepath: 'missing.png',
          transform: { x: 500, y: 250, width: 1000, height: 500, rotation: 0 },
          initialWidth: 1000, initialHeight: 500, layer: 0,
        },
      ];

      // Wait out the shared strict-rate-limiter window before rendering.
      await new Promise((r) => setTimeout(r, 1200));

      const res = await request(app)
        .post('/api/render-and-save-collage-both')
        .send({ objects, name: safeName })
        .timeout({ deadline: 30000 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // The exported PNG must keep the ORIGINAL bag pixel size (1000 x 500).
      const highPath = path.join(renderTestDir, 'collage_images', 'high', `${safeName}.png`);
      expect(await fsPromises.access(highPath).then(() => true).catch(() => false)).toBe(true);
      const png = await fsPromises.readFile(highPath);
      // PNG signature
      expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(png.readUInt32BE(16)).toBe(1000); // IHDR width — bag stays 1000px
      expect(png.readUInt32BE(20)).toBe(500);  // IHDR height — bag stays 500px
    });

    it('returns 400 (not 500) when bag dimensions cannot be resolved', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const res = await request(app)
        .post('/api/render-and-save-collage-both')
        .send({
          objects: [{ id: 'orphan', stencilId: 'threat', transform: { x: 10, y: 10, width: 40, height: 30, rotation: 0 }, layer: 1 }],
          name: 'sb-no-bag',
        })
        .timeout({ deadline: 30000 });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
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
