# System Hardware & Benchmark Environment Specification

> **Extraction Timestamp:** 2026-10-25T18:04:43.173Z  
> **Host Platform:** Windows_NT 10.0.26200 (x64)  

---

## 1. Hardware Summary

| Component | Specification |
|-----------|---------------|
| **OS Distribution** | `Windows_NT 10.0.26200` (Windows_NT 10.0.26200 (x64)) |
| **CPU Model** | **12th Gen Intel(R) Core(TM) i5-12450HX** |
| **CPU Topology** | **8 Physical Cores** / **12 Logical Threads** (x64) |
| **Total System RAM** | **15.71 GB** |
| **Available RAM at Baseline** | **3.46 GB** |
| **Swap Space** | 0 GB total (0 GB free) |
| **GPU / Accelerators** | NVIDIA GeForce RTX 3050 6GB Laptop GPU (6.0 GB VRAM) |
| **Target Test Directory** | `B:\xray` |
| **Target Disk Free Space** | **31.44 GB free** (out of 97.66 GB) |
| **Disk Sequential I/O** | **Write: 862.07 MB/s** | **Read: 4347.83 MB/s** |

---

## 2. Software & Runtime Environments

| Runtime / Tool | Version / Limit |
|----------------|-----------------|
| **Node.js** | `v24.15.0` |
| **NPM** | `11.6.1` |
| **Python** | `Python 3.14.5` |
| **Max Open Files (`ulimit -n`)** | `N/A` |
| **Max User Processes (`ulimit -u`)** | `N/A` |

---

## 3. Capacity & Worker Allocation Recommendations

Based on this machine's specification:
- **Recommended Node Heap:** `--max-old-space-size=8043`
- **Recommended Python Upload Workers:** `8` workers
- **Maximum Recommended Upload In-Flight:** `800` items
- **Disk Safety Limit:** Stop test if free space drops below `3.0 GB`.

*Generated automatically by `load_test/scripts/extract_system_info.mjs`.*
