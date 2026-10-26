#!/usr/bin/env node
/**
 * Cross-Platform System Hardware & Environment Profiler (Node.js)
 * Probes CPU, RAM, GPU, Disk, I/O throughput, and Runtimes.
 * Generates load_test/results/system_spec.json and SYSTEM_SPEC.md
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(REPO_ROOT, 'load_test/results');

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function getCpuInfo() {
  const cpus = os.cpus();
  const model = cpus.length > 0 ? cpus[0].model : 'Unknown';
  const logical = cpus.length;
  let physical = logical;

  if (process.platform === 'linux') {
    const lscpu = runCmd('lscpu');
    if (lscpu) {
      const matchCores = lscpu.match(/Core\(s\) per socket:\s+(\d+)/);
      const matchSockets = lscpu.match(/Socket\(s\):\s+(\d+)/);
      if (matchCores) {
        const cores = parseInt(matchCores[1], 10);
        const sockets = matchSockets ? parseInt(matchSockets[1], 10) : 1;
        physical = cores * sockets;
      }
    }
  } else if (process.platform === 'win32') {
    const cores = runCmd('powershell -Command "(Get-CimInstance Win32_Processor).NumberOfCores"');
    if (cores) physical = parseInt(cores.split('\n')[0].trim(), 10) || physical;
  }

  return {
    model,
    arch: os.arch(),
    physical_cores: physical,
    logical_cores: logical,
    speed_mhz: cpus.length > 0 ? cpus[0].speed : null,
  };
}

function getMemInfo() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  let availableGB = Number((freeBytes / 1024 / 1024 / 1024).toFixed(2));
  let swapTotalGB = 0;
  let swapFreeGB = 0;

  if (process.platform === 'linux') {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
      const getKb = (k) => {
        const m = meminfo.match(new RegExp(`${k}:\\s+(\\d+)`));
        return m ? parseInt(m[1], 10) : 0;
      };
      const availKb = getKb('MemAvailable');
      if (availKb > 0) availableGB = Number((availKb / 1024 / 1024).toFixed(2));
      swapTotalGB = Number((getKb('SwapTotal') / 1024 / 1024).toFixed(2));
      swapFreeGB = Number((getKb('SwapFree') / 1024 / 1024).toFixed(2));
    } catch {}
  }

  return {
    total_ram_gb: Number((totalBytes / 1024 / 1024 / 1024).toFixed(2)),
    available_ram_gb: availableGB,
    swap_total_gb: swapTotalGB,
    swap_free_gb: swapFreeGB,
  };
}

function getDiskInfo() {
  const disks = [];
  try {
    const stats = fs.statfsSync(REPO_ROOT);
    const totalGB = Number(((stats.blocks * stats.bsize) / (1024 * 1024 * 1024)).toFixed(2));
    const freeGB = Number(((stats.bfree * stats.bsize) / (1024 * 1024 * 1024)).toFixed(2));
    disks.push({
      path: REPO_ROOT,
      total_gb: totalGB,
      used_gb: Number((totalGB - freeGB).toFixed(2)),
      free_gb: freeGB,
      is_test_target: true,
    });
  } catch {}
  return disks;
}

function getGpuInfo() {
  const gpus = [];
  const out = runCmd('nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free --format=csv,noheader,nounits');
  if (out) {
    for (const line of out.split('\n')) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 4) {
        gpus.push({
          model: parts[0],
          driver_version: parts[1],
          total_vram_mb: parseFloat(parts[2]),
          free_vram_mb: parseFloat(parts[3]),
        });
      }
    }
  }
  return gpus;
}

function benchmarkIo(sizeMb = 100) {
  const testFile = path.join(REPO_ROOT, `.io_bench_${Date.now()}.bin`);
  const chunk = Buffer.alloc(1024 * 1024, 0x5a); // 1 MB
  let writeSpeed = 0;
  let readSpeed = 0;

  try {
    // Write
    const t0 = Date.now();
    const fd = fs.openSync(testFile, 'w');
    for (let i = 0; i < sizeMb; i++) {
      fs.writeSync(fd, chunk);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const writeDur = (Date.now() - t0) / 1000;
    writeSpeed = Number((sizeMb / writeDur).toFixed(2));

    // Read
    const t1 = Date.now();
    const readFd = fs.openSync(testFile, 'r');
    const readBuf = Buffer.alloc(1024 * 1024);
    while (fs.readSync(readFd, readBuf, 0, readBuf.length, null) > 0) {}
    fs.closeSync(readFd);
    const readDur = (Date.now() - t1) / 1000;
    readSpeed = Number((sizeMb / readDur).toFixed(2));
  } catch (err) {
    console.error('[WARN] IO Benchmark error:', err.message);
  } finally {
    try { if (fs.existsSync(testFile)) fs.unlinkSync(testFile); } catch {}
  }

  return { sample_size_mb: sizeMb, seq_write_mb_per_sec: writeSpeed, seq_read_mb_per_sec: readSpeed };
}

function main() {
  console.log('='.repeat(60));
  console.log('EXTRACTING SYSTEM HARDWARE & BENCHMARK ENVIRONMENT DETAILS');
  console.log('='.repeat(60));

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  console.log('[1/5] Probing CPU topology...');
  const cpu = getCpuInfo();
  console.log(`      Model: ${cpu.model}`);
  console.log(`      Cores: ${cpu.physical_cores} physical, ${cpu.logical_cores} logical`);

  console.log('[2/5] Probing RAM and Swap...');
  const mem = getMemInfo();
  console.log(`      RAM: ${mem.total_ram_gb} GB total, ${mem.available_ram_gb} GB available`);

  console.log('[3/5] Probing Disks & I/O Benchmark (100MB)...');
  const disks = getDiskInfo();
  const io = benchmarkIo(100);
  console.log(`      Target Disk Free: ${disks[0]?.free_gb ?? '?'} GB`);
  console.log(`      Disk Sequential Write: ${io.seq_write_mb_per_sec} MB/s, Read: ${io.seq_read_mb_per_sec} MB/s`);

  console.log('[4/5] Probing GPU and Runtimes...');
  const gpus = getGpuInfo();
  if (gpus.length > 0) {
    for (const g of gpus) console.log(`      GPU: ${g.model} (${(g.total_vram_mb/1024).toFixed(1)} GB VRAM)`);
  } else {
    console.log('      GPU: No NVIDIA GPU detected.');
  }

  const runtimes = {
    node: process.version,
    npm: runCmd('npm --version') || 'Not installed',
    python: runCmd('python3 --version') || runCmd('python --version') || 'Not installed',
    os_name: os.type(),
    os_release: os.release(),
    platform_str: `${os.type()} ${os.release()} (${os.arch()})`,
    ulimit_nofile: process.platform === 'linux' ? runCmd('ulimit -n') : 'N/A',
    ulimit_nproc: process.platform === 'linux' ? runCmd('ulimit -u') : 'N/A',
  };

  const spec = {
    timestamp: new Date().toISOString(),
    cpu,
    memory: mem,
    disks,
    gpus,
    runtimes,
    io_benchmark: io,
  };

  const jsonPath = path.join(RESULTS_DIR, 'system_spec.json');
  fs.writeFileSync(jsonPath, JSON.stringify(spec, null, 2));
  console.log(`\n[5/5] Saved JSON spec to: ${jsonPath}`);

  const gpuStr = gpus.length > 0
    ? gpus.map(g => `${g.model} (${(g.total_vram_mb/1024).toFixed(1)} GB VRAM)`).join(', ')
    : 'None detected (CPU-only)';

  const md = `# System Hardware & Benchmark Environment Specification

> **Extraction Timestamp:** ${spec.timestamp}  
> **Host Platform:** ${runtimes.platform_str}  

---

## 1. Hardware Summary

| Component | Specification |
|-----------|---------------|
| **OS Distribution** | \`${runtimes.os_name} ${runtimes.os_release}\` (${runtimes.platform_str}) |
| **CPU Model** | **${cpu.model}** |
| **CPU Topology** | **${cpu.physical_cores} Physical Cores** / **${cpu.logical_cores} Logical Threads** (${cpu.arch}) |
| **Total System RAM** | **${mem.total_ram_gb} GB** |
| **Available RAM at Baseline** | **${mem.available_ram_gb} GB** |
| **Swap Space** | ${mem.swap_total_gb} GB total (${mem.swap_free_gb} GB free) |
| **GPU / Accelerators** | ${gpuStr} |
| **Target Test Directory** | \`${disks[0]?.path ?? '.'}\` |
| **Target Disk Free Space** | **${disks[0]?.free_gb ?? '?'} GB free** (out of ${disks[0]?.total_gb ?? '?'} GB) |
| **Disk Sequential I/O** | **Write: ${io.seq_write_mb_per_sec} MB/s** \| **Read: ${io.seq_read_mb_per_sec} MB/s** |

---

## 2. Software & Runtime Environments

| Runtime / Tool | Version / Limit |
|----------------|-----------------|
| **Node.js** | \`${runtimes.node}\` |
| **NPM** | \`${runtimes.npm}\` |
| **Python** | \`${runtimes.python}\` |
| **Max Open Files (\`ulimit -n\`)** | \`${runtimes.ulimit_nofile}\` |
| **Max User Processes (\`ulimit -u\`)** | \`${runtimes.ulimit_nproc}\` |

---

## 3. Capacity & Worker Allocation Recommendations

Based on this machine's specification:
- **Recommended Node Heap:** \`--max-old-space-size=${Math.min(8192, Math.floor(mem.total_ram_gb * 512))}\`
- **Recommended Python Upload Workers:** \`${Math.min(16, Math.max(4, cpu.physical_cores))}\` workers
- **Maximum Recommended Upload In-Flight:** \`${Math.min(800, cpu.logical_cores * 100)}\` items
- **Disk Safety Limit:** Stop test if free space drops below \`3.0 GB\`.

*Generated automatically by \`load_test/scripts/extract_system_info.mjs\`.*
`;

  const mdPath = path.join(RESULTS_DIR, 'SYSTEM_SPEC.md');
  fs.writeFileSync(mdPath, md);
  console.log(`      Saved Markdown report to: ${mdPath}`);

  console.log('\n' + '='.repeat(60));
  console.log('SYSTEM PROFILING COMPLETE!');
  console.log('='.repeat(60));
}

main();
