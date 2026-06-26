/**
 * Convert .tip files from guns/knife folders to 16-bit lossless PNGs.
 *
 * - Synthesized images → extracted_synthesis/guns/ and .../knife/  (16-bit PNG, no pixel loss)
 * - High/low channel images → extracted_files_low_high/guns/ and .../knife/ (16-bit PNG, no pixel loss)
 *
 * Dependencies:
 *   npm install pngjs
 *
 * Usage:
 *   node convert_tip_to_png.js
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

// ──────────────────────────────────────────────
// .tip file reader  (P5 PGM parser, mirrors tipread.py)
// ──────────────────────────────────────────────

/**
 * Read a .tip file and return [low_raw, high_raw] as Uint16Array (row-major).
 * Layout in file: each pixel pair is [high_uint16_LE, low_uint16_LE], interleaved.
 * Image dimensions: rows = height, cols = width / 2
 *
 * @param {string} filename
 * @returns {[low_raw: Uint16Array, high_raw: Uint16Array]}
 */
function read_tip(filename) {
  const buf = fs.readFileSync(filename);
  let offset = 0;

  // Helper: read one ASCII text line from buffer
  function readLine() {
    let line = "";
    while (offset < buf.length) {
      const ch = String.fromCharCode(buf[offset++]);
      if (ch === "\n") break;
      line += ch;
    }
    return line.trim();
  }

  // 1) Magic line
  const magic = readLine();
  if (magic !== "P5") throw new Error(`Not a valid P5 PGM file: got "${magic}"`);

  // 2) Dimension line (skip comment lines starting with '#')
  let dimLine = "";
  while (true) {
    dimLine = readLine();
    if (!dimLine.startsWith("#")) break;
  }
  const [width, height] = dimLine.split(/\s+/).map(Number);

  // 3) Maxval line (skip comments)
  let maxLine = "";
  while (true) {
    maxLine = readLine();
    if (!maxLine.startsWith("#")) break;
  }
  const maxval = parseInt(maxLine, 10);
  if (maxval !== 65535) throw new Error(`Expected maxval 65535, got ${maxval}`);

  // 4) Binary pixel data
  // Python iterates: rows × cols, reading 2 bytes for high then 2 bytes for low
  const rows = height;
  const cols = width / 2;           // interleaved: actual image width is half the PGM width
  const high_raw = new Uint16Array(rows * cols);
  const low_raw  = new Uint16Array(rows * cols);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      // Each "pixel" in the PGM stores two 16-bit LE values: high then low
      high_raw[i * cols + j] = buf.readUInt16LE(offset);     offset += 2;
      low_raw [i * cols + j] = buf.readUInt16LE(offset);     offset += 2;
    }
  }

  return [low_raw, high_raw];
}

// ──────────────────────────────────────────────
// 270° rotation  (matches np.rot90(arr, k=3))
// np.rot90(arr, k=3) = rotate 270° CCW = 90° CW
//   output shape: (cols, rows)
//   out[j][rows-1-i] = src[i][j]  →  out[j * rows + (rows-1-i)] = src[i * cols + j]
// ──────────────────────────────────────────────

/**
 * Rotate a flat uint16 image 270° counter-clockwise (= 90° clockwise).
 *
 * @param {Uint16Array} src   Row-major, shape (rows × cols)
 * @param {number}      rows
 * @param {number}      cols
 * @returns {{ data: Uint16Array, rows: number, cols: number }}
 *   Output shape is (cols × rows) — i.e. new rows = cols, new cols = rows
 */
function rot270(src, rows, cols) {
  // Output dimensions after 90° CW rotation
  const outRows = cols;
  const outCols = rows;
  const dst = new Uint16Array(outRows * outCols);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      // np.rot90(k=3): dst[j, rows-1-i] = src[i, j]
      const dstRow = j;
      const dstCol = rows - 1 - i;
      dst[dstRow * outCols + dstCol] = src[i * cols + j];
    }
  }

  return { data: dst, rows: outRows, cols: outCols };
}

// ──────────────────────────────────────────────
// 16-bit grayscale PNG writer  (uses pngjs)
// pngjs stores pixels as RGBA 8-bit internally; for 16-bit we write raw chunks.
// ──────────────────────────────────────────────

/**
 * Write a Uint16Array as a 16-bit grayscale PNG file.
 * Uses pngjs with colorType=0 (grayscale), bitDepth=16.
 *
 * @param {string}      outPath
 * @param {Uint16Array} pixels   Row-major pixel data
 * @param {number}      width
 * @param {number}      height
 */
function write16bitPng(outPath, pixels, width, height) {
  const png = new PNG({ width, height, colorType: 0, bitDepth: 16, inputColorType: 0, inputHasAlpha: false });

  // pngjs expects its data buffer to be filled with big-endian 16-bit samples.
  // For colorType=0 bitDepth=16 there are width*height*2 bytes.
  const buf = Buffer.alloc(width * height * 2);
  for (let idx = 0; idx < pixels.length; idx++) {
    buf.writeUInt16BE(pixels[idx], idx * 2);
  }
  png.data = buf;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, PNG.sync.write(png));
}

// ──────────────────────────────────────────────
// Conversion routine  (mirrors convert_tip_to_png())
// ──────────────────────────────────────────────

/**
 * @param {string} inputRoot      Directory containing .tip files
 * @param {string} synthesisRoot  Output dir for synthesized images
 * @param {string} lowhighRoot    Output dir for high/low channel images
 */
function convert_tip_to_png(inputRoot, synthesisRoot, lowhighRoot) {
  inputRoot     = path.resolve(inputRoot);
  synthesisRoot = path.resolve(synthesisRoot);
  lowhighRoot   = path.resolve(lowhighRoot);

  synthesisRoot.mkdirSync(synthesisRoot, { recursive: true });
  lowhighRoot.mkdirSync(lowhighRoot,   { recursive: true });

  const tipFiles = fs.readdirSync(inputRoot)
    .filter(f => f.toLowerCase().endsWith(".tip"))
    .sort();

  if (tipFiles.length === 0) {
    console.log(`No .tip files found in ${inputRoot}`);
    return;
  }

  for (const fname of tipFiles) {
    const srcPath = path.join(inputRoot, fname);
    const [low_raw, high_raw] = read_tip(srcPath);

    // Apply 270° rotation (matching np.rot90(arr, k=3))
    const hi_rot = rot270(high_raw, Math.sqrt(high_raw.length), Math.sqrt(high_raw.length));
    const lo_rot = rot270(low_raw, Math.sqrt(low_raw.length), Math.sqrt(low_raw.length));

    const baseName = path.basename(fname, ".tip");

    // 1) Synthesised image → extracted_synthesis/ (16-bit PNG, preserve all values)
    const synPath = path.join(synthesisRoot, `${baseName}.png`);
    fs.mkdirSync(path.dirname(synPath), { recursive: true });
    write16bitPng(synPath, hi_rot.data, hi_rot.cols, hi_rot.rows);

    // 2) High/low channel images → extracted_files_low_high/ (16-bit lossless)
    const high_out = path.join(lowhighRoot, `${baseName}_high.png`);
    const low_out  = path.join(lowhighRoot, `${baseName}_low.png`);
    fs.mkdirSync(path.dirname(high_out), { recursive: true });
    fs.mkdirSync(path.dirname(low_out), { recursive: true });
    write16bitPng(high_out, hi_rot.data, hi_rot.cols, hi_rot.rows);  // hi_rot is already uint16
    write16bitPng(low_out,  lo_rot.data, lo_rot.cols, lo_rot.rows);   // lo_rot is already uint16

    console.log(`  ${fname} -> ${path.basename(synPath)}, ${path.basename(high_out)}, ${path.basename(low_out)}  (16-bit lossless)`);
  }

  console.log(`\nDone. Converted ${tipFiles.length} .tip files from ${inputRoot}`);
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────
const base = path.resolve(__dirname);          // directory containing this script
const root = path.resolve(base, "..");         // one level up (same as base.parent in Python)

for (const category of ["guns", "knife"]) {
  const srcDir = path.join(base, category);
  if (!fs.existsSync(srcDir)) continue;

  console.log("=".repeat(60));
  console.log(`PROCESSING ${category}/`);
  console.log("=".repeat(60));

  convert_tip_to_png(
    srcDir,
    path.join(root, "extracted_synthesis",      category),
    path.join(root, "extracted_files_low_high", category),
  );
}

console.log("\nAll done!");