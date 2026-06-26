# Requirements Document

## Introduction

This feature changes the upload flow to accept raw `.dump.pgm` and `.tip` sensor files alongside the existing PNG image flow. The backend parses each file, extracts pixel data, and generates a 16-bit grayscale PNG. Results are streamed back to the frontend progressively via NDJSON so that staged items appear one-by-one as processing completes, enabling fast ingestion of large batches (1 000+ files). The existing PNG upload flow is preserved entirely.

## Glossary

- **Pipeline**: The end-to-end flow from raw file upload through pixel extraction, PNG generation, and storage.
- **Raw File**: A `.dump.pgm` or `.tip` sensor capture file that must be processed before storage.
- **Item ID**: The filename stripped of all extensions (e.g. `P01X010-2024101200923.dump.pgm` → `P01X010-2024101200923`).
- **DumpReader**: The existing `dumpRead.js` module that parses `.dump.pgm` files and exposes the `ReadDump` function.
- **TipReader**: The existing `tipRead.js` module that parses `.tip` files and exposes the `readTip` function (returns `[low_raw, high_raw]`).
- **Pixel Array**: A 2-D array of 16-bit unsigned integer values extracted from a raw file; used as the source for PNG generation.
- **PNG Generator**: The `sharp` library used to encode a Pixel Array into a 16-bit grayscale PNG file.
- **Worker Pool**: A pool of 4 Node.js Worker Threads that process raw files in parallel.
- **NDJSON Stream**: A chunked HTTP response where each line is a self-contained JSON object terminated by a newline character.
- **Staged Panel**: The frontend UI table that lists items queued for final commit to the library.
- **Processing Indicator**: The frontend UI element that shows progress (e.g., "Processing files… 347 / 1 000") while the NDJSON stream is active.
- **Duplicate**: A file whose derived Item ID already exists in `items.json`.
- **Library**: The persistent item store backed by `backend/data/items.json` and managed through `storage.js`.
- **Pre-processed Item**: An item whose PNG and pixel data JSON were created by the Pipeline before the final commit step.

---

## Requirements

### Requirement 1: Raw File Acceptance in the Drop Zone

**User Story:** As an operator, I want to drag and drop `.dump.pgm` and `.tip` files into the upload area, so that I can submit raw sensor captures without manual conversion.

#### Acceptance Criteria

1. THE `UploadDropZone` component SHALL accept files whose extensions are `.pgm`, `.tip`, and any image format accepted today (`image/*`), via both the file input `accept` attribute and drag-and-drop validation.
2. WHEN a user selects or drops a mixed set of raw files and PNG images, THE `UploadDropZone` component SHALL pass all selected files to the `onFilesSelected` callback without filtering.
3. WHEN the selected files include at least one `.dump.pgm` or `.tip` file, THE `UploadPage` SHALL route all selected files (including any co-submitted PNG/image files) to the raw-file processing flow (`POST /api/process-raw-files`).
4. WHEN all selected files are PNG or other image files with no `.dump.pgm` or `.tip` files present, THE `UploadPage` SHALL route those files through the existing `POST /api/upload` flow unchanged.

---

### Requirement 2: Item ID Derivation

**User Story:** As a data engineer, I want item IDs derived deterministically from filenames, so that records are traceable back to their source files.

#### Acceptance Criteria

1. THE Pipeline SHALL derive the Item ID by removing all extensions from the original filename, stripping everything from the first dot onwards: for `P01X010-2024101200923.dump.pgm` the Item ID SHALL be `P01X010-2024101200923`, and for `P01X010-2024101200923.tip` the Item ID SHALL also be `P01X010-2024101200923`.

---

### Requirement 3: Duplicate Detection Before Processing

**User Story:** As an operator, I want duplicates detected before processing starts, so that no compute time is wasted on files already in the library.

#### Acceptance Criteria

1. WHEN `POST /api/process-raw-files` is called, THE Pipeline SHALL read `items.json` once and collect all existing Item IDs into an in-memory set before dispatching any worker task.
2. WHEN an incoming file's derived Item ID is found in the existing-ID set, THE Pipeline SHALL skip that file entirely — no parsing, no PNG generation, no pixel-data write.
3. WHEN one or more duplicates are detected, THE Pipeline SHALL include each duplicate's Item ID in the `duplicates` array of the final NDJSON summary line.
4. THE Pipeline SHALL NOT modify or overwrite any existing item record when a duplicate is detected.

---

### Requirement 4: Parallel Processing with Worker Threads

**User Story:** As an operator uploading 1 000+ files, I want processing to use parallel workers, so that the batch completes in minimal wall-clock time.

#### Acceptance Criteria

1. THE Worker Pool SHALL maintain exactly 4 concurrent Worker Threads for processing raw files.
2. WHEN a non-duplicate raw file is dispatched, THE Worker Pool SHALL assign it to the next available worker thread.
3. WHEN all 4 worker slots are occupied, THE Worker Pool SHALL queue additional files and dispatch them as workers become free.
4. WHEN a worker finishes a file, THE Worker Pool SHALL immediately post the result back to the main thread so the NDJSON stream can be written without waiting for the remaining workers.

---

### Requirement 5: Parsing `.dump.pgm` Files

**User Story:** As a backend developer, I want `.dump.pgm` files parsed via `DumpReader`, so that the correct pixel channel is used for PNG generation.

#### Acceptance Criteria

1. WHEN a worker processes a `.dump.pgm` file, THE worker SHALL invoke `ReadDump(filePath)` from `dumpRead.js` and use the returned `high` array as the Pixel Array.
2. WHEN `ReadDump` throws an error, THE worker SHALL catch the error and post an error result `{ status: "error", reason: <error message> }` back to the main thread without crashing the worker.
3. THE worker SHALL derive image dimensions from the Pixel Array: `width = high[0].length`, `height = high.length` when `high` is a 2-D array, or `width = cols`, `height = rows` when it is a flat typed array with separate dimension metadata from `ReadDump`.

---

### Requirement 6: Parsing `.tip` Files

**User Story:** As a backend developer, I want `.tip` files parsed via `TipReader`, so that the correct pixel channel is used for PNG generation.

#### Acceptance Criteria

1. WHEN a worker processes a `.tip` file, THE worker SHALL invoke `readTip(filePath)` from `tipRead.js` and use the returned `high_raw` array as the Pixel Array.
2. WHEN `readTip` throws an error or an uncaught exception propagates from within the worker, THE worker SHALL catch the error via a top-level `try/catch` and post an error result `{ status: "error", reason: <error message> }` back to the main thread without crashing the worker process.
3. THE worker SHALL derive image dimensions from the `high_raw` array returned by `readTip`.

---

### Requirement 7: 16-bit Grayscale PNG Generation

**User Story:** As a data engineer, I want lossless 16-bit grayscale PNGs generated from the pixel arrays, so that full sensor dynamic range is preserved.

#### Acceptance Criteria

1. WHEN a Pixel Array is available, THE PNG Generator SHALL encode it as a 16-bit grayscale PNG using `sharp` with raw input (`channels: 1`) and `toColourspace("grey16")`.
2. THE PNG Generator SHALL convert each floating-point pixel value to a `uint16` by clamping to `[0, 65535]` and rounding to the nearest integer before passing the buffer to `sharp`.
3. THE PNG Generator SHALL write the output PNG to `data/library_images/{itemId}.png`.
4. THE PNG Generator SHALL write pixel values in big-endian byte order in the raw buffer passed to `sharp`, as required by the PNG specification. THE PNG Generator SHALL treat input Pixel Arrays as already containing correct numeric values and SHALL automatically convert them to big-endian byte order during buffer construction, regardless of platform endianness.
5. IF the output directory `data/library_images` does not exist, THEN THE PNG Generator SHALL create it recursively before writing.

---

### Requirement 8: Pixel Data JSON Storage

**User Story:** As a data engineer, I want pixel data saved as JSON alongside the PNG, so that downstream tools can access raw numeric values.

#### Acceptance Criteria

1. WHEN a PNG is successfully generated, THE Pipeline SHALL serialize the Pixel Array to JSON and write it to `data/pixel_data/pre_{uuid}.json`, where `{uuid}` is a newly generated UUID v4. IF the JSON write fails, THEN THE Pipeline SHALL treat the entire file as a pipeline failure, discard the already-written PNG, and report an error result for that file.
2. THE Pipeline SHALL record the pixel data filename (e.g., `pre_abc123.json`) in the item record that is later written to `items.json` as the `pixel_data_path` field.

---

### Requirement 9: NDJSON Streaming Response

**User Story:** As a frontend developer, I want a streaming HTTP response for the processing endpoint, so that the UI can update progressively without waiting for all files to finish.

#### Acceptance Criteria

1. THE `POST /api/process-raw-files` endpoint SHALL respond with HTTP 200 and `Content-Type: application/x-ndjson` immediately upon receiving the request, before any file is processed.
2. WHEN a file finishes processing successfully, THE Pipeline SHALL write the following JSON line to the response stream: `{ "id": "<itemId>", "filepath": "<itemId>.png", "width": <width>, "height": <height>, "fileType": "dump" | "tip", "status": "done" }` followed by a newline character (`\n`).
3. WHEN a file fails processing, THE Pipeline SHALL write the following JSON line to the response stream: `{ "id": "<itemId>", "status": "error", "reason": "<error message>" }` followed by a newline character (`\n`).
4. WHEN all files have been processed, THE Pipeline SHALL write the following final JSON line and then end the response: `{ "status": "complete", "total": <total>, "processed": <processed>, "duplicates": <duplicateCount>, "failed": <failedCount> }` followed by a newline character (`\n`).
5. THE Pipeline SHALL NOT buffer result lines — each line SHALL be flushed to the HTTP response as soon as it is produced.

---

### Requirement 10: Category Assignment Rules

**User Story:** As an operator, I want categories assigned automatically by file type, so that I don't need to manually categorise bags.

#### Acceptance Criteria

1. WHEN a `.dump.pgm` file is processed, THE Pipeline SHALL assign `category = "bags"` to the resulting item and this assignment SHALL NOT be overridable by the user.
2. WHEN a `.tip` file is processed, THE Pipeline SHALL assign `category = "non-threats"` as the default category for the resulting item.
3. WHEN a `.tip` item is staged in the Staged Panel, THE `UploadFileQueue` component SHALL display the category selector in an enabled state, allowing the user to change the category to `"threats"`.
4. WHEN a `.dump.pgm` item is staged in the Staged Panel, THE `UploadFileQueue` component SHALL display the category selector in a disabled state locked to `"bags"`.

---

### Requirement 11: Progressive Staging in the Frontend

**User Story:** As an operator, I want items to appear in the staged panel as each file finishes processing, so that I can review and configure items before the full batch completes.

#### Acceptance Criteria

1. WHEN the frontend sends files to `POST /api/process-raw-files`, THE `UploadPage` component SHALL read the NDJSON response stream progressively using the Fetch Streams API (`response.body.getReader()`).
2. WHEN a `{ status: "done" }` line is parsed from the stream, THE `UploadPage` component SHALL append a new staged item to the Staged Panel immediately, without waiting for the next line.
3. WHEN a `{ status: "error" }` line is parsed from the stream, THE `UploadPage` component SHALL display an inline error notification for that item and continue processing the stream.
4. WHEN a `{ status: "complete" }` line is parsed from the stream, THE `UploadPage` component SHALL stop the Processing Indicator and display the final summary.
5. WHILE the NDJSON stream is active, THE Processing Indicator SHALL display the text "Processing files… {n} / {total}" where `n` is the count of completed lines received so far and `total` is the total number of files submitted.

---

### Requirement 12: Duplicate Warning Banner

**User Story:** As an operator, I want a clear warning when files are skipped as duplicates, so that I understand why my library count is lower than the files I submitted.

#### Acceptance Criteria

1. WHEN the `{ status: "complete" }` line contains `duplicates > 0`, THE `UploadPage` component SHALL display a warning banner with the text "{N} file(s) skipped — already in library".
2. THE warning banner SHALL disappear immediately when the user dismisses it or when a new upload is initiated.
3. WHILE the warning banner is visible and `duplicates > 0`, THE warning banner SHALL be styled with an amber/yellow colour scheme, distinct from error notifications.

---

### Requirement 13: PNG Preview in the Staged Panel

**User Story:** As an operator, I want to see a thumbnail of the generated PNG in the staged panel, so that I can visually confirm the image looks correct before committing.

#### Acceptance Criteria

1. WHEN a staged item produced by the Pipeline is displayed in the Staged Panel, THE `UploadFileQueue` component SHALL render the PNG preview by loading the image from `http://localhost:8080/data/library_images/{itemId}.png`.
2. THE PNG preview SHALL be displayed at approximately 96 × 96 pixels (within 5 pixels of that size in each dimension) to match the thumbnail area used by existing PNG staged items.
3. WHEN the PNG file is not yet available (e.g., still generating), THE `UploadFileQueue` component SHALL display a placeholder until the image loads.

---

### Requirement 14: Valid Region Editor Availability

**User Story:** As an operator, I want the valid region editor available for bag items produced from `.dump.pgm` files, so that I can define placement regions for synthesised images.

#### Acceptance Criteria

1. WHEN a staged item has `category = "bags"`, THE `UploadFileQueue` component SHALL display the "Set / Edit" valid-region button in the Valid Region column, regardless of whether the item originated from a PNG or a `.dump.pgm` file.
2. WHEN a staged item has `category = "threats"` or `category = "non-threats"`, THE `UploadFileQueue` component SHALL display a `—` placeholder in the Valid Region column.

---

### Requirement 15: Final Commit to the Library

**User Story:** As an operator, I want to press Upload after reviewing staged items to commit them permanently to the library, so that I control when items become available for collage generation.

#### Acceptance Criteria

1. WHEN the operator clicks the Upload button for a batch that includes pre-processed items, THE `POST /api/upload` endpoint SHALL accept a `preProcessed` flag or field per item indicating the PNG and pixel data already exist on disk.
2. WHEN `preProcessed = true` for an item, THE `POST /api/upload` endpoint SHALL write the item record to `items.json` (via `createItem`) without re-uploading or re-generating the PNG.
3. WHEN `preProcessed = true` and `category = "bags"`, THE `POST /api/upload` endpoint SHALL call `createBag` with any `valid_region_points` supplied in the request body.
4. WHEN `preProcessed = true` and `category = "threats"`, THE `POST /api/upload` endpoint SHALL call `createThreat` for the item.
5. WHEN `preProcessed = true` and `category = "non-threats"`, THE `POST /api/upload` endpoint SHALL call `createNonThreatItem` for the item.
6. THE existing PNG upload path (items without `preProcessed = true`) SHALL continue to work exactly as it does today, with no behavioural changes.

---

### Requirement 16: `sharp` Dependency in the Backend

**User Story:** As a backend developer, I want `sharp` declared in `backend/package.json`, so that the dependency is installed when the backend is bootstrapped.

#### Acceptance Criteria

1. THE `backend/package.json` `dependencies` section SHALL include `"sharp"` with a pinned version compatible with the `sharp` version already present in the root `package.json`.
2. WHEN `npm install` is run inside the `backend/` directory, THE `sharp` package SHALL be available for import in ESM worker and server files.

---

### Requirement 17: Preservation of the Existing PNG Upload Flow

**User Story:** As an operator who currently uploads PNG images, I want the existing flow to be completely unchanged, so that my existing workflows are not disrupted.

#### Acceptance Criteria

1. THE `POST /api/upload` endpoint SHALL continue to accept multipart PNG file uploads and process them exactly as it does today.
2. THE `UploadDropZone` component SHALL continue to accept `image/*` files and pass them through to the existing PNG staging flow.
3. THE `UploadFileQueue` component SHALL continue to display category selectors, subcategory selectors, and valid-region editors for PNG-sourced staged items, with no change in behaviour.
4. THE Library, Collage, Customization, and Saved pages SHALL remain untouched by this feature.
