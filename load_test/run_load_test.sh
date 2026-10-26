#!/usr/bin/env bash
# ==============================================================================
# Linux / POSIX Master Load Testing & Benchmarking Runner
# Usage:
#   chmod +x load_test/run_load_test.sh
#   ./load_test/run_load_test.sh [--scales 10000,16000,20000] [--seeds-only] [--quick]
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================================================"
echo "SYNTHETIC X-RAY APPLICATION — LAB ENVIRONMENT BENCHMARK & LOAD TEST"
echo "========================================================================"
echo "Repository Root: $REPO_ROOT"
cd "$REPO_ROOT"

# 1. Check prerequisites
echo ""
echo "[Step 1/6] Checking Prerequisites..."
if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is not installed. Please install Node.js v18+."
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is not installed. Please install Python 3.9+."
    exit 1
fi

NODE_VER=$(node -v)
PY_VER=$(python3 --version)
echo "Found Node.js: $NODE_VER | Python: $PY_VER"

# Adjust file descriptors limit on Linux if allowed
if [ "$(uname)" = "Linux" ]; then
    ulimit -n 65535 2>/dev/null || true
    echo "Open Files Limit: $(ulimit -n)"
fi

# 2. Extract System Specifications of the Lab Computer
echo ""
echo "[Step 2/6] Profiling Lab Machine Hardware & Environment..."
if [ -f "$REPO_ROOT/load_test/scripts/extract_system_info.py" ]; then
    python3 "$REPO_ROOT/load_test/scripts/extract_system_info.py"
else
    node "$REPO_ROOT/load_test/scripts/extract_system_info.mjs"
fi

# 3. Ensure Backend Dependencies
echo ""
echo "[Step 3/6] Ensuring Backend Node Dependencies..."
if [ ! -d "$REPO_ROOT/backend/node_modules" ]; then
    echo "Installing backend dependencies (npm install)..."
    (cd "$REPO_ROOT/backend" && npm install --silent)
fi

# 4. Prepare 1,000 Seed Files
echo ""
echo "[Step 4/6] Verifying / Generating 1,000 Seed Files..."
node "$REPO_ROOT/load_test/scripts/prepare_seed_files.mjs" --count 1000

if [ "$1" = "--seeds-only" ]; then
    echo "Seeds prepared successfully. Exiting as requested by --seeds-only."
    exit 0
fi

# 5. Start Backend Server if Not Active
echo ""
echo "[Step 5/6] Checking Backend Server Status on port 8080..."
SERVER_PID=""
if ! curl -s -f http://localhost:8080/api/health >/dev/null 2>&1; then
    # Calculate optimal heap from available RAM
    TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "8000000")
    TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
    HEAP_MB=$((TOTAL_MEM_MB / 2))
    if [ "$HEAP_MB" -gt 8192 ]; then HEAP_MB=8192; fi
    if [ "$HEAP_MB" -lt 2048 ]; then HEAP_MB=2048; fi

    echo "Starting backend server with --max-old-space-size=$HEAP_MB..."
    (cd "$REPO_ROOT/backend" && node --max-old-space-size=$HEAP_MB src/server.js > "$REPO_ROOT/load_test/logs/backend.log" 2>&1 & echo $! > /tmp/xray_backend.pid)
    SERVER_PID=$(cat /tmp/xray_backend.pid 2>/dev/null || echo "")

    echo "Waiting for server to become healthy..."
    RETRIES=30
    until curl -s -f http://localhost:8080/api/health >/dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
        sleep 1
        RETRIES=$((RETRIES - 1))
    done

    if [ $RETRIES -eq 0 ]; then
        echo "ERROR: Backend server failed to start within 30 seconds."
        cat "$REPO_ROOT/load_test/logs/backend.log" | tail -n 30
        exit 1
    fi
    echo "Backend server is healthy (PID: $SERVER_PID)!"
else
    echo "Backend server is already running and healthy on port 8080."
fi

# Cleanup trap to kill server if we started it
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        echo "Stopping test backend server (PID $SERVER_PID)..."
        kill "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# 6. Execute Load Test Suite
echo ""
echo "[Step 6/6] Executing Professional Load Test Suite..."
node "$REPO_ROOT/load_test/scripts/run_all_tests.mjs" "$@"

echo ""
echo "========================================================================"
echo "ALL LOAD TESTS & BENCHMARKING COMPLETED SUCCESSFULLY!"
echo "Results:"
echo "  - System Spec:    $REPO_ROOT/load_test/results/SYSTEM_SPEC.md"
echo "  - Master Summary: $REPO_ROOT/load_test/results/master_summary.json"
echo "  - Graphs & Dash:  $REPO_ROOT/load_test/graphs/dashboard.html"
echo "  - Detailed Logs:  $REPO_ROOT/load_test/logs/full_load_test.log"
echo "========================================================================"
