import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('systemInfo config repair', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xray-system-config-'));
    process.env.DATA_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('repairs a persisted config with an impossible worker count', async () => {
    const configPath = path.join(tempDir, 'system-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          cpuCount: 12,
          cpuModel: 'test-model',
          optimalWorkerCount: 99,
          detectedAt: '2026-08-02T05:44:34.548Z',
          lastUpdated: '2026-08-02T05:44:34.548Z',
        },
        null,
        2,
      ),
    );

    const { initializeSystemConfig } = await import('../src/lib/systemInfo.js');

    const refreshed = await initializeSystemConfig();

    expect(refreshed.optimalWorkerCount).toBeGreaterThanOrEqual(1);
    expect(refreshed.optimalWorkerCount).toBeLessThanOrEqual(8);
    expect(refreshed.optimalWorkerCount).not.toBe(99);

    const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(saved.optimalWorkerCount).toBe(refreshed.optimalWorkerCount);
  });
});
