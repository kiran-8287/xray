import request from 'supertest';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import app from '../src/server.js';
import config from '../src/lib/config.js';

// Exports-path configuration endpoints:
//   GET /api/user-config/exports-path  (ok:true, paths, configured, platform)
//   POST /api/user-config/exports-path (scope + absolute path; "" resets to default)
//
// Each page (load, saved, collage) has its own independent export path ("scope").

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userConfigFile = path.join(config.dataDir, 'user_config.json');

describe('Exports path configuration', () => {
  let backup = null;
  let testDir = null;

  beforeAll(async () => {
    try {
      backup = await fsPromises.readFile(userConfigFile, 'utf8');
    } catch (_) {
      backup = null;
    }
    testDir = path.join(__dirname, 'tmp_export_path_test');
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  });

  afterAll(async () => {
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
    if (backup === null) {
      try { await fsPromises.rm(userConfigFile, { force: true }); } catch (_) { /* ignore */ }
    } else {
      try { await fsPromises.writeFile(userConfigFile, backup); } catch (_) { /* ignore */ }
    }
  });

  it('GET returns ok, platform, and absolute default paths for each scope', async () => {
    const res = await request(app).get('/api/user-config/exports-path');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.platform).toBe('string');
    expect(res.body.platform.length).toBeGreaterThan(0);
    
    // Each scope should have a path
    for (const scope of ['load', 'saved', 'collage']) {
      expect(typeof res.body.paths[scope]).toBe('string');
      expect(path.isAbsolute(res.body.paths[scope])).toBe(true);
      expect(typeof res.body.configured[scope]).toBe('boolean');
    }
  });

  it('POST rejects relative paths with a helpful message', async () => {
    const res = await request(app)
      .post('/api/user-config/exports-path')
      .send({ scope: 'saved', exportsPath: 'my_exports' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/absolute/i);
  });

  it('POST rejects directory traversal', async () => {
    const res = await request(app)
      .post('/api/user-config/exports-path')
      .send({ exportsPath: '..\\..\\evil' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\.\./);
  });

  it('POST accepts an absolute path and creates the standard subfolders', async () => {
    const res = await request(app)
      .post('/api/user-config/exports-path')
      .send({ exportsPath: testDir });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.exportsPath).toBe('string');
    const savedPath = res.body.exportsPath;
    expect(path.isAbsolute(savedPath)).toBe(true);
    for (const sub of ['high', 'low', 'annotations']) {
      await expect(fsPromises.access(path.join(savedPath, sub))).resolves.toBeUndefined();
    }

    // Reset so we don't leak this folder into later assertions.
    await request(app).post('/api/user-config/exports-path').send({ exportsPath: '' });
    await fsPromises.rm(testDir, { recursive: true, force: true });
  });

  it('POST empty string resets to the default (exportsPath null)', async () => {
    // First set a custom absolute path, then reset it.
    await fsPromises.mkdir(testDir, { recursive: true });
    await request(app).post('/api/user-config/exports-path').send({ exportsPath: testDir });

    const res = await request(app).post('/api/user-config/exports-path').send({ exportsPath: '' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.exportsPath).toBeNull();
  });

  it('POST non-string body is rejected', async () => {
    const res = await request(app)
      .post('/api/user-config/exports-path')
      .send({ exportsPath: 12345 });
    expect(res.status).toBe(400);
  });
});
