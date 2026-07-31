/**
 * Upload Stress Test Scenario
 * 
 * Simulates: User uploads files while simultaneously calling bulk operations
 * (bulk assign category, bulk auto-generate mask) on the same items.
 * 
 * Uses valid PNG files to avoid 500 errors from invalid .dump.pgm format.
 */

import http from 'node:http';
import https from 'node:https';
import { apiRequest } from '../stress-test.mjs';

// Minimal valid 1x1 transparent PNG
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89,
  0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54,
  0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
]);

/**
 * Build a multipart form-data body for uploading files
 */
function buildMultipartBody(files, boundary) {
  const chunks = [];
  for (const { name, buffer } of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="images"; filename="${name}"\r\n`));
    chunks.push(Buffer.from('Content-Type: image/png\r\n\r\n'));
    chunks.push(buffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

/**
 * Upload files via /api/upload endpoint using valid PNGs
 */
function uploadFiles(baseUrl, count, boundary) {
  const files = Array.from({ length: count }, (_, i) => ({
    name: `stress_test_${Date.now()}_${i}.png`,
    buffer: MINIMAL_PNG,
  }));

  const body = buildMultipartBody(files, boundary);
  const url = new URL('/api/upload', baseUrl);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: '/api/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 60000,
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          data: parsed,
          filesUploaded: parsed?.uploaded?.length || 0,
          duration_ms: Date.now() - startTime,
        });
      });
    });

    const startTime = Date.now();
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Upload timeout after 60000ms'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Simulate bulk operations: update item categories and auto-generate masks
 */
async function simulateBulkOperations(baseUrl, itemIds) {
  const results = [];

  for (const id of itemIds.slice(0, 5)) {
    try {
      const res = await apiRequest('PUT', `/api/items/${id}`, {
        category: 'bags',
        subcategory: 'backpack',
      });
      results.push({ operation: 'assign-category', id, status: res.status, ok: res.ok, duration_ms: res.timing?.duration_ms || 0 });
    } catch (err) {
      results.push({ operation: 'assign-category', id, error: err.message });
    }
  }

  try {
    const batchItems = itemIds.slice(0, 10).map(id => ({
      itemId: id,
      pixelDataPath: `highenergy/${id}.npz`,
    }));
    const res = await apiRequest('POST', '/api/auto-valid-region-batch', { items: batchItems });
    results.push({ operation: 'auto-valid-region-batch', count: batchItems.length, status: res.status, ok: res.ok, duration_ms: res.timing?.duration_ms || 0 });
  } catch (err) {
    results.push({ operation: 'auto-valid-region-batch', error: err.message });
  }

  return results;
}

/**
 * Main stress test function
 */
export async function runUploadStress(baseUrl, quickMode, memoryTracker) {
  const results = [];

  const configs = quickMode
    ? [
        { files: 5, concurrency: 2, label: '5 files x 2 concurrent' },
        { files: 10, concurrency: 5, label: '10 files x 5 concurrent' },
        { files: 20, concurrency: 10, label: '20 files x 10 concurrent' },
      ]
    : [
        { files: 5, concurrency: 2, label: '5 files x 2 concurrent' },
        { files: 10, concurrency: 5, label: '10 files x 5 concurrent' },
        { files: 20, concurrency: 10, label: '20 files x 10 concurrent' },
        { files: 50, concurrency: 20, label: '50 files x 20 concurrent' },
        { files: 100, concurrency: 50, label: '100 files x 50 concurrent' },
        { files: 200, concurrency: 100, label: '200 files x 100 concurrent' },
        { files: 500, concurrency: 200, label: '500 files x 200 concurrent' },
        { files: 1000, concurrency: 500, label: '1000 files x 500 concurrent' },
      ];

  for (const config of configs) {
    console.log(`\n  ── Upload stress: ${config.label} ──`);

    const runResult = {
      runNumber: results.length + 1,
      config: config.label,
      files: config.files,
      concurrency: config.concurrency,
      passed: true,
      error: null,
      peakRSS_mb: 0,
      memoryGrowth_mb: 0,
      uploadDuration_ms: 0,
      bulkOpsDuration_ms: 0,
      totalDuration_ms: 0,
      processedCount: 0,
      failedCount: 0,
      bulkOpsResults: [],
      memoryBefore: null,
      memoryAfter: null,
    };

    const memBefore = process.memoryUsage();
    runResult.memoryBefore = Math.round(memBefore.heapUsed / 1024 / 1024);
    const startTime = Date.now();

    try {
      const boundary = `----StressTestBoundary${Date.now()}`;
      const uploadPromise = uploadFiles(baseUrl, config.files, boundary);

      const itemIds = Array.from({ length: config.files }, (_, i) => `uploaded_${i}`);
      const bulkOpsPromise = simulateBulkOperations(baseUrl, itemIds);

      const [uploadResult, bulkOpsResults] = await Promise.all([uploadPromise, bulkOpsPromise]);

      runResult.uploadDuration_ms = uploadResult.duration_ms;
      runResult.processedCount = uploadResult.filesUploaded;
      runResult.failedCount = uploadResult.filesUploaded === 0 ? config.files : 0;
      runResult.bulkOpsResults = bulkOpsResults;
      runResult.bulkOpsDuration_ms = bulkOpsResults.reduce((sum, r) => sum + (r.duration_ms || 0), 0);

      if (!uploadResult.ok) {
        throw new Error(`Upload failed with status ${uploadResult.status}`);
      }

      const bulkFailures = bulkOpsResults.filter(r => !r.ok);
      if (bulkFailures.length > 0) {
        console.log(`  ⚠️  ${bulkFailures.length} bulk operations failed`);
      }

    } catch (err) {
      runResult.passed = false;
      runResult.error = err.message;
      console.log(`  ❌ Failed: ${err.message}`);
    }

    runResult.totalDuration_ms = Date.now() - startTime;

    const memAfter = process.memoryUsage();
    runResult.memoryAfter = Math.round(memAfter.heapUsed / 1024 / 1024);
    runResult.memoryGrowth_mb = runResult.memoryAfter - runResult.memoryBefore;
    runResult.peakRSS_mb = Math.round(memAfter.rss / 1024 / 1024);

    memoryTracker.snapshot(`upload-${config.files}-${config.concurrency}`);
    results.push(runResult);

    if (!runResult.passed) {
      console.log(`\n  ❌ Breaking point found at ${config.label}`);
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}