# How to Run Measurements and Generate Reports

This guide explains how to run benchmarks, tests, and view instrumentation logs.

## 📊 1. Run Upload Benchmarks

The benchmark suite tests upload performance with 1000, 5000, and 10000 files using real X-ray files from the `dump and tip` folder.

### Prerequisites
- Backend server must be running on `http://localhost:8080` (or set `TARGET_URL` env var)
- Node.js 18+ installed
- Source files available in `dump and tip/` folder (37 real .dump.pgm and .tip files)

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
1. Scans `dump and tip/` folder for source files (47 real X-ray files)
2. Loads source files as templates and truncates to 100KB each
3. Creates unique filenames: `test_file_00001.pgm`, `test_file_00001.tip`
4. Uploads 1000, 5000, 10000 files sequentially
5. Measures throughput, latency, and memory usage
6. Saves structured JSON reports to `perf/reports/`
7. Cleans up temp files

### File Duplication Strategy
- Cycles through the 47 source files (bags_easy, bags_hard, bags_medium, guns, knife)
- Truncates large files (5-8MB) to 100KB to manage disk space
- 10,000 files × 100KB = ~1GB total disk space required
- Maintains original file extensions (.dump.pgm, .tip)
- Uses real file headers and structure (not synthetic files)

### View Reports

```bash
# Latest report
cat perf/reports/benchmark-latest.json

# All reports
ls perf/reports/benchmark-*.json
```

---

## 🧪 2. Run Stress Test Suite

The stress test suite simulates real user flows and finds breaking points.

### Prerequisites
- Backend server must be running on `http://localhost:8080`
- Node.js 18+ installed

### Run All Scenarios

```bash
# From the project root
node perf/stress-test.mjs
```

### Run Specific Scenario

```bash
# Upload stress only
node perf/stress-test.mjs --scenario upload

# Generation stress only
node perf/stress-test.mjs --scenario generation

# Buffer stress only
node perf/stress-test.mjs --scenario buffer

# API timeout/error handling only
node perf/stress-test.mjs --scenario api-timeout

# Concurrent operations stress only
node perf/stress-test.mjs --scenario concurrent-ops
```

### Quick Mode (lower limits for fast testing)

```bash
node perf/stress-test.mjs --quick
```

### Custom Target URL

```bash
node perf/stress-test.mjs --target http://localhost:3000
```

### What It Does

Each scenario ramps up load until the system breaks:

1. **upload-stress**: Uploads files while simultaneously calling bulk operations (assign category, auto-generate mask)
2. **generation-stress**: Tests increasing K (combinations) and N (objects per combination)
3. **buffer-stress**: Tests how many layouts can be saved before crash
4. **api-timeout**: Verifies proper error codes (400/404/500) are returned
5. **concurrent-ops**: Simulates multiple users calling APIs simultaneously

### View Reports

```bash
# Latest report for a scenario
cat perf/reports/stress-upload-stress-latest.json
cat perf/reports/stress-generation-stress-latest.json

# All stress reports
ls perf/reports/stress-*.json

# CSV reports (open in Excel)
ls perf/reports/stress-*.csv
```

### Sample Report Structure

```json
{
  "scenario": "upload-stress",
  "timestamp": "2026-07-29T14:17:42.842Z",
  "targetUrl": "http://localhost:8080",
  "results": [
    {
      "runNumber": 1,
      "config": "5 files x 2 concurrent",
      "files": 5,
      "concurrency": 2,
      "passed": true,
      "uploadDuration_ms": 1234,
      "bulkOpsDuration_ms": 567,
      "totalDuration_ms": 1801,
      "memoryGrowth_mb": 12,
      "peakRSS_mb": 58
    }
  ],
  "summary": {
    "totalRuns": 1,
    "passed": 1,
    "failed": 0,
    "peakMemoryMB": 58,
    "breakingPoint": null
  }
}
```

---

## ⏱️ 3. Run 1-Hour Stress Timeout Loop

The stress timeout loop harness executes **recursive long-running API calls** over a 1-hour window to monitor memory, cache, buffer sizes, and detect breaking points.

### Prerequisites
- Backend server must be running on `http://localhost:8080` (or set `TARGET_URL` env var)
- Node.js 18+ installed

### Run the Full 1-Hour Test

```bash
# From the project root
node perf/stress_timeout_loop.mjs
```

### Quick Mode (10-minute version)

```bash
node perf/stress_timeout_loop.mjs --quick
```

### Custom Target URL

```bash
node perf/stress_timeout_loop.mjs --target http://localhost:3000
```

### Start from a Specific Phase

```bash
# Skip warmup, start from ramp phase
node perf/stress_timeout_loop.mjs --phase 2

# Start from breaking point phase
node perf/stress_timeout_loop.mjs --phase 4
```

### Dry Run (Preview Plan Without Executing)

```bash
node perf/stress_timeout_loop.mjs --dry-run
```

### What It Does

The script executes 5 phases of escalating load:

| Phase | Duration (Full) | Duration (Quick) | Concurrency | Description |
|-------|----------------|------------------|-------------|-------------|
| 1. Warmup | 5 min | 30s | 5 | Light GETs to warm up the system |
| 2. Ramp | 15 min | 2 min | 50 | Mixed GET/POST, gradually increasing |
| 3. Sustained | 20 min | 3 min | 100 | Heavy write operations at peak load |
| 4. Breaking Point | 15 min | 3 min | 200 | Aggressive escalation until failure |
| 5. Cooldown | 5 min | 1 min | 10 | Monitor recovery after stress |

### API Call Patterns

Each "operation chain" simulates a real user workflow by calling multiple APIs in sequence:

1. **System queries** (GET `/api/system/info`, POST `/api/system/memory-check`)
2. **Paginated read** (recursive GET `/api/items/categorized` — fetches all pages)
3. **Deep item fetch** (GET `/api/items/:id` with bag enrichment)
4. **Integrity check** (GET `/api/saved-layouts/integrity` — heavy read/aggregation)
5. **Auto-valid-region** (POST `/api/auto-valid-region` — CPU-bound pixel processing)
6. **Render preview** (POST `/api/render-preview` — rendering pipeline)

### Breaking Point Detection

The script continuously monitors 7 conditions and stops early if any are triggered:

| Condition | Threshold | What It Detects |
|-----------|-----------|-----------------|
| Error rate (60s window) | >50% | System returning errors |
| Memory growth (RSS) | >500MB | Memory leak or bloat |
| p95 response time | >30s | Severe latency degradation |
| Consecutive timeouts | >3 | Connection pool exhaustion |
| Heap usage ratio | >90% | GC pressure, near OOM |
| Free system memory | <500MB | System-wide memory pressure |
| Concurrent requests | >200 | Request queue backup |

### Background Monitoring

Every 5 seconds, the script collects:
- **Memory**: RSS, heapUsed, heapTotal, external (from `process.memoryUsage()`)
- **System**: free memory (from `os.freemem()`), CPU load (from `os.cpus()`)
- **Request metrics**: active request count, consecutive timeouts
- **Response times**: p50/p95/p99 percentiles over the last 100 responses

### View Reports

```bash
# Latest report
cat perf/reports/stress-timeout-loop-latest.json

# All reports
ls perf/reports/stress-timeout-loop-*.json

# CSV reports (open in Excel)
ls perf/reports/stress-timeout-loop-*.csv
```

### Sample Report Structure

```json
{
  "scenario": "stress-timeout-loop",
  "timestamp": "2026-07-31T10:00:00.000Z",
  "targetUrl": "http://localhost:8080",
  "totalDuration_ms": 3600000,
  "totalDuration_formatted": "60.0 min",
  "phasesCompleted": 5,
  "phases": [
    {
      "phaseName": "warmup",
      "duration_ms": 300000,
      "chainsExecuted": 150,
      "chainsSuccessful": 148,
      "chainsFailed": 2,
      "breakingDetected": false
    }
  ],
  "breakingPoint": {
    "detected": true,
    "phase": "breaking",
    "reason": "Error rate 65% exceeds threshold 50%"
  },
  "monitor": {
    "peakRSS_mb": 1024,
    "peakHeap_mb": 512,
    "finalMemoryGrowth_mb": 320,
    "peakConcurrency": 200,
    "peakCpuLoad": 85,
    "responseTimePercentiles": {
      "p50": 1200,
      "p95": 8500,
      "p99": 25000
    }
  },
  "thresholds": {
    "errorRate60s": 0.5,
    "memoryGrowthMB": 500,
    "responseTimeMs": 30000
  }
}
```

---

## 🧪 4. Run Test Suite

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

---

## 📈 5. View Instrumentation Logs

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
    "upload_receipt": { "duration_s": 0.001 },
    "validation": { "duration_s": 0.045 },
    "worker_dispatch": { "duration_s": 11.234 }
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

## 🔍 6. Monitor Real-Time Metrics

### Prometheus Metrics Endpoint

```bash
# Get all metrics
curl http://localhost:8080/metrics

# Filter for specific metrics
curl http://localhost:8080/metrics | grep http_request_duration_seconds
curl http://localhost:8080/metrics | grep upload_file_processing_seconds
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `http_request_duration_seconds` | Histogram | HTTP request latency by method/route/status |
| `upload_file_processing_seconds` | Histogram | Time to process each uploaded file |
| `nodejs_heap_size_total_bytes` | Gauge | Total heap size |
| `nodejs_heap_used_bytes` | Gauge | Used heap size |
| `nodejs_external_memory_bytes` | Gauge | External memory (C++ objects) |

---

## 🚀 7. Quick Start - Complete Workflow

### Step 1: Start the Backend
```bash
cd backend
npm run dev
```

### Step 2: Run Benchmarks (in another terminal)
```bash
# This will create 10000 test files (100KB each) by truncating real files from "dump and tip" folder
# Total disk space required: ~1GB
# Then upload 1000, 5000, and 10000 files sequentially
node perf/benchmark_upload.mjs
```

### Step 3: Run Stress Tests (in another terminal)
```bash
node perf/stress-test.mjs --quick
```

### Step 4: Run Unit Tests (in another terminal)
```bash
cd backend
npm test
```

### Step 5: View Reports
```bash
# Latest benchmark report
cat perf/reports/benchmark-latest.json | jq .

# Latest stress report
cat perf/reports/stress-upload-stress-latest.json | jq .

# System config
cat backend/data/system-config.json
```

---

## 📝 8. Example: Complete Stress Test Run

```bash
# Terminal 1: Start server
cd c:\Users\saikiran\Desktop\xray\backend
npm run dev

# Terminal 2: Run stress tests
cd c:\Users\saikiran\Desktop\xray
node perf/stress-test.mjs --scenario upload

# Output:
# ╔══════════════════════════════════════════════════════════╗
# ║         X-RAY STRESS TEST SUITE                         ║
# ╚══════════════════════════════════════════════════════════╝
#   Target: http://localhost:8080
#   Mode:   FULL
#   Reports: perf/reports
#
# ▶ Running scenario: upload-stress
#
#   ── Upload stress: 5 files x 2 concurrent ──
#   ✅ Uploaded 5 files in 1.2s (4.2 f/s)
#   ── Upload stress: 10 files x 5 concurrent ──
#   ✅ Uploaded 10 files in 2.1s (4.8 f/s)
#   ── Upload stress: 20 files x 10 concurrent ──
#   ✅ Uploaded 20 files in 3.5s (5.7 f/s)
#   ...
#
# 📄 Report saved: perf/reports/stress-upload-stress-2026-07-29T14-17-42-842Z.json
# 📄 CSV saved: perf/reports/stress-upload-stress-2026-07-29T14-17-42-842Z.csv
#
# ════════════════════════════════════════════════════════════
#  📊 SCENARIO: upload-stress
# ════════════════════════════════════════════════════════════
#    Total runs:    8
#    Passed:        7
#    Failed:        1
#    Peak memory:   512 MB
#
#    ❌ BREAKING POINT at run #8
#       Error: Upload failed with status 500
#    ✅ Memory stable: 45 MB total growth
# ════════════════════════════════════════════════════════════
```

---

## 🐛 Troubleshooting

### Stress test fails with "ECONNREFUSED"
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
- **Stress Test Code**: `perf/stress-test.mjs` + `perf/scenarios/*.mjs`
- **Test Files**: `backend/tests/*.test.js`