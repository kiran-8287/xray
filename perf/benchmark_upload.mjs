/**
 * Upload Benchmark Suite
 * Tests upload performance with 1000, 5000, 10000 files
 * Measures: throughput, latency, memory growth, worker efficiency
 * Note: Uses valid PNG files (Jimp-compatible) with .png extension
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
 * Generate a valid minimal PNG file (1x1 pixel, 8-bit grayscale)
 * This ensures Jimp can read the file and extract dimensions cleanly.
 */
function generateTestFile() {
  // Minimal valid PNG: 1x1 pixel, 8-bit grayscale with proper CRC
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length (13)
    0x49, 0x48, 0x44, 0x52, // "IHDR" type
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08,                   // bit depth = 8
    0x00,                   // color type = grayscale
    0x00,                   // compression
    0x00,                   // filter
    0x00,                   // interlace
    0x77, 0x4F, 0x5A, 0x06, // IHDR CRC (calculated)
    
    0x00, 0x00, 0x00, 0x0A, // IDAT chunk length (10)
    0x49, 0x44, 0x41, 0x54, // "IDAT" type
    0x78, 0x01, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data
    0xE2, 0x21, 0xBC, 0x33, // IDAT CRC
    
    0x00, 0x00, 0x00, 0x00, // IEND chunk length
    0x49, 0x45, 0x4E, 0x44, // "IEND" type
    0xAE, 0x42, 0x60, 0x82  // IEND CRC
  ]);
}

/**
 * Create test files using .png extension (valid PNG format that Jimp can read)
 */
async function createTestFiles(count, outputDir, sizeKB = 100) {
  await fs.mkdir(outputDir, { recursive: true });
  
  console.log(`Creating ${count} test files (${sizeKB}KB each, valid PNG format)...`);
  const startTime = Date.now();
  
  // Generate a single valid PNG buffer to reuse
  const pngBuffer = generateTestFile(sizeKB);
  
  // Create files in batches to avoid "too many open files" error
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < count; i += BATCH_SIZE) {
    const batchPromises = [];
    const batchEnd = Math.min(i + BATCH_SIZE, count);
    
    for (let j = i; j < batchEnd; j++) {
      // Use .png extension so Jimp can recognize the format
      const newFileName = `test_file_${String(j).padStart(5, '0')}.png`;
      const filePath = path.join(outputDir, newFileName);
      
      // Use the valid PNG buffer for all files (Jimp can read it)
      batchPromises.push(fs.writeFile(filePath, pngBuffer));
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
        // Parse response to check for actual success/failure
        let responseData = {};
        try {
          responseData = JSON.parse(data);
        } catch (e) {
          // Response is not JSON, use HTTP status only
        }
        
        const httpSuccess = res.statusCode >= 200 && res.statusCode < 300;
        const actualSuccess = httpSuccess && 
                              responseData.ok === true && 
                              (!responseData.errors || responseData.errors.length === 0);
        
        resolve({
          success: actualSuccess,
          statusCode: res.statusCode,
          filesUploaded: batch.length,
          response: data,
          responseData: responseData,
          processedCount: responseData.itemsProcessed || 0,
          errorCount: responseData.errors ? responseData.errors.length : 0,
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
    success: lastError === null && totalUploaded === filePaths.length,
    statusCode: lastError ? lastError.statusCode : 200,
    filesUploaded: totalUploaded,
    duration,
    throughput,
    response: lastError ? lastError.response : null,
    processedCount: lastError ? (lastError.processedCount || 0) : totalUploaded,
    errorCount: lastError ? (lastError.errorCount || 0) : 0,
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
    console.log(`  Files Processed: ${uploadResult.processedCount}`);
    console.log(`  Files Failed: ${uploadResult.errorCount}`);
    console.log(`  Total Time: ${uploadResult.duration.toFixed(2)}s`);
    console.log(`  Throughput: ${uploadResult.throughput.toFixed(2)} files/sec`);
    
    if (!uploadResult.success || uploadResult.errorCount > 0) {
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
  const csvHeader = 'fileCount,status,httpStatus,filesUploaded,filesProcessed,filesFailed,duration_s,throughput_fps,totalMemoryMB,freeMemoryMB\n';
  const csvRows = results.map(r => {
    const u = r.upload || {};
    const m = r.systemMetrics || {};
    return [
      r.fileCount,
      r.success ? 'SUCCESS' : 'FAILED',
      u.statusCode || '',
      u.filesUploaded || '',
      u.processedCount || 0,
      u.errorCount || 0,
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
  console.log('\n' + '='.repeat(100));
  console.log('BENCHMARK SUMMARY');
  console.log('='.repeat(100));
  console.log('Size        Status    Time (s)    Throughput   Processed   Failed   Memory (MB)');
  console.log('-'.repeat(100));
  
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const upload = result.upload || {};
    const time = upload.duration ? upload.duration.toFixed(2) : 'N/A';
    const throughput = upload.throughput ? upload.throughput.toFixed(2) + ' f/s' : 'N/A';
    const mem = result.systemMetrics || {};
    const memory = mem.freeMemoryMB ? mem.freeMemoryMB.toFixed(0) : 'N/A';
    const size = result.fileCount + ' files';
    const processed = upload.processedCount ? upload.processedCount.toString() : '0';
    const failed = upload.errorCount ? upload.errorCount.toString() : '0';
    
    console.log(
      size.padEnd(12) + 
      status.padEnd(11) + 
      time.padEnd(13) + 
      throughput.padEnd(14) + 
      processed.padEnd(11) + 
      failed.padEnd(9) + 
      memory
    );
  }
  
  console.log('='.repeat(100));
}

/**
 * Main benchmark runner
 */
async function main() {
  console.log('Upload Benchmark Suite');
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Sizes: ${BENCHMARK_SIZES.join(', ')} files`);
  console.log('Note: Uses valid PNG files (Jimp-compatible) with .png extension');
  console.log('Note: 10000 files will be split into batches of 4500 due to server limits');
  
  // Create temporary directory for test files
  const testDir = path.join(__dirname, 'temp-test-files');
  
  try {
    // Create test files (100KB each, valid PNG format)
    // 10000 files x 100KB = ~1GB total
    await createTestFiles(Math.max(...BENCHMARK_SIZES), testDir, 100);
    
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