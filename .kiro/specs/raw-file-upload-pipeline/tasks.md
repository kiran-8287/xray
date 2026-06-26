# Implementation Plan: Raw File Upload Pipeline

## Overview

Extend the upload flow to accept `.dump.pgm` and `.tip` raw sensor files. The backend parses each file in a Worker Thread pool, generates 16-bit grayscale PNGs via `sharp`, and streams NDJSON results back progressively. The frontend reads the stream, stages items one-by-one as they complete, and the existing PNG upload flow is left entirely unchanged.

## Tasks

- [x] 1. Add `sharp` dependency to `backend/package.json`
  - Add `"sharp": "^0.33.5"` to the `dependencies` object in `backend/package.json`
  - Verify the entry is inside the `dependencies` block (not `devDependencies`)
  - _Requirements: 16.1, 16.2_

- [ ] 2. Create `backend/src/lib/rawFileWorker.js`
  - [-] 2.1 Implement the ESM worker module with `createRequire` bridge
    - Create `backend/src/lib/rawFileWorker.js` as an ESM file
    - Use `import { createRequire } from "module"` to obtain a `require` function
    - Use `createRequire` to load `./dumpRead.js` (destructure `ReadDump`) and `./tipRead.js` (destructure `read_tip`)
    - Import `{ parentPort }` from `node:worker_threads`, `fs` from `node:fs/promises`, `path` from `node:path`, `crypto` from `node:crypto`, and `sharp` (default import)
    - _Requirements: 5.1, 6.1_

  - [-] 2.2 Implement the parse → convert → PNG → JSON pipeline inside the worker
    - Listen for exactly one inbound message on `parentPort` via `parentPort.once("message", async (task) => { ... })`
    - Destructure `{ filePath, itemId, fileType, pixelDataDir, libraryImagesDir }` from the task
    - For `fileType === "dump"`: call `ReadDump(filePath)` and assign `pixelArray = high` (index 0); derive `rows` and `cols` from `ReadDump`'s returned 4th and 5th values
    - For `fileType === "tip"`: call `read_tip(filePath)` and assign `pixelArray = high_raw` (index 1 of the returned pair); derive `rows` from `pixelArray.length / cols` and `cols` from `high_raw`'s dimension (width/2 from the `.tip` header)
    - Implement `to_uint16(arr)`: clamp each value to `[0, 65535]` with `Math.min(65535, Math.max(0, Math.round(v)))` and return a `Uint16Array`
    - Build big-endian buffer: `Buffer.allocUnsafe(uint16.length * 2)` + loop writing `beBuf.writeUInt16BE(uint16[k], k * 2)`
    - Call `sharp(beBuf, { raw: { width: cols, height: rows, channels: 1 } }).toColourspace("grey16").png({ compressionLevel: 6 }).toFile(pngPath)` where `pngPath = path.join(libraryImagesDir, itemId + ".png")`
    - Write pixel data JSON: `const uuid = crypto.randomUUID(); const pixelDataFilename = "pre_" + uuid + ".json";` then `await fs.writeFile(path.join(pixelDataDir, pixelDataFilename), JSON.stringify(Array.from(pixelArray)))`
    - If the pixel-data write fails, call `await fs.unlink(pngPath).catch(() => {})` to discard the orphaned PNG, then re-throw
    - Post success: `parentPort.postMessage({ status: "done", id: itemId, filepath: itemId + ".png", pixelDataFilename, width: cols, height: rows, fileType })`
    - Wrap the entire message handler body in `try/catch`; post error: `parentPort.postMessage({ status: "error", id: itemId, reason: err.message })`
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2_

  - [ ]* 2.3 Write property test for `to_uint16` and big-endian buffer construction (Property 5)
    - **Property 5: Pixel value clamping and big-endian buffer correctness**
    - **Validates: Requirements 7.2, 7.4**
    - Create `backend/src/lib/rawFileWorker.test.js` using fast-check
    - Export `to_uint16` from the worker module (or extract it to a shared helper) so it can be imported in tests
    - Generate arbitrary `Float64Array` values in `[-1000, 70000]`; assert `beBuf.readUInt16BE(i*2) === Math.min(65535, Math.max(0, Math.round(arr[i])))` for all `i`
    - Tag: `// Feature: raw-file-upload-pipeline, Property 5: Pixel value clamping and big-endian buffer correctness`

- [x] 3. Create `backend/src/lib/workerPool.js`
  - [x] 3.1 Implement the ESM pool module
    - Create `backend/src/lib/workerPool.js` as an ESM file
    - Import `{ Worker }` from `node:worker_threads` and `{ fileURLToPath }` from `node:url`
    - Derive `__dirname` from `import.meta.url` via `fileURLToPath`
    - Resolve the worker script path: `path.join(__dirname, "rawFileWorker.js")`
    - Define `class WorkerPool` with constructor parameter `size = 4`
    - In the constructor: pre-create `size` Worker instances, add all to an `idle` Set; initialize `queue = []` and `_drainResolvers = []`
    - Attach a pool-level error handler on each worker: `worker.on("error", (err) => { ... })` — synthesize an error result for the active task associated with that worker, call `this._onResult`, replace the crashed worker with a fresh one, and re-add it to idle
    - Implement `addTask(task, onResult)`: store `onResult`, call internal `_runTask(task)`
    - Implement `_runTask(task)`: if `idle.size > 0`, pick and remove a worker from idle, send task via `worker.postMessage(task)`, register `worker.once("message", result => { onResult(result); idle.add(worker); if (queue.length > 0) this._runTask(queue.shift()); this._checkDrain(); })`; else push to `queue`
    - Implement `drain()`: return a `Promise` that resolves when `idle.size === size` and `queue.length === 0`; if already drained resolve immediately; otherwise push resolver to `_drainResolvers`
    - Implement `_checkDrain()`: if fully drained, call all pending drain resolvers and clear the array
    - Export `WorkerPool` as default export
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 3.2 Write property test for worker pool concurrency cap (Property 4)
    - **Property 4: Worker pool concurrency never exceeds 4**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - In the same test file or a dedicated `workerPool.test.js`, use fast-check to generate integers N in [5..50]
    - Mock the Worker class so each worker's `postMessage` triggers a delayed reply; record peak simultaneous active workers
    - Assert peak active count never exceeds 4
    - Tag: `// Feature: raw-file-upload-pipeline, Property 4: Worker pool concurrency never exceeds 4`

- [ ] 4. Add `POST /api/process-raw-files` to `backend/src/server.js`
  - [~] 4.1 Set up multer memory storage and the new route skeleton
    - At the top of `server.js`, import `WorkerPool` from `"./lib/workerPool.js"` and `{ Worker }` from `"node:worker_threads"`
    - Create a second multer instance using `multer.memoryStorage()` (or diskStorage to `libraryImagesRoot`) named `rawUpload` for raw files
    - Register `app.post("/api/process-raw-files", rawUpload.array("rawFiles"), async (req, res) => { ... })`
    - _Requirements: 9.1_

  - [~] 4.2 Implement duplicate pre-check and NDJSON header flush
    - Inside the handler, call `getItems()` once and build `const existingIds = new Set(items.map(i => i.id))`
    - Derive Item IDs: implement `deriveItemId(filename)` as `filename.slice(0, filename.indexOf("."))` (returns full name if no dot found)
    - Classify file type: `.dump.pgm` → `"dump"`, `.tip` → `"tip"`
    - Partition files into `nonDuplicates` (derived ID not in `existingIds`) and count `duplicateCount`
    - Set response headers immediately before any async work: `res.setHeader("Content-Type", "application/x-ndjson"); res.setHeader("Transfer-Encoding", "chunked"); res.status(200).flushHeaders()`
    - _Requirements: 2.1, 3.1, 3.2, 9.1_

  - [~] 4.3 Dispatch tasks to pool and stream NDJSON lines
    - Instantiate `const pool = new WorkerPool(4)`
    - For each non-duplicate file, save the file buffer to a temp path (or use `req.file.path` from disk storage), then call:
      ```js
      pool.addTask(
        { filePath, itemId, fileType, pixelDataDir: pixelDataRoot, libraryImagesDir: libraryImagesRoot },
        (result) => {
          res.write(JSON.stringify(result) + "\n");
        }
      );
      ```
    - After dispatching all tasks, `await pool.drain()`
    - Write the complete summary line: `res.write(JSON.stringify({ status: "complete", total: nonDuplicates.length, processed: processedCount, duplicates: duplicateCount, failed: failedCount }) + "\n")`
    - Call `res.end()`
    - Track `processedCount` and `failedCount` inside the `onResult` callback by checking `result.status`
    - _Requirements: 3.3, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 4.4 Write property test for `deriveItemId` (Property 1)
    - **Property 1: Item ID derivation strips from first dot**
    - **Validates: Requirement 2.1**
    - Extract `deriveItemId` as a pure exported helper in a shared `utils.js` or inline export from the route file
    - Use fast-check to generate strings containing at least one `"."` character
    - Assert `deriveItemId(s) === s.slice(0, s.indexOf("."))`
    - Tag: `// Feature: raw-file-upload-pipeline, Property 1: Item ID derivation strips from first dot`

  - [ ]* 4.5 Write property test for duplicate skip behaviour (Property 2)
    - **Property 2: No file is passed to a worker if its derived ID exists in the library**
    - **Validates: Requirements 3.2, 3.4**
    - Generate an arbitrary `Set<string>` of existing IDs and an array of filenames (some overlapping the set)
    - Mock `pool.addTask` and assert it is never called for a filename whose `deriveItemId` result is in the existing-ID set
    - Tag: `// Feature: raw-file-upload-pipeline, Property 2: No file is passed to a worker if its derived ID exists in the library`

  - [ ]* 4.6 Write property test for duplicate count in summary line (Property 3)
    - **Property 3: All duplicate IDs appear in the complete summary line**
    - **Validates: Requirement 3.3**
    - Generate an array of filenames and a set of pre-existing IDs; compute expected `duplicateCount`
    - Run the routing logic with mocked pool and assert the emitted complete line has `duplicates === expectedDuplicateCount`
    - Tag: `// Feature: raw-file-upload-pipeline, Property 3: All duplicate IDs appear in the complete summary line`

  - [ ]* 4.7 Write property test for NDJSON done-line structure (Property 6)
    - **Property 6: NDJSON done-line structure is complete for all successfully processed files**
    - **Validates: Requirement 9.2**
    - Generate arbitrary `WorkerResultDone`-shaped objects (random `id`, positive integer `width`/`height`, `fileType` from `{"dump","tip"}`)
    - Assert the serialised line parses back to an object with all required fields at correct types
    - Tag: `// Feature: raw-file-upload-pipeline, Property 6: NDJSON done-line structure is complete for all successfully processed files`

- [~] 5. Checkpoint — backend pipeline complete
  - Ensure all backend tests pass, verify `sharp` can be imported inside a Worker Thread in ESM mode, ask the user if questions arise.

- [ ] 6. Extend `POST /api/upload` in `backend/src/server.js` for pre-processed items
  - [~] 6.1 Handle `preProcessed: true` in the upload loop
    - Inside the existing `for (const file of files)` loop in `POST /api/upload`, read `const fileMeta = metadataByName[file.originalname] || {}`
    - Add a branch: if `fileMeta.preProcessed === true`, skip the `Jimp.read` dimension detection and the multer file move; instead use `fileMeta.width`, `fileMeta.height`, `fileMeta.preGeneratedFilepath` as `filepath`, and `fileMeta.pixelDataFilename` as `pixel_data_path`
    - Call `createItem({ id: fileMeta.itemId, filename: fileMeta.itemId, filepath: fileMeta.preGeneratedFilepath, category, subcategory, width: fileMeta.width, height: fileMeta.height, pixel_data_path: fileMeta.pixelDataFilename, ... })` exactly as today for non-pre-processed items
    - For pre-processed items: no multer file is present in `req.files` for that item, so do NOT call `fs.unlink` on a missing file
    - _Requirements: 15.1, 15.2_

  - [~] 6.2 Call correct sub-table helpers for pre-processed items by category
    - After `createItem`, branch on `category`:
      - `"bags"` → call `createBag({ item_id, valid_region_points: fileMeta.valid_region_points || null })`
      - `"threats"` → call `createThreat({ item_id, threat_type: null, severity: null })` then `createNonThreatItem({ item_id, subcategory_slug })`
      - everything else → call `createNonThreatItem({ item_id, subcategory_slug })`
    - Existing PNG path (no `preProcessed`) must remain functionally identical — do not change any logic in that branch
    - _Requirements: 15.3, 15.4, 15.5, 15.6, 17.1_

  - [ ]* 6.3 Write property test for pre-processed commit skipping file I/O (Property 9)
    - **Property 9: Pre-processed items are committed without PNG re-generation**
    - **Validates: Requirements 15.1, 15.2**
    - Use fast-check to generate random pre-processed item payloads across all three categories
    - Mock `createItem`, `createBag`, `createThreat`, `createNonThreatItem`, `Jimp`, and `sharp`; call the handler
    - Assert `createItem` is called with `preGeneratedFilepath`; assert `Jimp` and `sharp` mocks are never called
    - Tag: `// Feature: raw-file-upload-pipeline, Property 9: Pre-processed items are committed without PNG re-generation`

- [~] 7. Extend `StagedItem` type in `frontend/src/context/UploadContext.tsx`
  - Add the following optional fields to the `StagedItem` interface:
    ```ts
    preProcessed?: boolean;
    preGeneratedFilepath?: string;
    fileType?: "dump" | "tip";
    itemId?: string;
    width?: number;
    height?: number;
    pixelDataFilename?: string;
    ```
  - The existing `file`, `category`, `subcategory`, and `valid_region_points` fields are unchanged
  - _Requirements: 13.1, 15.1_

- [~] 8. Update `frontend/src/components/upload/UploadDropZone.tsx`
  - Change the `<input>` element's `accept` attribute from `"image/*"` to `".pgm,.tip,image/*"`
  - Do not change drag-and-drop logic; all dropped files are already passed to `onFilesSelected` without filtering
  - _Requirements: 1.1, 1.2, 17.2_

- [ ] 9. Update `frontend/src/pages/UploadPage.tsx` for raw-file routing and progressive staging
  - [~] 9.1 Add routing detection and processing state
    - Add state: `const [processing, setProcessing] = useState(false)` and `const [processingProgress, setProcessingProgress] = useState<{ n: number; total: number } | null>(null)`
    - Add state: `const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)` and `const [streamErrors, setStreamErrors] = useState<{ id: string; reason: string }[]>([])`
    - In `handleFilesSelected`, detect raw files: `const hasRawFiles = newFiles.some(f => f.name.endsWith(".dump.pgm") || f.name.endsWith(".tip"))`
    - If `hasRawFiles`, call `processRawFiles(newFiles)` instead of the existing staged-panel append; clear `duplicateWarning` and `streamErrors` at the start of each new upload
    - _Requirements: 1.3, 1.4, 12.2_

  - [~] 9.2 Implement `processRawFiles` with Fetch Streams API
    - Create `async function processRawFiles(files: File[])` inside the component
    - Build `FormData` with `files.forEach(f => formData.append("rawFiles", f))`
    - `POST` to `http://localhost:8080/api/process-raw-files`; set `setProcessing(true)` and `setProcessingProgress({ n: 0, total: files.length })`
    - Use `response.body!.getReader()` + `TextDecoder` loop with `{ stream: true }` decode; split accumulated buffer on `"\n"`, keep the last (potentially partial) segment in `buffer`
    - Parse each complete line with `JSON.parse`; skip empty or non-parseable lines
    - _Requirements: 11.1_

  - [~] 9.3 Handle each NDJSON message type in the stream reader
    - `status === "done"`: increment `completed`, call `setProcessingProgress({ n: completed, total })`, call `setStaged(prev => [...prev, { file: new File([], msg.id), category: msg.fileType === "dump" ? "bags" : "non-threats", subcategory: "", valid_region_points: null, preProcessed: true, preGeneratedFilepath: msg.filepath, fileType: msg.fileType, itemId: msg.id, width: msg.width, height: msg.height }])`
    - `status === "error"`: call `setStreamErrors(prev => [...prev, { id: msg.id, reason: msg.reason }])`
    - `status === "complete"`: call `setProcessing(false)`, `setProcessingProgress(null)`; if `msg.duplicates > 0` call `setDuplicateWarning(\`${msg.duplicates} file(s) skipped — already in library\`)`
    - If the stream ends without a `complete` line, call `setProcessing(false)` and show a generic warning
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 12.1_

  - [~] 9.4 Render processing indicator, stream errors, and duplicate warning banner
    - While `processing === true`, render: `<p>Processing files… {processingProgress?.n} / {processingProgress?.total}</p>` (styled similarly to the existing validation message banner)
    - For each entry in `streamErrors`, render an inline amber error badge showing `id: reason`
    - When `duplicateWarning` is set, render a dismissible amber banner with the warning text and an `×` button that calls `setDuplicateWarning(null)`
    - _Requirements: 11.5, 12.1, 12.3_

  - [ ]* 9.5 Write property test for NDJSON stream chunking invariant (Property 7)
    - **Property 7: Stream reader correctly reassembles lines at arbitrary chunk boundaries**
    - **Validates: Requirement 11.1**
    - Extract the chunk-reassembly logic into a pure function `parseNdjsonChunks(chunks: Uint8Array[]): object[]`
    - Use fast-check to generate arrays of NDJSON objects, serialise to bytes, then split at arbitrary byte offsets
    - Assert the parsed objects match the originals regardless of split points
    - Tag: `// Feature: raw-file-upload-pipeline, Property 7: Stream reader correctly reassembles lines at arbitrary chunk boundaries`

- [ ] 10. Update `frontend/src/components/upload/UploadFileQueue.tsx` for pre-processed items
  - [~] 10.1 Render PNG preview from server URL for pre-processed items
    - In the row render inside `staged.map(...)`, replace the unconditional `URL.createObjectURL(file)` call:
      ```ts
      const preview = s.preProcessed
        ? `http://localhost:8080/data/library_images/${s.itemId}.png`
        : URL.createObjectURL(s.file);
      ```
    - Pass `preview` to `<ThumbnailWithRegion src={preview} ... />`
    - _Requirements: 13.1, 13.2_

  - [~] 10.2 Lock category selector for dump items; keep enabled for tip items
    - Add `disabled` to the inline category `<select>` for pre-processed dump items:
      ```ts
      disabled={uploading || (s.preProcessed && s.fileType === "dump")}
      ```
    - For tip items, leave `disabled` dependent only on `uploading` (selector stays enabled, default value `"non-threats"` already set in step 9.3)
    - Add `disabled` to the subcategory `<select>` for pre-processed dump items similarly: `disabled={uploading || !s.category || (s.preProcessed && s.fileType === "dump")}`
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [~] 10.3 Ensure valid region button is available for bag items regardless of source
    - The existing `{isBags ? <button>Set/Edit</button> : <span>—</span>}` already drives off `s.category === "bags"`; since dump items are staged with `category: "bags"`, no extra logic is needed — verify this renders correctly and add a comment confirming intentional shared path
    - _Requirements: 14.1, 14.2_

  - [ ]* 10.4 Write property test for preview URL format (Property 10)
    - **Property 10: Preview URL is derived from itemId for all pre-processed staged items**
    - **Validates: Requirement 13.1**
    - Use fast-check to generate arbitrary `itemId` strings
    - Shallow-render `UploadFileQueue` with a pre-processed staged item; assert the `src` on the `<canvas>` image load equals `"http://localhost:8080/data/library_images/" + itemId + ".png"`
    - Tag: `// Feature: raw-file-upload-pipeline, Property 10: Preview URL is derived from itemId for all pre-processed staged items`

  - [ ]* 10.5 Write property test for category assignment by file type (Property 8)
    - **Property 8: Category is determined by file type for all pipeline items**
    - **Validates: Requirements 10.1, 10.2**
    - Use fast-check with `fc.constantFrom("dump", "tip")` as the arbitrary
    - Assert staged items produced in step 9.3 have `category === "bags"` when `fileType === "dump"` and `category === "non-threats"` when `fileType === "tip"`
    - Tag: `// Feature: raw-file-upload-pipeline, Property 8: Category is determined by file type for all pipeline items`

- [ ] 11. Extend `doUpload` in `frontend/src/pages/UploadPage.tsx` for pre-processed metadata
  - [~] 11.1 Modify `FormData` construction in `doUpload`
    - Change the `formData.append("images", s.file)` loop to: `staged.forEach(s => { if (!s.preProcessed) formData.append("images", s.file); })`
    - Change metadata construction to include pre-processed fields:
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
      ```
    - The `folderName` append and the `POST` fetch call are unchanged
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [~] 11.2 Verify non-pre-processed PNG path is unchanged
    - Confirm that when `s.preProcessed` is falsy, `s.file` is appended to `FormData` as before and `originalname` is `s.file.name`
    - No logic change required — this is a verification step; add an inline comment `// Existing PNG path: unchanged` in the code
    - _Requirements: 15.6, 17.1, 17.3_

- [~] 12. Final checkpoint — Ensure all tests pass
  - Run the full test suite (`npm test` in both `backend/` and `frontend/`)
  - Verify a real `.dump.pgm` file and a real `.tip` file can be uploaded end-to-end: PNG written to `library_images/`, pixel JSON written to `pixel_data/`, items appear in `GET /api/items/categorized`
  - Verify a standard PNG upload still works without regression
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP delivery
- `dumpRead.js` and `tipRead.js` are CommonJS; use `createRequire` in the ESM worker — do not convert the readers
- `ReadDump` returns `[high, low, R, rows, cols]`; use index 0 (`high`) as the pixel array and the 4th/5th return values for dimensions
- `read_tip` (the function exported by `tipRead.js`) returns `[low_raw, high_raw]`; use index 1 (`high_raw`) as the pixel array
- The `dumpRead.js` already contains `to_uint16` and `save_array_png_16bit` implementations that can be referenced as blueprints but the worker must implement its own copy to avoid CJS/ESM boundary issues with `sharp`
- For the `sharp` import inside the worker, a plain `import sharp from "sharp"` works in ESM workers; the `createRequire` bridge is only needed for the CJS reader modules
- The `workerPool.js` drain mechanism should terminate workers after all tasks complete to free memory between requests
- Property tests are tagged for traceability back to design properties and requirement clauses

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "3.1"] },
    { "id": 1, "tasks": ["2.2", "3.2"] },
    { "id": 2, "tasks": ["2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "4.5", "4.6", "4.7", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7", "8"] },
    { "id": 6, "tasks": ["9.1", "9.2"] },
    { "id": 7, "tasks": ["9.3"] },
    { "id": 8, "tasks": ["9.4", "9.5", "10.1"] },
    { "id": 9, "tasks": ["10.2", "10.3", "11.1"] },
    { "id": 10, "tasks": ["10.4", "10.5", "11.2"] }
  ]
}
```
