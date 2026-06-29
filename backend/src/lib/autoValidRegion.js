// backend/src/lib/autoValidRegion.js
// Auto-generates a valid region polygon from raw pixel data (2D float arrays: 0-65535)
// 65535 = white (background/air), anything < 65535 = bag material

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
    this.rank = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(x) {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x, y) {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py;
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      this.rank[px]++;
    }
  }
}

// ---------------------------------------------------------------------------
// Label connected components using 8-connectivity
// ---------------------------------------------------------------------------
function labelComponents(mask, width, height) {
  const labels = new Int32Array(width * height);
  const uf = new UnionFind(width * height);
  let nextLabel = 1;

  // First pass: label pixels and union with 8-connected neighbors
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;

      const neighbors = [];
      if (x > 0 && mask[idx - 1] === 1) neighbors.push(idx - 1);
      if (y > 0 && mask[idx - width] === 1) neighbors.push(idx - width);
      if (x > 0 && y > 0 && mask[idx - width - 1] === 1) neighbors.push(idx - width - 1);
      if (x < width - 1 && y > 0 && mask[idx - width + 1] === 1) neighbors.push(idx - width + 1);

      if (neighbors.length === 0) {
        labels[idx] = nextLabel++;
      } else {
        const minLabel = Math.min(...neighbors.map(n => labels[n]));
        labels[idx] = minLabel;
        for (const n of neighbors) {
          uf.union(minLabel, labels[n]);
        }
      }
    }
  }

  // Second pass: relabel with root labels
  const rootToNewLabel = new Map();
  let newLabel = 1;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 0) continue;
    const root = uf.find(labels[i]);
    if (!rootToNewLabel.has(root)) {
      rootToNewLabel.set(root, newLabel++);
    }
    labels[i] = rootToNewLabel.get(root);
  }

  return labels;
}

// ---------------------------------------------------------------------------
// Extract the largest connected component (the bag itself)
// ---------------------------------------------------------------------------
function extractLargestComponent(mask, width, height) {
  const labels = labelComponents(mask, width, height);
  const componentSizes = new Map();

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > 0) {
      componentSizes.set(labels[i], (componentSizes.get(labels[i]) || 0) + 1);
    }
  }

  if (componentSizes.size === 0) {
    return mask;
  }

  let maxSize = 0;
  let maxLabel = 0;
  for (const [label, size] of componentSizes) {
    if (size > maxSize) {
      maxSize = size;
      maxLabel = label;
    }
  }

  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    result[i] = labels[i] === maxLabel ? 1 : 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Morphological closing: dilate then erode (fills small holes)
// Conservative version: only 4-connectivity, single pass
// ---------------------------------------------------------------------------
function dilate(mask, width, height) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        // 4-connectivity only (N, S, E, W)
        const neighbors = [
          [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            result[ny * width + nx] = 1;
          }
        }
      }
    }
  }
  return result;
}

function erode(mask, width, height) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 4-connectivity: all 4 neighbors must be 1
      const neighbors = [
        [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]
      ];
      let allNeighborsAreOne = true;
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || mask[ny * width + nx] === 0) {
          allNeighborsAreOne = false;
          break;
        }
      }
      result[y * width + x] = allNeighborsAreOne ? 1 : 0;
    }
  }
  return result;
}

function cleanMask(mask, width, height) {
  // Only clean if the component is reasonably large
  let pixelCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) pixelCount++;
  }
  
  // Skip cleaning for small components to avoid over-shrinking
  if (pixelCount < 1000) {
    return mask;
  }
  
  // Single pass of conservative closing
  const dilated = dilate(mask, width, height);
  const closed = erode(dilated, width, height);
  return closed;
}

// ---------------------------------------------------------------------------
// Find boundary pixels (foreground pixels with at least one background neighbor)
// Then order them into a contour using nearest-neighbor chaining
// ---------------------------------------------------------------------------
function findContour(mask, width, height) {
  // Step 1: Find all boundary pixels
  const boundaryPixels = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      
      // Check if this pixel has any background neighbor (8-connectivity)
      let hasBackgroundNeighbor = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || mask[ny * width + nx] === 0) {
            hasBackgroundNeighbor = true;
            break;
          }
        }
        if (hasBackgroundNeighbor) break;
      }
      
      if (hasBackgroundNeighbor) {
        boundaryPixels.push({ x, y });
      }
    }
  }

  if (boundaryPixels.length < 3) {
    return boundaryPixels;
  }

  // Step 2: Order boundary pixels into a contour using nearest-neighbor chaining
  const contour = [boundaryPixels[0]];
  const used = new Set([0]);
  
  while (used.size < boundaryPixels.length) {
    const current = contour[contour.length - 1];
    let nearestIdx = -1;
    let nearestDist = Infinity;
    
    // Find the nearest unused boundary pixel
    for (let i = 0; i < boundaryPixels.length; i++) {
      if (used.has(i)) continue;
      
      const pixel = boundaryPixels[i];
      const dx = pixel.x - current.x;
      const dy = pixel.y - current.y;
      const dist = dx * dx + dy * dy; // Use squared distance for speed
      
      // Only consider nearby pixels (within reasonable distance)
      if (dist < nearestDist && dist < 100) { // Max distance of 10 pixels
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    
    if (nearestIdx === -1) {
      // No nearby pixel found, try to find any unused pixel
      for (let i = 0; i < boundaryPixels.length; i++) {
        if (!used.has(i)) {
          nearestIdx = i;
          break;
        }
      }
    }
    
    if (nearestIdx === -1) break;
    
    contour.push(boundaryPixels[nearestIdx]);
    used.add(nearestIdx);
  }

  return contour;
}

// ---------------------------------------------------------------------------
// Smoothing: moving average
// ---------------------------------------------------------------------------
function smoothContour(points, windowSize = 3) {
  if (points.length < 3) return points;

  const smoothed = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < points.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let j = -halfWindow; j <= halfWindow; j++) {
      const idx = (i + j + points.length) % points.length;
      sumX += points[idx].x;
      sumY += points[idx].y;
      count++;
    }

    smoothed.push({
      x: sumX / count,
      y: sumY / count,
    });
  }

  return smoothed;
}

// ---------------------------------------------------------------------------
// Ramer-Douglas-Peucker polygon simplification
// ---------------------------------------------------------------------------
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lineLenSq = dx * dx + dy * dy;

  if (lineLenSq === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }

  const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLenSq));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

function rdpSimplify(points, epsilon) {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [first, last];
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function ensureClosed(points) {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    return [...points, { x: first.x, y: first.y }];
  }
  return points;
}

function removeDuplicates(points) {
  if (points.length <= 1) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (prev.x !== curr.x || prev.y !== curr.y) {
      result.push(curr);
    }
  }
  return result;
}

function normalizePoints(points, width, height) {
  return points.map(p => ({
    x: p.x / width,
    y: p.y / height,
  }));
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
  // 1. Load pixel data
  const raw = await fs.readFile(pixelDataPath, 'utf8');
  const pixelArray2D = JSON.parse(raw); // nested arrays: [[col,...],...] or [[row,...],...]

  if (!Array.isArray(pixelArray2D) || pixelArray2D.length === 0) {
    throw new Error('Pixel data is empty or not an array');
  }

  // Determine orientation: the pixel data is rows x cols (height x width)
  const height = pixelArray2D.length;
  const width = Array.isArray(pixelArray2D[0]) ? pixelArray2D[0].length : 0;

  if (width === 0) {
    throw new Error('Pixel data has zero width');
  }

  console.log(`[autoValidRegion] Loading pixel data: ${width}x${height} (${(raw.length / 1024 / 1024).toFixed(1)} MB)`);

  // 2. Create binary mask: value < 65535 → 1 (bag), value === 65535 → 0 (background)
  // Use a small tolerance for float precision
  const WHITE_THRESHOLD = 65400;
  const mask = new Uint8Array(width * height);

  let pixelCount = 0;
  for (let y = 0; y < height; y++) {
    const row = pixelArray2D[y];
    for (let x = 0; x < width; x++) {
      const val = row[x];
      const idx = y * width + x;
      if (val < WHITE_THRESHOLD) {
        mask[idx] = 1;
        pixelCount++;
      } else {
        mask[idx] = 0;
      }
    }
  }

  console.log(`[autoValidRegion] Pixel count (non-white): ${pixelCount} / ${width * height} (${((pixelCount / (width * height)) * 100).toFixed(1)}%)`);

  if (pixelCount === 0) {
    throw new Error('No non-white pixels found in pixel data');
  }

  // 3. Clean the mask (morphological closing to fill small holes)
  const cleanedMask = cleanMask(mask, width, height);

  // 4. Extract the largest connected component
  const bagMask = extractLargestComponent(cleanedMask, width, height);

  // 5. Find the contour
  let contour = findContour(bagMask, width, height);
  if (contour.length < 3) {
    throw new Error('Could not find contour (less than 3 points)');
  }

  console.log(`[autoValidRegion] Raw contour points: ${contour.length}`);

  // 6. Smooth the contour
  contour = smoothContour(contour, 3);
  contour = smoothContour(contour, 3);

  // 7. Ensure closed and remove duplicates
  contour = ensureClosed(contour);
  contour = removeDuplicates(contour);

  if (contour.length < 3) {
    throw new Error('Contour too small after smoothing');
  }

  // 8. Simplify with RDP (adaptive epsilon to target 30-80 points)
  const MIN_POINTS = 30;
  const MAX_POINTS = 80;

  let epsilon = 1.5;
  let simplified = rdpSimplify(contour, epsilon);

  // Iterate to hit the target point range
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (simplified.length < MIN_POINTS && epsilon > 0.2 && iterations < MAX_ITERATIONS) {
    epsilon *= 0.75;
    simplified = rdpSimplify(contour, epsilon);
    iterations++;
  }

  iterations = 0;
  while (simplified.length > MAX_POINTS && epsilon < 15 && iterations < MAX_ITERATIONS) {
    epsilon *= 1.4;
    simplified = rdpSimplify(contour, epsilon);
    iterations++;
  }

  if (simplified.length < 3) {
    throw new Error('Simplified polygon has less than 3 points');
  }

  // 9. Final cleanup
  simplified = ensureClosed(simplified);
  simplified = removeDuplicates(simplified);

  if (simplified.length < 3) {
    throw new Error('Final polygon has less than 3 points');
  }

  // 10. Normalize to 0-1 range
  const normalized = normalizePoints(simplified, width, height);

  console.log(`[autoValidRegion] Generated ${normalized.length} points (epsilon=${epsilon.toFixed(2)})`);

  return {
    points: normalized,
    width,
    height,
    pixelCount,
  };
}