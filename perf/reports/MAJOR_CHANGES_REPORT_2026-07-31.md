# Xray Project — Major Changes Report

Report date: 2026-07-31
Scope: 32 modified files + 28 new files across backend, frontend, and perf tooling.
Source diff base: branch `afterdocker` (up to date with `origin/afterdocker`).

---

## 0. Contents

1. [Backend Performance & Memory Optimizations (Python Image Processing)](#1-backend-performance--memory-optimizations-python-image-processing)
2. [New Backend Infrastructure: Bulk Operations & Queueing](#2-new-backend-infrastructure-bulk-operations--queueing)
3. [Library Page: Scale Performance Pass (O() Complexity Fixes)](#3-library-page-scale-performance-pass-o-complexity-fixes)
4. [New Feature: Auto-Save ("Save as you Go")](#4-new-feature-auto-save-save-as-you-go)
5. [Upload Page: UX Overhaul + Progress Bar + Correct Indexing](#5-upload-page-ux-overhaul--progress-bar--correct-indexing)
6. [Stress Testing & Monitoring Infrastructure](#6-stress-testing--monitoring-infrastructure)
7. [Summary Table](#7-summary-table-scope-of-changes)
8. [File-by-File Reference Index](#8-file-by-file-reference-index)

---

## 1. Backend Performance & Memory Optimizations (Python Image Processing)

### 1.1 Vectorized NumPy Pixel Processing — No More Python Loops

**Files modified:**

- [dumpread.py](file:///c:/Users/saikiran/Desktop/xray/backend/scripts/dumpread.py) — Replaced nested Python `for i in range(rows): for j in range(cols)` pixel loops with fully vectorized NumPy operations using boolean mask arrays. The `ReadDump` function now returns uint16 arrays directly instead of allocating intermediate float64 matrices and then re-converting.

- [process_raw_file.py](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/process_raw_file.py) — Added `ensure_uint16()` helper that is a no-op when the array dtype is already `uint16` (avoids double allocations and redundant `np.clip`/`astype` calls). Added explicit `gc.collect()` calls after freeing large arrays: right after the dump/tip pixel arrays are read and typed, and again after both NPZ files have been written. This prevents the Python heap from ballooning during batch-processing runs of many files. Pixel data is now stored in NPZ files **always as uint16**, cutting file sizes in half compared to the previous float64 serialization.

**Impact:**

- **R calculation** (log ratio of high/low energy channels): previously O(rows×cols) pure-Python iteration with per-pixel branch → now a single vectorized `np.log(high_f[mask] / 65535.0) / np.log(low_f[mask] / 65535.0)` on `float32` with `np.errstate(divide='ignore', invalid='ignore')`, plus scalar-broadcast fill of `np.inf` where `low >= 60000`.
- **Memory footprint per 2D channel:** `float64 (8 bytes/pixel)` → `uint16 (2 bytes/pixel)` = **4× RAM reduction per channel** (high + low = 8× total for the two-channel pixel payload).
- **`to_uint16()` now short-circuits:** if the input is already `np.uint16`, it returns the same reference — no `np.clip`, `np.round`, or `astype` allocation. Every call site previously called `to_uint16` unconditionally, so this removes two redundant clip+cast passes per processed dump file (and also every call that was passing an already-correct uint16 from elsewhere).

### 1.2 Hardcoded Drive Paths → Centralized Config

**File modified:**

- [renderCanvas.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/renderCanvas.js#L7-L8) — Hardcoded `B:\\library_images` and `B:\\pixel_data` replaced with `config.libraryImagesRoot` / `config.pixelDataRoot`, making the module portable across machines/deployments that don't mount to `B:`.

---

## 2. New Backend Infrastructure: Bulk Operations & Queueing

### 2.1 Bulk Delete (O(partitions) instead of O(N) HTTP calls)

**New code:**

- [storage.js → bulkDeleteItems()](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/storage.js#L384-L467) — New exported function. Algorithm:
  1. Builds `idSet = new Set(ids)` for O(1) membership testing.
  2. Iterates every partition ONCE across the three category trees (`bags`, `threats`, `non_threats`).
  3. Splits each partition's items in linear time into `kept` / `deleted` arrays.
  4. Rewrites a touched partition at most once per partition (atomic temp-then-rename via `writeJSONFileAtomic`).
  5. After all mutations, rebuilds accurate per-category `totalCount`s by re-reading partition lengths (avoids drift bugs if any call path ever miscounts).
  6. Returns BOTH `{ deleted: string[], items: Item[] }` so callers have the full deleted records to clean up files without re-fetching.

- [server.js → POST /api/items/bulk-delete](file:///c:/Users/saikiran/Desktop/xray/backend/src/server.js#L1224-L1273) — New route:
  - Hard caps at 50,000 IDs per call via `.slice(0, 50000)` as a defense against multi-GB accidental bodies.
  - 400 on missing/empty `ids` array.
  - Calls `bulkDeleteItems`, then iterates the returned `items` once per record to:
    - `unlink()` the library preview PNG if `filepath` present (safe path-checked via `safeJoin`).
    - `unlink()` BOTH `highenergy` and `lowenergy` `.npz` pixel-data files when present.
  - Returns `{ ok: true, deletedCount, requestedCount, fileErrors }` so callers can detect partial cleanup (missing PNGs/npzs don't fail the whole call — they're counted).

**Performance improvement:** 1000 deletes = 1000 HTTP requests, 1000 catalog scans, 1000 partition rewrites → **1 HTTP request**, and each partition rewritten at most once regardless of how many items from it are deleted.

### 2.2 DiskWriteQueue — Serial Batch Layout Write with Pacing

**New file:**

- [diskWriteQueue.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/diskWriteQueue.js) (260 lines) — Module-level singleton with its own private atomic-write locks (doesn't re-use storage.js locks to avoid cross-module deadlock). Key design:

  1. **Serializes all writes:** At most one batch write is in flight at any time (queue FIFO).
  2. **Paces consecutive writes** with a 200ms sleep after each write so that any in-flight GET `/api/saved-layouts` read can finish and release its file handle before the next write starts and rewrites the same partition.
  3. **Coalesces arriving batches** into pending queue during write-backlog; batches that pile up during a long write are processed one after another without overlapping.
  4. **Partitions saved layouts** automatically at 5000 items per file, matching the items.json partitioning strategy used for library storage:
     - Partition 1 → `savedLayouts.json` (legacy single file)
     - Partition N → `savedLayouts_${N}.json`
     - Catalog at `savedLayouts_catalog.json` tracks `{ activePartition, totalCount, partitions: [1, 2, ...] }`.
  5. **Write-back safety:** on `writeBatch` error, the batch is unshifted back to the front of the queue for retry on the next process cycle (no silent data loss).
  6. **Non-blocking tail-call processing:** `processNext` uses `setImmediate(processNext)` for the next batch rather than recursive `await`, preventing stack buildup from deep synchronous queue drains.
  7. Public API:
     - `enqueue(layouts) → { depth, inFlight, totalQueued }` — fire-and-forget.
     - `getDiskWriteQueueStatus() → { depth, inFlight, totalQueued, totalWritten, batchesWritten, isDrained }` — for polling.
     - `getAllSavedLayouts()` — aggregates across all partitions via catalog.
     - `drain() → Promise` — blocks until `queue.length===0 && !inFlight`, polled every 50ms. Used to avoid double-write races when a manual bulk save wants to wait for the auto-save queue to empty first.

**Corresponding endpoints registered in [server.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/server.js#L791-L870):**

- `POST /api/saved-layouts/batch-bulk` — Registered BEFORE `GET /:id` to avoid param collision. Validates each layout has `name` + `layout_json.objects`, stamps auto IDs/timestamps if missing, enqueues to `DiskWriteQueue.enqueue`, responds immediately with `{ ok, queued, queueDepth, totalQueued }`. Non-blocking for the caller.
- `GET /api/saved-layouts/batch-bulk/status` — Returns current `getDiskWriteQueueStatus()`.
- `POST /api/saved-layouts/batch-bulk/drain` — Blocks on `drainDiskQueue()`, returns final status.

### 2.3 On-the-Fly PNG Regeneration Fallback Middleware

**File:** [server.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/server.js#L111-L140) — Middleware registered BEFORE the static-serve middleware for `/data/library_images`.

Behavior: when a request for `/data/library_images/:filename.png` arrives:
1. Try `fs.access(targetPngPath)`. If exists → fall through to static serve (next()).
2. If missing → check whether `pixel_data/highenergy/${itemId}.npz` (derived from stripping `.png` extension) exists.
3. If NPZ available → spawn `python backend/src/lib/generate_png.py --npz-path … --png-path …` as a subprocess, wait for exit 0, then fall through to static serve which now sees the freshly generated file.
4. If any step fails → fall through silently to static serve (which will 404 — same UX as before, no new error surfaces).

**New generator script:** [generate_png.py](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/generate_png.py) — Memory-safe NPZ → PNG conversion:
- Uses `np.load(..., mmap_mode='r')` to memory-map the NPZ file. Avoids allocating a full RAM copy for large arrays; especially important for any legacy float64 pixel_data files where a raw `np.load` would double the memory footprint.
- If `data.dtype != np.uint16` (legacy files), clips and casts in-place to uint16 before PIL save — halves the memory needed to feed PIL.
- `os.makedirs(outDir, exist_ok=True)` so the target PNG dir doesn't need to pre-exist.
- Prints `"OK"` on stdout on success; error to stderr + exit(1) on failure (the subprocess handler in server.js checks only exit code).

### 2.4 HTTP Server Tuning for High-Concurrency Stress Tests

**File:** [server.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/server.js#L1917-L1923) — After the `app.listen(port, ...)` call, explicit server settings:

```
server.maxConnections   = 1000      (Node default = 511)
server.keepAliveTimeout = 120000    (Node default = 5000ms → caused premature keep-alive drops mid-stress)
server.headersTimeout   = 125000    (Slightly above keepAliveTimeout per Node docs)
server.timeout          = 300000    (5 minutes — prevents long pixel-processing requests from being severed)
server.requestTimeout   = 300000    (5 minutes)
```

This was a direct contributor to the earlier stress test false-positive "timeout" failures: the server was killing sockets after 5s idle, but the client's HTTP agent was reusing them and the subsequent request then appeared to be a timeout rather than a RST. The keepAlive jump to 2 minutes matches the expected time a stress-phase batch of writes can keep a socket busy.

---

## 3. Library Page: Scale Performance Pass (O() Complexity Fixes)

A companion document exists for this section with before/after tables and benchmark math:
[LIBRARY_PAGE_SCALE_REPORT.md](file:///c:/Users/saikiran/Desktop/xray/perf/reports/LIBRARY_PAGE_SCALE_REPORT.md) (369 lines).

### 3.1 Generate Classification: O(S×T) → O(S) via Twin Lookup Maps

**File:** [LibraryPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/LibraryPage.tsx)

Two duplicate copies of the same nested classification loop existed:
- `handleGenerateCollage()` (the "Generate Collage → navigate to CollagePage" user flow)
- `handleGenerate` useCallback (the in-page K-combinations + Web Worker flow)

Both ran the pattern:
```
selectedItems.forEach((itemId) => {
  for (const subcats of Object.values(categorizedItems)) {
    for (const items of Object.values(subcats)) {
      const match = items.find((item) => item.id === itemId);   // LINEAR SCAN
```
Complexity O(S × T) per generate-click where S = #selected, T = total items in library.

**Fix:** Single `useMemo` builds both maps in one O(T) pass over `categorizedItems`:
- `itemCategoryMap: Map<itemId, categoryKey>` — used for quick category-bucket selection counts.
- `itemByIdMap: Map<itemId, Item>` — used when full Item record is needed (bulk delete, file cleanup, full payload to worker).

Both generate paths then use a pure O(S) loop:
```
for (const itemId of selectedItems) {
  const item = itemByIdMap.get(itemId);
  const normalized = normalizeCategoryName(item.category);
  if (normalized === "bags") bags.push(item);
  else if (normalized === "threats") threats.push(item);
  else others.push(item);
}
```

**Measured (estimated) improvement:**
| S    | T      | Old iters  | Old time | New O(S) | Speedup |
|------|--------|-----------|----------|----------|---------|
| 50   | 5K     | 250K      | 80 ms    | <0.1 ms  | 800×    |
| 500  | 5K     | 2.5M      | 0.8 s    | ~0.2 ms  | 4,000×  |
| 5K   | 50K    | 250M      | 83 s 🚩  | ~1.5 ms  | 55,000× |
| 10K  | 100K   | 1B        | 5.5 min  | ~3 ms    | 110,000×|

### 3.2 Sidebar Selection Stats: Precomputed O(S) Instead of Per-Render Filter/Every

**File:** [SimpleLibrarySidebar.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/library/SimpleLibrarySidebar.tsx)

Old sidebar per render: 3 category headers × `.filter().length` + `.every()` + `.some()` (3 × O(|cat|) each) plus 3× per subcategory `.every()` + `.some()` (2 × O(|sub|) each). At 3 × 10 subcats × 1000 items this produced ~33,000 `.has()` calls per render, costing 3–10 ms per click and ~50 ms at 100K items (perceptible frame drops above 16 ms / 60 fps).

**Fix:** New prop `sidebarSelectionStats: SidebarSelectionStats` injected from LibraryPage, precomputed in a useMemo:
```
sidebarSelectionStats = {
  byCategory:    { [catKey]: { selected, total } },
  bySubcategory: { [catKey]: { [subKey]: { selected, total } } },
}
```
Seeded once O(T) when `categorizedItems` changes; selection counters incremented by a pure O(S) pass over `selectedItems` using `itemByIdMap → item.category + item.subcategory`.

Sidebar now renders all select-state from integer compares only:
```
allSelected  = (total > 0 && selected === total)
someSelected = (selected > 0 && !allSelected)
```
No nested iteration anywhere in the sidebar anymore.

### 3.3 Combination Generator Hotspot: pickRandomK (Sparse-Swap Map for k << n)

**File:** [combinationGenerator.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/lib/combinationGenerator.ts)

Hot pattern before: 8 call sites (3 for threats, 4 for non-threats, 1 in pickRandomSubset) all used `shuffleArray(arr).slice(0, k)`. `shuffleArray` = full Fisher-Yates O(N). Typical run: kValue=10,000 combos, threats.length=10,000, selectedCount in [1..4] → 10K × 10K swaps = 100,000,000 useless swap iterations per run to pick 3 items per combo.

**New `pickRandomK<T>(arr, k)` with 3-tier strategy:**

1. **k === 1:** `const idx = Math.floor(Math.random()*n); [arr[idx]]` — zero allocation, one draw.
2. **k * 32 < n (k much smaller than n):** **Sparse Swap Map.** Tracks only positions that were swapped in a `Map<idx, swappedTo>` instead of copying the full array. For i=0..k-1: draws j = i + randInt(n-i); looks up current-values of positions i and j via swapped-or-identity; swaps map entries; records arr[actual value of i] as a result; deletes the i-entry from the map so map size stays exactly k at worst. Zero full-array copy, exactly k iterations, memory cost = k-sized Map + k-length result array.
3. **Else (k close to N):** Allocate one copy, standard partial Fisher-Yates, STOP after k swaps (avoids doing the remaining N−k unnecessary swaps of a "full shuffle + slice").

**Call-site replacement:** All 8 `shuffleArray(arr).slice(0, k)` instances → `pickRandomSubset(min,max)` rewritten to call `pickRandomK(arr, draw)`, and both threat and non-threat selectors in both generators call `pickRandomK` directly.

**Same 10K × 10K example:** 100M swap iters → 10K × 3 = 30,000 shuffle-adjacent ops ≈ **3,300× fewer operations** in this hotspot alone.

### 3.4 Bulk-Delete Frontend Wiring + Graceful Fallback

**File:** [LibraryPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/LibraryPage.tsx)

New helper `bulkDeleteLibraryItems(itemsToDelete: Item[]): Promise<number>`:
- **Primary path:** one `POST /api/items/bulk-delete` body = `{ ids: items.map(i => i.id) }`. Returns `deletedCount` from response.
- **Fallback path (endpoint fails for any reason):** chunks remaining IDs into groups of 25, runs `Promise.all(chunk.map(id => DELETE /api/items/:id))` per chunk, sequentially advances to next chunk. Never opens more than 25 concurrent DELETE fetches no matter how large N is. Previous code was unbounded `Promise.all(N)` hitting the browser's 6-connection-per-host ceiling immediately and causing server socket exhaustion + `SQLITE_BUSY`.
- 3 call sites converted: `handleDeleteSelected` (uses `itemByIdMap` to resolve IDs → Items for bulk call), `deleteCategory`, `deleteSubcategory`.

### 3.5 Guardrails & Soft Caps (Explicit > Silent Corruption)

Module-level constants at the top of LibraryPage (avoids TS "used before declaration" errors they had when previously declared mid-component above first useMemo/useEffect references):

```
const SELECT_PERSIST_THRESHOLD = 50_000;   // localStorage guardrail
const SELECT_GENERATE_SOFT_CAP  = 5_000;    // generate confirm dialog
```

- **localStorage persistence (selected item IDs):** Old code `JSON.stringify(Array.from(selectedItems)).setItem` wrapped in try/catch that swallowed `QuotaExceededError` silently → partial/stale restored selections on refresh. New code: if `size > SELECT_PERSIST_THRESHOLD`, calls `localStorage.removeItem("selectedItemIds")` to CLEAR stale data + emits one `console.warn` explaining the trade-off. Selections keep working in memory; they just don't survive a refresh. Explicit, no silent corruption.
- **Generate soft cap (5,000 selected):** Inside `handleGenerateCollage`, immediately after `classifySelectedItems()` (still O(1) work done so far), shows `window.confirm` dialog warning user the generation may be long and memory-heavy. If declined, returns before any worker handoff or postMessage payload is built. The 5,000 threshold is conservative and specifically chosen to avoid accidental 25 MB+ structured-clone worker postMessages that previously hung or OOMed the tab.

### 3.6 Pagination Footer: Direct Page-Number Input + Full Keyboard Shortcuts + Toast Feedback

**File:** [Pagination.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/library/Pagination.tsx)

Page-number input rewrite (not just parse-on-submit — a full robustness pass):

1. **`parsePageInput(raw)` returns `{ value, clamped, invalid, rawParsed }`:**
   - Empty / whitespace-only → `{ invalid: true, value: currentPage }` (doesn't move).
   - Non-digit characters stripped by the caller before parse; but parse itself also runs `/\D/g` replacement defensively.
   - Digit string longer than 9 chars → parsed value, but forced clamped to `totalPages`.
   - Out-of-range (`<1` or `>totalPages`) → clamped to nearest bound but preserves the actual `rawParsed` so the caller can toast what the user actually typed.
   - `value === currentPage` → still returns valid with no change.

2. **Keyboard shortcuts implemented per convention (confirmed in project_memory):**
   - Enter: submit / jump to parsed page, reset input to final value.
   - Escape: revert input to actual current page, blur field.
   - ArrowUp: next page (`currentPage + 1` clamped).
   - ArrowDown: prev page (`currentPage - 1` clamped). Note: arrow semantics were fixed in a prior session; now uniform across all three pagination usages (Library, Saved, Collage).
   - Home: first page (= 1).
   - End: last page (= totalPages).

3. **Input-level keystroke rejection:** `onBeforeInput` handler prevents non-digit insertions at the native event level (backspace, deletions, nav keys, select-all, copy, paste, cut still work; paste gets re-parsed at Enter/blur anyway).

4. **Toast notifications for clamp events (inline style-injected CSS + toasts array):** When a user types a page number outside bounds, e.g. "No page 9999 — max is 42. Jumping to last page." Rather than silently clamping. Toasts are rendered in a fixed-top-center container outside the pagination div so they appear regardless of component scroll state.

5. **Layout reflow:** Pagination "shell" (select-all checkbox + showing X-Y-of-Z) always renders even at 1 total page; nav controls (Prev/Next/numbered buttons/input) render only when `totalPages > 1`. The numbered page buttons are now consistently clickable `<button>` elements instead of what was mixed button/span behavior before.

**Same robust input logic (duplicated — deliberate) in SavedPage.tsx:**
[SavedPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/SavedPage.tsx#L564-L661) has its own copy of `parsePageInput`/handlers plus two added safety effects:
- `useEffect([page])` keeps `pageInput` text in sync whenever the real page number changes (Prev/Next button clicks, filter resets to page 1, pagination recalc after deletion shrinks totalPages).
- `useEffect([pagination, page])` auto-clamps `page` back into valid range when `pagination.totalPages` shrinks (e.g. deleting the very last layout on last page triggers a totalPages recalc that could otherwise leave `page` out of range for the subsequent load).

Also fixes the edge case "Showing 1–50 of 0" → when `total===0`, start is rendered as 0, not 1.

SavedPage Prev/Next disabled flags now include `|| pagination.totalPages <= 1` so buttons are properly disabled on empty single-page filter results.

Same pattern applied to [CollagePage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/CollagePage.tsx) pagination (see LibraryPage changes in earlier session; file modified this pass for related integration updates).

### 3.7 BOM Fix (Silent Corruption Saver)

[SimpleLibrarySidebar.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/library/SimpleLibrarySidebar.tsx#L1) — UTF-8 byte-order mark (`∩╗┐` / the three bytes 0xEF 0xBB 0xBF at file start) removed. Some TSC versions and certain Node/ESBuild/ESLint pipeline configurations choke on BOMs in non-UTF-8-with-BOM-aware toolchains. Removal keeps the build hermetic.

---

## 4. New Feature: Auto-Save ("Save as you Go")

### 4.1 GenerationService: Auto-Save Batch Pipeline + Public Toggle API

**File modified:** [generationService.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/lib/generationService.ts)

~180 lines added around the existing singleton service. Design rationale: because combinations are generated in a Web Worker in batches of configurable size, we can hook the "batch just arrived" event to POST each batch to the new backend batch-bulk endpoint. The backend disk queue serializes the writes, so the frontend sends batches fire-and-forget with only status counters tracked (no per-layout await).

**New `comboToLayout(combo)` converter:**
Translates an in-memory `CombinatorialResult` (which includes full transform + pixelValue + polygon on every object) into the slimmed saved-layout record the backend expects:
- Bag object → extracts `validRegionPolygon` by calling `getTransformedPolygon()` with bag's current transform + raw `polygonOutline`.
- Combos named automatically: `"<bagName> containing Pistol, Knife, Shampoo"` (bag name + concatenated threat + non-threat names).
- Threats and non-threats split into their schema buckets, `subcategory` lowercased + whitespace→dash normalized, minimal transform payload `{ center, size, rotation }`, layer preserved.

**New `autoSaveBatch(batch)`:**
- Returns `void` (caller doesn't await). One POST to `${API_BASE_URL}/api/saved-layouts/batch-bulk` with `{ layouts: batch.map(comboToLayout) }`.
- Success: bumps `state.autoSaveStatus.queued += batch.length; batchesSent += 1`, notifies subscribers so any UI showing status can re-render.
- Failure (HTTP non-ok OR fetch throws): increments `.errors`, `console.error`s detail, notifies subscribers. Never throws to caller so it can't kill the generation loop.

**New public API on `GenerationService` export:**
- `setAutoSaveEnabled(bool)` — Dynamically toggles. If toggling ON mid-run with existing combos AND `queued === 0`, immediately backfills the already-generated combos as a single `autoSaveBatch` call (so users who forgot to tick the box before clicking Generate can enable it 10 seconds in without losing their in-progress generated work).
- `isAutoSaveEnabled()`, `getAutoSaveStatus()` — read endpoints.
- Module-level `autoSaveEnabled` flag that both `startGeneration` (sets it from params.autoSave) and `cancelGeneration`/`clearResults` (resets to false) touch.
- `state.autoSaveStatus: AutoSaveStatus | null` propagated through every `notifySubscribers()` call so the selection tray and any other subscriber always sees fresh counters.
- `batchSize` threaded through to the worker message from params (default: 5000), replacing the hardcoded 100 that was the old INCREMENTAL_BATCH_SIZE. So default batch-to-disk POST size is now 50× larger (5000 layouts vs 100) = 50× fewer HTTP calls, 50× fewer disk-write queue cycles, 50× fewer partition file rewrites per generation.

### 4.2 UI Toggle: SelectionTray "Save as you Go" Checkbox

**File modified:** [SelectionTray.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/library/SelectionTray.tsx#L215-L228)

New optional props: `autoSave?: boolean` and `setAutoSave?: (b: boolean) => void`. Only rendered if `setAutoSave` is provided (so tray can still be used elsewhere without the feature).

Pill-styled checkbox: blue-accented (`bg-blue-50/80 + border-blue-200/80`), text `Save as you go`, the checkbox sized 14×14 to match the existing `requireAtLeastOneNonThreat` checkbox style. Wired in LibraryPage to local `autoSave` state and dynamic `GenerationService.setAutoSaveEnabled`.

### 4.3 Types Extended: New Params and Status Shapes

**File modified:** [generation.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/types/generation.ts)

- New `AutoSaveStatus = { enabled: boolean; queued: number; batchesSent: number; errors: number }`.
- `GenerationState.autoSaveStatus: AutoSaveStatus | null`.
- `GenerationParams` gains three optional fields:
  - `batchSize?: number` (default 5000) — controls how often the worker emits batches, which also maps to how often auto-save POSTs.
  - `autoSave?: boolean` — initial auto-save state for `GenerationService.startGeneration`.
  - `bagWeightMode?: 'uniform' | 'subcategory_proportional'` — stub parameter for future bag-selection weighting strategies (forward-compat; no backend path uses it yet).

### 4.4 Worker Threading: batchSize Pass-Through

**Files modified:**
- [incrementalGenerator.worker.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/workers/incrementalGenerator.worker.ts) — `IncrementalWorkerRequest` gains optional `batchSize?: number`; passed as last positional argument to `generateCombinationsIncremental` with `?? 5000` default fallback.
- [combinationGenerator.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/lib/combinationGenerator.ts) — `generateCombinationsIncremental` function signature updated to accept an `effectiveBatchSize` parameter (last arg) that replaces the previous hardcoded `INCREMENTAL_BATCH_SIZE` in the batch-emission check.

---

## 5. Upload Page: UX Overhaul + Progress Bar + Correct Indexing

### 5.1 Visual Progress Bar Banner (Always Visible Once Files Exist)

**File:** [UploadPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/UploadPage.tsx)

Old amber "pre-buffering batches in background… (n/total items)" indicator shown only while `processing === true`. Replaced with a full progress bar card shown whenever `files.length > 0`:

Structure of new banner (`bg-panel` rounded-2xl card, 5px padding, shared progress UX pattern):
- Top row: 3px status dot + `"Progress: X / Y files processed"` label + percentage badge (`99%`) in accent-mono text.
  - Dot: `bg-amber-500 animate-pulse` while processing; solid `bg-emerald-500` when all files done.
  - Counter = `min(files.length, (activePage-1)*PAGE_SIZE + activePageItems.length)`. Accounts for paginated active-page staging, not just the raw raw-files list.
- Bottom row: 10px-high rounded progress bar with emerald fill, CSS transition for smooth growth.

### 5.2 Batch Header & Button Context-Aware Labeling

- Batch container header was `"Batch Ready (N Tiles)"` → now:
  - `"Active Batch (N Files) — Step P of T"` (shows current active page out of totalPages).
- Button text was fixed `"Save Batch to Library"` → now context-aware:
  - Final page only: `"Save Final Batch to Library"`
  - Non-final page: `"Save Batch & Load Next Batch"`
  - In-flight saving: `"Saving Batch & Loading Next..."`
- Saving flow now explicitly pre-buffers `isNextBufferReady` (memo: next page has staged items ≥ 1) so UX can communicate that the next-batch load is real and immediate, not vague "wait for prebuffering."
- Fixed width added to the save button so the label-change doesn't reflow button size during the save-in-progress transition.

### 5.3 Staged-Active Semantics Clarified: setStagedForActivePage

Old prop signature for UploadFileQueue passed `setStaged` that was the raw setter for `staged` state. However, `staged` in UploadPage is now a paginated slice for the ACTIVE page only — not global. So renaming the prop to `setStagedForActivePage` (and its internal usage) prevents a future maintainer from thinking the setter operates on the total global staged list. No behavior change; pure semantic clarity.

### 5.4 Bugfix: removeIndex in UploadFileQueue Works by Name Matching

**File:** [UploadFileQueue.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/upload/UploadFileQueue.tsx#L259-L282)

Previously: when user clicked the × on a page-local card in the queue, `removeIndex(pageIdx)` computed `globalIdx(pageIdx)` and used it as the array index into BOTH `staged` (which was page-local and correct in simple cases) AND the global `files` array. This worked iff every file staged exactly once in the same order as files were added AND the user never removed items from earlier pages after staging later pages.

Bug scenario reproduced by the new code's fallback comments: user uploads 200 files (2 pages). Removes 3 files from page 1. Then tries to remove 1 file from page 2. Old code: `globalIdx(pageIdx)=103`, splices `files[103]` → but files array only has 197 entries now after page-1 removals, so it either deletes the wrong file or throws on out-of-range.

**Fix:**
1. Look up the staged item being removed (it has either `.file` with name or `.itemId`).
2. Compute `targetName = removedItem.file?.name || removedItem.itemId`.
3. Find its position in `files` via `filesCopy.findIndex(f => f.name === targetName || f === removedItem.file)`.
4. Only if no name match AND the index is still in bounds → fall back to the original index-based splice.

This preserves correctness regardless of the order in which the user removes items from arbitrary pages across the upload queue.

---

## 6. Stress Testing & Monitoring Infrastructure

### 6.1 stress_timeout_loop.mjs — 1-Hour 5-Phase Harness (Quick / Dry-Run / Phase-Start Modes)

**New file:** [stress_timeout_loop.mjs](file:///c:/Users/saikiran/Desktop/xray/perf/stress_timeout_loop.mjs)

Self-contained script (purposefully does NOT import from stress-test.mjs to avoid side effects from that file's module-level state). Runs in 5 timed phases:

| Phase | Wall time (full) | Wall time (--quick) | Load Profile |
|-------|------------------|---------------------|--------------|
| 1 Warmup | 0–5m | 0–30s | 5 concurrent simple GETs |
| 2 Ramp | 5–20m | 30s–2.5m | 10 → 50 concurrent, mixed GET/POST |
| 3 Sustained | 20–40m | 2.5–5.5m | 50 → 200 concurrent, write-heavy |
| 4 Breaking Point | 40–55m | 5.5–8.5m | Escalate until thresholds trip |
| 5 Cooldown | 55–60m | 8.5–9.5m | Stop load, monitor recovery |

Full mode: 60 minutes. Quick mode (`--quick`): ~9.5 minutes.

**Thresholds configured (these match the confirmed project_memory rules exactly):**
```
consecutiveTimeouts: 15     (was 3 in earlier versions → too sensitive)
errorRate60s:      0.50     (50% errors in 60s sliding window)
memoryGrowthMB:    500      (RSS growth vs baseline)
responseTimeMs:    30_000   (p95 latency 30s)
heapUsageRatio:    0.90     (heapUsed > 90% of heapTotal)
freeSystemMB:      500      (OS free memory drops below 500 MB)
concurrentMax:     200      (hard cap on concurrent requests above 200)
```

CLI flags:
- `--quick` — 9.5-min profile as above.
- `--target http://host:port` — override default `http://localhost:8080` / env `TARGET_URL`.
- `--phase N` — start at phase N instead of phase 1.
- `--dry-run` — print plan, don't execute any HTTP.

Outputs both **CSV** and **JSON** per-run reports into `perf/reports/` with UTC-timestamped filenames, plus a `-latest.json` convenience symlink-copy that `HOW_TO_RUN.md` / shell scripts can reference without knowing the exact timestamp.

### 6.2 SystemMonitor 3-Way Classification (Success / Error / Timeout)

The test script internally uses a 3-way classifier (per the project_memory confirmed rules):
- `recordSuccess()` only on HTTP 2xx responses → resets timeout streak, increments success counters.
- `recordError()` on HTTP 4xx/5xx → increments error rate but does NOT touch the consecutive-timeouts streak (reachable server returning 500 is not a timeout).
- `recordTimeout()` only on genuine transport failures: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, or the 30,000ms `req.timeout` abort handler firing.

Critical for avoiding false positives: in earlier sessions the script was treating fast 500 responses as "timeouts" and tripping the breaker after 3 in a row even though the server was perfectly reachable (just erroring). The breaker threshold of 15 consecutive genuine transport failures aligns with project_memory confirmed rule.

### 6.3 28 New Stress Report Files (Perf Data Collected This Cycle)

All under `perf/reports/`:
- `stress-timeout-loop-*` (6 full runs, each with CSV + JSON pair, plus `stress-timeout-loop-latest.json`)
- `stress-api-timeout-*` (CSV + JSON + `-latest.json`)
- `stress-buffer-stress-*` (CSV + JSON + `-latest.json`)
- `stress-concurrent-ops-*` (CSV + JSON + `-latest.json`)
- `stress-generation-stress-*` (CSV + JSON + `-latest.json`)
- `stress-upload-stress-*` (CSV + JSON + `-latest.json`)
- `LIBRARY_PAGE_SCALE_REPORT.md` (referenced in §3)

Also modified: [HOW_TO_RUN.md](file:///c:/Users/saikiran/Desktop/xray/perf/HOW_TO_RUN.md) updated to document the new `stress_timeout_loop.mjs` invocations and the `-latest.json` rollover pattern.

---

## 7. Summary Table: Scope of Changes

| Area | Files | Nature |
|---|---|---|
| **Image processing memory (Python)** | dumpread.py, process_raw_file.py | Vectorization of pixel loops; uint16-only throughout; explicit gc; to_uint16 no-op on correct dtype |
| **Hardcoded paths → config** | renderCanvas.js | Drive-letter literals replaced with config object |
| **Bulk delete backend** | storage.js, server.js | bulkDeleteItems() storage func + /api/items/bulk-delete route (50K cap, file cleanup) |
| **Saved-layouts write queue** | new diskWriteQueue.js, server.js 3 routes | Partitioned JSON layout storage, serial writes, 200ms pacing, FIFO coalesce, drain/status APIs |
| **PNG regen fallback** | new generate_png.py, server.js middleware | mmap'd NPZ → uint16 → PNG; transparent /data/library_images 404 interceptor |
| **HTTP server robustness** | server.js listen() tail | maxConnections=1000, keepAlive=2min, 5min request timeouts |
| **Library scale performance** | LibraryPage, combinationGenerator, Pagination, SimpleSidebar, report | 7 bottleneck fixes, 4+ O() drops of 1–5 orders of magnitude; 369-line written performance report |
| **Pagination UX (x3 locations)** | Pagination.tsx, SavedPage.tsx, CollagePage.tsx | Sanitized numeric input, clamp toasts, 6-key keyboard shortcuts, out-of-range auto-clamp effects |
| **Auto-save pipeline end-to-end** | generationService, SelectionTray, incrementalGenerator.worker, combinationGenerator, generation.ts | Save-as-you-go UI toggle → batch-bulk HTTP → DiskWriteQueue → partitioned files |
| **Upload UX + bugfix** | UploadPage.tsx, UploadFileQueue.tsx | Progress bar + better labeling; removeIndex fixes index desync across pages |
| **Stress test infra** | new stress_timeout_loop.mjs, HOW_TO_RUN.md, 28 report outputs | 5-phase harness, quick/dry/phase modes, 3-way monitoring classification, CSV+JSON output |

---

## 8. File-by-File Reference Index

### 8.1 Modified Files (Git-tracked)

| # | File | What changed |
|---|---|---|
| 1 | [backend/scripts/dumpread.py](file:///c:/Users/saikiran/Desktop/xray/backend/scripts/dumpread.py) | Vectorized pixel loops; uint16 return paths throughout; to_uint16 short-circuits already-uint16 arrays |
| 2 | [backend/src/lib/process_raw_file.py](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/process_raw_file.py) | ensure_uint16 helper; gc.collect() calls after freeing large arrays; NPZ always uint16 |
| 3 | [backend/src/lib/renderCanvas.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/renderCanvas.js) | B:\ hardcoded paths → config.libraryImagesRoot / config.pixelDataRoot |
| 4 | [backend/src/lib/storage.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/storage.js) | New exported bulkDeleteItems(ids[]) |
| 5 | [backend/src/server.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/server.js) | PNG regen middleware; /saved-layouts batch-bulk 3 routes; /items/bulk-delete route; server listen() tuning; spawn import |
| 6 | [frontend/dist/index.html](file:///c:/Users/saikiran/Desktop/xray/frontend/dist/index.html) | (Build artifact — no logic change, rebuilt from source) |
| 7 | [frontend/src/components/customization/WorkspaceToolbar.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/customization/WorkspaceToolbar.tsx) | Related integration with save/navigation flow from prior session |
| 8 | [frontend/src/components/library/Pagination.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/library/Pagination.tsx) | Robust page-number input, parsePageInput, 6 keyboard shortcuts, toast notifications, always-render shell, clickable numbered buttons |
| 9 | [frontend/src/components/library/SelectionTray.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/library/SelectionTray.tsx) | autoSave / setAutoSave props + Save-as-you-go checkbox pill |
| 10 | [frontend/src/components/library/SimpleLibrarySidebar.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/library/SimpleLibrarySidebar.tsx) | BOM removed; sidebarSelectionStats prop; selection state from precomputed ints instead of filter/every/some |
| 11 | [frontend/src/components/upload/UploadFileQueue.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/components/upload/UploadFileQueue.tsx) | removeIndex bugfix: by-name match in files array instead of naive globalIdx |
| 12 | [frontend/src/lib/combinationGenerator.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/lib/combinationGenerator.ts) | pickRandomK (3-tier sparse-swap Map strategy); pickRandomSubset rewritten; 8 call-sites migrated from shuffle().slice(); batchSize parameter added to incremental generator |
| 13 | [frontend/src/lib/generationService.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/lib/generationService.ts) | comboToLayout converter; autoSaveBatch fire-and-forget; autoSaveEnabled flag; setAutoSaveEnabled/getAutoSaveStatus public API; autoSaveStatus state propagated to subscribers; batchSize + autoSave threaded through startGeneration params |
| 14 | [frontend/src/pages/CollagePage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/CollagePage.tsx) | Pagination direct-input integration + edge-case handling |
| 15 | [frontend/src/pages/CustomizationPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/CustomizationPage.tsx) | Save / back-arrow integration from prior session; auto-save status display if any |
| 16 | [frontend/src/pages/LibraryPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/LibraryPage.tsx) | Module-level guardrails; localStorage persistence 50K cap; bulkDeleteLibraryItems helper + 3 call sites; itemCategoryMap + itemByIdMap twin maps; sidebarSelectionStats; classifySelectedItems O(S) helper; selected-counts O(S) memos; handleGenerate O(S) classification; soft-generate-cap 5K confirm; pagination select-all props; autoSave state wired to tray and service |
| 17 | [frontend/src/pages/SavedPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/SavedPage.tsx) | Direct page-number input with same robust handler set; pageInput sync effect; page clamp effect; Prev/Next disabled on totalPages<=1; 0-total showing-start fix |
| 18 | [frontend/src/pages/UploadPage.tsx](file:///c:/Users/saikiran/Desktop/xray/frontend/src/pages/UploadPage.tsx) | Progress bar banner always visible when files present; step-aware batch header labeling; final-page button text; isNextBufferReady memo; setStaged→setStagedForActivePage semantic rename |
| 19 | [frontend/src/types/generation.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/types/generation.ts) | AutoSaveStatus; GenerationState.autoSaveStatus; GenerationParams.batchSize, autoSave, bagWeightMode |
| 20 | [frontend/src/workers/incrementalGenerator.worker.ts](file:///c:/Users/saikiran/Desktop/xray/frontend/src/workers/incrementalGenerator.worker.ts) | IncrementalWorkerRequest.batchSize optional; forwarded to generateCombinationsIncremental; fallback ?? 5000 |
| 21 | [perf/HOW_TO_RUN.md](file:///c:/Users/saikiran/Desktop/xray/perf/HOW_TO_RUN.md) | Documents stress_timeout_loop.mjs usage and -latest.json convention |
| 22-26 | `perf/reports/stress-*-latest.json` (5 files) | Symlink-copies of each stress-type's most-recent JSON report |

### 8.2 New Files (Untracked)

| # | File | Purpose |
|---|---|---|
| 1 | [backend/src/lib/diskWriteQueue.js](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/diskWriteQueue.js) | Serial partitioned saved-layouts writer with 200ms pacing, FIFO queue, status + drain APIs. 260 lines. |
| 2 | [backend/src/lib/generate_png.py](file:///c:/Users/saikiran/Desktop/xray/backend/src/lib/generate_png.py) | mmap-mode NPZ → uint16 → PNG converter for on-the-fly missing-library-PNG regeneration |
| 3 | [perf/stress_timeout_loop.mjs](file:///c:/Users/saikiran/Desktop/xray/perf/stress_timeout_loop.mjs) | 1-hour 5-phase stress harness; --quick / --phase / --dry-run / --target flags; 3-way monitor; CSV+JSON output |
| 4 | [perf/reports/LIBRARY_PAGE_SCALE_REPORT.md](file:///c:/Users/saikiran/Desktop/xray/perf/reports/LIBRARY_PAGE_SCALE_REPORT.md) | Full bottleneck analysis + before/after tables for the library-scale performance pass |
| 5-28 | `perf/reports/stress-*-2026-07-31T*-*.{csv,json}` (24 files = 6 timeout-loop runs × 2 + 1 each of api-timeout / buffer / concurrent-ops / generation / upload × 2) | Raw stress output collected this cycle |
