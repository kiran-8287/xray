/**
 * Upload Benchmark Suite
 * Tests upload performance with 500, 1000, 5000, 10000 files
 * Measures: throughput, latency, memory growth, worker efficiency
 * Note: Server has a 5000-file limit per request, so 10000 is split into 2 batches
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:8080';
const RESULTS_DIR = path.join(__dirname, 'reports');

// Benchmark configurations
const BENCHMARK_SIZES = [500, 1000, 5000, 10000];

/**
 * Generate a small test file (simulating a .dump.pgm file)
 */
function generateTestFile(sizeKB = 50) {
  const buffer = Buffer.alloc(sizeKB * 1024);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
}

/**
 * Create test files for benchmarking
 */
async function createTestFiles(count, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  
  console.log(`Creating ${count} test files...`);
  const startTime = Date.now();
  
  // Create files in batches to avoid "too many open files" error
  const BATCH_SIZE = 100;
  const buffer = generateTestFile(50); // 50KB per file
  
  for (let i = 0; i < count; i += BATCH_SIZE) {
    const batchPromises = [];
    const batchEnd = Math.min(i + BATCH_SIZE, count);
    
    for (let j = i; j < batchEnd; j++) {
      const filePath = path.join(outputDir, `test_file_${j}_P01X010-2024101200${String(j).padStart(4, '0')}.dump.pgm`);
      batchPromises.push(fs.writeFile(filePath, buffer));
    }
    
    await Promise.all(batchPromises);
    console.log(`  Created ${batchEnd}/${count} files...`);
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`Created ${count} files in ${duration.toFixed(2)}s`);
  
  return outputDir;
}

/**
 * Upload a batch of files using HTTP multipart request
 * Server limit is 5000 files per request, so large benchmarks must be split
 */
async function uploadBatch(files, batchSize) {
  const batch = files.slice(0, batchSize);
  
  const boundary = `----FormBoundary${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chunks = [];
  
  for (const filePath of batch) {
    const fileBuffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath);
    
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="images"; filename="${fileName}"\r\n`));
    chunks.push(Buffer.from('Content-Type: application/octet-stream\r\n\r\n'));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from('\r\n'));
  }
  
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  
  const body = Buffer.concat(chunks);
  
  return new Promise((resolve, reject) => {
    const url = new URL(TARGET_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: '/api/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          filesUploaded: batch.length,
          response: data,
        });
      });
    });
    
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

/**
 * Upload files (auto-splits into batches of 4500 to stay within server limits)
 */
async function uploadFiles(fileDir, fileCount) {
  const files = await fs.readdir(fileDir);
  const filesToUpload = files.slice(0, fileCount);
  
  console.log(`Uploading ${filesToUpload.length} files...`);
  const startTime = Date.now();
  
  const MAX_BATCH = 4500; // Stay safely under the 5000 limit
  const filePaths = filesToUpload.map(f => path.join(fileDir, f));
  const totalFiles = filePaths.length;
  
  let totalUploaded = 0;
  let lastError = null;
  
  // Upload in batches if needed
  for (let i = 0; i < totalFiles; i += MAX_BATCH) {
    const batchEnd = Math.min(i + MAX_BATCH, totalFiles);
    const batchPaths = filePaths.slice(i, batchEnd);
    
    console.log(`  Sending batch ${i + 1} to ${batchEnd} of ${totalFiles}...`);
    const result = await uploadBatch(batchPaths, batchEnd - i);
    
    totalUploaded += result.filesUploaded;
    
    if (!result.success) {
      lastError = result;
      break;
    }
  }
  
  const duration = (Date.now() - startTime) / 1000;
  const throughput = totalUploaded / duration;
  
  return {
    success: lastError === null,
    statusCode: lastError ? lastError.statusCode : 200,
    filesUploaded: totalUploaded,
    duration,
    throughput,
    response: lastError ? lastError.response : null,
  };
}

/**
 * Get system metrics
 */
async function getSystemMetrics() {
  try {
    const os = await import('node:os');
    return {
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
    };
  } catch (err) {
    return { totalMemoryMB: 0, freeMemoryMB: 0 };
  }
}

/**
 * Run benchmark for a specific file count
 */
async function runBenchmark(fileCount, testDir) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BENCHMARK: ${fileCount} files`);
  console.log('='.repeat(60));
  
  const metrics = {
    fileCount,
    startTime: new Date().toISOString(),
    systemMetrics: await getSystemMetrics(),
  };
  
  try {
    // Upload files
    const uploadResult = await uploadFiles(testDir, fileCount);
    metrics.upload = uploadResult;
    
    console.log(`\nResults:`);
    console.log(`  Status: ${uploadResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`  HTTP Status: ${uploadResult.statusCode}`);
    console.log(`  Files Uploaded: ${uploadResult.filesUploaded}`);
    console.log(`  Total Time: ${uploadResult.duration.toFixed(2)}s`);
    console.log(`  Throughput: ${uploadResult.throughput.toFixed(2)} files/sec`);
    
    if (!uploadResult.success) {
      console.log(`  Response: ${uploadResult.response}`);
    }
    
    metrics.endTime = new Date().toISOString();
    metrics.success = uploadResult.success;
    
  } catch (err) {
    console.error(`Benchmark failed:`, err);
    metrics.error = err.message;
    metrics.success = false;
  }
  
  return metrics;
}

/**
 * Save benchmark report (JSON + CSV)
 */
async function saveReport(results) {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(RESULTS_DIR, `benchmark-${timestamp}.json`);
  const csvPath = path.join(RESULTS_DIR, `benchmark-${timestamp}.csv`);
  
  const report = {
    timestamp: new Date().toISOString(),
    targetUrl: TARGET_URL,
    results,
    summary: {
      totalBenchmarks: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    },
  };
  
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report saved: ${reportPath}`);
  
  // Build CSV
  const csvHeader = 'fileCount,status,httpStatus,filesUploaded,duration_s,throughput_fps,totalMemoryMB,freeMemoryMB\n';
  const csvRows = results.map(r => {
    const u = r.upload || {};
    const m = r.systemMetrics || {};
    return [
      r.fileCount,
      r.success ? 'SUCCESS' : 'FAILED',
      u.statusCode || '',
      u.filesUploaded || '',
      u.duration ? u.duration.toFixed(3) : '',
      u.throughput ? u.throughput.toFixed(2) : '',
      m.totalMemoryMB || '',
      m.freeMemoryMB || ''
    ].join(',');
  });
  const csvContent = csvHeader + csvRows.join('\n');
  
  await fs.writeFile(csvPath, csvContent);
  console.log(`CSV report saved: ${csvPath}`);
  
  // Also save as latest (both formats)
  const latestJsonPath = path.join(RESULTS_DIR, 'benchmark-latest.json');
  await fs.writeFile(latestJsonPath, JSON.stringify(report, null, 2));
  
  const latestCsvPath = path.join(RESULTS_DIR, 'benchmark-latest.csv');
  await fs.writeFile(latestCsvPath, csvContent);
  
  return reportPath;
}

/**
 * Print summary table
 */
function printSummary(results) {
  console.log('\n' + '='.repeat(80));
  console.log('BENCHMARK SUMMARY');
  console.log('='.repeat(80));
  console.log('Size        Status    Time (s)    Throughput     Memory (MB)');
  console.log('-'.repeat(80));
  
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const upload = result.upload || {};
    const time = upload.duration ? upload.duration.toFixed(2) : 'N/A';
    const throughput = upload.throughput ? upload.throughput.toFixed(2) + ' f/s' : 'N/A';
    const mem = result.systemMetrics || {};
    const memory = mem.freeMemoryMB ? mem.freeMemoryMB.toFixed(0) : 'N/A';
    const size = result.fileCount + ' files';
    
    console.log(
      size.padEnd(12) + 
      status.padEnd(11) + 
      time.padEnd(13) + 
      throughput.padEnd(16) + 
      memory
    );
  }
  
  console.log('='.repeat(80));
}

/**
 * Main benchmark runner
 */
async function main() {
  console.log('Upload Benchmark Suite');
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Sizes: ${BENCHMARK_SIZES.join(', ')} files`);
  console.log('Note: 10000 files will be split into batches of 4500 due to server limits');
  
  // Create temporary directory for test files
  const testDir = path.join(__dirname, 'temp-test-files');
  
  try {
    // Create test files (use smallest size for all benchmarks)
    await createTestFiles(Math.max(...BENCHMARK_SIZES), testDir);
    
    // Run benchmarks
    const results = [];
    for (const size of BENCHMARK_SIZES) {
      const result = await runBenchmark(size, testDir);
      results.push(result);
      
      // Wait between benchmarks
      if (size !== BENCHMARK_SIZES[BENCHMARK_SIZES.length - 1]) {
        console.log('\nWaiting 5s before next benchmark...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // Save report
    await saveReport(results);
    
    // Print summary
    printSummary(results);
    
  } catch (err) {
    console.error('Benchmark suite failed:', err);
  } finally {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true });
      console.log(`\nCleaned up test directory: ${testDir}`);
    } catch (err) {
      console.warn('Failed to cleanup test directory:', err);
    }
  }
}

// Run if called directly
if (process.argv[1] === __filename) {
  main();
}

export { runBenchmark, createTestFiles, saveReport };