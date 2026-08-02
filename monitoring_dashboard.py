"""
Xray API Monitoring Dashboard (Streamlit)
=========================================

Live-monitoring UI that tails ``backend/data/monitoring.log`` (newline-delimited
JSON).  The backend server middleware emits **two events per request**:

    * ``type == "request_started"``  — when Express accepts the request
    * ``type == "request_finished"`` — when the last byte is written to the
      client (carries status, duration_*, memory and concurrency snapshots)

Every event carries:

    - timestamp, startedAt, requestId, method, path, route
    - page_hint  (spa page name — uploaded Library/Collage/Upload/...)
    - in_flight  (exact instantaneous concurrency counter from the node server)
    - rss_mb, heap_total_mb, heap_used_mb, external_mb (node process memory)

Finished events additionally carry:
    - status, ok, duration_ms, duration_s, content_length

Run from the project root with::

    python run_monitoring_dashboard.py
    # or:
    streamlit run monitoring_dashboard.py --server.port 8502
"""

from __future__ import annotations

import json
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parent
LOG_PATH = PROJECT_ROOT / "backend" / "data" / "monitoring.log"
LIVE_SCRAPE_URL = "http://localhost:8080/metrics/live"
POLL_SECONDS_DEFAULT = 2
MAX_TAIL_LINES = 200_000  # only keep the most recent N lines in memory

st.set_page_config(
    page_title="Xray API Monitoring Dashboard",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# Tiny inline CSS patch to make the dense metrics fit on one screen.
# ---------------------------------------------------------------------------
st.markdown(
    """
    <style>
    .block-container { padding-top: 1rem; padding-bottom: 3rem; }
    [data-testid="stMetricValue"] { font-size: 1.45rem !important; }
    table { font-size: 0.85rem !important; }
    section[data-testid="stSidebar"] > div { padding-top: 1rem; }
    .stMarkdown p { margin-bottom: 0.25rem; }
    </style>
    """,
    unsafe_allow_html=True,
)


# ===========================================================================
# Log ingestion & parsing helpers
# ===========================================================================

def parse_log_line(line: str) -> dict[str, Any] | None:
    s = line.strip()
    if not s:
        return None
    try:
        obj = json.loads(s)
    except json.JSONDecodeError:
        # Legacy single-event entries (pre two-event upgrade) — still accept
        # them when they look like JSON objects without a type field.
        try:
            obj = json.loads(s)
        except Exception:
            return None
    if not isinstance(obj, dict):
        return None
    obj.setdefault("type", "request_finished")  # backwards compatibility
    return obj


@st.cache_data(show_spinner=False)
def _load_log_lines_from_disk(path_str: str, limit: int, _fake_tok: int) -> list[dict[str, Any]]:
    """
    Cached loader keyed by (path, limit, mtime-ish counter).

    ``_fake_tok`` changes each refresh so Streamlit knows to re-read the disk
    without us having to blow away the entire cache.
    """
    path = Path(path_str)
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            # Efficient tail: seek to end and back-track ~MAX_TAIL_LINES.
            # For typical log sizes (<100MB) we just read and slice the tail.
            lines = fh.readlines()
    except OSError:
        return []
    if limit and len(lines) > limit:
        lines = lines[-limit:]
    parsed: list[dict[str, Any]] = []
    for raw in lines:
        item = parse_log_line(raw)
        if item is not None:
            parsed.append(item)
    return parsed


def load_log_entries(path: Path, limit: int = MAX_TAIL_LINES) -> list[dict[str, Any]]:
    """Public wrapper: uses a cache-busting counter for live polling."""
    tok = st.session_state.get("log_load_token", 0)
    return _load_log_lines_from_disk(str(path), limit, tok)


def bump_log_cache_token() -> None:
    """Must be called *before* loading data if we want a fresh read from disk."""
    st.session_state["log_load_token"] = st.session_state.get("log_load_token", 0) + 1


def _to_dt(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, utc=True, errors="coerce")


def build_dataframes(events: list[dict[str, Any]]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    if not events:
        empty = pd.DataFrame()
        return empty, empty, empty

    df = pd.DataFrame(events)
    if "timestamp" in df.columns:
        df["timestamp"] = _to_dt(df["timestamp"])
    if "startedAt" in df.columns:
        df["startedAt"] = _to_dt(df["startedAt"])
    if "finishedAt" in df.columns:
        df["finishedAt"] = _to_dt(df["finishedAt"])
    for col in ("duration_s", "duration_ms", "status", "in_flight",
                "rss_mb", "heap_total_mb", "heap_used_mb", "external_mb",
                "content_length"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ("type", "method", "path", "route", "page_hint", "ok",
                "requestId"):
        if col in df.columns:
            df[col] = df[col].astype("string")

    started = df[df["type"] == "request_started"].copy() if "type" in df.columns else df.iloc[0:0]
    finished = df[df["type"] == "request_finished"].copy() if "type" in df.columns else df.copy()

    return df, started.reset_index(drop=True), finished.reset_index(drop=True)


def compute_inflight_from_timeline(started: pd.DataFrame, finished: pd.DataFrame) -> pd.DataFrame:
    """
    Rebuilds a per-second concurrency series from raw start/finish events,
    cross-referenced by requestId so aborted/unfinished requests are ignored
    if they lack a matching finish row.

    Returns a DataFrame with columns [timestamp, concurrency].
    """
    if started.empty or finished.empty:
        return pd.DataFrame(columns=["timestamp", "concurrency"])

    pairs = pd.merge(
        started[["requestId", "startedAt"]].rename(columns={"startedAt": "t0"}),
        finished[["requestId", "finishedAt", "duration_ms"]].rename(
            columns={"finishedAt": "t1"}
        ),
        on="requestId",
        how="inner",
    )
    if pairs.empty:
        return pd.DataFrame(columns=["timestamp", "concurrency"])
    pairs = pairs.dropna(subset=["t0", "t1"])
    if pairs.empty:
        return pd.DataFrame(columns=["timestamp", "concurrency"])

    pts: list[tuple[pd.Timestamp, int]] = []
    for _, row in pairs.iterrows():
        pts.append((row["t0"], +1))
        pts.append((row["t1"], -1))
    pts.sort(key=lambda x: x[0])
    current = 0
    timeline: list[tuple[pd.Timestamp, int]] = []
    for ts, delta in pts:
        current += delta
        timeline.append((ts, current))
    return pd.DataFrame(timeline, columns=["timestamp", "concurrency"])


def humanize_seconds(secs: float) -> str:
    if pd.isna(secs):
        return "—"
    if secs < 1:
        return f"{secs * 1000:.1f} ms"
    if secs < 60:
        return f"{secs:.2f} s"
    mins = int(secs // 60)
    s = secs - mins * 60
    return f"{mins}m {s:.1f}s"


def _safe_cast_numeric(v, default=0.0, as_int: bool = False):
    if pd.isna(v):
        return int(default) if as_int else float(default)
    return int(v) if as_int else float(v)


# ===========================================================================
# Sidebar controls
# ===========================================================================

st.sidebar.header("🎛️ Dashboard controls")
lookback_minutes = st.sidebar.slider(
    "Lookback window (minutes)", min_value=1, max_value=60 * 8, value=30, step=1
)
poll_s = st.sidebar.slider(
    "Auto-refresh poll (seconds)", min_value=1, max_value=30, value=POLL_SECONDS_DEFAULT, step=1
)
top_n = st.sidebar.slider("Top N endpoints", min_value=5, max_value=40, value=10, step=1)
slow_threshold_ms = st.sidebar.number_input(
    "Slow request threshold (ms)", min_value=100, max_value=600_000, value=2000, step=100
)
regex_filter = st.sidebar.text_input(
    "Regex endpoint filter (path)", value="", help="Match with Python re.search on the request path"
).strip()
page_filter = st.sidebar.multiselect(
    "Filter by SPA page",
    options=["upload", "library", "collage", "home", "benchmark", "settings", "analysis", "unknown"],
    default=[],
    help="Leave empty to include all pages",
)
method_filter = st.sidebar.multiselect(
    "Filter by HTTP method", options=["GET", "POST", "PUT", "DELETE", "PATCH"], default=[]
)
status_filter = st.sidebar.multiselect(
    "Filter by status class",
    options=["2xx", "3xx", "4xx", "5xx"],
    default=[],
)

st.sidebar.markdown("---")
col_a, col_b = st.sidebar.columns(2)
if col_a.button("🔁 Refresh now", use_container_width=True):
    bump_log_cache_token()
    st.rerun()
auto_refresh = col_b.checkbox("Auto refresh", value=True)

st.sidebar.markdown("### Source")
st.sidebar.code(
    f"Log: {LOG_PATH}\n"
    f"Exists: {LOG_PATH.exists()}\n"
    f"Size: {LOG_PATH.stat().st_size / 1024:.1f} KB" if LOG_PATH.exists() else f"Log: {LOG_PATH} (missing)"
)
st.sidebar.caption(
    "Tip: restart this dashboard via `run_monitoring_dashboard.py` to also "
    "boot the server if it's not already running."
)

# Handle auto-refresh using a simple counter; Streamlit reruns the script on
# every interaction so we use a session-state delta + time.sleep trick via the
# rerun mechanism. No extra deps needed.
if auto_refresh:
    last = st.session_state.get("_last_autorefresh", 0.0)
    if time.time() - last >= poll_s:
        st.session_state["_last_autorefresh"] = time.time()
        bump_log_cache_token()
        st.rerun()

# ===========================================================================
# Header + loading
# ===========================================================================

st.title("📈 Xray API Monitoring Dashboard")
st.caption(
    "Live tail of `monitoring.log` · each request shows up twice: accepted and "
    "finished · memory + concurrency are snapshotted on every event."
)

if not LOG_PATH.exists():
    st.warning(
        f"Log file not found at `{LOG_PATH}`. Start the backend first; the "
        "monitoring middleware will create it automatically on the first API call."
    )
    st.stop()

all_events = load_log_entries(LOG_PATH)
df_all, df_started, df_finished = build_dataframes(all_events)

if df_all.empty:
    st.info("Waiting for monitoring events… trigger any API call from the frontend.")
    st.stop()

# Slice to selected lookback window
window_start = pd.Timestamp.now(tz="UTC") - pd.Timedelta(minutes=lookback_minutes)
if "timestamp" in df_all.columns:
    df_all = df_all[df_all["timestamp"] >= window_start]
    df_started = df_started[df_started["timestamp"] >= window_start] if not df_started.empty else df_started
    df_finished = df_finished[df_finished["timestamp"] >= window_start] if not df_finished.empty else df_finished

# Apply sidebar filters (only on finished df for aggregations)
def apply_filters(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame
    if regex_filter:
        try:
            mask = out["path"].astype("string").str.contains(regex_filter, regex=True, na=False)
            out = out[mask]
        except re.error as exc:
            st.sidebar.error(f"Bad regex: {exc}")
    if page_filter and "page_hint" in out.columns:
        out = out[out["page_hint"].isin(page_filter)]
    if method_filter and "method" in out.columns:
        out = out[out["method"].isin(method_filter)]
    if status_filter and "status" in out.columns:
        s = pd.to_numeric(out["status"], errors="coerce").astype("Int64")
        keep = pd.Series(False, index=out.index)
        for klass in status_filter:
            lo, hi = {"2xx": (200, 300), "3xx": (300, 400),
                      "4xx": (400, 500), "5xx": (500, 600)}[klass]
            keep |= s.between(lo, hi - 1, inclusive="both")
        out = out[keep]
    return out


f_started = apply_filters(df_started) if not df_started.empty else df_started
f_finished = apply_filters(df_finished) if not df_finished.empty else df_finished

# ---------------------------------------------------------------------------
# Live in-flight list (requests that have a request_started event but NO
# matching request_finished event in the current lookback window).
# ---------------------------------------------------------------------------

if not df_started.empty and not df_finished.empty:
    finished_ids = set(df_finished["requestId"].dropna().tolist())
    inflight = df_started[~df_started["requestId"].isin(finished_ids)].copy()
else:
    inflight = df_started.copy() if not df_started.empty else pd.DataFrame()

if not inflight.empty:
    inflight["elapsed_ms"] = (
        pd.Timestamp.now(tz="UTC") - inflight["startedAt"]
    ).dt.total_seconds() * 1000.0
    inflight = inflight.sort_values("startedAt", ascending=False).head(50)

# ===========================================================================
# Row 1 — headline health metrics
# ===========================================================================

fin = f_finished
n_requests = len(fin)
status_series = pd.to_numeric(fin["status"] if "status" in fin.columns else pd.Series(dtype="float64"),
                              errors="coerce")
errors = int(((status_series >= 400).sum()))
successes = int(((status_series < 400).sum()))
error_pct = (errors / n_requests * 100.0) if n_requests else 0.0

dur_s = pd.to_numeric(fin["duration_s"] if "duration_s" in fin.columns else pd.Series(dtype="float64"),
                      errors="coerce")
avg_lat_s = float(dur_s.mean()) if n_requests else 0.0
p50_s = float(dur_s.quantile(0.50)) if n_requests else 0.0
p95_s = float(dur_s.quantile(0.95)) if n_requests else 0.0
p99_s = float(dur_s.quantile(0.99)) if n_requests else 0.0
peak_s = float(dur_s.max()) if n_requests else 0.0
slow_count = int((dur_s >= slow_threshold_ms / 1000.0).sum()) if n_requests else 0

_inflight_s = pd.to_numeric(
    df_all["in_flight"] if "in_flight" in df_all.columns else pd.Series(dtype="float64"),
    errors="coerce"
)
peak_inflight_reported = _safe_cast_numeric(_inflight_s.max(), default=0, as_int=True)

_rss_s = pd.to_numeric(
    df_all["rss_mb"] if "rss_mb" in df_all.columns else pd.Series(dtype="float64"),
    errors="coerce"
)
peak_rss = _safe_cast_numeric(_rss_s.max(), default=0.0)

c1, c2, c3, c4, c5, c6 = st.columns(6)
c1.metric("Requests (window)", f"{n_requests:,}")
c2.metric("Errors", f"{errors}", delta=f"{error_pct:.1f}%",
          delta_color="inverse" if error_pct else "off")
c3.metric("P50 / P95", f"{humanize_seconds(p50_s)} / {humanize_seconds(p95_s)}")
c4.metric("Peak latency", humanize_seconds(peak_s))
c5.metric("Peak in-flight", str(peak_inflight_reported))
c6.metric("Peak RSS memory", f"{peak_rss:.0f} MB")

h1, h2, h3, h4 = st.columns(4)
h1.metric("Successes", f"{successes:,}")
h2.metric("Slow (>={slow_threshold_ms} ms)".format(slow_threshold_ms=slow_threshold_ms),
          f"{slow_count:,}")
h3.metric("Unique endpoints",
          int(fin["path"].nunique()) if n_requests and "path" in fin.columns else 0)
last_ts = fin["timestamp"].max() if n_requests and "timestamp" in fin.columns else None
h4.metric("Last finished",
          last_ts.strftime("%H:%M:%S %Z") if last_ts is not None and not pd.isna(last_ts) else "—")

st.markdown("---")

# ===========================================================================
# Row 2 — In-flight live panel
# ===========================================================================

inflight_col, live_col = st.columns([2.1, 1])
with inflight_col:
    st.subheader("🕒 Currently in-flight (recent first)")
    if inflight.empty:
        st.success("No requests currently in flight.")
    else:
        view = inflight[[
            "startedAt", "elapsed_ms", "method", "path", "page_hint",
            "in_flight", "rss_mb", "requestId",
        ]].copy()
        view["elapsed_ms"] = view["elapsed_ms"].round(0).astype("Int64")
        view.columns = ["started", "elapsed_ms", "method", "path", "page",
                        "in_flight_snap", "rss_mb", "request_id"]
        st.dataframe(view, use_container_width=True, hide_index=True, height=290)

with live_col:
    st.subheader("🟢 Instantaneous snapshot")
    try:
        import urllib.request
        with urllib.request.urlopen(LIVE_SCRAPE_URL, timeout=2) as resp:
            live = json.loads(resp.read().decode("utf-8"))
        st.metric("In-flight RIGHT NOW", str(live.get("in_flight_requests", "—")))
        mem = live.get("memory_mb") or {}
        st.metric("Current RSS", f"{float(mem.get('rss_mb', 0)):.0f} MB")
        st.caption(f"Server time: {live.get('server_time_utc', '—')}")
    except Exception as exc:
        st.info(f"Could not reach {LIVE_SCRAPE_URL} — backend not running?\n\n{exc}")

st.markdown("---")

# ===========================================================================
# Row 3 — main 2-column plot area
# ===========================================================================

left, right = st.columns([1.3, 1])

with left:
    st.subheader("📊 Requests per 10 seconds (finished)")
    if not fin.empty and "timestamp" in fin.columns:
        per10s = fin.set_index("timestamp").resample("10s").size().reset_index()
        per10s.columns = ["timestamp", "requests"]
        st.line_chart(per10s, x="timestamp", y="requests", height=300)
    else:
        st.info("No finished requests in this window yet.")

with right:
    st.subheader("🧮 Concurrency (exact timeline from requestId pairs)")
    conc = compute_inflight_from_timeline(f_started, f_finished)
    if not conc.empty:
        st.line_chart(conc, x="timestamp", y="concurrency", height=300,
                      color="#ff4b4b")
    elif not df_all.empty and "in_flight" in df_all.columns:
        # Fall back to the raw per-event in_flight snapshots if we can't pair.
        fallback = df_all[["timestamp", "in_flight"]].dropna().sort_values("timestamp")
        if not fallback.empty:
            st.line_chart(fallback, x="timestamp", y="in_flight", height=300,
                          color="#ff4b4b")
            st.caption("(Falling back to raw in_flight snapshots; paired timeline unavailable)")
        else:
            st.info("Not enough data for concurrency chart yet.")
    else:
        st.info("Not enough data for concurrency chart yet.")

st.markdown("---")

mem_left, mem_right = st.columns([1.2, 1])

with mem_left:
    st.subheader("💾 Node.js memory over time (RSS MB)")
    mem_df = df_all[["timestamp", "rss_mb", "heap_used_mb"]].dropna(subset=["rss_mb"])
    if not mem_df.empty:
        mem_df = mem_df.sort_values("timestamp")
        st.line_chart(mem_df, x="timestamp", y=["rss_mb", "heap_used_mb"], height=300)
    else:
        st.info("No memory snapshots in the current window.")

with mem_right:
    st.subheader("🗂️ Requests by SPA page")
    if not fin.empty and "page_hint" in fin.columns:
        by_page = (
            fin["page_hint"]
            .fillna("unknown")
            .value_counts()
            .head(15)
            .reset_index()
        )
        by_page.columns = ["page", "requests"]
        st.bar_chart(by_page, x="page", y="requests", horizontal=True, height=300)
    else:
        st.info("No per-page attribution yet.")

st.markdown("---")

# ===========================================================================
# Row 4 — endpoint summaries
# ===========================================================================

col_lat, col_status = st.columns([1.5, 1])

with col_lat:
    st.subheader("🏁 Endpoint latency summary")
    if not fin.empty and {"path", "duration_ms"}.issubset(fin.columns):
        summary = fin.groupby("path").agg(
            calls=("duration_ms", "size"),
            errors=("status", lambda s: int((pd.to_numeric(s, errors="coerce") >= 400).sum())),
            p50_ms=("duration_ms", lambda s: _safe_cast_numeric(pd.to_numeric(s, errors="coerce").quantile(0.50))),
            p95_ms=("duration_ms", lambda s: _safe_cast_numeric(pd.to_numeric(s, errors="coerce").quantile(0.95))),
            p99_ms=("duration_ms", lambda s: _safe_cast_numeric(pd.to_numeric(s, errors="coerce").quantile(0.99))),
            max_ms=("duration_ms", lambda s: _safe_cast_numeric(pd.to_numeric(s, errors="coerce").max())),
            avg_ms=("duration_ms", lambda s: _safe_cast_numeric(pd.to_numeric(s, errors="coerce").mean())),
        ).sort_values("calls", ascending=False).head(top_n).round(1)
        st.dataframe(summary, use_container_width=True, height=420)
    else:
        st.info("Not enough finished request data.")

with col_status:
    st.subheader("⚠️ Status distribution")
    if not fin.empty and "status" in fin.columns:
        s = pd.to_numeric(fin["status"], errors="coerce").dropna().astype(int)
        if len(s) > 0:
            def bucket(code: int) -> str:
                if 200 <= code < 300: return "2xx OK"
                if 300 <= code < 400: return "3xx Redirect"
                if 400 <= code < 500: return "4xx Client Err"
                if 500 <= code < 600: return "5xx Server Err"
                return "Other"
            dist = s.map(bucket).value_counts().reset_index()
            dist.columns = ["status", "count"]
            st.bar_chart(dist, x="status", y="count", height=260)

    st.subheader("🥇 Top slowest individual requests")
    if not fin.empty and {"path", "duration_ms"}.issubset(fin.columns):
        slowest = (
            fin[["timestamp", "method", "path", "page_hint", "status", "duration_ms", "requestId"]]
            .sort_values("duration_ms", ascending=False)
            .head(15)
            .copy()
        )
        slowest["duration_ms"] = slowest["duration_ms"].round(1)
        slowest.columns = ["ts", "method", "path", "page", "status", "dur_ms", "req_id"]
        st.dataframe(slowest, use_container_width=True, height=420, hide_index=True)

st.markdown("---")

# ===========================================================================
# Row 5 — recent finished events live tail
# ===========================================================================

st.subheader("📜 Recent finished requests (most recent first)")
if not fin.empty:
    tail_n = st.slider("Recent rows shown", min_value=20, max_value=500, value=100, step=20)
    tail = fin.sort_values("timestamp", ascending=False).head(tail_n)
    tail_view = tail[[
        "timestamp", "method", "path", "route", "status", "duration_ms",
        "page_hint", "in_flight", "rss_mb", "requestId",
    ]].copy()
    tail_view["duration_ms"] = tail_view["duration_ms"].round(1)
    tail_view.columns = ["ts", "method", "path", "route", "status",
                         "dur_ms", "page", "in_flight", "rss_mb", "req_id"]
    st.dataframe(tail_view, use_container_width=True, height=480, hide_index=True)
else:
    st.info("No finished requests yet.")

st.caption(
    f"Loaded {len(all_events):,} events · "
    f"{len(df_started):,} started · {len(df_finished):,} finished · "
    f"Window last {lookback_minutes} min · "
    f"Last reload: {datetime.now(timezone.utc).strftime('%H:%M:%S %Z')}"
)
