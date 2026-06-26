#!/usr/bin/env node
/**
 * dumpread.js
 *
 * Exact JavaScript port of dumpread.py
 *
 * Version Info
 */
const DUMPREAD_MAJOR_REVISION = "1.0";
const DUMPREAD_MINOR_VERSION  = "0.0.1";
const DUMPREAD_VERSION_DATE   = "20240917";

const fs   = require("fs");
const path = require("path");
const sharp = require("sharp");

// ---------------------------------------------------------------------------
// ReadDump
// ---------------------------------------------------------------------------
/**
 * Read a .dump.pgm file and return arrays [high, low, R] (or [high, low, high_raw, low_raw]
 * when raw=true).
 *
 * All arrays are plain Float64Arrays laid out row-major: index = i*cols + j
 *
 * @param {string}  filename
 * @param {boolean} [raw=false]
 * @param {boolean} [FlippedAndRotated=false]
 * @param {boolean} [DenoiseRequired=false]
 * @returns {[high, low, R, rows, cols] | [high, low, high_raw, low_raw]}
 */
function ReadDump(filename, raw = false, FlippedAndRotated = false, DenoiseRequired = false) {
  const buf = fs.readFileSync(filename);
  let pos = 0;

  // ---- helpers for reading text lines from the buffer ----
  function readLine() {
    const start = pos;
    while (pos < buf.length && buf[pos] !== 0x0a) pos++;
    const line = buf.slice(start, pos).toString("ascii");
    if (pos < buf.length) pos++; // consume '\n'
    return line;
  }

  // ---- header ----
  const gate = readLine().trim();                       // e.g. "P5"
  const dims = readLine().trim().split(/\s+/);
  const cols = parseInt(dims[0], 10) / 2;              // width / 2  (interleaved high+low)
  const rows = parseInt(dims[1], 10);
  readLine();                                           // maxval line

  // ---- comment block — scan for "denoised" flag ----
  let check_denoise = false;
  let line = readLine();

  while (true) {
    if (line.charCodeAt(0) === 0x23 /* '#' */) {
      line = readLine();
      if (line === undefined || pos >= buf.length) break;
      if (line.includes("denoised")) {
        check_denoise = !line.includes("denoised=0");
      }
    } else {
      break;
    }
  }
  // At this point `line` holds the first non-comment line (consumed above).
  // The binary pixel data starts at `pos` (after that line was read).

  // ---- processed data (high / low interleaved) ----
  const high = new Float64Array(rows * cols);
  const low  = new Float64Array(rows * cols);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      high[i * cols + j] = buf.readUInt16LE(pos);  pos += 2;
      low [i * cols + j] = buf.readUInt16LE(pos);  pos += 2;
    }
  }

  // ---- skip to "#Raw Data Dump" sentinel ----
  while (true) {
    const l = readLine();
    if (l.trim() === "#Raw Data Dump") break;
  }

  // ---- raw data ----
  const high_raw = new Float64Array(rows * cols);
  const low_raw  = new Float64Array(rows * cols);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      high_raw[i * cols + j] = buf.readUInt16LE(pos);  pos += 2;
      low_raw [i * cols + j] = buf.readUInt16LE(pos);  pos += 2;
    }
  }

  // ---- compute R ----
  const R = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const idx = i * cols + j;
      const h = high[idx];
      const l = low[idx];

      if (l < 60000 && l !== 0 && h !== 0) {
        R[idx] = Math.log(h / 65535) / Math.log(l / 65535);
      } else if (l === 0) {
        R[idx] = 0;
      } else if (h === 0) {
        R[idx] = 0;
      } else if (l >= 60000) {
        R[idx] = Infinity;
      }
    }
  }

  // ---- denoiseRequired stub ----
  // Note: Python version has the import commented out: #from denoise import LVstPMGuidedDenoise
  // So we just skip this check to match Python behavior

  if (raw == true) {
    return [high, low, high_raw, low_raw];
  }

  if (FlippedAndRotated == true) {
    console.log("The Image is flipped and Rotated");
    return [flipTranspose(high, rows, cols), flipTranspose(low, rows, cols), flipTranspose(R, rows, cols), rows, cols];
  }
  else {
    console.log("The Image is Not flipped and Rotated");
    return [high, low, R, rows, cols];
  }
}

// ---------------------------------------------------------------------------
// flipTranspose  — equivalent to cv2.flip(np.transpose(arr), 1)
//   np.transpose on a 2D array swaps axes → (cols, rows) shaped output
//   cv2.flip(..., 1) flips left-right
// ---------------------------------------------------------------------------
function flipTranspose(arr, rows, cols) {
  // After transpose: new shape is (cols, rows)
  const out = new Float64Array(cols * rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      // transposed[j, i] then flip horizontally → transposed[j, (rows-1-i)]
      out[j * rows + (rows - 1 - i)] = arr[i * cols + j];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// to_uint16  — clip float64 values to [0, 65535] and return a Uint16Array
// ---------------------------------------------------------------------------
function to_uint16(arr) {
  const out = new Uint16Array(arr.length);
  for (let k = 0; k < arr.length; k++) {
    out[k] = Math.min(65535, Math.max(0, Math.round(arr[k])));
  }
  return out;
}

// ---------------------------------------------------------------------------
// save_array_png_16bit  — save a float64 array as a 16-bit greyscale PNG
// Returns a Promise<void>.
// ---------------------------------------------------------------------------
async function save_array_png_16bit(arr, filePath, rows, cols) {
  const uint16 = to_uint16(arr);

  // Convert to big-endian (network byte order) as required by PNG spec
  const beBuf = Buffer.allocUnsafe(uint16.length * 2);
  for (let k = 0; k < uint16.length; k++) {
    beBuf.writeUInt16BE(uint16[k], k * 2);
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  await sharp(beBuf, {
    raw: { width: cols, height: rows, channels: 1 },
  })
    .toColourspace("grey16")   // sharp internal: 16-bit grey
    .png({ compressionLevel: 6 })
    .toFile(filePath);
}

// ---------------------------------------------------------------------------
// convert_dump_to_png
// ---------------------------------------------------------------------------
/**
 * @param {string} inputRoot
 * @param {string} outputRoot
 * @param {string} channelRoot
 * @param {"high"|"low"|"R"} [source="high"]
 */
async function convert_dump_to_png(inputRoot, outputRoot, channelRoot, source = "high") {
  inputRoot   = path.resolve(inputRoot);
  outputRoot  = path.resolve(outputRoot);
  channelRoot = path.resolve(channelRoot);

  fs.mkdirSync(outputRoot,  { recursive: true });
  fs.mkdirSync(channelRoot, { recursive: true });

  const paths = rglob(inputRoot, /\.dump\.pgm$/);

  if (paths.length === 0) {
    console.log(`No .dump.pgm files found under ${inputRoot}`);
    return;
  }

  for (const srcPath of paths.sort()) {
    const relPath  = path.relative(inputRoot, srcPath);
    const baseName = path.basename(srcPath).slice(0, -".dump.pgm".length); // strip suffix
    const outName  = baseName + ".png";
    const outPath  = path.join(outputRoot, path.dirname(relPath), outName);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const [high, low, R, rows, cols] = ReadDump(srcPath, false);
    const imageArray = source === "high" ? high : source === "low" ? low : R;

    try {
      await save_array_png_16bit(imageArray, outPath, rows, cols);
      console.log(`Converted ${srcPath} -> ${outPath}  (16-bit lossless)`);
    } catch (e) {
      console.log(`Failed to save ${outPath}: ${e.message}`);
    }

    for (const [channelName, channelArray] of [["high", high], ["low", low]]) {
      const channelPath = path.join(
        channelRoot,
        path.dirname(relPath),
        `${baseName}_${channelName}.png`
      );
      try {
        await save_array_png_16bit(channelArray, channelPath, rows, cols);
        console.log(`Saved ${channelName} channel ${srcPath} -> ${channelPath}  (16-bit lossless)`);
      } catch (e) {
        console.log(`Failed to save ${channelName} channel ${channelPath}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Converted ${paths.length} files to ${outputRoot} and saved high/low channels to ${channelRoot}`);
}

// ---------------------------------------------------------------------------
// rglob — recursive file search (equivalent to Path.rglob)
// ---------------------------------------------------------------------------
function rglob(dir, pattern) {
  const results = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// CLI  — mirrors the argparse block in the Python original
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);

  function getArg(flag, defaultVal) {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : defaultVal;
  }

  const scriptDir = path.dirname(path.resolve(__filename));

  const inputRoot   = getArg("--input-root",   scriptDir);
  const outputRoot  = getArg("--output-root",  path.join(scriptDir, "..", "extracted_synthesis"));
  const channelRoot = getArg("--channel-root", path.join(scriptDir, "..", "extracted_files_low_high"));
  const source      = getArg("--source",       "high");

  if (!["high", "low", "R"].includes(source)) {
    console.error(`--source must be one of: high, low, R`);
    process.exit(1);
  }

  convert_dump_to_png(inputRoot, outputRoot, channelRoot, source).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exports (for use as a module)
// ---------------------------------------------------------------------------
module.exports = {
  ReadDump,
  to_uint16,
  save_array_png_16bit,
  convert_dump_to_png,
};