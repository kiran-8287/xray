# How to Run Measurements and Generate Reports

This guide explains how to run benchmarks, tests, and view instrumentation logs.

## 📊 1. Run Upload Benchmarks

The benchmark suite tests upload performance with 500, 1000, 5000, and 10000 files.

### Prerequisites
- Backend server must be running on `http://localhost:8080` (or set `TARGET_URL` env var)
- Node.js 18+ installed

### Run the Benchmark

```bash
# From the project root
node perf/benchmark_upload.mjs
```

### Customize Target URL

```bash
# For different server address
TARGET_URL=http://localhost:3000 node perf/benchmark_upload.mjs
```

### What It Does
1. Creates test files (50KB each) in `perf/temp-test-files/`
2. Uploads 500, 1000, 5000, 10000 files sequentially
3. Measures throughput, latency, and memory usage
4. Saves structured JSON reports to `perf/reports/`
5. Cleans up temp files

### View Reports

```bash
# Latest report
cat perf/reports/benchmark-latest.json

# All reports
ls perf/reports/benchmark-*.json
```

### Sample Report Structure
```json
{
  "timestamp": "2026-07-29T12:00:00.000Z",
  "targetUrl": "http://localhost:8080",
  "results": [
    {
      "fileCount": 500,
      "success": true,
      "upload": {
        "filesUploaded": 500,
        "duration": 45.2,
        "throughput": 11.06
      }
    }
  ],
  "summary": {
    "totalBenchmarks": 4,
    "successful": 4,
    "failed": 0
  }
}
```

---

## 🧪 2. Run Test Suite

### Run All Backend Tests

```bash
# From the project root
cd backend
npm test
```

### Run Specific Test Files

```bash
# API tests only
cd backend
npx jest tests/api.test.js

# Worker pool tests only
cd backend
npx jest tests/workerPool.test.js

# Load tests only
cd backend
npx jest tests/load.test.js --testTimeout=120000
```

### Run Tests with Coverage

```bash
cd backend
npx jest --coverage
```

### Test Output Example
```
PASS backend/tests/api.test.js
  API Tests
    GET /
      ✓ should return api info (45ms)
    GET /api/items/categorized
      ✓ should return ok true (12ms)
      ✓ should support pagination (8ms)
    POST /api/upload
      ✓ should upload a small file successfully (234ms)
      ✓ should reject invalid file types (189ms)
      ✓ should handle duplicate filenames (312ms)
      ✓ should handle metadata correctly (198ms)

PASS backend/tests/workerPool.test.js
  WorkerPool
    constructor
      ✓ should create a pool with default size of 4
      ✓ should create a pool with custom size
    addTask
      ✓ should add a task to the pool
      ✓ should handle multiple tasks

PASS backend/tests/load.test.js
  Load Tests
    POST /api/upload - concurrent uploads
      ✓ should handle 10 concurrent uploads (5.2s)
      ✓ should handle 50 concurrent uploads (28.1s)
    GET /api/items/categorized - concurrent requests
      ✓ should handle 100 concurrent requests (1.3s)

Test Suites: 3 passed, 3 total
Tests:       23 passed, 23 total
```

---

## 📈 3. View Instrumentation Logs

The instrumentation system logs detailed timing and memory metrics for every pipeline stage.

### Start Backend with Logging

```bash
cd backend
npm run dev
```

### Log Output Format

Logs are structured JSON (using Pino) and include:

**Pipeline Stage Logs:**
```json
{
  "level": 30,
  "msg": "pipeline_stage_complete",
  "operationId": "1720000000000-abc123",
  "operationType": "process_raw_files",
  "stage": "validation",
  "duration_s": 0.045,
  "memory_delta_bytes": {
    "rss": 1048576,
    "heapUsed": 524288,
    "heapTotal": 1048576,
    "external": 0
  }
}
```

**Pipeline Summary:**
```json
{
  "level": 30,
  "msg": "pipeline_summary",
  "operationId": "1720000000000-abc123",
  "operationType": "process_raw_files",
  "total_duration_s": 12.345,
  "total_memory_delta_bytes": {
    "rss": 15728640,
    "heapUsed": 8388608,
    "heapTotal": 15728640,
    "external": 0
  },
  "stages": {
    "upload_receipt": {
      "duration_s": 0.001,
      "memory_delta_bytes": { "rss": 0, "heapUsed": 0, "heapTotal": 0, "external": 0 }
    },
    "validation": {
      "duration_s": 0.045,
      "memory_delta_bytes": { "rss": 1048576, "heapUsed": 524288, "heapTotal": 1048576, "external": 0 }
    },
    "worker_dispatch": {
      "duration_s": 11.234,
      "memory_delta_bytes": { "rss": 14680064, "heapUsed": 7864320, "heapTotal": 14680064, "external": 0 }
    }
  }
}
```

### Filter Logs

```bash
# Only show pipeline logs
cd backend && npm run dev | grep pipeline

# Only show errors
cd backend && npm run dev | grep pipeline_stage_error

# Pretty print JSON logs
cd backend && npm run dev | pino-pretty
```

### Key Metrics to Watch

| Metric | Where to Find | What It Means |
|--------|---------------|---------------|
| `total_duration_s` | `pipeline_summary` | Total time for entire operation |
| `duration_s` (per stage) | `pipeline_stage_complete` | Time spent in each pipeline stage |
| `memory_delta_bytes.rss` | `pipeline_stage_complete` | Memory increase during stage |
| `worker_count_determined` | Startup log | Dynamic worker count chosen |
| `memory_check` | Before processing | Memory availability check |

---

## 🔍 4. Monitor Real-Time Metrics

### Prometheus Metrics Endpoint

```bash
# Get all metrics
curl http://localhost:8080/metrics

# Filter for specific metrics
curl http://localhost:8080/metrics | grep http_request_duration_seconds
curl http://localhost:8080/metrics | grep worker_batch_duration_seconds
curl http://localhost:8080/metrics | grep upload_file_processing_seconds
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `http_request_duration_seconds` | Histogram | HTTP request latency by method/route/status |
| `upload_file_processing_seconds` | Histogram | Time to process each uploaded file |
| `worker_batch_duration_seconds` | Histogram | Time to process a worker batch |
| `nodejs_heap_size_total_bytes` | Gauge | Total heap size |
| `nodejs_heap_used_bytes` | Gauge | Used heap size |
| `nodejs_external_memory_bytes` | Gauge | External memory (C++ objects) |

---

## 🚀 5. Quick Start - Complete Workflow

### Step 1: Start the Backend
```bash
cd backend
npm run dev
```

### Step 2: Run Benchmarks (in another terminal)
```bash
node perf/benchmark_upload.mjs
```

### Step 3: Run Tests (in another terminal)
```bash
cd backend
npm test
```

### Step 4: View Reports
```bash
# Latest benchmark report
cat perf/reports/benchmark-latest.json | jq .

# System config
cat backend/data/system-config.json
```

---

## 📝 6. Example: Complete Benchmark Run

```bash
# Terminal 1: Start server
cd c:\Users\saikiran\Desktop\xray\backend
npm run dev

# Terminal 2: Run benchmark
cd c:\Users\saikiran\Desktop\xray
node perf/benchmark_upload.mjs

# Output:
# Upload Benchmark Suite
# Target: http://localhost:8080
# Sizes: 500, 1000, 5000, 10000 files
#
# Creating 10000 test files...
# Created 10000 files in 12.34s
#
# ============================================================
# BENCHMARK: 500 files
# ============================================================
# Uploading 500 files...
#
# Results:
#   Status: ✅ SUCCESS
#   HTTP Status: 200
#   Files Uploaded: 500
#   Total Time: 23.45s
#   Throughput: 21.32 files/sec
#
# ============================================================
# BENCHMARK: 1000 files
# ============================================================
# ...
#
# Report saved: perf/reports/benchmark-2026-07-29T12-34-56-789.json
#
# ================================================================================
# BENCHMARK SUMMARY
# ================================================================================
# Size        Status    Time (s)    Throughput     Memory (MB)   
# --------------------------------------------------------------------------------
# 500 files   ✅         23.45       21.32 f/s      8192         
# 1000 files  ✅         45.67       21.90 f/s      6144         
# 5000 files  ✅         234.12      21.35 f/s      4096         
# 10000 files ✅         467.89      21.38 f/s      2048         
# ================================================================================
```

---

## 🐛 Troubleshooting

### Benchmark fails with "ECONNREFUSED"
- Make sure backend is running on the correct port
- Check `TARGET_URL` environment variable

### Tests timeout
- Increase timeout in test file: `.timeout({ deadline: 60000 })`
- Check if backend is running for integration tests

### No logs appearing
- Check `LOG_LEVEL` environment variable (should be `info` or `debug`)
- Make sure Pino logger is initialized in server.js

### Memory check fails
- Reduce benchmark size
- Close other applications to free memory
- Check `backend/data/system-config.json` for worker count

---

## 📚 Additional Resources

- **Instrumentation Code**: `backend/src/lib/instrumentation.js`
- **System Info Code**: `backend/src/lib/systemInfo.js`
- **Benchmark Code**: `perf/benchmark_upload.mjs`
- **Test Files**: `backend/tests/*.test.js`
- **Existing k6 Scripts**: `perf/k6/` (for load testing)