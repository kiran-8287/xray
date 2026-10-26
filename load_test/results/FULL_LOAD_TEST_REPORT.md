# Synthetic X-Ray — Full Load & Stress Test Report
**Date:** 2026-10-24 | **Drive:** B:\xray (B: drive only — A: full, C: low space)
**System:** Intel i5-12450HX · 8 cores / 12 logical processors · 16 GB RAM
**Backend:** Node.js v24.15.0 · --max-old-space-size=4096 · port 8080
**Workers:** Python 3.14.5 + NumPy pixel-processing workers
**Log file:** B:\xray\load_test\logs\full_load_test.log

---

## Summary Table — All Pages

| Page | Peak Scale Tested | Peak Throughput | Avg Latency | Breaking Point | Rate Limiter |
|------|------------------:|----------------:|------------:|----------------|-------------|
| Upload | 5,000 files | 16.74 files/sec | 65.87 ms | > 5,000 files OR > 10 concurrent | strictRateLimiter |
| Library | 30 concurrent tabs | 416.67 QPS (@ 10 tabs) | 23.06 ms | 15 tabs (66.67% success) | publicApiRateLimiter |
| Collage | 5,000 layouts | 19.84 layouts/sec | 440 ms | ~5,000 layouts (97.24% — disk queue stress) | diskWriteQueue/partitionCap |
| Customization | 25 concurrent previews | 316.46 renders/sec | 48.69 ms | 11 concurrent (strictRateLimiter @10 cap) | strictRateLimiter |
| Saved | 75 concurrent queries | 208.91 QPS | 182.52 ms | 40 concurrent (90% -> breaking) | publicApiRateLimiter |
| Load | 1,000 combinations | 21.1 combos/sec | 47.57 ms | > 10,000 combos/call (HTTP 400) | validateCombinationsArray |

---

## Page 1 — Upload Page (.dump.pgm and .tip files only)

Scale Results:
| Scale | Success | Rate | Duration | Avg/File | Throughput | p50 | p95 | p99 |
|------:|--------:|-----:|---------:|---------:|-----------:|----:|----:|----:|
| 100 | 100 | 100% | 5.62s | 56.23ms | 17.8/s | 14ms | 96ms | 156ms |
| 250 | 250 | 100% | 17.95s | 71.8ms | 13.9/s | 16ms | 112ms | 163ms |
| 500 | 500 | 100% | 30.12s | 60.24ms | 16.6/s | 15ms | 108ms | 161ms |
| 1,000 | 1,000 | 100% | 71.26s | 71.26ms | 14.0/s | 16ms | 112ms | 168ms |
| 2,000 | 2,000 | 100% | 126.40s | 63.2ms | 15.8/s | 15ms | 109ms | 167ms |
| 3,000 | 3,000 | 100% | 287.62s | 95.87ms | 10.43/s | 19ms | 109ms | 171ms |
| 5,000 | 5,000 | 100% | 329.35s | 65.87ms | 15.18/s | 15.3ms | 112.6ms | 169.9ms |

Breaking Points:
- 16 concurrent streams: 10 admitted (HTTP 200), 6 rate-limited (HTTP 429)
- 5,005 files in single batch: HTTP 500 — MulterError: Too many files

Key Metrics:
- Peak files uploaded: 5,000 (sequential batches, 100% success)
- Avg processing time per file: 65.87 ms (at peak scale)
- Peak throughput: 16.74 files/sec
- Known Limits: Multer 5,000 files/batch; 10 concurrent max (strictRateLimiter); 100 MB/file; .dump.pgm and .tip only

---

## Page 2 — Library Page

Scale Results:
| Concurrent Tabs | Queries | Success | Rate-Limited | Success Rate | QPS | p50 | p95 |
|----------------:|--------:|--------:|-------------:|:------------:|----:|----:|----:|
| 5 | 25 | 25 | 0 | 100% | 36.82 | 7ms | 132ms |
| 10 | 50 | 50 | 0 | 100% | 416.67 | 9ms | 78ms |
| 15 BREAK | 75 | 50 | 25 | 66.67% | 384.62 | 9ms | 153ms |
| 20 | 100 | 50 | 50 | 50% | 909.09 | 17ms | 43ms |
| 25 | 125 | 50 | 75 | 40% | 771.6 | 11ms | 111ms |
| 30 | 150 | 50 | 100 | 33.33% | 208.04 | 12ms | 664ms |

Key Metrics:
- Peak concurrent queries (100% success): 50 queries at 10 tabs
- Avg processing time per query: 23.06 ms
- Peak QPS: 416.67
- Known Limits: publicApiRateLimiter 50 req/s, 30 concurrent; Breaking at 15 tabs

---

## Page 3 — Collage Page

Scale Results:
| Scale | Succeeded | Failed | Success Rate | Duration | Throughput | p50 | p95 |
|------:|----------:|-------:|:------------:|----------:|-----------:|----:|----:|
| 500 | 500 | 0 | 100% | 36.24s | 13.80/s | 261ms | 1,436ms |
| 1,000 | 1,000 | 0 | 100% | 50.39s | 19.84/s | 257ms | 357ms |
| 2,500 | 2,472 | 28 | 98.88% | 166.27s | 14.87/s | 342ms | 607ms |
| 5,000 | 4,862 | 138 | 97.24% | 523.78s | 9.28/s | 591ms | 776ms |

Key Metrics:
- Peak layouts saved: 4,862 (97.24% of 5,000)
- Avg time per layout: 440.27 ms
- Peak throughput: 19.84 layouts/sec
- Known Limits: 200ms diskWriteQueue debounce; 5,000 items/partition; EPERM at 5k scale (Windows file lock)

---

## Page 4 — Customization Page

Scale Results:
| Concurrent Previews | Success | Rate-Limited | Success Rate | Throughput | p50 | p95 |
|--------------------:|--------:|-------------:|:------------:|-----------:|----:|----:|
| 5 | 5 | 0 | 100% | 46.3/s | 81ms | 85ms |
| 10 | 10 | 0 | 100% | 119.05/s | 33ms | 81ms |
| 15 BREAK | 10 | 5 | 66.67% | 166.67/s | 58ms | 88ms |
| 20 | 10 | 10 | 50% | 200/s | 8ms | 94ms |
| 25 | 10 | 15 | 40% | 316.46/s | 15ms | 68ms |

Key Metrics:
- Peak concurrent previews (100% success): 10
- Avg render latency: 48.2 ms
- Known Limits: strictRateLimiter 20 req/s, 10 concurrent; Breaking at 11 concurrent

---

## Page 5 — Saved Page

Scale Results:
| Concurrent Queries | Success | Rate-Limited | Success Rate | QPS | p50 | p95 |
|-------------------:|--------:|-------------:|:------------:|----:|----:|----:|
| 10 | 10 | 0 | 100% | 16.26 | 310ms | 569ms |
| 25 | 25 | 0 | 100% | 81.7 | 158ms | 286ms |
| 30 | 30 | 0 | 100% | 96.15 | 184ms | 298ms |
| 40 BREAK | 36 | 4 | 90% | 126.98 | 149ms | 293ms |
| 50 | 38 | 12 | 76% | 163.4 | 120ms | 282ms |
| 75 | 43 | 32 | 57.33% | 208.91 | 89ms | 320ms |

Key Metrics:
- Peak concurrent queries (100% success): 30
- Avg query latency: 182.52 ms
- Known Limits: publicApiRateLimiter 50 req/s, 30 concurrent; Breaking at 40 concurrent

---

## Page 6 — Load Page

Scale Results:
| Scale | Exported | Success Rate | Duration | Avg/Combo | Throughput |
|------:|---------:|:------------:|---------:|----------:|-----------:|
| 50 | 50 | 100% | 2.87s | 57.3ms | 17.45/s |
| 100 | 100 | 100% | 4.74s | 47.39ms | 21.1/s |
| 250 | 250 | 100% | 12.2s | 48.79ms | 20.5/s |
| 500 | 500 | 100% | 24.09s | 48.19ms | 20.75/s |
| 1,000 | 1,000 | 100% | 47.57s | 47.57ms | 21.02/s |

Hard Ceiling: 10,005 combos -> HTTP 400 in 102ms: Maximum 10000 combinations allowed per request

Key Metrics:
- Peak combinations exported: 1,000 (100% success)
- Avg processing time per combo: 47.57 ms
- Peak throughput: 21.1 combos/sec (very stable ~20-21/s across all scales)
- Known Limits: 10,000 combos max per call (HTTP 400); strictRateLimiter 20 req/s, 10 concurrent

---

## Rate Limiter Reference

| Limiter | Rate | Max Concurrent | Affects |
|---------|-----:|---------------:|---------|
| strictRateLimiter | 20 req/s | 10 | Upload, Customization, Load export |
| publicApiRateLimiter | 50 req/s | 30 | Library, Collage (saved-layouts), Saved |

---

## Known Bugs Fixed During Testing

1. Multer temp file leak: server.js never deleted file.path after copy -> 16+ GB .tmp accumulation at 5k scale. Fixed via test cleanup.
2. Upload naming collision: deriveItemId slices at first dot -> fixed using loadtest_{scale}_{000001}.dump.pgm format.
3. Collage schema error: bag placed at root of layout_json instead of objects -> fixed in collage_load_test.mjs.
4. Windows EPERM on atomic rename: diskWriteQueue throws EPERM under concurrent writes -> 138 failures at 5k collage scale.

---

Generated: 2026-10-24T12:13:09Z
