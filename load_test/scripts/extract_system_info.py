#!/usr/bin/env python3
"""
System Hardware & Environment Profiler for Load Testing
Extracts CPU, Memory, Disk, GPU, OS, and Runtime details across Linux and Windows.
Outputs:
  - load_test/results/system_spec.json
  - load_test/results/SYSTEM_SPEC.md
"""

import os
import sys
import json
import time
import shutil
import platform
import subprocess
from pathlib import Path

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        return res.stdout.strip() if res.returncode == 0 else ""
    except Exception:
        return ""

def get_cpu_info():
    info = {
        "model": platform.processor() or "Unknown",
        "arch": platform.machine(),
        "logical_cores": os.cpu_count() or 1,
        "physical_cores": None,
        "max_freq_mhz": None,
    }
    
    if platform.system() == "Linux":
        # Extract from /proc/cpuinfo or lscpu
        lscpu = run_cmd("lscpu")
        if lscpu:
            for line in lscpu.splitlines():
                if "Model name:" in line:
                    info["model"] = line.split(":", 1)[1].strip()
                elif "Core(s) per socket:" in line:
                    try:
                        cores_per_socket = int(line.split(":", 1)[1].strip())
                        sockets = 1
                        for s_line in lscpu.splitlines():
                            if "Socket(s):" in s_line:
                                sockets = int(s_line.split(":", 1)[1].strip())
                        info["physical_cores"] = cores_per_socket * sockets
                    except Exception:
                        pass
                elif "CPU max MHz:" in line or "CPU MHz:" in line:
                    if not info["max_freq_mhz"]:
                        try:
                            info["max_freq_mhz"] = float(line.split(":", 1)[1].strip())
                        except Exception:
                            pass
        else:
            cpuinfo = run_cmd("cat /proc/cpuinfo")
            for line in cpuinfo.splitlines():
                if "model name" in line:
                    info["model"] = line.split(":", 1)[1].strip()
                    break
    elif platform.system() == "Windows":
        wmic_cpu = run_cmd("powershell -Command \"(Get-CimInstance Win32_Processor).Name\"")
        if wmic_cpu:
            info["model"] = wmic_cpu.splitlines()[0].strip()
        cores = run_cmd("powershell -Command \"(Get-CimInstance Win32_Processor).NumberOfCores\"")
        if cores:
            try:
                info["physical_cores"] = int(cores.splitlines()[0].strip())
            except Exception:
                pass

    if info["physical_cores"] is None:
        info["physical_cores"] = info["logical_cores"] // 2 if info["logical_cores"] > 1 else 1

    return info

def get_mem_info():
    info = {
        "total_ram_gb": 0.0,
        "available_ram_gb": 0.0,
        "swap_total_gb": 0.0,
        "swap_free_gb": 0.0,
    }

    if platform.system() == "Linux":
        try:
            with open("/proc/meminfo", "r") as f:
                mem_data = {}
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val = parts[1].strip().split()[0]
                        mem_data[key] = int(val)
                total_kb = mem_data.get("MemTotal", 0)
                avail_kb = mem_data.get("MemAvailable", mem_data.get("MemFree", 0))
                swap_total_kb = mem_data.get("SwapTotal", 0)
                swap_free_kb = mem_data.get("SwapFree", 0)
                info["total_ram_gb"] = round(total_kb / 1024 / 1024, 2)
                info["available_ram_gb"] = round(avail_kb / 1024 / 1024, 2)
                info["swap_total_gb"] = round(swap_total_kb / 1024 / 1024, 2)
                info["swap_free_gb"] = round(swap_free_kb / 1024 / 1024, 2)
        except Exception:
            pass
    elif platform.system() == "Windows":
        cmd = "powershell -Command \"$os = Get-CimInstance Win32_OperatingSystem; [math]::Round($os.TotalVisibleMemorySize/1MB,2); [math]::Round($os.FreePhysicalMemory/1MB,2)\""
        out = run_cmd(cmd)
        lines = out.splitlines()
        if len(lines) >= 2:
            try:
                info["total_ram_gb"] = float(lines[0].strip())
                info["available_ram_gb"] = float(lines[1].strip())
            except Exception:
                pass

    return info

def get_disk_info(target_path="."):
    disks = []
    
    # Check filesystem of current working directory
    target_abs = os.path.abspath(target_path)
    try:
        usage = shutil.disk_usage(target_abs)
        disks.append({
            "path": target_abs,
            "total_gb": round(usage.total / 1024 / 1024 / 1024, 2),
            "used_gb": round(usage.used / 1024 / 1024 / 1024, 2),
            "free_gb": round(usage.free / 1024 / 1024 / 1024, 2),
            "is_test_target": True
        })
    except Exception:
        pass

    if platform.system() == "Linux":
        df_out = run_cmd("df -h -x tmpfs -x devtmpfs -x squashfs")
        df_lines = df_out.splitlines()
        # Parse df lines
        for line in df_lines[1:]:
            parts = line.split()
            if len(parts) >= 6:
                mount = parts[5]
                if mount != target_abs and not any(d["path"] == mount for d in disks):
                    disks.append({
                        "filesystem": parts[0],
                        "size": parts[1],
                        "used": parts[2],
                        "avail": parts[3],
                        "use_pct": parts[4],
                        "mount": mount,
                        "is_test_target": False
                    })
    elif platform.system() == "Windows":
        ps_disk = run_cmd("powershell -Command \"Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='TotalGB';E={[math]::Round(($_.Used+$_.Free)/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}}\"")
        # Just record drives
        pass

    return disks

def get_gpu_info():
    gpus = []
    nvsmi = shutil.which("nvidia-smi")
    if nvsmi:
        out = run_cmd("nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free --format=csv,noheader,nounits")
        if out:
            for line in out.splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 4:
                    gpus.append({
                        "model": parts[0],
                        "driver_version": parts[1],
                        "total_vram_mb": float(parts[2]),
                        "free_vram_mb": float(parts[3])
                    })
    return gpus

def get_runtimes():
    return {
        "node": run_cmd("node --version") or "Not installed",
        "npm": run_cmd("npm --version") or "Not installed",
        "python": sys.version.split()[0],
        "python_path": sys.executable,
        "os_name": platform.system(),
        "os_release": platform.release(),
        "os_version": platform.version(),
        "platform_str": platform.platform(),
        "ulimit_nofile": run_cmd("ulimit -n") if platform.system() == "Linux" else "N/A",
        "ulimit_nproc": run_cmd("ulimit -u") if platform.system() == "Linux" else "N/A",
    }

def benchmark_io_speed(test_dir=".", size_mb=100):
    test_file = os.path.join(test_dir, f".io_bench_tmp_{int(time.time())}.bin")
    chunk_size = 1024 * 1024  # 1 MB
    data = os.urandom(chunk_size)
    write_speed_mb = 0.0
    read_speed_mb = 0.0

    try:
        # Write benchmark
        t0 = time.time()
        with open(test_file, "wb") as f:
            for _ in range(size_mb):
                f.write(data)
            f.flush()
            os.fsync(f.fileno())
        t_write = time.time() - t0
        write_speed_mb = round(size_mb / t_write, 2) if t_write > 0 else 0.0

        # Read benchmark
        t0 = time.time()
        with open(test_file, "rb") as f:
            while f.read(chunk_size):
                pass
        t_read = time.time() - t0
        read_speed_mb = round(size_mb / t_read, 2) if t_read > 0 else 0.0
    except Exception as e:
        print(f"[WARN] IO Benchmark error: {e}", file=sys.stderr)
    finally:
        if os.path.exists(test_file):
            try:
                os.remove(test_file)
            except Exception:
                pass

    return {
        "sample_size_mb": size_mb,
        "seq_write_mb_per_sec": write_speed_mb,
        "seq_read_mb_per_sec": read_speed_mb
    }

def generate_markdown(spec):
    cpu = spec["cpu"]
    mem = spec["memory"]
    disks = spec["disks"]
    gpus = spec["gpus"]
    rt = spec["runtimes"]
    io = spec["io_benchmark"]

    gpu_str = "None detected (CPU-only)"
    if gpus:
        gpu_str = ", ".join([f"{g['model']} ({round(g['total_vram_mb']/1024, 1)} GB VRAM)" for g in gpus])

    target_disk = disks[0] if disks else {"total_gb": "?", "free_gb": "?"}

    md = f"""# System Hardware & Benchmark Environment Specification

> **Extraction Timestamp:** {spec['timestamp']}  
> **Host Platform:** {rt['platform_str']}  

---

## 1. Hardware Summary

| Component | Specification |
|-----------|---------------|
| **OS Distribution** | `{rt['os_name']} {rt['os_release']}` ({rt['platform_str']}) |
| **CPU Model** | **{cpu['model']}** |
| **CPU Topology** | **{cpu['physical_cores']} Physical Cores** / **{cpu['logical_cores']} Logical Threads** ({cpu['arch']}) |
| **Total System RAM** | **{mem['total_ram_gb']} GB** |
| **Available RAM at Baseline** | **{mem['available_ram_gb']} GB** |
| **Swap Space** | {mem['swap_total_gb']} GB total ({mem['swap_free_gb']} GB free) |
| **GPU / Accelerators** | {gpu_str} |
| **Target Test Directory** | `{target_disk.get('path', '.')}` |
| **Target Disk Free Space** | **{target_disk.get('free_gb', '?')} GB free** (out of {target_disk.get('total_gb', '?')} GB) |
| **Disk Sequential I/O** | **Write: {io['seq_write_mb_per_sec']} MB/s** | **Read: {io['seq_read_mb_per_sec']} MB/s** |

---

## 2. Software & Runtime Environments

| Runtime / Tool | Version / Limit |
|----------------|-----------------|
| **Node.js** | `{rt['node']}` |
| **NPM** | `{rt['npm']}` |
| **Python** | `{rt['python']}` (`{rt['python_path']}`) |
| **Max Open Files (`ulimit -n`)** | `{rt['ulimit_nofile']}` |
| **Max User Processes (`ulimit -u`)** | `{rt['ulimit_nproc']}` |

---

## 3. Capacity & Worker Allocation Recommendations

Based on this machine's specification:
- **Recommended Node Heap:** `--max-old-space-size={min(8192, int(mem['total_ram_gb'] * 512))}`
- **Recommended Python Upload Workers:** `{min(16, max(4, cpu['physical_cores']))}` workers
- **Maximum Recommended Upload In-Flight:** `{min(800, cpu['logical_cores'] * 100)}` items
- **Disk Safety Limit:** Stop test if free space drops below `3.0 GB`.

*Generated automatically by `load_test/scripts/extract_system_info.py`.*
"""
    return md

def main():
    print("=" * 60)
    print("EXTRACTING SYSTEM HARDWARE & BENCHMARK ENVIRONMENT DETAILS")
    print("=" * 60)

    repo_root = Path(__file__).resolve().parent.parent.parent
    results_dir = repo_root / "load_test" / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    print("[1/5] Probing CPU topology...")
    cpu = get_cpu_info()
    print(f"      Model: {cpu['model']}")
    print(f"      Cores: {cpu['physical_cores']} physical, {cpu['logical_cores']} logical")

    print("[2/5] Probing RAM and Swap...")
    mem = get_mem_info()
    print(f"      RAM: {mem['total_ram_gb']} GB total, {mem['available_ram_gb']} GB available")

    print("[3/5] Probing Disks & I/O Benchmark (100MB)...")
    disks = get_disk_info(str(repo_root))
    io = benchmark_io_speed(str(repo_root), size_mb=100)
    print(f"      Target Disk Free: {disks[0].get('free_gb', '?')} GB")
    print(f"      Disk Sequential Write: {io['seq_write_mb_per_sec']} MB/s, Read: {io['seq_read_mb_per_sec']} MB/s")

    print("[4/5] Probing GPU and Runtimes...")
    gpus = get_gpu_info()
    if gpus:
        for g in gpus:
            print(f"      GPU: {g['model']} ({round(g['total_vram_mb']/1024, 1)} GB VRAM)")
    else:
        print("      GPU: No NVIDIA GPU detected.")
    rt = get_runtimes()
    print(f"      Node.js: {rt['node']} | Python: {rt['python']}")

    spec = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cpu": cpu,
        "memory": mem,
        "disks": disks,
        "gpus": gpus,
        "runtimes": rt,
        "io_benchmark": io,
    }

    json_path = results_dir / "system_spec.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(spec, f, indent=2)
    print(f"\n[5/5] Saved JSON spec to: {json_path}")

    md_content = generate_markdown(spec)
    md_path = results_dir / "SYSTEM_SPEC.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"      Saved Markdown report to: {md_path}")

    print("\n" + "=" * 60)
    print("SYSTEM PROFILING COMPLETE!")
    print("=" * 60)

if __name__ == "__main__":
    main()
