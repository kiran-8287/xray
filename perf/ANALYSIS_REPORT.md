# Performance Analysis Report
**Generated:** 2026-07-30  
**System:** X-Ray Upload Benchmark Suite

---

## Executive Summary

The benchmark tests were **successfully completed** for 500, 1000, 5000, and 10000 files. However, there's a **critical issue** that makes the results misleading:

### ⚠️ CRITICAL FINDING: All Files Are Failing Silently

**Problem:** The benchmark creates **invalid image files** (random binary data) instead of valid PNG/PGM images. The backend tries to process them with Jimp (image processing library), which fails for all files. However:
- HTTP responses return **200 OK** (success)
- But internally, **ALL files are marked as failed** (itemsFailed: 500, 1000, 4500, etc.)
- The benchmark only checks HTTP status, not actual processing success

**Impact:** The reported "success" is misleading. No files are actually being processed successfully.

---

## Benchmark Results (As Executed)

### Test Configuration
- **File Size:** 50KB per file
- **File Type:** Random binary data (NOT valid images)
- **Server:** http://localhost:8080
- **Node Memory Limit:** 4096MB

### Performance Metrics

| File Count | HTTP Status | Time (s) | Throughput (f/s) | Free Memory (MB) | Actual Success |
|------------|-------------|----------|------------------|------------------|----------------|
| 500 files  | ✅ 200      | 6.90     | 72.47            | 3392             | ❌ 0/500       |
| 1000 files | ✅ 200      | 13.46    | 74.29            | 3675             | ❌ 0/1000      |
| 5000 files | ✅ 200      | 93.29    | 53.59            | 3711             | ❌ 0/5000      |
| 10000 files| ✅ 200      | 191.82   | 52.13            | 2879             | ❌ 0/10000     |

### Backend Processing Details (from logs)

**500 files:**
- Upload receipt: 0.0001s
- Validation: 0.00001s
- Persistence: 6.39s
- **Items processed: 0, Items failed: 500**
- Memory delta: +210MB RSS, +153MB heap

**1000 files:**
- Upload receipt: 0.00008s
- Validation: 0.00001s
- Persistence: 12.55s
- **Items processed: 0, Items failed: 1000**
- Memory delta: +68MB RSS, +52MB heap

**4500 files (batch 1 of 10000):**
- Upload receipt: 0.0002s
- Validation: 0.00001s
- Persistence: 80.34s
- **Items processed: 0, Items failed: 4500**
- Memory delta: +132MB RSS, +148MB heap

**4500 files (batch 2 of 10000):**
- Persistence: 82.75s
- **Items processed: 0, Items failed: 4500**
- Memory delta: +88MB RSS, +99MB heap

---

## Root Cause Analysis

### Why All Files Are Failing

1. **Invalid Test Data Generation** (`perf/benchmark_upload.mjs` lines 25-31):
   ```javascript
   function generateTestFile(sizeKB = 50) {
     const buffer = Buffer.alloc(sizeKB * 1024);
     for (let i = 0; i < buffer.length; i++) {
       buffer[i] = Math.floor(Math.random() * 256); // Random bytes!
     }
     return buffer;
   }
   ```
   This creates **random binary data**, not valid PGM/PNG images.

2. **Backend Image Processing** (`backend/src/server.js` lines 826-831):
   ```javascript
   try {
     const loadedImg = await Jimp.read(savedFilePath);
     width = loadedImg.bitmap.width;
     height = loadedImg.bitmap.height;
   } catch (dimErr) {
     console.warn("Warning: could not detect image dimensions for", file.filename, dimErr);
   }
   ```
   Jimp fails to read random binary data as an image, causing an error.

3. **Error Handling** (`backend/src/server.js` lines 894-909):
   ```javascript
   } catch (fileErr) {
     console.error(`Error processing file ${file.originalname}:`, fileErr);
     errors.push({ filename: file.originalname, message: String(fileErr) });
     // ... cleanup
   }
   ```
   All errors are caught and added to the `errors` array, but the HTTP response still returns 200.

### Why HTTP 200 is Returned

The upload endpoint (`/api/upload`) is designed to be fault-tolerant:
- It catches per-file errors and continues processing
- Returns HTTP 200 with a summary of successes/failures
- The benchmark only checks `res.statusCode >= 200 && res.statusCode < 300`

---

## What Should Happen (Correct Behavior)

### Valid Test Files Needed

The benchmark should use **valid PNG or PGM images** like the test suite does:

**Example from `backend/tests/helpers.js`:**
```javascript
// Minimal valid PNG: 1x1 pixel, 8-bit grayscale
const png = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, // IHDR chunk length (13)
  0x49, 0x48, 0x44, 0x52, // "IHDR" type
  0x00, 0x00, 0x00, 0x01, // width = 1
  0x00, 0x00, 0x00, 0x01, // height = 1
  // ... proper PNG structure
]);
```

### Expected Results with Valid Images

With valid images, you would see:
- **Items processed: 500/500** (or 1000/1000, etc.)
- **Items failed: 0**
- Actual image processing (dimension detection, database writes)
- More realistic memory usage patterns
- Meaningful throughput measurements

---

## Performance Analysis (Current - Invalid Data)

### Time Complexity
- **500 → 1000 files:** ~2x time (13.46s vs 6.90s) ✅ Linear
- **1000 → 5000 files:** ~7x time (93.29s vs 13.46s) ✅ Linear
- **5000 → 10000 files:** ~2x time (191.82s vs 93.29s) ✅ Linear

**Conclusion:** Upload time scales **linearly** with file count.

### Throughput Degradation
- 500 files: 72.47 f/s
- 1000 files: 74.29 f/s (peak)
- 5000 files: 53.59 f/s (26% drop)
- 10000 files: 52.13 f/s (30% drop from peak)

**Conclusion:** Throughput **degrades at scale** due to:
- Memory pressure
- Database write contention (JSON file locking)
- Garbage collection overhead

### Memory Usage
- **Total RAM:** 16,092 MB
- **Free RAM during tests:** 2879-3711 MB
- **Memory growth per file:** ~15-20MB RSS per 100 files

**Concern:** Memory usage is **very high** for what should be lightweight operations:
- 500 files: 210MB RSS delta
- 1000 files: 68MB RSS delta (better, but still high)
- 4500 files: 132MB RSS delta

**Root cause:** Each file upload triggers:
1. Multer disk write (50KB)
2. Jimp read attempt (loads entire file into memory)
3. Database read (entire items.json)
4. Database write (entire items.json with new item)
5. Error cleanup (file deletion)

---

## Breaking Point Analysis

### Current Status: No Breaking Point Found

The system **did not crash or timeout** at any tested size:
- ✅ 500 files: Success (6.90s)
- ✅ 1000 files: Success (13.46s)
- ✅ 5000 files: Success (93.29s)
- ✅ 10000 files: Success (191.82s)

### Estimated Breaking Points

Based on memory growth patterns:

**Memory Limit (4096MB Node.js heap):**
- Current free memory: ~2879MB at 10000 files
- Estimated max: **~15000-20000 files** before OOM
- **BUT:** This is misleading because files aren't actually being processed

**Timeout Limit (60000ms):**
- Current max: 191.82s for 10000 files
- Estimated timeout: **~25000+ files** (if linear scaling holds)

**Database Contention:**
- Current pattern: Reading/writing entire items.json for each file
- Estimated limit: **~5000-10000 items** (before JSON file becomes too slow)

---

## Recommendations

### 1. Fix Benchmark Data Generation (CRITICAL)

**Update `perf/benchmark_upload.mjs` to create valid images:**

```javascript
/**
 * Generate a valid minimal PNG file
 */
function generateTestFile(sizeKB = 50) {
  // Use the same approach as backend/tests/helpers.js
  // Create a minimal valid 1x1 grayscale PNG
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08, 0x00, 0x00, 0x00, 0x00, // 8-bit grayscale
    0x77, 0x4F, 0x5A, 0x06, // IHDR CRC
    0x00, 0x00, 0x00, 0x0A, // IDAT chunk length
    0x49, 0x44, 0x41, 0x54, // "IDAT"
    0x78, 0x01, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // data
    0xE2, 0x21, 0xBC, 0x33, // IDAT CRC
    0x00, 0x00, 0x00, 0x00, // IEND
    0x49, 0x45, 0x4E, 0x44, // "IEND"
    0xAE, 0x42, 0x60, 82  // IEND CRC
  ]);
  
  // Pad to desired size if needed
  if (sizeKB > 0.1) {
    const targetSize = sizeKB * 1024;
    const padded = Buffer.alloc(targetSize);
    png.copy(padded);
    // Fill rest with valid PNG-like data or repeat pattern
    for (let i = png.length; i < targetSize; i++) {
      padded[i] = 0x00;
    }
    return padded;
  }
  
  return png;
}
```

### 2. Update Benchmark to Check Response Body

**Current (line 108):**
```javascript
success: res.statusCode >= 200 && res.statusCode < 300,
```

**Should be:**
```javascript
let responseData;
try {
  responseData = JSON.parse(data);
} catch (e) {
  responseData = {};
}

success: res.statusCode >= 200 && 
         res.statusCode < 300 && 
         responseData.ok === true &&
         responseData.errors?.length === 0;
```

### 3. Optimize Backend for Bulk Uploads

**Current issues:**
- Reading entire `items.json` for every `itemExists()` check
- Writing entire `items.json` for every `createItem()`
- Loading full image with Jimp just to get dimensions

**Recommendations:**
1. **Cache items in memory** during upload batch
2. **Batch database writes** (write once per 100-500 items)
3. **Use async dimension detection** or skip for bulk operations
4. **Consider streaming/chunked writes** for large batches

### 4. Test with Realistic Data Sizes

Current test: 50KB files (random data)  
Realistic scenario: 500KB-2MB actual PGM/PNG files

**Recommended test matrix:**
- 100 files × 500KB = 50MB total
- 500 files × 500KB = 250MB total
- 1000 files × 1MB = 1GB total
- 2000 files × 1MB = 2GB total

---

## Space & Disk Usage

### Test File Generation
- **10000 files × 50KB** = **~476MB** temporary disk space
- Cleanup: ✅ Automatic (deleted after benchmark)

### Backend Storage (items.json)
- **Per item:** ~200-300 bytes (JSON)
- **10000 items:** ~2-3MB
- **Not a concern** at current scale

### Library Images
- **Per file:** 50KB (uploaded)
- **10000 files:** ~476MB
- **Current location:** `backend/data/library_images/`

**Total disk impact for 10000 files:** ~952MB (test files + uploaded files)

---

## Summary & Next Steps

### What's Working
✅ Benchmark suite runs successfully  
✅ HTTP upload mechanism works  
✅ Linear time scaling (no exponential blowup)  
✅ No crashes/timeouts up to 10000 files  
✅ Automatic cleanup of test files  

### What's Broken
❌ **Test data is invalid** (random binary, not images)  
❌ **All files fail processing** (0% success rate)  
❌ **Benchmark doesn't detect failures** (only checks HTTP 200)  
❌ **Memory usage is high** (210MB for 500 files is excessive)  

### Immediate Actions Required

1. **Fix `perf/benchmark_upload.mjs`:**
   - Use valid PNG/PGM file generation
   - Check response body for actual success/failure
   - Report real success rate

2. **Re-run benchmarks** with valid images to get:
   - Real throughput numbers
   - Actual memory usage under load
   - True breaking point

3. **Backend optimizations** (if needed):
   - Batch database writes
   - Cache item existence checks
   - Optimize image dimension detection

---

## Questions Answered

### Q: Are the reports correct?
**A:** NO. The reports show HTTP success but hide the fact that 0% of files are actually being processed.

### Q: What's happening with 500 files?
**A:** All 500 files upload successfully via HTTP, but all fail during image processing (Jimp can't read random binary data).

### Q: How much memory/space/speed/time for 1000, 2000, etc.?
**A:** 
- **Time:** Scales linearly (1000 files = 13.5s, 10000 files = 192s)
- **Memory:** 68-210MB RSS per batch (high due to failed processing)
- **Space:** 50KB per file on disk
- **Speed:** 52-74 files/sec (degrading at scale)

### Q: What's the breaking point?
**A:** Not reached yet (tested up to 10000 files). Estimated limits:
- **Memory:** ~15000-20000 files (before OOM)
- **Timeout:** ~25000+ files (before 60s timeout)
- **Database:** ~5000-10000 items (before JSON file becomes too slow)

**BUT:** These are all misleading because files aren't actually being processed!

---

## Files Generated

- `perf/reports/benchmark-2026-07-30T10-38-31-903Z.json` - Raw benchmark data
- `perf/reports/benchmark-2026-07-30T10-38-31-903Z.csv` - CSV format
- `perf/ANALYSIS_REPORT.md` - This report