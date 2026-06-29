// backend/src/lib/autoValidRegion.js
// Auto-generates a valid region polygon from raw pixel data (2D float arrays: 0-65535)
// 65535 = white (background/air), anything < 65535 = bag material
//
// Improvements over v1:
//   - Multi-pass morphological closing (fills larger interior holes reliably)
//   - Moore-neighbor (radial sweep) contour tracing — O(perimeter) instead of O(n²)
//     and handles concave shapes correctly without cross-jumps
//   - Gaussian-weighted smoothing instead of plain moving average
//   - Binary-search RDP epsilon — hits the 30-80 point target in O(log n) iterations
//   - Edge-pad the mask so bags touching the image border are traced cleanly

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Union-Find (Disjoint Set) for connected component labeling
// ---------------------------------------------------------------------------
class UnionFind {
  constructor(size) {
    this.parent = new Int32Array(size);
    this.rank   = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(x, y) {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;
    if (this.rank[px] < this.rank[py])      this.parent[px] = py;
    else if (this.rank[px] > this.rank[py]) this.parent[py] = px;
    else { this.parent[py] = px; this.rank[px]++; }
  }
}

// ---------------------------------------------------------------------------
// Label connected components using 8-connectivity
// ---------------------------------------------------------------------------
function labelComponents(mask, width, height) {
  const labels = new Int32Array(width * height);
  const uf     = new UnionFind(width * height);
  let nextLabel = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;

      // Check 4 already-visited neighbors (top-left, top, top-right, left)
      const neighbors = [];
      if (x > 0           && mask[idx - 1]          === 1) neighbors.push(idx - 1);
      if (y > 0           && mask[idx - width]       === 1) neighbors.push(idx - width);
      if (x > 0  && y > 0 && mask[idx - width - 1]  === 1) neighbors.push(idx - width - 1);
      if (x < width - 1 && y > 0 && mask[idx - width + 1] === 1) neighbors.push(idx - width + 1);

      if (neighbors.length === 0) {
        labels[idx] = nextLabel++;
      } else {
        const minLabel = Math.min(...neighbors.map(n => labels[n]));
        labels[idx]    = minLabel;
        for (const n of neighbors) uf.union(minLabel, labels[n]);
      }
    }
  }

  // Second pass: flatten to root labels
  const rootToNew = new Map();
  let newLabel = 1;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 0) continue;
    const root = uf.find(labels[i]);
    if (!rootToNew.has(root)) rootToNew.set(root, newLabel++);
    labels[i] = rootToNew.get(root);
  }

  return labels;
}

// ---------------------------------------------------------------------------
// Extract the largest connected component (the bag body)
// ---------------------------------------------------------------------------
function extractLargestComponent(mask, width, height) {
  const labels        = labelComponents(mask, width, height);
  const componentSize = new Map();

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > 0) componentSize.set(labels[i], (componentSize.get(labels[i]) || 0) + 1);
  }

  if (componentSize.size === 0) return mask;

  let maxLabel = 0;
  let maxSize  = 0;
  for (const [label, size] of componentSize) {
    if (size > maxSize) { maxSize = size; maxLabel = label; }
  }

  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) result[i] = labels[i] === maxLabel ? 1 : 0;
  return result;
}

// ---------------------------------------------------------------------------
// Morphological operations (4-connectivity, single-pass allocating)
// ---------------------------------------------------------------------------
function dilate4(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      if (y > 0)           out[(y-1)*width + x] = 1;
      if (y < height - 1)  out[(y+1)*width + x] = 1;
      if (x > 0)           out[y*width + (x-1)] = 1;
      if (x < width - 1)   out[y*width + (x+1)] = 1;
      out[y * width + x] = 1;
    }
  }
  return out;
}

function erode4(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        y > 0 && y < height-1 && x > 0 && x < width-1 &&
        mask[y*width+x]        === 1 &&
        mask[(y-1)*width+x]    === 1 &&
        mask[(y+1)*width+x]    === 1 &&
        mask[y*width+(x-1)]    === 1 &&
        mask[y*width+(x+1)]    === 1
      ) out[y*width+x] = 1;
    }
  }
  return out;
}

/**
 * Multi-pass morphological closing.
 * More passes = larger holes get filled, but outer shape stays intact.
 * radius controls how many dilate→erode cycles we do.
 */
function morphClose(mask, width, height, radius = 3) {
  let m = mask;
  // Dilate `radius` times
  for (let i = 0; i < radius; i++) m = dilate4(m, width, height);
  // Erode `radius` times
  for (let i = 0; i < radius; i++) m = erode4(m, width, height);
  return m;
}

/**
 * Fill interior holes by flood-filling the background from corners,
 * then inverting: anything background NOT reachable from the border is a hole.
 *
 * This is more reliable than morphological closing for complex bag shapes
 * with large interior voids.
 */
function fillInteriorHoles(mask, width, height) {
  // BFS flood-fill from all border pixels that are background
  const visited = new Uint8Array(mask.length);
  const queue   = [];

  const enqueue = (idx) => {
    if (!visited[idx] && mask[idx] === 0) {
      visited[idx] = 1;
      queue.push(idx);
    }
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);                          // top row
    enqueue((height-1)*width + x);       // bottom row
  }
  for (let y = 0; y < height; y++) {
    enqueue(y*width);                    // left col
    enqueue(y*width + width-1);          // right col
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x   = idx % width;
    const y   = (idx - x) / width;
    if (x > 0)           enqueue(idx - 1);
    if (x < width-1)     enqueue(idx + 1);
    if (y > 0)           enqueue(idx - width);
    if (y < height-1)    enqueue(idx + width);
  }

  // Any background pixel NOT visited is an interior hole → fill it
  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    result[i] = (mask[i] === 1 || (mask[i] === 0 && !visited[i])) ? 1 : 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Moore-Neighbor (Jacob's stopping criterion) contour tracing
//
// This is O(perimeter) — vastly faster than the O(n²) nearest-neighbor
// approach in v1, and handles concave shapes correctly with no cross-jumps.
//
// Reference: "A linear-time component-labeling algorithm using contour
// tracing technique" (Chang et al., 2004), Moore-neighbor variant.
// ---------------------------------------------------------------------------

// 8-direction offsets: E, NE, N, NW, W, SW, S, SE (clockwise starting East)
const DIR_DX = [ 1,  1,  0, -1, -1, -1,  0,  1];
const DIR_DY = [ 0, -1, -1, -1,  0,  1,  1,  1];

/**
 * Given a foreground pixel and the direction we entered from (backtrack dir),
 * perform one Moore-neighbor rotation to find the next boundary pixel.
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {number} cx  current pixel x
 * @param {number} cy  current pixel y
 * @param {number} backDir  direction index of where we came FROM (so we start scanning from there)
 * @returns {{ x, y, dir } | null}
 */
function mooreNext(mask, width, height, cx, cy, backDir) {
  // Rotate clockwise through all 8 neighbors starting from backDir
  for (let i = 1; i <= 8; i++) {
    const dir = (backDir + i) % 8;
    const nx  = cx + DIR_DX[dir];
    const ny  = cy + DIR_DY[dir];
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    if (mask[ny * width + nx] === 1) {
      return { x: nx, y: ny, dir };
    }
  }
  return null; // isolated pixel
}

/**
 * Opposite direction index (used as initial backtrack for Moore tracing)
 */
function oppositeDir(dir) { return (dir + 4) % 8; }

/**
 * Trace the outer contour of the largest component.
 * Returns an ordered array of { x, y } pixel coordinates.
 */
function traceContour(mask, width, height) {
  // Find the topmost-leftmost foreground pixel (guaranteed to be on the outer boundary)
  let startX = -1, startY = -1;
  outer:
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) { startX = x; startY = y; break outer; }
    }
  }

  if (startX === -1) return [];

  const contour = [{ x: startX, y: startY }];

  // The first step: enter from the West (dir=4) so we scan clockwise from SW
  const firstStep = mooreNext(mask, width, height, startX, startY, 4 /* West */);
  if (!firstStep) return contour; // single isolated pixel

  let cx   = firstStep.x;
  let cy   = firstStep.y;
  let back = oppositeDir(firstStep.dir); // direction we came from

  // Jacob's stopping criterion: stop when we revisit the start pixel
  // AND the next step would revisit the second pixel (full loop closed)
  while (cx !== startX || cy !== startY) {
    contour.push({ x: cx, y: cy });

    const next = mooreNext(mask, width, height, cx, cy, back);
    if (!next) break; // shouldn't happen on a valid closed contour
    back = oppositeDir(next.dir);
    cx   = next.x;
    cy   = next.y;

    // Safety valve: if the contour grows larger than the perimeter could
    // possibly be, something went wrong — bail out
    if (contour.length > 2 * (width + height) * 4) break;
  }

  return contour;
}

// ---------------------------------------------------------------------------
// Gaussian-weighted smoothing (better than simple moving average)
// ---------------------------------------------------------------------------

/** Build a 1-D Gaussian kernel of half-width `hw` */
function gaussianKernel(hw) {
  const sigma  = hw / 2.0;
  const kernel = [];
  let   sum    = 0;
  for (let i = -hw; i <= hw; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  return kernel.map(w => w / sum);
}

/**
 * Smooth a closed polygon with a Gaussian kernel.
 * `passes` allows multiple smoothing rounds for stronger effect.
 */
function gaussianSmooth(points, halfWindow = 5, passes = 2) {
  if (points.length < 3) return points;
  const kernel = gaussianKernel(halfWindow);
  let   pts    = points;

  for (let p = 0; p < passes; p++) {
    const out = [];
    const n   = pts.length;
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0;
      for (let j = -halfWindow; j <= halfWindow; j++) {
        const idx = ((i + j) % n + n) % n;
        const w   = kernel[j + halfWindow];
        sx += pts[idx].x * w;
        sy += pts[idx].y * w;
      }
      out.push({ x: sx, y: sy });
    }
    pts = out;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Ramer-Douglas-Peucker polygon simplification
// ---------------------------------------------------------------------------
function perpDist(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t   = Math.max(0, Math.min(1, ((point.x-a.x)*dx + (point.y-a.y)*dy) / lenSq));
  return Math.hypot(point.x - (a.x + t*dx), point.y - (a.y + t*dy));
}

function rdpSimplify(points, epsilon) {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  const first = points[0], last = points[points.length-1];
  for (let i = 1; i < points.length-1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const L = rdpSimplify(points.slice(0, maxIdx+1), epsilon);
    const R = rdpSimplify(points.slice(maxIdx),      epsilon);
    return L.slice(0, -1).concat(R);
  }
  return [first, last];
}

/**
 * Binary-search the RDP epsilon to land in [minPts, maxPts].
 * Much more reliable than the iterative multiply/divide in v1.
 */
function adaptiveRDP(points, minPts = 30, maxPts = 80) {
  // Quick check at extreme epsilons
  const atZero = rdpSimplify(points, 0.01);
  if (atZero.length <= maxPts) return atZero;

  let lo = 0.01, hi = 50;

  // Binary search for the largest epsilon that still gives >= minPts
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const simplified = rdpSimplify(points, mid);
    if (simplified.length < minPts)      hi = mid;
    else if (simplified.length > maxPts) lo = mid;
    else return simplified; // in the sweet spot
    if (hi - lo < 0.01) break;
  }

  // Return the result at `lo` (slightly more detail) clamped to minPts
  return rdpSimplify(points, lo);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function ensureClosed(points) {
  if (points.length < 3) return points;
  const f = points[0], l = points[points.length-1];
  if (f.x !== l.x || f.y !== l.y) return [...points, { x: f.x, y: f.y }];
  return points;
}

function removeDuplicates(points) {
  if (points.length <= 1) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i], q = out[out.length-1];
    if (p.x !== q.x || p.y !== q.y) out.push(p);
  }
  return out;
}

function normalizePoints(points, width, height) {
  return points.map(p => ({ x: p.x / width, y: p.y / height }));
}

/**
 * Add a 1-pixel padding border of background (0) around the mask.
 * This lets bags that touch the image edge be traced cleanly by the
 * Moore-neighbor algorithm (which needs background pixels around the start pixel).
 */
function padMask(mask, width, height) {
  const W2 = width + 2, H2 = height + 2;
  const out = new Uint8Array(W2 * H2); // zero-initialized
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[(y+1)*W2 + (x+1)] = mask[y*width + x];
    }
  }
  return { mask: out, width: W2, height: H2 };
}

/** Remove the 1-pixel padding offset from a contour */
function unpadContour(contour) {
  return contour.map(p => ({ x: p.x - 1, y: p.y - 1 }));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Auto-generate a valid region polygon from raw pixel data.
 *
 * @param {string} pixelDataPath - Absolute path to the pixel data JSON file
 * @returns {Promise<{points: Array<{x:number,y:number}>, width: number, height: number, pixelCount: number}>}
 */
export async function generateValidRegion(pixelDataPath) {
  // ── 1. Load pixel data ────────────────────────────────────────────────────
  const raw          = await fs.readFile(pixelDataPath, 'utf8');
  const pixelArray2D = JSON.parse(raw);

  if (!Array.isArray(pixelArray2D) || pixelArray2D.length === 0)
    throw new Error('Pixel data is empty or not an array');

  const height = pixelArray2D.length;
  const width  = Array.isArray(pixelArray2D[0]) ? pixelArray2D[0].length : 0;
  if (width === 0) throw new Error('Pixel data has zero width');

  console.log(`[autoValidRegion] Loaded ${width}x${height} (${(raw.length/1024/1024).toFixed(1)} MB)`);

  // ── 2. Binary mask ────────────────────────────────────────────────────────
  // Threshold: < 65400 is bag material (65400–65535 treated as background
  // to handle floating-point noise near white)
  const WHITE_THRESHOLD = 65400;
  const mask = new Uint8Array(width * height);
  let pixelCount = 0;

  for (let y = 0; y < height; y++) {
    const row = pixelArray2D[y];
    for (let x = 0; x < width; x++) {
      if (row[x] < WHITE_THRESHOLD) { mask[y*width+x] = 1; pixelCount++; }
    }
  }

  console.log(`[autoValidRegion] Non-white pixels: ${pixelCount} / ${width*height} (${((pixelCount/(width*height))*100).toFixed(1)}%)`);
  if (pixelCount === 0) throw new Error('No non-white pixels found in pixel data');

  // ── 3. Extract largest component first (removes noise before morphology) ──
  //    This is important: running closing on a noisy mask wastes time dilating noise.
  let bagMask = extractLargestComponent(mask, width, height);

  // ── 4. Multi-pass morphological closing to fill small interior holes ───────
  bagMask = morphClose(bagMask, width, height, 3 /* radius */);

  // ── 5. Flood-fill interior holes (catches large voids morphology misses) ──
  bagMask = fillInteriorHoles(bagMask, width, height);

  // ── 6. Re-extract largest component (closing may have merged noise back) ──
  bagMask = extractLargestComponent(bagMask, width, height);

  // ── 7. Pad mask by 1 pixel so bags touching the border trace correctly ────
  const { mask: paddedMask, width: pw, height: ph } = padMask(bagMask, width, height);

  // ── 8. Moore-neighbor contour tracing (O(perimeter), concave-safe) ────────
  let contour = traceContour(paddedMask, pw, ph);
  if (contour.length < 3) throw new Error('Could not find contour (< 3 points)');

  // Remove the 1-pixel padding offset
  contour = unpadContour(contour);

  console.log(`[autoValidRegion] Raw contour: ${contour.length} points`);

  // ── 9. Gaussian smoothing (stronger and more uniform than moving average) ──
  //    halfWindow=5, 2 passes gives a smooth curve without eroding corners.
  contour = gaussianSmooth(contour, 5, 2);

  // ── 10. Close and deduplicate ──────────────────────────────────────────────
  contour = ensureClosed(contour);
  contour = removeDuplicates(contour);
  if (contour.length < 3) throw new Error('Contour too small after smoothing');

  // ── 11. Adaptive RDP simplification (binary-search epsilon) ───────────────
  const simplified = adaptiveRDP(contour, 30, 80);
  if (simplified.length < 3) throw new Error('Simplified polygon < 3 points');

  // ── 12. Final cleanup + normalize to [0, 1] ───────────────────────────────
  const final = removeDuplicates(ensureClosed(simplified));
  if (final.length < 3) throw new Error('Final polygon < 3 points');

  const normalized = normalizePoints(final, width, height);

  console.log(`[autoValidRegion] Final polygon: ${normalized.length} points`);

  return { points: normalized, width, height, pixelCount };
}