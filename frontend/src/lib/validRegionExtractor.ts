import type { Point } from "../types/geometry";

const WHITE_THRESHOLD = 245;

/**
 * Load image and return binary mask + dimensions.
 * 1 = non-white (bag), 0 = white (background)
 */
async function loadImageData(imageSrc: string): Promise<{ mask: Uint8Array; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      const mask = new Uint8Array(width * height);

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const idx = i / 4;
        // Foreground if ANY channel is below threshold (matches renderer logic)
        const isNonWhite = r < WHITE_THRESHOLD || g < WHITE_THRESHOLD || b < WHITE_THRESHOLD;
        mask[idx] = isNonWhite ? 1 : 0;
      }
      resolve({ mask, width, height });
    };
    img.onerror = () => resolve(null);
    img.src = imageSrc;
  });
}

/**
 * Union-Find (Disjoint Set) for connected component labeling.
 */
class UnionFind {
  private parent: Int32Array;
  private rank: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number) {
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

/**
 * Label connected components using 8-connectivity.
 * Returns an array where each pixel's value is the component ID (0 = background).
 */
function labelComponents(mask: Uint8Array, width: number, height: number): Int32Array {
  const labels = new Int32Array(width * height);
  const uf = new UnionFind(width * height);
  let nextLabel = 1;

  // First pass: label pixels and union with 8-connected neighbors
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;

      // Check 8-connected neighbors (already processed: left, top, top-left, top-right)
      const neighbors: number[] = [];
      if (x > 0 && mask[idx - 1] === 1) neighbors.push(idx - 1);           // left
      if (y > 0 && mask[idx - width] === 1) neighbors.push(idx - width);   // top
      if (x > 0 && y > 0 && mask[idx - width - 1] === 1) neighbors.push(idx - width - 1);       // top-left
      if (x < width - 1 && y > 0 && mask[idx - width + 1] === 1) neighbors.push(idx - width + 1); // top-right

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
  const rootToNewLabel = new Map<number, number>();
  let newLabel = 1;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 0) continue;
    const root = uf.find(labels[i]);
    if (!rootToNewLabel.has(root)) {
      rootToNewLabel.set(root, newLabel++);
    }
    labels[i] = rootToNewLabel.get(root)!;
  }

  return labels;
}

/**
 * Find the largest connected component (the bag).
 * Returns a new mask with only the largest component.
 */
function extractLargestComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
  const labels = labelComponents(mask, width, height);
  const componentSizes = new Map<number, number>();

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > 0) {
      componentSizes.set(labels[i], (componentSizes.get(labels[i]) || 0) + 1);
    }
  }

  if (componentSizes.size === 0) {
    return mask;
  }

  // Find the largest component
  let maxSize = 0;
  let maxLabel = 0;
  for (const [label, size] of componentSizes) {
    if (size > maxSize) {
      maxSize = size;
      maxLabel = label;
    }
  }

  // Create mask with only the largest component
  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    result[i] = labels[i] === maxLabel ? 1 : 0;
  }

  return result;
}

/**
 * Clean the binary mask using morphological closing.
 * Fills small holes inside the bag.
 */
function cleanMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  // Closing: dilation followed by erosion
  const dilated = dilate(mask, width, height);
  const closed = erode(dilated, width, height);
  return closed;
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              result[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  }
  return result;
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allNeighborsAreOne = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || mask[ny * width + nx] === 0) {
            allNeighborsAreOne = false;
            break;
          }
        }
        if (!allNeighborsAreOne) break;
      }
      result[y * width + x] = allNeighborsAreOne ? 1 : 0;
    }
  }
  return result;
}

/**
 * Find the external contour using Moore neighborhood border following.
 * This is a robust implementation that traces the outer boundary.
 */
function findContour(mask: Uint8Array, width: number, height: number): Point[] {
  // Find the first foreground pixel
  let startX = -1;
  let startY = -1;
  for (let y = 0; y < height && startX === -1; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
  }

  if (startX === -1) {
    return [];
  }

  // 8-connected directions (clockwise from East)
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  const contour: Point[] = [];
  let x = startX;
  let y = startY;

  // Find initial direction (from start pixel to a background neighbor)
  let dir = 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + dx[d];
    const ny = y + dy[d];
    if (nx < 0 || nx >= width || ny < 0 || ny >= height || mask[ny * width + nx] === 0) {
      dir = d;
      break;
    }
  }

  const maxSteps = width * height * 2;
  let steps = 0;

  do {
    contour.push({ x, y });

    // Search clockwise starting from (dir + 6) % 8
    let found = false;
    const startDir = (dir + 6) % 8;

    for (let i = 0; i < 8; i++) {
      const newDir = (startDir + i) % 8;
      const nx = x + dx[newDir];
      const ny = y + dy[newDir];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (mask[ny * width + nx] === 1) {
          // Found next foreground pixel
          dir = (newDir + 4) % 8; // backtrack direction (opposite)
          x = nx;
          y = ny;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      break;
    }

    steps++;
    if (steps > maxSteps) {
      break;
    }
  } while (!(x === startX && y === startY && contour.length > 2));

  return contour;
}

/**
 * Smooth contour points using moving average.
 * Reduces jaggedness from pixel-level tracing.
 */
function smoothContour(points: Point[], windowSize: number = 3): Point[] {
  if (points.length < 3) return points;
  
  const smoothed: Point[] = [];
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
      y: sumY / count
    });
  }
  
  return smoothed;
}

/**
 * Ramer-Douglas-Peucker algorithm for polygon simplification.
 */
function rdpSimplify(points: Point[], epsilon: number): Point[] {
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

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
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

/**
 * Normalize points to 0-1 range.
 */
function normalizePoints(points: Point[], width: number, height: number): Point[] {
  return points.map(p => ({
    x: p.x / width,
    y: p.y / height,
  }));
}

/**
 * Ensure polygon is closed.
 */
function ensureClosed(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    return [...points, { x: first.x, y: first.y }];
  }
  return points;
}

/**
 * Remove duplicate consecutive points.
 */
function removeDuplicates(points: Point[]): Point[] {
  if (points.length <= 1) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (prev.x !== curr.x || prev.y !== curr.y) {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Main function: Extract valid region from bag image.
 */
export async function extractValidRegion(imageSrc: string): Promise<Point[]> {
  const data = await loadImageData(imageSrc);
  if (!data) {
    return [];
  }

  const { mask, width, height } = data;

  // Step 1: Clean the mask (fill small holes)
  const cleanedMask = cleanMask(mask, width, height);

  // Step 2: Extract largest component (the bag)
  const bagMask = extractLargestComponent(cleanedMask, width, height);

  // Step 3: Find the contour
  let contour = findContour(bagMask, width, height);
  if (contour.length < 3) {
    return [];
  }

  // Step 4: Smooth the contour to reduce pixel-level jaggedness
  // Apply smoothing multiple times for a cleaner result
  contour = smoothContour(contour, 3);
  contour = smoothContour(contour, 3);

  // Step 5: Ensure closed and remove duplicates
  contour = ensureClosed(contour);
  contour = removeDuplicates(contour);

  if (contour.length < 3) {
    return [];
  }

  // Step 6: Simplify with adaptive epsilon
  // Target: 30-80 points for good detail
  const MIN_POINTS = 30;
  const MAX_POINTS = 80;

  let epsilon = 1.5;
  let simplified = rdpSimplify(contour, epsilon);

  while (simplified.length < MIN_POINTS && epsilon > 0.2) {
    epsilon *= 0.75;
    simplified = rdpSimplify(contour, epsilon);
  }

  while (simplified.length > MAX_POINTS && epsilon < 15) {
    epsilon *= 1.4;
    simplified = rdpSimplify(contour, epsilon);
  }

  if (simplified.length < 3) {
    return [];
  }

  // Step 7: Final cleanup
  simplified = ensureClosed(simplified);
  simplified = removeDuplicates(simplified);

  if (simplified.length < 3) {
    return [];
  }

  // Step 8: Normalize to 0-1 range (full precision)
  return normalizePoints(simplified, width, height);
}

/**
 * Extract valid region from an HTMLImageElement directly.
 */
export async function extractValidRegionFromImage(img: HTMLImageElement): Promise<Point[]> {
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  if (width === 0 || height === 0) {
    return [];
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return [];
  }

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const idx = i / 4;
    const isNonWhite = r < WHITE_THRESHOLD || g < WHITE_THRESHOLD || b < WHITE_THRESHOLD;
    mask[idx] = isNonWhite ? 1 : 0;
  }

  const cleanedMask = cleanMask(mask, width, height);
  const bagMask = extractLargestComponent(cleanedMask, width, height);

  let contour = findContour(bagMask, width, height);
  if (contour.length < 3) {
    return [];
  }

  // Smooth the contour
  contour = smoothContour(contour, 3);
  contour = smoothContour(contour, 3);

  contour = ensureClosed(contour);
  contour = removeDuplicates(contour);

  if (contour.length < 3) {
    return [];
  }

  let epsilon = 1.5;
  let simplified = rdpSimplify(contour, epsilon);

  while (simplified.length < 30 && epsilon > 0.2) {
    epsilon *= 0.75;
    simplified = rdpSimplify(contour, epsilon);
  }

  while (simplified.length > 80 && epsilon < 15) {
    epsilon *= 1.4;
    simplified = rdpSimplify(contour, epsilon);
  }

  if (simplified.length < 3) {
    return [];
  }

  simplified = ensureClosed(simplified);
  simplified = removeDuplicates(simplified);

  if (simplified.length < 3) {
    return [];
  }

  return normalizePoints(simplified, width, height);
}