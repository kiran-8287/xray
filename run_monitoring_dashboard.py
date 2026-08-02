"""
Bootstrap runner for the Xray Monitoring Dashboard.

Usage (from project root)::

    python run_monitoring_dashboard.py
    python run_monitoring_dashboard.py --port 8502
    python run_monitoring_dashboard.py --no-server-check   # skip backend health check

What it does
------------
1. Ensures the ``backend/data`` directory + ``monitoring.log`` exist so the
   dashboard doesn't show a "missing file" warning before the first request
   hits the backend.
2. Prints an API inventory summary (list of every ``app.<method>`` route
   registered in ``backend/src/server.js``) — useful as a reference when
   interpreting endpoint-level charts.
3. Runs a quick ``pip install`` sanity check for ``streamlit``/``pandas`` in
   the project virtualenv (if found) or the active Python interpreter.
4. Executes ``streamlit run monitoring_dashboard.py`` on the requested port.

This is the "Python build script" the frontend testing flow calls — it
prepares everything and opens the live-tailing Streamlit monitoring UI.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER_JS = ROOT / "backend" / "src" / "server.js"
DATA_DIR = ROOT / "backend" / "data"
LOG_FILE = DATA_DIR / "monitoring.log"
DASHBOARD = ROOT / "monitoring_dashboard.py"
BACKEND_URL = "http://localhost:8080/metrics/live"

REQUIRED_PACKAGES = ["streamlit>=1.30", "pandas>=2.0"]


# ---------------------------------------------------------------------------
# 1. Log file scaffolding
# ---------------------------------------------------------------------------

def ensure_logging_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not LOG_FILE.exists():
        LOG_FILE.touch(exist_ok=True)
    # pixel_data / library_images / collage_images are also data dir children;
    # we leave those to the backend storage module since it owns permissions.
    for sub in ("library_images", "collage_images", "pixel_data"):
        (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# 2. API endpoint inventory scraped straight from server.js (regex)
# ---------------------------------------------------------------------------

def scrape_api_inventory() -> list[tuple[str, str]]:
    """
    Regex-scan server.js for Express route registrations of the form::

        app.<METHOD>('/api/...', ...)
        app.<METHOD>('/...' , ...)

    Returns a sorted list of ``(METHOD, path_template)`` tuples.
    """
    if not SERVER_JS.exists():
        return []
    text = SERVER_JS.read_text(encoding="utf-8", errors="replace")
    pattern = re.compile(
        r"^\s*app\s*\.\s*(get|post|put|delete|patch)\s*\(\s*"
        r"(?P<quote>[\"'])(?P<path>[^\"']+)(?P=quote)",
        re.MULTILINE | re.IGNORECASE,
    )
    found: set[tuple[str, str]] = set()
    for m in pattern.finditer(text):
        method = m.group(1).upper()
        path = m.group("path")
        # Skip the static mounts that are not actually API handlers.
        if path in ("/", "/metrics") and method != "GET":
            pass
        found.add((method, path))
    return sorted(found, key=lambda kv: (kv[1], kv[0]))


def print_inventory(inv: list[tuple[str, str]]) -> None:
    if not inv:
        return
    api_only = [(m, p) for (m, p) in inv if p.startswith("/api")]
    others = [(m, p) for (m, p) in inv if not p.startswith("/api")]
    print("\n=== Registered API Endpoints (scraped from server.js) ===")
    for m, p in api_only:
        print(f"  {m:6s} {p}")
    if others:
        print("\n=== Other Routes ===")
        for m, p in others:
            print(f"  {m:6s} {p}")
    print(f"\nTotal: {len(api_only)} API routes + {len(others)} miscellaneous = {len(inv)} total")


# ---------------------------------------------------------------------------
# 3. Dependency sanity check (soft install via pip)
# ---------------------------------------------------------------------------

def ensure_packages() -> None:
    missing: list[str] = []
    for spec in REQUIRED_PACKAGES:
        pkg_name = spec.split(">=")[0].split("==")[0].split("<")[0].strip()
        try:
            __import__(pkg_name.replace("-", "_"))
        except Exception:
            missing.append(spec)
    if not missing:
        return
    print(f"\n[WARNING] Missing Python packages: {missing}. Installing...")
    cmd = [sys.executable, "-m", "pip", "install", *missing]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(
            f"\n[ERROR] Could not install dashboard deps. Install manually:\n"
            f"    {sys.executable} -m pip install {' '.join(REQUIRED_PACKAGES)}"
        )
        sys.exit(result.returncode)


# ---------------------------------------------------------------------------
# 4. Check if backend is reachable
# ---------------------------------------------------------------------------

def check_backend_health() -> bool:
    try:
        import json as _json
        import urllib.request as _req
        with _req.urlopen(BACKEND_URL, timeout=2) as r:
            live = _json.loads(r.read().decode("utf-8"))
        print(
            f"\n[OK] Backend is alive: {live.get('in_flight_requests', '?')} requests "
            f"in flight, RSS {live.get('memory_mb', {}).get('rss_mb', '?')} MB "
            f"(server time {live.get('server_time_utc', '--')})."
        )
        return True
    except Exception as exc:
        print(
            f"\n[WARNING] Backend is NOT running at {BACKEND_URL} ({exc}).\n"
            f"    Start the backend before you do experiments, otherwise no logs "
            f"will be produced."
        )
        return False


# ---------------------------------------------------------------------------
# 5. Launch streamlit
# ---------------------------------------------------------------------------

def launch_dashboard(port: int) -> int:
    streamlit_bin = shutil.which("streamlit")
    argv0 = [sys.executable, "-m", "streamlit"] if streamlit_bin is None else [streamlit_bin]
    cmd = [
        *argv0, "run", str(DASHBOARD),
        "--server.port", str(port),
        "--server.headless", "false",
        "--server.runOnSave", "true",
    ]
    print(f"\n[LAUNCH] Launching: {' '.join(cmd)}\n")
    proc = subprocess.run(cmd, check=False)
    return proc.returncode


# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="Launch Xray monitoring dashboard (Streamlit)")
    parser.add_argument("--port", type=int, default=8502, help="Streamlit server port (default: 8502)")
    parser.add_argument("--no-server-check", action="store_true",
                        help="Skip the backend /metrics/live health check")
    parser.add_argument("--list-only", action="store_true",
                        help="Only print the API endpoint inventory and exit")
    args = parser.parse_args()

    print("=" * 68)
    print("Xray — Monitoring Dashboard bootstrap")
    print("=" * 68)
    print(f"Project root : {ROOT}")
    print(f"Log file     : {LOG_FILE}")
    print(f"Dashboard    : {DASHBOARD}")

    ensure_logging_dirs()
    inv = scrape_api_inventory()
    print_inventory(inv)

    if args.list_only:
        return 0

    ensure_packages()

    if not args.no_server_check:
        check_backend_health()

    return launch_dashboard(args.port)


if __name__ == "__main__":
    raise SystemExit(main())
