# Design Document: Raw File Upload Pipeline

## Overview

This feature extends the existing upload flow to accept raw `.dump.pgm` and `.tip` sensor files. The backend parses each file using the existing `dumpRead.js` and `tipRead.js` readers, generates a 16-bit grayscale PNG via `sharp`, saves pixel data JSON, and streams results back to the frontend progressively via NDJSON. The frontend reads the stream using the Fetch Streams API and appends items to the staged panel one-by-one as each file completes. The existing PNG upload flow is entirely unchanged.

**Key technical decisions:**
- Pixel array source: `high` (index 0) for `.dump.pgm`, `high_raw` (index 1) for `.tip`
- PNG encoding: `sharp` with `toColourspace("grey16")`, big-endian Uint16 buffer
- Parallelism: Node.js `worker_threads`, pool of 4 workers per request
- Streaming: NDJSON over chunked HTTP (`Content-Type: application/x-ndjson`), one JSON line per completed file
- Frontend consumption: Fetch Streams API (`response.body.getReader()`)
- Item ID: strip from first dot — `P01X010-2024101200923.dump.pgm` → `P01X010-2024101200923`
- Module system: ESM workers with `createRequire` to bridge the CJS readers

## Architecture

The full flow from browser to library:

```
Browser (UploadPage.tsx)
  │
  │  POST /api/process-raw-files  (multipart, .dump.pgm / .tip files)
  ▼
Express server.js (ESM)
  │  1. multer saves uploads to /tmp (memStorage or diskStorage)
  │  2. Read items.json once → build existingIds Set
  │  3. Filter out duplicates
  │  4. Set response headers: 200, application/x-ndjson
  │  5. Pass non-duplicate file tasks to WorkerPool
  ▼
workerPool.js (ESM, createRequire bridge)
  │  Maintains queue of pending tasks
  │  Keeps ≤ 4 Worker instances active
  │  Calls onResult(result) callback for each completed task immediately
  │
  ├──► Worker Thread 1 (rawFileWorker.js)
  ├──► Worker Thread 2 (rawFileWorker.js)
  ├──► Worker Thread 3 (rawFileWorker.js)
  └──► Worker Thread 4 (rawFileWorker.js)
         │
         │  receive: { filePath, itemId, fileType, pixelDataDir, libraryImagesDir }
         │
         │  .dump.pgm → ReadDump(filePath)  → high array  (Float64Array)
         │  .tip      → read_tip(filePath)  → high_raw    (Uint16Array)
         │
         │  to_uint16() → big-endian Buffer → sharp().toColourspace("grey16").png()
         │  → write {itemId}.png to libraryImagesDir
         │  → write pre_{uuid}.json to pixelDataDir
         │
         └──► parentPort.postMessage({ status:"done"|"error", ...fields })
  │
  ▼
Express (onResult callback)
  │  res.write(JSON.stringify(result) + "\n")   ← flush immediately
  │  When all done: res.write(summaryLine + "\n"), res.end()
  ▼
Browser (UploadPage.tsx — Fetch Streams reader)
  │  reader.read() loop, TextDecoder, split on "\n"
  │  For each "done" line → setStaged(prev => [...prev, newItem])
  │  For each "error" line → show inline error
  │  For "complete" line → stop progress indicator, show summary
  ▼
Operator reviews staged panel, sets subcategories / valid regions, clicks Upload
  │
  │  POST /api/upload  (existing endpoint, extended)
  │  metadata per item includes: preProcessed: true, preGeneratedFilepath, itemId, ...
  ▼
Express /api/upload
  │  preProcessed=true → skip multer file write, skip PNG generation
  │  call createItem() + createBag()/createThreat()/createNonThreatItem()
  ▼
items.json  +  library_images/{itemId}.png  +  pixel_data/pre_{uuid}.json
```

## Components and Interfaces

### New Backend Files

```
backend/src/lib/
  rawFileWorker.js    — Worker Thread script (ESM + createRequire)
  workerPool.js       — Pool manager for 4 workers (ESM + createRequire)
```

### Modified Files

| File | Change |
|------|--------|
| `backend/src/server.js` | Add `POST /api/process-raw-files`; extend `POST /api/upload` for `preProcessed` items; remove dead `/api/read-dump` and `/api/read-tip` endpoints |
| `backend/package.json` | Add `"sharp": "^0.33.5"` to dependencies |
| `frontend/src/context/UploadContext.tsx` | Extend `StagedItem` with pipeline fields |
| `frontend/src/pages/UploadPage.tsx` | Add raw-file routing, NDJSON stream reading, progress indicator, duplicate warning banner |
| `frontend/src/components/upload/UploadDropZone.tsx` | Add `.pgm,.tip` to `accept` attribute |
| `frontend/src/components/upload/UploadFileQueue.tsx` | Handle `preProcessed` items: URL-based preview, locked category for bags |

### Module System Strategy

`server.js` is ESM (`"type": "module"` in `backend/package.json`). Both `dumpRead.js` and `tipRead.js` are CommonJS (they use `require()`).

**Recommendation: ESM worker files with `createRequire`.**

Worker files spawned via `new Worker(path)` in an ESM project default to ESM. To import CJS modules from an ESM worker, use Node's built-in `createRequire`:

```js
// rawFileWorker.js  (ESM)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { ReadDump } = require("./dumpRead.js");
const { read_tip } = require("./tipRead.js");
```

This avoids converting the CJS readers to ESM (which would require refactoring their internal `require("fs")` calls) and avoids making the workers CJS (which would complicate top-level await and ES module imports in the worker itself).

`workerPool.js` does not need to import the readers directly — it only creates `Worker` instances — so it is pure ESM with no `createRequire` needed.

## Data Models

### `StagedItem` Type Extension (`UploadContext.tsx`)

```ts
export interface StagedItem {
  // Existing fields (unchanged)
  file: File;                          // null / dummy File for pre-processed items
  category: string;
  subcategory: string;
  valid_region_points?: any | null;

  // New fields for pipeline-produced items
  preProcessed?: boolean;              // true when item came from /api/process-raw-files
  preGeneratedFilepath?: string;       // "{itemId}.png" — relative path in library_images
  fileType?: "dump" | "tip";           // source file type
  itemId?: string;                     // derived item ID (stripped filename)
  width?: number;                      // image dimensions from worker result
  height?: number;
}
```

When `preProcessed = true`, the `file` field holds a minimal stub `File` object (e.g., `new File([], itemId)`) so that existing queue components that reference `s.file.name` continue to work without null checks throughout.

### Worker Message — Inbound (main → worker)

```ts
interface WorkerTask {
  filePath: string;        // absolute path to the uploaded temp file
  itemId: string;          // derived ID (filename stripped from first dot)
  fileType: "dump" | "tip";
  pixelDataDir: string;    // absolute path to backend/data/pixel_data
  libraryImagesDir: string; // absolute path to backend/data/library_images
}
```

### Worker Message — Outbound (worker → main)

**Success:**
```ts
interface WorkerResultDone {
  status: "done";
  id: string;              // itemId
  filepath: string;        // "{itemId}.png"
  pixelDataFilename: string; // "pre_{uuid}.json"
  width: number;
  height: number;
  fileType: "dump" | "tip";
}
```

**Failure:**
```ts
interface WorkerResultError {
  status: "error";
  id: string;              // itemId
  reason: string;          // error message
}
```

### NDJSON Stream Line Formats

Each line is a JSON object followed by `\n`. No blank lines are emitted between records.

**Done line** (one per successfully processed file):
```json
{ "id": "P01X010-2024101200923", "filepath": "P01X010-2024101200923.png", "width": 512, "height": 640, "fileType": "dump", "status": "done" }
```

**Error line** (one per failed file):
```json
{ "id": "P01X010-2024101200923", "status": "error", "reason": "Unexpected end of file" }
```

**Complete line** (exactly one, always the final line):
```json
{ "status": "complete", "total": 10, "processed": 8, "duplicates": 1, "failed": 1 }
```

Where:
- `total` = number of non-duplicate files submitted to the worker pool
- `processed` = count of done lines emitted
- `duplicates` = count of files skipped before worker dispatch
- `failed` = count of error lines emitted

### `POST /api/upload` Extended Metadata Format

For pre-processed items, the frontend sends metadata in the existing `metadata` JSON array, with additional fields:

```ts
interface UploadMetadataItem {
  originalname: string;          // itemId (used as lookup key; no file bytes sent)
  category: string;
  subcategory: string;
  valid_region_points?: any | null;

  // New fields for pre-processed items
  preProcessed?: true;
  preGeneratedFilepath?: string; // "{itemId}.png" (already on disk)
  itemId?: string;               // the derived item ID
  width?: number;
  height?: number;
  pixelDataFilename?: string;    // "pre_{uuid}.json" (already on disk)
  fileType?: "dump" | "tip";
}
```

When `preProcessed = true`, the endpoint:
1. Does NOT expect a corresponding file entry in `req.files` for that item
2. Calls `createItem({ id, filepath: preGeneratedFilepath, category, subcategory, width, height, pixel_data_path: pixelDataFilename, ... })`
3. Calls `createBag`, `createThreat`, or `createNonThreatItem` per category, same as today
4. Does NOT run Jimp dimension detection (width/height already provided)

## Worker Thread Design (`rawFileWorker.js`)

```
[start]
  │
  parentPort.once("message", async (task) => {
  │
  ├── try {
  │     const { filePath, itemId, fileType, pixelDataDir, libraryImagesDir } = task
  │
  │     // 1. Parse raw file
  │     if fileType === "dump":
  │       [high, low, R, rows, cols] = ReadDump(filePath)
  │       pixelArray = high            // Float64Array, flat, rows×cols
  │     else:  // "tip"
  │       [low_raw, high_raw] = read_tip(filePath)
  │       pixelArray = high_raw        // Uint16Array, flat, rows×cols
  │       rows = height, cols = width/2 (from tip header)
  │
  │     // 2. Convert to big-endian Uint16 buffer
  │     uint16 = to_uint16(pixelArray)          // clamp [0,65535], round
  │     beBuf = Buffer.allocUnsafe(uint16.length * 2)
  │     for k in range(uint16.length):
  │       beBuf.writeUInt16BE(uint16[k], k*2)
  │
  │     // 3. Generate PNG via sharp
  │     pngPath = path.join(libraryImagesDir, itemId + ".png")
  │     await sharp(beBuf, { raw: { width: cols, height: rows, channels: 1 } })
  │       .toColourspace("grey16")
  │       .png({ compressionLevel: 6 })
  │       .toFile(pngPath)
  │
  │     // 4. Write pixel data JSON
  │     uuid = crypto.randomUUID()
  │     pixelDataFilename = "pre_" + uuid + ".json"
  │     pixelDataPath = path.join(pixelDataDir, pixelDataFilename)
  │     try {
  │       await fs.writeFile(pixelDataPath, JSON.stringify(Array.from(pixelArray)))
  │     } catch (writeErr) {
  │       await fs.unlink(pngPath).catch(() => {})   // discard PNG
  │       throw writeErr
  │     }
  │
  │     // 5. Post success result
  │     parentPort.postMessage({
  │       status: "done", id: itemId,
  │       filepath: itemId + ".png",
  │       pixelDataFilename, width: cols, height: rows, fileType
  │     })
  │
  ├── } catch (err) {
  │     parentPort.postMessage({ status: "error", id: itemId, reason: err.message })
  └── }
  })
```

**sharp API call — exact form:**
```js
await sharp(beBuf, {
  raw: { width: cols, height: rows, channels: 1 },
})
  .toColourspace("grey16")
  .png({ compressionLevel: 6 })
  .toFile(pngPath);
```

The `beBuf` is a `Buffer` of `rows × cols × 2` bytes with each uint16 value written in big-endian order via `writeUInt16BE`. The `toColourspace("grey16")` call tells sharp to interpret the input as 16-bit single-channel greyscale and preserve that depth in the output PNG.

## Worker Pool Design (`workerPool.js`)

The pool owns a fixed set of `Worker` instances and a FIFO task queue. It never creates more than 4 workers.

```
WorkerPool {
  workers: Worker[4]          // pre-created at construction
  idle: Set<Worker>           // workers not currently busy
  queue: Task[]               // pending tasks waiting for a free worker
  onResult: (result) => void  // callback set by caller
}

runTask(task):
  if idle.size > 0:
    pick worker from idle, remove from idle
    send task to worker via worker.postMessage(task)
    worker.once("message", (result) => {
      onResult(result)            // emit immediately — no buffering
      idle.add(worker)
      if queue.length > 0:
        runTask(queue.shift())    // drain queue
    })
  else:
    queue.push(task)

addTask(task):
  runTask(task)

drain() → Promise<void>:
  resolves when idle.size === 4 and queue.length === 0
  (used by endpoint to know when to write the complete line)
```

Workers are created with `new Worker(workerPath)` at pool construction, not per-task. This avoids startup overhead for every file. Workers stay alive for the lifetime of the request and are terminated in `drain()`.

Because the `onResult` callback is invoked synchronously inside the worker's `"message"` event, and `res.write()` is called immediately in that callback, each NDJSON line is flushed to the HTTP response as soon as the worker posts its result — satisfying the no-buffering requirement.

## Frontend Stream Reading

### Routing Logic (`UploadPage.tsx`)

```ts
const hasRawFiles = newFiles.some(f =>
  f.name.endsWith(".dump.pgm") || f.name.endsWith(".tip")
);

if (hasRawFiles) {
  // Raw pipeline: all files (including co-submitted PNGs) go to raw endpoint
  await processRawFiles(newFiles);
} else {
  // Existing PNG flow: unchanged
  await doUpload();
}
```

### NDJSON Stream Reader (pseudocode)

```ts
async function processRawFiles(files: File[]) {
  const formData = new FormData();
  files.forEach(f => formData.append("rawFiles", f));

  const response = await fetch("http://localhost:8080/api/process-raw-files", {
    method: "POST",
    body: formData,
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = 0;
  const total = files.length;

  setProcessing(true);
  setProcessingProgress({ n: 0, total });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;   // last element may be incomplete

    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);

      if (msg.status === "done") {
        completed++;
        setProcessingProgress({ n: completed, total });
        // Append to staged panel immediately
        setStaged(prev => [...prev, {
          file: new File([], msg.id),
          category: msg.fileType === "dump" ? "bags" : "non-threats",
          subcategory: "",
          valid_region_points: null,
          preProcessed: true,
          preGeneratedFilepath: msg.filepath,
          fileType: msg.fileType,
          itemId: msg.id,
          width: msg.width,
          height: msg.height,
        }]);
      } else if (msg.status === "error") {
        // Show inline error for this item
        addStreamError(msg.id, msg.reason);
      } else if (msg.status === "complete") {
        setProcessing(false);
        if (msg.duplicates > 0) {
          setDuplicateWarning(`${msg.duplicates} file(s) skipped — already in library`);
        }
      }
    }
  }
}
```

### Final Commit (`doUpload` extension)

When staged items include pre-processed items, the metadata array sent to `POST /api/upload` includes the extra fields. No file bytes are sent for pre-processed items — only the metadata JSON:

```ts
const metadata = staged.map(s => ({
  originalname: s.preProcessed ? s.itemId! : s.file.name,
  category: s.category,
  subcategory: s.subcategory,
  valid_region_points: s.valid_region_points || null,
  ...(s.preProcessed && {
    preProcessed: true,
    preGeneratedFilepath: s.preGeneratedFilepath,
    itemId: s.itemId,
    width: s.width,
    height: s.height,
    pixelDataFilename: s.pixelDataFilename,
    fileType: s.fileType,
  }),
}));

formData.append("metadata", JSON.stringify(metadata));
// Only append file bytes for non-pre-processed items
staged.forEach(s => {
  if (!s.preProcessed) formData.append("images", s.file);
});
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Property reflection:** After prework analysis, the following properties provide unique, non-redundant validation value. Properties for `to_uint16` clamping and big-endian buffer construction are combined (they test the same buffer-building function). The duplicate-detection properties (skip + summary) are kept separate because one tests the skip behavior and one tests the reporting behavior. Category assignment properties for dump vs. tip are combined into a single dispatch property.

---

### Property 1: Item ID derivation strips from first dot

*For any* filename string containing at least one dot, `deriveItemId(filename)` shall return the substring of characters before the first dot — never including any dot or extension character.

**Validates: Requirement 2.1**

---

### Property 2: No file is passed to a worker if its derived ID exists in the library

*For any* set of existing Item IDs and any batch of incoming files, each file whose derived Item ID is a member of the existing-ID set shall not result in a worker task being dispatched.

**Validates: Requirements 3.2, 3.4**

---

### Property 3: All duplicate IDs appear in the complete summary line

*For any* batch of incoming files where a subset are duplicates, the `duplicates` count in the final `{ status: "complete" }` line shall equal the size of that duplicate subset, and every skipped ID shall be accounted for in the count.

**Validates: Requirement 3.3**

---

### Property 4: Worker pool concurrency never exceeds 4

*For any* batch of N files (N > 4), at no point during processing shall more than 4 worker threads be simultaneously active.

**Validates: Requirements 4.1, 4.2, 4.3**

---

### Property 5: Pixel value clamping and big-endian buffer correctness

*For any* Float64Array or Uint16Array of pixel values, the two-step conversion (clamp to [0, 65535] → round → write as big-endian uint16) shall produce a `Buffer` where: (a) every value is in [0, 65535], and (b) `buf.readUInt16BE(i * 2)` equals `Math.min(65535, Math.max(0, Math.round(pixelArray[i])))` for all indices `i`.

**Validates: Requirements 7.2, 7.4**

---

### Property 6: NDJSON done-line structure is complete for all successfully processed files

*For any* file that is successfully processed by the worker, the emitted NDJSON line shall be a valid JSON object containing all required fields: `id` (string), `filepath` (string ending in `.png`), `width` (positive integer), `height` (positive integer), `fileType` (`"dump"` or `"tip"`), and `status` equal to `"done"`.

**Validates: Requirement 9.2**

---

### Property 7: Stream reader correctly reassembles lines at arbitrary chunk boundaries

*For any* sequence of NDJSON lines, when the byte stream is split into chunks at arbitrary boundaries (not necessarily at newline characters), the stream reader shall produce the same set of parsed JSON objects as if the entire stream were read at once.

**Validates: Requirement 11.1**

---

### Property 8: Category is determined by file type for all pipeline items

*For any* file processed by the pipeline, the `category` field of the resulting staged item shall be `"bags"` if the file type is `"dump"`, and `"non-threats"` if the file type is `"tip"`.

**Validates: Requirements 10.1, 10.2**

---

### Property 9: Pre-processed items are committed without PNG re-generation

*For any* item with `preProcessed = true` submitted to `POST /api/upload`, the endpoint shall call `createItem` with the supplied `preGeneratedFilepath` and shall not invoke `sharp`, `Jimp`, or any file-write operation for the image itself.

**Validates: Requirements 15.1, 15.2**

---

### Property 10: Preview URL is derived from itemId for all pre-processed staged items

*For any* pre-processed staged item displayed in the `UploadFileQueue`, the `src` attribute of the preview image element shall equal `http://localhost:8080/data/library_images/{itemId}.png`.

**Validates: Requirement 13.1**

## Error Handling

### Worker-level errors

Every worker wraps its entire body in a `try/catch`. Any synchronous or asynchronous exception — from the file reader, from sharp, or from the pixel-data write — is caught and turned into a `{ status: "error", id, reason: err.message }` message posted back to the main thread. The worker does not crash or exit; it becomes idle again and is available for the next task.

If the PNG was written before the pixel-data JSON write fails, the worker deletes the PNG file (`fs.unlink`) before posting the error result, to avoid orphaned image files without corresponding items.json entries.

### Pool-level errors

If a `Worker` instance emits an `"error"` event (uncaught exception that escapes the try/catch inside the worker script), the pool catches it via `worker.on("error", ...)`, synthesizes an error result for the active task, calls `onResult`, and replaces the failed worker with a fresh one.

### Endpoint-level errors

If the multer upload fails (e.g., file too large, disk full), Express returns a standard `{ ok: false, error: "..." }` JSON response before streaming starts.

If the response stream has already started (headers sent), any error in the main-thread coordination code is logged server-side. The stream may end abruptly; the frontend detects this via the `reader.read()` loop resolving with `done: true` before a `complete` line was received, and shows a generic error banner.

### Frontend error handling

- Network errors during the fetch are caught and displayed as a full-page error banner.
- Malformed NDJSON lines (unparseable JSON) are skipped with a console warning.
- If the stream ends without a `complete` line, the processing indicator is stopped and a warning is shown.
- Duplicate warnings are dismissible and auto-cleared on a new upload.

### `POST /api/upload` pre-processed item errors

If `createItem` fails for a pre-processed item (e.g., ID already exists due to a race condition), the endpoint reports that item in the `errors` array without affecting other items in the same request.

## Testing Strategy

### Unit Tests

Unit tests cover specific examples, edge cases, and integration points. They are co-located with the source they test (`*.test.js` / `*.test.ts`).

**`deriveItemId` (pure function):**
- `"P01X010-2024101200923.dump.pgm"` → `"P01X010-2024101200923"`
- `"scan.tip"` → `"scan"`
- `"no-extension"` → `"no-extension"` (no dot found)

**`to_uint16` (pure function):**
- `0.0` → `0`
- `65535.0` → `65535`
- `65536.9` → `65535` (clamped)
- `-1.0` → `0` (clamped)
- `100.6` → `101` (rounded)

**Big-endian buffer construction:**
- For `Uint16Array([0x1234, 0xABCD])`, buffer bytes should be `[0x12, 0x34, 0xAB, 0xCD]`

**Worker task dispatch (mocked workers):**
- File with existing ID → worker.postMessage not called
- File with new ID → worker.postMessage called with correct task shape
- ReadDump throws → error result posted, no PNG written

**`POST /api/process-raw-files` endpoint (supertest + mocked worker pool):**
- Headers: `Content-Type: application/x-ndjson`, status 200 before workers start
- Each done result from pool → corresponding NDJSON line in response
- Final complete line has correct counts
- All-duplicates batch → zero worker tasks + complete line with duplicates count

**`POST /api/upload` pre-processed path:**
- `preProcessed: true` + `category: "bags"` → `createItem` + `createBag` called, sharp/Jimp not called
- `preProcessed: true` + `category: "threats"` → `createItem` + `createThreat` called
- `preProcessed: true` + `category: "non-threats"` → `createItem` + `createNonThreatItem` called
- `preProcessed` absent → existing PNG path unchanged

**Frontend stream reader (`parseNdjsonStream`):**
- Lines chunked mid-JSON → correct objects emitted
- Empty lines → skipped
- Malformed JSON → skipped with no crash

**`UploadDropZone`:**
- File input `accept` attribute contains `.pgm,.tip,image/*`

**`UploadFileQueue` with pre-processed item:**
- `preProcessed=true`, `fileType="dump"` → category select disabled, value `"bags"`
- `preProcessed=true`, `fileType="tip"` → category select enabled, default value `"non-threats"`
- `preProcessed=true` → preview `src` is `http://localhost:8080/data/library_images/{itemId}.png`

### Property-Based Tests

Property-based testing is applicable because the pipeline contains several pure functions with large input spaces whose correctness is best expressed as universally quantified invariants. The recommended library is **fast-check** (TypeScript-native, works in both Node.js and browser environments).

Each property test runs a minimum of **100 iterations**. Tests are tagged with a comment referencing the design property they validate.

**Tag format:** `// Feature: raw-file-upload-pipeline, Property {N}: {property_text}`

```
Property 1: deriveItemId
  Arbitraries: string with at least one '.' character
  Assert: result === input.slice(0, input.indexOf('.'))

Property 2: Duplicate skip
  Arbitraries: Set<string> existingIds, File[] batch (some IDs overlap)
  Assert: for every file in batch where deriveItemId matches existingIds,
          worker.postMessage was never called with that itemId

Property 3: Duplicate count in summary
  Arbitraries: array of itemIds (some duplicates of existing set)
  Assert: complete.duplicates === count of files whose ID was in existingIds

Property 4: Concurrency cap
  Arbitraries: integer N in [5..50] (number of files)
  Assert: max simultaneous active workers never exceeds 4

Property 5: Pixel buffer invariant
  Arbitraries: Float64Array of length [1..1000] with values in [-1000..70000]
  Assert: for all i, beBuf.readUInt16BE(i*2) === Math.min(65535,Math.max(0,Math.round(arr[i])))

Property 6: NDJSON done-line structure
  Arbitraries: valid WorkerResultDone object with random id, dims, fileType
  Assert: JSON.parse(emittedLine) has all required fields with correct types

Property 7: Stream chunking invariant
  Arbitraries: array of NDJSON strings, partition into arbitrary chunk sizes
  Assert: parsed objects from chunked reader === parsed objects from full string

Property 8: Category by file type
  Arbitraries: fileType ∈ {"dump", "tip"}
  Assert: resulting staged item category === (fileType === "dump" ? "bags" : "non-threats")

Property 9: Pre-processed commit skips file I/O
  Arbitraries: random preProcessed item (any category)
  Assert: createItem called with preGeneratedFilepath; sharp/Jimp mocks not called

Property 10: Preview URL format
  Arbitraries: random itemId string
  Assert: img.src === "http://localhost:8080/data/library_images/" + itemId + ".png"
```

### Integration Tests

- `POST /api/process-raw-files` with a real `.dump.pgm` file against a live Express instance (no mocks): verify PNG is written to `library_images/`, pixel JSON is written to `pixel_data/`, NDJSON stream emits a valid done line.
- `POST /api/process-raw-files` with a real `.tip` file: same verification.
- Duplicate submission: submit same file twice; second call should produce `duplicates: 1` in complete line.
- `POST /api/upload` round-trip for a pre-processed item: call process-raw-files, capture NDJSON result, then call upload with preProcessed metadata; verify item appears in `GET /api/items/categorized`.

### Regression Tests

- `POST /api/upload` with a standard PNG file must continue to work exactly as before (no behavioral change).
- `UploadDropZone` with only image/* files → `onFilesSelected` called with all files.
- `UploadFileQueue` with PNG staged items → category select enabled, preview from `URL.createObjectURL`, valid region button visible for bags.
