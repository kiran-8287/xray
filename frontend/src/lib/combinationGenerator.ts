import type { Item } from "../types/library";
import type { SceneObject, CombinatorialResult, FailureLog, GenerationResult } from "../types/customization";
import {
  isObjectInsideContainer,
  getRandomPositionInContainer,
  doObjectsOverlap,
  getTransformedValidRegion,
} from "./customizationHelpers";
import { generateSynthesizedId } from "./synthesizedIdGenerator";
import type { Point } from "../types/geometry";

const CANVAS_W = 800;
const CANVAS_H = 600;

// Default batch size for incremental generation callbacks (5000 per batch)
const DEFAULT_BATCH_SIZE = 5000;

// Performance optimization: Cache for transformed valid regions
const validRegionCache = new Map<string, Point[]>();
const CACHE_MAX_SIZE = 100;

// Bug #2 fix: module-level fast ID counter used by generateCombinationsIncremental.
// Initialised once per call via initIdCounter() inside that function.
let _idBasePrefix = '';
let _idSequence = 1;

/**
 * O(1) ID generator — uses the pre-computed counter instead of scanning the
 * full existingIds array on every combo.  Only valid inside
 * generateCombinationsIncremental after initIdCounter() has run.
 */
function nextSynthesizedId(usedIds: Set<string>): string {
  let seq = _idSequence;
  let id: string;
  do {
    const letterIndex = Math.floor((seq - 1) / 99999);
    const numberPart  = ((seq - 1) % 99999) + 1;
    const letter = String.fromCharCode(65 + letterIndex);
    id = `${_idBasePrefix}-${letter}${String(numberPart).padStart(5, '0')}`;
    seq++;
  } while (usedIds.has(id));
  _idSequence = seq;
  usedIds.add(id);
  return id;
}

function parseOutline(item: Item): { x: number; y: number }[] | undefined {
  if (item.valid_region_points) {
    const raw = typeof item.valid_region_points === "string"
      ? JSON.parse(item.valid_region_points)
      : item.valid_region_points;
    if (Array.isArray(raw)) {
      return raw;
    } else if (raw && typeof raw === "object") {
      return raw.simplifiedPoints || raw.points || raw.shapes?.[0]?.points;
    }
  }
  if (item.polygon_json) {
    return typeof item.polygon_json === "string"
      ? JSON.parse(item.polygon_json)
      : item.polygon_json;
  }
  return undefined;
}

function createBagSceneObject(bag: Item): SceneObject {
  const outline = parseOutline(bag);
  const bagWidth = bag.width || bag.height || Math.min(CANVAS_W, CANVAS_H);
  const bagHeight = bag.height || bag.width || Math.min(CANVAS_W, CANVAS_H);
  return {
    id: bag.id,
    name: bag.name,
    library: "bag",
    subcategory: bag.subcategory,
    originalPixelValue: bag.pixel_value,
    currentPixelValue: bag.pixel_value,
    oldPixelValue: null,
    stencilId: "bag",
    filepath: bag.filepath,
    polygonOutline: outline,
    transform: {
      x: bagWidth / 2,
      y: bagHeight / 2,
      width: bagWidth,
      height: bagHeight,
      rotation: 0,
    },
    initialWidth: bagWidth,
    initialHeight: bagHeight,
    layer: 0,
    tags: bag.tags || [],
  };
}

function createThreatSceneObject(
  threat: Item,
  x: number,
  y: number,
  rotation: number,
  layer: number
): SceneObject {
  const outline = parseOutline(threat);
  const w = threat.width ? Math.round(threat.width) : 120;
  const h = threat.height ? Math.round(threat.height) : 60;
  return {
    id: threat.id,
    name: threat.name,
    library: "threat",
    subcategory: threat.subcategory,
    originalPixelValue: threat.pixel_value,
    currentPixelValue: threat.pixel_value,
    oldPixelValue: null,
    stencilId: "threat",
    filepath: threat.filepath,
    polygonOutline: outline,
    transform: { x, y, width: w, height: h, rotation },
    initialWidth: w,
    initialHeight: h,
    layer,
  };
}

function createNonThreatSceneObject(
  item: Item,
  x: number,
  y: number,
  rotation: number,
  layer: number
): SceneObject {
  const outline = parseOutline(item);
  const w = item.width ? Math.round(item.width) : 80;
  const h = item.height ? Math.round(item.height) : 80;
  return {
    id: item.id,
    name: item.name,
    library: "non-threat",
    subcategory: item.subcategory,
    originalPixelValue: item.pixel_value,
    currentPixelValue: item.pixel_value,
    oldPixelValue: null,
    stencilId: "item",
    filepath: item.filepath,
    polygonOutline: outline,
    transform: { x, y, width: w, height: h, rotation },
    initialWidth: w,
    initialHeight: h,
    layer,
  };
}

function placementHash(threatId: string, x: number, y: number, rotation: number): string {
  return `${threatId}_${Math.round(x)}_${Math.round(y)}_${Math.round(rotation)}`;
}

function nonThreatComboHash(nonThreatIds: string[], positions: { x: number; y: number; rotation: number }[]): string {
  const sorted = [...nonThreatIds].sort();
  const posStr = positions.map(p => `${Math.round(p.x)}_${Math.round(p.y)}_${Math.round(p.rotation)}`).join("|");
  return `${sorted.join(",")}_${posStr}`;
}

function pickRandomSubset<T>(arr: T[], min: number, max: number): T[] {
  if (arr.length === 0) return [];
  const range = max - min + 1;
  const count = Math.min(min + Math.floor(Math.random() * (range <= 0 ? 1 : range)), arr.length);
  return pickRandomK(arr, count);
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandomK<T>(arr: T[], k: number): T[] {
  const n = arr.length;
  if (k <= 0) return [];
  if (k >= n) return shuffleArray(arr);
  if (k === 1) {
    return [arr[Math.floor(Math.random() * n)]];
  }
  // Partial Fisher-Yates: only perform first k swaps, return those k elements.
  // O(k) instead of O(n) for small k<<n (typical: k=1..4 threats, n=1000..10000).
  const result = new Array(k);
  // Use a sparse swap tracking via Map when n >> k to avoid full array copy.
  if (k * 32 < n) {
    const swapped = new Map<number, number>();
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const iVal = swapped.has(i) ? swapped.get(i)! : i;
      const jVal = swapped.has(j) ? swapped.get(j)! : j;
      result[i] = arr[jVal];
      swapped.set(j, iVal);
      // i entry is no longer needed (we never go back), keep map small
      swapped.delete(i);
    }
  } else {
    const a = [...arr];
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      [a[i], a[j]] = [a[j], a[i]];
      result[i] = a[i];
    }
  }
  return result;
}

// Performance optimization: Get cached valid region
function getCachedValidRegion(bagObj: SceneObject): Point[] {
  const cacheKey = `${bagObj.id}_${bagObj.transform.width}_${bagObj.transform.height}_${bagObj.transform.rotation}`;
  
  if (validRegionCache.has(cacheKey)) {
    return validRegionCache.get(cacheKey)!;
  }
  
  const region = getTransformedValidRegion(bagObj);
  
  // Limit cache size
  if (validRegionCache.size >= CACHE_MAX_SIZE) {
    const firstKey = validRegionCache.keys().next().value;
    if (firstKey) validRegionCache.delete(firstKey);
  }
  
  validRegionCache.set(cacheKey, region);
  return region;
}

// Performance optimization: Fast bounding box overlap check
function fastBoundingBoxOverlap(
  x1: number, y1: number, w1: number, h1: number,
  x2: number, y2: number, w2: number, h2: number
): boolean {
  return !(
    x1 + w1 / 2 < x2 - w2 / 2 ||
    x1 - w1 / 2 > x2 + w2 / 2 ||
    y1 + h1 / 2 < y2 - h2 / 2 ||
    y1 - h1 / 2 > y2 + h2 / 2
  );
}

/**
 * Try to place a threat inside a bag at a given position and rotation.
 */
function tryPlaceThreat(
  threat: Item,
  bagObj: SceneObject,
  x: number,
  y: number,
  rotation: number
): boolean {
  const outline = parseOutline(threat);
  const w = threat.width ? Math.round(threat.width) : 120;
  const h = threat.height ? Math.round(threat.height) : 60;

  const testObj = {
    polygonOutline: outline,
    transform: { x, y, width: w, height: h, rotation },
  };

  return isObjectInsideContainer(testObj, bagObj);
}

/**
 * Try to place non-threat items inside a bag, avoiding overlap with threats and each other.
 * Returns array of {x, y, rotation} if all placed, null otherwise.
 * FLEXIBLE: Allows overlapping if necessary to ensure generation can proceed.
 */
function tryPlaceNonThreats(
  items: Item[],
  bagObj: SceneObject,
  threatObjs: SceneObject[],
  maxAttempts: number = 50
): { x: number; y: number; rotation: number }[] | null {
  const positions: { x: number; y: number; rotation: number }[] = [];

  for (const item of items) {
    const outline = parseOutline(item);
    const w = item.width ? Math.round(item.width) : 80;
    const h = item.height ? Math.round(item.height) : 80;

    let placed = false;
    // Increased max attempts for better success rate
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pos = getRandomPositionInContainer(w, h, bagObj, outline);
      if (!pos) continue;
      
      // Only check if inside bag - skip overlap checks for non-threats
      // This allows overlapping non-threats and non-threats over threats
      // to ensure generation can proceed
      const testObj: SceneObject = {
        id: "temp",
        name: item.name,
        library: "non-threat",
        originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        oldPixelValue: null,
        stencilId: "item",
        filepath: item.filepath,
        polygonOutline: outline,
        transform: { x: pos.x, y: pos.y, width: w, height: h, rotation: pos.rotation ?? 0 },
        layer: 0,
      };

      // Only check if inside bag
      if (!isObjectInsideContainer(testObj, bagObj)) continue;

      positions.push({ x: pos.x, y: pos.y, rotation: pos.rotation ?? 0 });
      placed = true;
      break;
    }

    if (!placed) {
      // If we can't place this non-threat, return null to skip this combo
      // The generation will try another bag/threat combination
      return null;
    }
  }

  return positions;
}

/**
 * Build a shuffled list of position+rotation candidates for a threat inside a bag.
 * OPTIMIZED: Reduced grid density and rotation steps for faster generation.
 */
function buildPositionRotationCandidates(
  bagObj: SceneObject,
  threat: Item,
  target: number
): { x: number; y: number; rotation: number }[] {
  const validRegion: Point[] = getCachedValidRegion(bagObj) || [];

  // Bug #5 fix: fall back to the bag's bounding box when no valid-region polygon
  // exists, so random candidates don't all collapse to (0, 0).
  let minX: number, maxX: number, minY: number, maxY: number;
  if (validRegion.length >= 3) {
    minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
    for (let i = 0; i < validRegion.length; i++) {
      const p = validRegion[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  } else {
    // Use the bag's axis-aligned bounding box as the candidate region.
    minX = bagObj.transform.x - bagObj.transform.width / 2;
    maxX = bagObj.transform.x + bagObj.transform.width / 2;
    minY = bagObj.transform.y - bagObj.transform.height / 2;
    maxY = bagObj.transform.y + bagObj.transform.height / 2;
  }

  const threatW = threat.width ? Math.round(threat.width) : 120;
  const threatH = threat.height ? Math.round(threat.height) : 60;

  // OPTIMIZATION: Increased grid step to reduce candidates (was 0.6, now 0.8)
  const gridStep = Math.max(threatW, threatH) * 0.8;
  const positionCandidates: { x: number; y: number }[] = [];

  if (validRegion.length >= 3) {
    for (let px = minX + threatW / 2; px <= maxX - threatW / 2; px += gridStep) {
      for (let py = minY + threatH / 2; py <= maxY - threatH / 2; py += gridStep) {
        positionCandidates.push({ x: px, y: py });
      }
    }
  }

  // OPTIMIZATION: Reduced random candidates (was target * 10, now target * 5)
  const requiredRandom = Math.max(0, target * 5 - positionCandidates.length);
  for (let i = 0; i < requiredRandom; i++) {
    const rx = minX + threatW / 2 + Math.random() * Math.max(0, maxX - minX - threatW);
    const ry = minY + threatH / 2 + Math.random() * Math.max(0, maxY - minY - threatH);
    positionCandidates.push({ x: rx, y: ry });
  }

  // OPTIMIZATION: Fewer rotation angles (increased step size)
  const rotationStep = target <= 12 ? 45 : target <= 24 ? 30 : target <= 72 ? 20 : 15;
  const rotationAngles: number[] = [];
  for (let angle = 0; angle < 360; angle += rotationStep) rotationAngles.push(angle);

  // Cartesian product of positions × rotations
  const candidates: { x: number; y: number; rotation: number }[] = [];
  for (let i = 0; i < positionCandidates.length; i++) {
    const p = positionCandidates[i];
    for (let j = 0; j < rotationAngles.length; j++) {
      const r = rotationAngles[j];
      candidates.push({ x: p.x, y: p.y, rotation: r });
    }
  }

  // Shuffle candidates using Fisher-Yates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = temp;
  }

  // OPTIMIZATION: Reduced MAX_CANDIDATES (was 5000, now 2000)
  const MAX_CANDIDATES = Math.max(500, target * 100, 2000);
  if (candidates.length > MAX_CANDIDATES) {
    return candidates.slice(0, MAX_CANDIDATES);
  }

  return candidates;
}

/**
 * Generate a placement for a single threat inside a bag.
 * Tries non-overlapping first (10 attempts), then falls back to overlapping.
 * Tracks positions per bag+threat to ensure uniqueness within same bag.
 */
function generateSingleThreatPlacement(
  bag: Item,
  threat: Item,
  bagObj: SceneObject,
  bagId: string,
  bagThreatPositions: Map<string, Set<string>>,
  existingThreats: SceneObject[] = []
): { x: number; y: number; rotation: number } | null {
  const candidates = buildPositionRotationCandidates(bagObj, threat, 10);
  const maxAttempts = Math.min(candidates.length, 100);

  // Get tracking key for this bag+threat combination
  const trackingKey = `${bagId}_${threat.id}`;
  const usedPositions = bagThreatPositions.get(trackingKey) || new Set<string>();
  
  // Phase 1: Try non-overlapping (check against existing threats)
  for (let idx = 0; idx < Math.min(maxAttempts, 10); idx++) {
    const cand = candidates[idx];
    const pos = { x: cand.x, y: cand.y };
    const rotation = cand.rotation;

    // Check if this placement is valid
    if (!tryPlaceThreat(threat, bagObj, pos.x, pos.y, rotation)) continue;

    // Check overlap with existing threats
    const testObj = createThreatSceneObject(threat, pos.x, pos.y, rotation, 1);
    let overlaps = false;
    for (const existing of existingThreats) {
      if (doObjectsOverlap(testObj, existing)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    // Check if position already used for this bag+threat
    const posHash = `${Math.round(pos.x)}_${Math.round(pos.y)}_${rotation}`;
    if (usedPositions.has(posHash)) continue;

    // Track this position
    usedPositions.add(posHash);
    if (usedPositions.size > 50) {
      // Remove oldest entry (FIFO) to keep memory bounded
      const firstHash = usedPositions.values().next().value;
      if (firstHash) usedPositions.delete(firstHash);
    }
    bagThreatPositions.set(trackingKey, usedPositions);

    return { x: pos.x, y: pos.y, rotation };
  }

  // Phase 2: Fallback to overlapping (no overlap checks)
  for (let idx = 10; idx < maxAttempts; idx++) {
    const cand = candidates[idx];
    const pos = { x: cand.x, y: cand.y };
    const rotation = cand.rotation;

    // Check if this placement is valid
    if (!tryPlaceThreat(threat, bagObj, pos.x, pos.y, rotation)) continue;

    // Check if position already used for this bag+threat
    const posHash = `${Math.round(pos.x)}_${Math.round(pos.y)}_${rotation}`;
    if (usedPositions.has(posHash)) continue;

    // Track this position
    usedPositions.add(posHash);
    if (usedPositions.size > 50) {
      const firstHash = usedPositions.values().next().value;
      if (firstHash) usedPositions.delete(firstHash);
    }
    bagThreatPositions.set(trackingKey, usedPositions);

    return { x: pos.x, y: pos.y, rotation };
  }

  return null;
}

/**
 * Pick a threat count (1-4) based on percentage distribution weights.
 * The distribution is an object like {1: 60, 2: 20, 3: 10, 4: 10}.
 * Only considers counts up to the available threats length.
 */
function pickThreatCountByDistribution(
  distribution: Record<number, number>,
  availableThreats: number
): number {
  // Build weighted list of eligible counts
  const eligible: { count: number; weight: number }[] = [];
  for (let i = 1; i <= Math.min(4, availableThreats); i++) {
    const weight = distribution[i] ?? 0;
    if (weight > 0) {
      eligible.push({ count: i, weight });
    }
  }

  if (eligible.length === 0) {
    // Fallback: uniform distribution
    return 1 + Math.floor(Math.random() * Math.min(4, availableThreats));
  }

  const totalWeight = eligible.reduce((sum, e) => sum + e.weight, 0);
  const random = Math.random() * totalWeight;
  let cumulative = 0;
  for (const e of eligible) {
    cumulative += e.weight;
    if (random <= cumulative) return e.count;
  }

  return eligible[eligible.length - 1].count;
}

/**
 * Pick a non-threat count (1-4) based on percentage distribution weights.
 * The distribution is an object like {1: 60, 2: 20, 3: 10, 4: 10}.
 * Only considers counts up to the available non-threats length.
 * If requireAtLeastOne is true, ensures at least 1 non-threat is selected.
 */
function pickNonThreatCountByDistribution(
  distribution: Record<number, number>,
  availableNonThreats: number,
  requireAtLeastOne: boolean = false
): number {
  // Build weighted list of eligible counts
  const eligible: { count: number; weight: number }[] = [];
  for (let i = 1; i <= Math.min(4, availableNonThreats); i++) {
    const weight = distribution[i] ?? 0;
    if (weight > 0) {
      eligible.push({ count: i, weight });
    }
  }

  // If requireAtLeastOne and no eligible counts with weight, force at least 1
  if (eligible.length === 0) {
    if (requireAtLeastOne && availableNonThreats > 0) {
      return 1;
    }
    // Fallback: uniform distribution
    return 1 + Math.floor(Math.random() * Math.min(4, availableNonThreats));
  }

  const totalWeight = eligible.reduce((sum, e) => sum + e.weight, 0);
  const random = Math.random() * totalWeight;
  let cumulative = 0;
  for (const e of eligible) {
    cumulative += e.weight;
    if (random <= cumulative) return e.count;
  }

  return eligible[eligible.length - 1].count;
}

/**
 * Generate a multi-threat combo with tolerance-based distribution.
 * Places threats with position tracking and overlap fallback.
 */
function generateMultiThreatPlacements(
  bag: Item,
  threats: Item[],
  targetByCount: Record<number, { min: number; target: number; max: number }>,
  nonThreats: Item[],
  nonThreatDistribution: Record<number, number>,
  requireAtLeastOneNonThreat: boolean = false,
  globalUsedIds?: Set<string>,
  nextId?: (usedIds: Set<string>) => string
): { results: CombinatorialResult[]; failure: FailureLog | null } {
  const results: CombinatorialResult[] = [];
  const usedIds = globalUsedIds ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);

  // Calculate total target
  const totalTarget = Object.values(targetByCount).reduce((sum, bounds) => sum + bounds.target, 0);
  
  // OPTIMIZATION: More attempts since overlap is allowed (much higher success rate)
  // Bug #1 fix: removed the Math.min(5000, ...) hard-cap so large targets can
  // exhaust all bag/rotation candidates before giving up.
  const maxAttempts = Math.max(totalTarget * 5, 1000);

  for (let attempt = 0; attempt < maxAttempts && results.length < totalTarget; attempt++) {
    // Pick threat count based on remaining targets
    const remainingTargets: { count: number; remaining: number }[] = [];
    for (const [count, bounds] of Object.entries(targetByCount)) {
      const countNum = parseInt(count);
      const currentCount = results.filter(r => r.threats.length === countNum).length;
      const remaining = bounds.max - currentCount;
      if (remaining > 0) {
        remainingTargets.push({ count: countNum, remaining });
      }
    }

    if (remainingTargets.length === 0) break;

    // Weighted random selection based on remaining targets
    const totalRemaining = remainingTargets.reduce((sum, rt) => sum + rt.remaining, 0);
    const random = Math.random() * totalRemaining;
    let cumulative = 0;
    let selectedCount = remainingTargets[0].count;
    for (const rt of remainingTargets) {
      cumulative += rt.remaining;
      if (random <= cumulative) {
        selectedCount = rt.count;
        break;
      }
    }

    const selectedThreats = pickRandomK(threats, selectedCount);

    // Try to place all selected threats (NO overlap checks - overlap allowed!)
    const placedThreats: { item: Item; x: number; y: number; rotation: number }[] = [];
    let placementFailed = false;

    // Track positions for this bag+threat combination
    const bagThreatPositions = new Map<string, Set<string>>();
    const threatObjs: SceneObject[] = []; // Create empty array first
    
    for (const threat of selectedThreats) {
      const placement = generateSingleThreatPlacement(
        bag, threat, bagObj, bag.id, bagThreatPositions, threatObjs
      );

      if (!placement) {
        placementFailed = true;
        break;
      }

      placedThreats.push({ item: threat, ...placement });
    }

    if (placementFailed) continue;

    // Create threat scene objects after all placed
    for (let i = 0; i < placedThreats.length; i++) {
      const pt = placedThreats[i];
      threatObjs.push(createThreatSceneObject(pt.item, pt.x, pt.y, pt.rotation, i + 1));
    }

    // Select and place non-threats based on distribution
    let nonThreatPositions: { x: number; y: number; rotation: number }[] | null = [];
    let selectedNonThreats: Item[] = [];

    if (nonThreats.length > 0) {
      const nonThreatCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length, requireAtLeastOneNonThreat);
      selectedNonThreats = pickRandomK(nonThreats, nonThreatCount);
    }

    if (selectedNonThreats.length > 0) {
      nonThreatPositions = tryPlaceNonThreats(selectedNonThreats, bagObj, threatObjs);
      if (!nonThreatPositions) continue; // Couldn't place non-threats, skip
    }

    // Build the result
    const objects: SceneObject[] = [bagObj];
    let layer = 1;

    // Add non-threats
    selectedNonThreats.forEach((item, idx) => {
      const ntObj = createNonThreatSceneObject(
        item,
        nonThreatPositions![idx].x,
        nonThreatPositions![idx].y,
        nonThreatPositions![idx].rotation,
        layer++
      );
      objects.push(ntObj);
    });

    // Add threats (on top, preserving ordering)
    for (const tObj of threatObjs) {
      objects.push({ ...tObj, layer: layer++ });
    }

    // Generate unique synthesized ID
    const generatedId = nextId
      ? { id: nextId(usedIds) }
      : generateSynthesizedId(bag.id, Array.from(usedIds));
    if (!nextId) usedIds.add(generatedId.id);

    results.push({
      id: generatedId.id,
      bag,
      threats: placedThreats.map(pt => pt.item),
      others: selectedNonThreats,
      objects,
    });
  }

  // Determine failure
  let failure: FailureLog | null = null;
  if (results.length < totalTarget) {
    if (results.length === 0) {
      failure = {
        bagName: bag.name,
        bagId: bag.id,
        threatName: threats.map(t => t.name).join(", "),
        threatId: threats.map(t => t.id).join(","),
        reason: `No multi-threat combination could be placed in bag "${bag.name}"`,
        expected: totalTarget,
        actual: 0,
      };
    } else {
      failure = {
        bagName: bag.name,
        bagId: bag.id,
        threatName: threats.map(t => t.name).join(", "),
        threatId: threats.map(t => t.id).join(","),
        reason: `Only ${results.length} of ${totalTarget} multi-threat combos found for bag "${bag.name}"`,
        expected: totalTarget,
        actual: results.length,
      };
    }
  }

  return { results, failure };
}

/**
 * Generate unique placements for a (bag, threat) pair (single threat per combo).
 */
function generateThreatPlacements(
  bag: Item,
  threat: Item,
  target: number,
  nonThreats: Item[],
  nonThreatDistribution: Record<number, number>,
  existingUsed?: Set<string>,
  globalUsedIds?: Set<string>
): { results: CombinatorialResult[]; failure: FailureLog | null } {
  const results: CombinatorialResult[] = [];
  const usedPlacements = existingUsed ?? new Set<string>();
  const usedIds = globalUsedIds ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);

  const candidates = buildPositionRotationCandidates(bagObj, threat, target);
  // OPTIMIZATION: Reduced max attempts (was target * 100, 2000, now target * 50, 1000)
  const maxAttempts = Math.min(candidates.length, Math.max(target * 50, 1000));

  for (let idx = 0; idx < candidates.length && results.length < target && idx < maxAttempts; idx++) {
    const cand = candidates[idx];
    const pos = { x: cand.x, y: cand.y };
    const rotation = cand.rotation;

    // Check if this placement is valid
    if (!tryPlaceThreat(threat, bagObj, pos.x, pos.y, rotation)) continue;

    // Check uniqueness
    const hash = placementHash(threat.id, pos.x, pos.y, rotation);
    if (usedPlacements.has(hash)) continue;

    // Create threat scene object
    const threatObj = createThreatSceneObject(threat, pos.x, pos.y, rotation, 1);

    // Select and place non-threats based on distribution
    let nonThreatPositions: { x: number; y: number; rotation: number }[] | null = [];
    let selectedNonThreats: Item[] = [];

    if (nonThreats.length > 0) {
      const nonThreatCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length);
      selectedNonThreats = pickRandomK(nonThreats, nonThreatCount);
    }

    if (selectedNonThreats.length > 0) {
      nonThreatPositions = tryPlaceNonThreats(selectedNonThreats, bagObj, [threatObj]);
      if (!nonThreatPositions) continue;
    }

    // Build the result
    usedPlacements.add(hash);

    const objects: SceneObject[] = [bagObj];
    let layer = 1;

    // Add non-threats
    selectedNonThreats.forEach((item, idx) => {
      const ntObj = createNonThreatSceneObject(
        item,
        nonThreatPositions![idx].x,
        nonThreatPositions![idx].y,
        nonThreatPositions![idx].rotation,
        layer++
      );
      objects.push(ntObj);
    });

    // Add threat (on top)
    objects.push({ ...threatObj, layer: layer++ });

    // Generate unique synthesized ID using global used IDs set
    const generatedId = generateSynthesizedId(bag.id, Array.from(usedIds));
    usedIds.add(generatedId.id);
    results.push({
      id: generatedId.id,
      bag,
      threats: [threat],
      others: selectedNonThreats,
      objects,
    });
  }

  // Determine if there's a failure
  let failure: FailureLog | null = null;
  if (results.length < target) {
    if (results.length === 0) {
      failure = {
        bagName: bag.name,
        bagId: bag.id,
        threatName: threat.name,
        threatId: threat.id,
        reason: `Threat "${threat.name}" does not fit inside bag "${bag.name}" at any rotation or position`,
        expected: target,
        actual: 0,
      };
    } else {
      failure = {
        bagName: bag.name,
        bagId: bag.id,
        threatName: threat.name,
        threatId: threat.id,
        reason: `Only ${results.length} of ${target} unique placements found for threat "${threat.name}" in bag "${bag.name}"`,
        expected: target,
        actual: results.length,
      };
    }
  }

  return { results, failure };
}

/**
 * Generate unique clean combos (no threat) for a bag.
 * Uniqueness comes from non-threat subsets and their positions/rotations.
 */
function generateCleanCombinations(
  bag: Item,
  target: number,
  nonThreats: Item[],
  nonThreatDistribution: Record<number, number>,
  requireAtLeastOneNonThreat: boolean = false,
  globalUsedIds?: Set<string>,
  nextId?: (usedIds: Set<string>) => string
): CombinatorialResult[] {
  const results: CombinatorialResult[] = [];
  const usedHashes = new Set<string>();
  const usedIds = globalUsedIds ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);

  // OPTIMIZATION: Reduced max attempts (was target * 50, 1000, now target * 30, 500)
  const maxAttempts = Math.min(3000, Math.max(target * 30, 500));

  for (let attempt = 0; attempt < maxAttempts && results.length < target; attempt++) {
    // Select non-threat subset based on distribution
    let selectedNonThreats: Item[];
    if (nonThreats.length === 0) {
      selectedNonThreats = [];
    } else {
      const nonThreatCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length, requireAtLeastOneNonThreat);
      selectedNonThreats = pickRandomK(nonThreats, nonThreatCount);
    }

    // If requireAtLeastOneNonThreat is true and no non-threats selected, skip this attempt
    if (requireAtLeastOneNonThreat && selectedNonThreats.length === 0) {
      continue;
    }

    if (selectedNonThreats.length === 0) {
      // Empty bag combo - only one unique version
      const hash = "empty_bag";
      if (usedHashes.has(hash)) continue;
      usedHashes.add(hash);

      // Generate unique synthesized ID using global used IDs set
      const generatedId = nextId
        ? { id: nextId(usedIds) }
        : generateSynthesizedId(bag.id, Array.from(usedIds));
      if (!nextId) usedIds.add(generatedId.id);
      results.push({
        id: generatedId.id,
        bag,
        threats: [],
        others: [],
        objects: [bagObj],
      });
      continue;
    }

    // Try to place non-threats
    const positions = tryPlaceNonThreats(selectedNonThreats, bagObj, []);
    if (!positions) continue;

    // Check uniqueness
    const hash = nonThreatComboHash(
      selectedNonThreats.map(nt => nt.id),
      positions
    );
    if (usedHashes.has(hash)) continue;
    usedHashes.add(hash);

    // Build result
    const objects: SceneObject[] = [bagObj];
    let layer = 1;
    selectedNonThreats.forEach((item, idx) => {
      const ntObj = createNonThreatSceneObject(
        item,
        positions[idx].x,
        positions[idx].y,
        positions[idx].rotation,
        layer++
      );
      objects.push(ntObj);
    });

    // Generate unique synthesized ID using global used IDs set
    const generatedId = nextId
      ? { id: nextId(usedIds) }
      : generateSynthesizedId(bag.id, Array.from(usedIds));
    if (!nextId) usedIds.add(generatedId.id);
    results.push({
      id: generatedId.id,
      bag,
      threats: [],
      others: selectedNonThreats,
      objects,
    });
  }

  return results;
}

/**
 * Main function: Generate K combinations from selected items.
 *
 * Distribution strategy:
 * - Uses weighted random selection for bags, where bags that have been used less frequently
 *   get higher weight, ensuring the dataset is unbiased towards any subset of bags
 * - For each selected bag, distributes evenly across threats (if any)
 * - Supports multi-threat combos: when threats are available, each combo gets 1-4 random threats
 *   based on the percentage distribution provided
 * - If a bag can't generate combinations, it's marked as exhausted
 *
 * @param bags - Selected bag items
 * @param threats - Selected threat items
 * @param nonThreats - Selected non-threat items
 * @param k - Target number of combinations
 * @param threatDistribution - Percentage distribution for threat counts, e.g. {1: 60, 2: 20, 3: 10, 4: 10}
 * @param nonThreatDistribution - Percentage distribution for non-threat counts, e.g. {1: 60, 2: 20, 3: 10, 4: 10}
 * @param requireAtLeastOneNonThreat - If true, ensures every combination has at least one non-threat
 * @returns GenerationResult with results array and failures array
 */
export async function generateCombinations(
  bags: Item[],
  threats: Item[],
  nonThreats: Item[],
  k: number,
  threatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  nonThreatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  requireAtLeastOneNonThreat: boolean = false,
  existingIds: string[] = []
): Promise<GenerationResult> {
  const startTime = Date.now();
  
  if (bags.length === 0) {
    console.log(`[CombinationGenerator] No bags provided, exiting early`);
    return { results: [], failures: [] };
  }
  if (k <= 0) {
    console.log(`[CombinationGenerator] k <= 0, exiting early`);
    return { results: [], failures: [] };
  }
  
  console.log(`[CombinationGenerator] Starting generation:`, {
    k,
    bags: bags.length,
    threats: threats.length,
    nonThreats: nonThreats.length,
    threatDistribution,
    nonThreatDistribution,
    requireAtLeastOneNonThreat,
    existingIdsCount: existingIds.length
  });

  // Validate distributions - ensure they have at least one non-zero value
  const hasValidThreatDist = Object.values(threatDistribution).some(v => v > 0);
  const hasValidNonThreatDist = Object.values(nonThreatDistribution).some(v => v > 0);
  
  if (!hasValidThreatDist && threats.length > 0) {
    threatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  }
  if (!hasValidNonThreatDist && nonThreats.length > 0) {
    nonThreatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  }

  const results: CombinatorialResult[] = [];
  const failures: FailureLog[] = [];
  const seenFailures = new Set<string>(); // Avoid duplicate failure logs
  // Seed with previously-saved IDs so the sequence continues from the highest
  // counter for the current date prefix instead of restarting at 00001.
  const usedIds = new Set<string>(existingIds); // Track all generated IDs globally

  // Bug #2 fix: pre-compute the next sequence number ONCE from existingIds so
  // that every subsequent ID generation is O(1) instead of O(N) per combo.
  (function initIdCounter() {
    const now = new Date();
    const day   = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year  = String(now.getFullYear()).slice(-2);
    _idBasePrefix = `SB${day}${month}${year}`;
    let maxSeq = 0;
    for (const id of existingIds) {
      if (id.startsWith(_idBasePrefix + '-')) {
        const suffix = id.slice(_idBasePrefix.length + 1);
        if (suffix.length >= 6) {
          const letter = suffix.charAt(0);
          const num = parseInt(suffix.slice(1), 10);
          if (!isNaN(num) && letter >= 'A' && letter <= 'Z') {
            const seq = (letter.charCodeAt(0) - 65) * 99999 + num;
            if (seq > maxSeq) maxSeq = seq;
          }
        }
      }
    }
    _idSequence = maxSeq + 1;
  })();

  type BagEntry = {
    bag: Item;
    hasValidRegion: boolean;
    usageCount: number;
    isExhausted: boolean;
  };

  const bagEntries: BagEntry[] = [];

  // Initialize bag entries
  for (const bag of bags) {
    const hasValidRegion = !!(bag.valid_region_points && (Array.isArray(bag.valid_region_points) ? bag.valid_region_points.length > 0 : true));

    bagEntries.push({
      bag,
      hasValidRegion,
      usageCount: 0,
      isExhausted: false
    });
  }

  /**
   * Weighted random selection:
   * - Weight is inversely proportional to usage count
   * - Exhausted entries have weight 0
   */
  function selectWeightedBag(): BagEntry | null {
    const available = bagEntries.filter(p => !p.isExhausted);
    if (available.length === 0) return null;

    const maxUsage = Math.max(...available.map(p => p.usageCount), 1);

    let totalWeight = 0;
    const weighted = available.map(p => {
      const weight = maxUsage - p.usageCount + 1;
      totalWeight += weight;
      return { entry: p, weight, cumulative: totalWeight };
    });

    const random = Math.random() * totalWeight;
    for (const w of weighted) {
      if (random <= w.cumulative) {
        return w.entry;
      }
    }

    return available[0];
  }

  /**
   * Try to generate one combination for a bag entry
   */
  function tryGenerateOne(entry: BagEntry): CombinatorialResult | null {
    if (!entry.hasValidRegion) {
      entry.isExhausted = true;
      const failureKey = `${entry.bag.id}-novalidregion`;
      if (!seenFailures.has(failureKey)) {
        seenFailures.add(failureKey);
        failures.push({
          bagName: entry.bag.name,
          bagId: entry.bag.id,
          threatName: "N/A",
          threatId: "N/A",
          reason: `Bag "${entry.bag.name}" has no valid region defined — cannot place any items`,
          expected: 1,
          actual: 0,
        });
      }
      return null;
    }

    if (threats.length > 0) {
      // Multi-threat mode: generate threats per combo based on distribution
      // Calculate target counts for each threat count based on distribution
      const targetByCount: Record<number, { min: number; target: number; max: number }> = {};
      const totalWeight = Object.values(threatDistribution).reduce((sum, w) => sum + w, 0);
      const tolerance = 0.05;
      
      for (const [count, weight] of Object.entries(threatDistribution)) {
        const countNum = parseInt(count);
        if (countNum <= threats.length && weight > 0) {
          const target = Math.round((weight / totalWeight) * k);
          targetByCount[countNum] = {
            min: Math.max(0, Math.floor(target * (1 - tolerance))),
            target,
            max: Math.ceil(target * (1 + tolerance))
          };
        }
      }

      const { results: placements, failure } = generateMultiThreatPlacements(
        entry.bag,
        threats,
        targetByCount,
        nonThreats,
        nonThreatDistribution,
        requireAtLeastOneNonThreat,
        usedIds,
        nextSynthesizedId
      );
      if (placements.length > 0) {
        entry.usageCount++;
        return placements[0];
      } else {
        entry.isExhausted = true;
        if (failure) {
          const failureKey = `${entry.bag.id}-multi-threat`;
          if (!seenFailures.has(failureKey)) {
            seenFailures.add(failureKey);
            failures.push(failure);
          }
        }
        return null;
      }
    } else {
      // Clean combo (no threats)
      const placements = generateCleanCombinations(
        entry.bag,
        1,
        nonThreats,
        nonThreatDistribution,
        requireAtLeastOneNonThreat,
        usedIds,
        nextSynthesizedId
      );
      if (placements.length > 0) {
        entry.usageCount++;
        return placements[0];
      } else {
        entry.isExhausted = true;
        return null;
      }
    }
  }

  /**
   * Adaptive generation loop:
   * Instead of batching per threat count (which drops remaining capacity on failure),
   * we use a single unified loop that tracks remaining targets per threat count.
   * When a threat count fails too many consecutive times, its remaining target
   * is redistributed to other threat counts proportionally.
   */
  const maxConsecutiveFailures = bagEntries.length * 3;

  // Pre-calculate target distribution with tolerance (5%)
  const targetByCount: Record<number, { min: number; target: number; max: number }> = {};
  const distributionWeights: Record<number, number> = {};
  if (threats.length > 0) {
    const totalWeight = Object.values(threatDistribution).reduce((sum, w) => sum + w, 0);
    const tolerance = 0.05; // 5% tolerance
    
    // Calculate targets with min/max bounds
    const targets: { count: number; min: number; target: number; max: number; weight: number }[] = [];
    for (const [count, weight] of Object.entries(threatDistribution)) {
      const countNum = parseInt(count);
      if (countNum <= threats.length && weight > 0) {
        const target = Math.round((weight / totalWeight) * k);
        targets.push({
          count: countNum,
          min: Math.max(0, Math.floor(target * (1 - tolerance))),
          target: target,
          max: Math.ceil(target * (1 + tolerance)),
          weight
        });
      }
    }

    // Convert to records
    for (const t of targets) {
      if (t.target > 0) {
        targetByCount[t.count] = { min: t.min, target: t.target, max: t.max };
        distributionWeights[t.count] = t.weight;
      }
    }
  }

  // If we have threats with distribution targets, use adaptive unified loop.
  // Otherwise, fall back to the original linear loop (clean combos).
  if (threats.length > 0 && Object.keys(targetByCount).length > 0) {
    // Track remaining targets per threat count (starts at max, capped to fill k)
    let remainingByCount: Record<number, number> = {};
    let totalRemaining = 0;
    
    // Calculate initial total of all maxes
    let totalMax = 0;
    for (const bounds of Object.values(targetByCount)) {
      totalMax += bounds.max;
    }
    
    // Scale down if total max exceeds k (cap each proportionally)
    const scale = Math.min(1, k / totalMax);
    for (const [countStr, bounds] of Object.entries(targetByCount)) {
      const countNum = parseInt(countStr);
      const capped = Math.min(bounds.max, Math.max(bounds.min || 0, Math.round(bounds.max * scale)));
      remainingByCount[countNum] = capped;
      totalRemaining += capped;
    }
    
    // If after scaling we're below k, add remaining capacity proportionally
    if (totalRemaining < k && Object.keys(remainingByCount).length > 0) {
      const deficit = k - totalRemaining;
      const totalWeight = Object.values(distributionWeights).reduce((s, w) => s + w, 0);
      // Distribute deficit proportionally by original weight
      const counts = Object.keys(remainingByCount).map(Number);
      for (const countNum of counts) {
        const weight = distributionWeights[countNum] || 0;
        const extra = Math.round((weight / totalWeight) * deficit);
        remainingByCount[countNum] += extra;
        totalRemaining += extra;
      }
      // Final adjust to hit exactly k (trim from highest weighted count)
      if (totalRemaining > k) {
        const sorted = counts.sort((a, b) => (distributionWeights[b] || 0) - (distributionWeights[a] || 0));
        for (const countNum of sorted) {
          const excess = totalRemaining - k;
          const canRemove = Math.min(excess, remainingByCount[countNum] - (targetByCount[countNum]?.min || 0));
          if (canRemove > 0) {
            remainingByCount[countNum] -= canRemove;
            totalRemaining -= canRemove;
          }
          if (totalRemaining <= k) break;
        }
      }
    }

    // Track consecutive failures per threat count for adaptive redistribution
    const consecutiveFailuresByCount: Record<number, number> = {};
    const exhaustedCount = new Set<number>();
    const maxConsecutivePerCount = Math.max(10, Math.ceil(k / 10)); // adaptive threshold
    
    // Main adaptive generation loop
    let attemptsWithoutProgress = 0;
    // Bug #1 fix: removed the Math.min(5000, ...) hard-cap so the loop can
    // exhaust all bags/rotations before giving up.  The limit is now generous
    // but still bounded to prevent infinite loops on truly impossible inputs.
    const maxAttemptsWithoutProgress = Math.max(k * 10, 50_000);
    let lastLogTime = Date.now();
    const LOG_INTERVAL_MS = 2000; // Log every 2 seconds
    
    console.log(`[CombinationGenerator] Entering main generation loop...`);
    
    while (results.length < k && totalRemaining > 0 && attemptsWithoutProgress < maxAttemptsWithoutProgress) {
      attemptsWithoutProgress++;
      
      // Log status every 2 seconds
      const now = Date.now();
      if (now - lastLogTime >= LOG_INTERVAL_MS) {
        lastLogTime = now;
        const exhausted = bagEntries.filter(b => b.isExhausted).length;
        console.log(`[CombinationGenerator] Status: ${results.length}/${k} generated, ${exhausted}/${bagEntries.length} bags exhausted, ${attemptsWithoutProgress} attempts without progress`);
      }
      
      // Pick a bag
      const entry = selectWeightedBag();
      if (!entry) {
        console.log(`[CombinationGenerator] No bags available - all exhausted`);
        break;
      }
      
      if (!entry.hasValidRegion) {
        entry.isExhausted = true;
        continue;
      }
      
      // Pick threat count weighted by remaining targets × distribution weight
      const activeCounts = Object.keys(remainingByCount)
        .map(Number)
        .filter(c => !exhaustedCount.has(c) && (remainingByCount[c] || 0) > 0);
      
      if (activeCounts.length === 0) {
        console.log(`[CombinationGenerator] No active threat counts remaining`);
        break;
      }
      
      // Weighted selection: higher weight = higher chance
      let selectionTotalWeight = 0;
      const selectionWeights: { count: number; weight: number; cumulative: number }[] = [];
      for (const countNum of activeCounts) {
        const remaining = remainingByCount[countNum] || 0;
        const distWeight = distributionWeights[countNum] || 1;
        // Weight by both remaining need and original distribution preference
        const weight = remaining * distWeight;
        selectionTotalWeight += weight;
        selectionWeights.push({
          count: countNum,
          weight,
          cumulative: selectionTotalWeight
        });
      }
      
      const selectionRandom = Math.random() * selectionTotalWeight;
      let selectedCount = activeCounts[0];
      for (const sw of selectionWeights) {
        if (selectionRandom <= sw.cumulative) {
          selectedCount = sw.count;
          break;
        }
      }
      
      // Try to generate one combo with this threat count
      const selectedThreats = pickRandomK(threats, selectedCount);
      const bagObj = createBagSceneObject(entry.bag);
      
      // Place threats with position tracking
      const placedThreats: { item: Item; x: number; y: number; rotation: number }[] = [];
      let placementFailed = false;
      
      // Track positions for this bag+threat combination
      const bagThreatPositions = new Map<string, Set<string>>();
      const threatObjs: SceneObject[] = [];
      
      for (const threat of selectedThreats) {
        const placement = generateSingleThreatPlacement(
          entry.bag, threat, bagObj, entry.bag.id, bagThreatPositions, threatObjs
        );
        
        if (!placement) {
          placementFailed = true;
          break;
        }
        
        placedThreats.push({ item: threat, ...placement });
      }
      
      if (placementFailed) {
        // Track consecutive failure for this threat count
        consecutiveFailuresByCount[selectedCount] = (consecutiveFailuresByCount[selectedCount] || 0) + 1;
        
        // If too many consecutive failures, redistribute this count's remaining to others
        if (consecutiveFailuresByCount[selectedCount] >= maxConsecutivePerCount && !exhaustedCount.has(selectedCount)) {
          console.log(`[CombinationGenerator] Exhausting ${selectedCount}-threat count after ${consecutiveFailuresByCount[selectedCount]} failures`);
          exhaustedCount.add(selectedCount);
          const failedRemaining = remainingByCount[selectedCount] || 0;
          delete remainingByCount[selectedCount];
          totalRemaining -= failedRemaining;
          
          // Redistribute to other active counts proportionally
          if (failedRemaining > 0 && activeCounts.length > 1) {
            const otherCounts = activeCounts.filter(c => c !== selectedCount);
            const otherTotalWeight = otherCounts.reduce((s, c) => s + (distributionWeights[c] || 1), 0);
            if (otherTotalWeight > 0) {
              for (const otherCount of otherCounts) {
                const share = Math.round((failedRemaining * (distributionWeights[otherCount] || 1)) / otherTotalWeight);
                if (share > 0) {
                  remainingByCount[otherCount] = (remainingByCount[otherCount] || 0) + share;
                  totalRemaining += share;
                }
              }
              // Ensure total stays consistent
              if (totalRemaining > k - results.length) {
                const excess = totalRemaining - (k - results.length);
                // Trim from highest remaining
                const sortedOthers = [...otherCounts].sort((a, b) => (remainingByCount[b] || 0) - (remainingByCount[a] || 0));
                let trimmed = 0;
                for (const c of sortedOthers) {
                  const canTrim = Math.min(excess - trimmed, remainingByCount[c] || 0);
                  if (canTrim > 0) {
                    remainingByCount[c] = (remainingByCount[c] || 0) - canTrim;
                    totalRemaining -= canTrim;
                    trimmed += canTrim;
                  }
                  if (trimmed >= excess) break;
                }
              }
            }
            
            // Log redistribution as a failure
            const failureKey = `${entry.bag.id}-redistribute-${selectedCount}`;
            if (!seenFailures.has(failureKey)) {
              seenFailures.add(failureKey);
              failures.push({
                bagName: entry.bag.name,
                bagId: entry.bag.id,
                threatName: threats.map(t => t.name).join(", "),
                threatId: threats.map(t => t.id).join(","),
                reason: `Redistributed ${failedRemaining} remaining combos from ${selectedCount}-threat count to other counts (too many consecutive failures)`,
                expected: failedRemaining,
                actual: 0,
              });
            }
          }
        }
        continue;
      }
      
      // Create threat scene objects after all placed
      for (let i = 0; i < placedThreats.length; i++) {
        const pt = placedThreats[i];
        threatObjs.push(createThreatSceneObject(pt.item, pt.x, pt.y, pt.rotation, i + 1));
      }
      
      // Select and place non-threats
      let nonThreatPositions: { x: number; y: number; rotation: number }[] | null = [];
      let selectedNonThreats: Item[] = [];
      
      if (nonThreats.length > 0) {
        const nonThreatCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length, requireAtLeastOneNonThreat);
        selectedNonThreats = pickRandomK(nonThreats, nonThreatCount);
      }
      
      if (selectedNonThreats.length > 0) {
        nonThreatPositions = tryPlaceNonThreats(selectedNonThreats, bagObj, threatObjs);
        if (!nonThreatPositions) {
          // Non-threat placement failed — this is a placement failure for this count too
          consecutiveFailuresByCount[selectedCount] = (consecutiveFailuresByCount[selectedCount] || 0) + 1;
          continue;
        }
      }
      
      // Build the result
      const objects: SceneObject[] = [bagObj];
      let layer = 1;
      
      selectedNonThreats.forEach((item, idx) => {
        const ntObj = createNonThreatSceneObject(
          item,
          nonThreatPositions![idx].x,
          nonThreatPositions![idx].y,
          nonThreatPositions![idx].rotation,
          layer++
        );
        objects.push(ntObj);
      });
      
      for (const tObj of threatObjs) {
        objects.push({ ...tObj, layer: layer++ });
      }
      
      // Generate unique synthesized ID
      // Bug #2 fix: use the O(1) module-level counter instead of scanning the
      // full usedIds array on every combo.
      const generatedId = nextSynthesizedId(usedIds);
      usedIds.add(generatedId);
      
      results.push({
        id: generatedId,
        bag: entry.bag,
        threats: placedThreats.map(pt => pt.item),
        others: selectedNonThreats,
        objects,
      });
      
      // Success: decrement remaining for this count
      remainingByCount[selectedCount] = (remainingByCount[selectedCount] || 0) - 1;
      totalRemaining--;
      entry.usageCount++;
      attemptsWithoutProgress = 0;
      consecutiveFailuresByCount[selectedCount] = 0;

      // Yield to UI every 50 combinations and report progress
      if (results.length % 50 === 0) {
        console.log(`[CombinationGenerator] Progress: ${results.length}/${k} (${((results.length/k)*100).toFixed(1)}%)`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  } else {
    // Fallback to original logic if no threats or no distribution
    let consecutiveFailures = 0;
    while (results.length < k && consecutiveFailures < maxConsecutiveFailures) {
      const entry = selectWeightedBag();
      if (!entry) break;

      const combo = tryGenerateOne(entry);
      if (combo) {
        results.push(combo);
        consecutiveFailures = 0;
        
        // Report progress every 50 combinations
        if (results.length % 50 === 0) {
          console.log(`[CombinationGenerator] Progress: ${results.length}/${k} (${((results.length/k)*100).toFixed(1)}%)`);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } else {
        consecutiveFailures++;
      }
    }
  }

  const endTime = Date.now();
  const elapsed = endTime - startTime;
  
  console.log(`[CombinationGenerator] Completed in ${elapsed}ms`, {
    requested: k,
    generated: results.length,
    failures: failures.length,
    avgTimePerCombo: results.length > 0 ? `${(elapsed / results.length).toFixed(2)}ms` : 'N/A'
  });
  
  return { results, failures };
}

export function testGenerationSpeed() {
  console.log("Testing generation speed with sample data...");
  // This function can be called from console to test
  return { message: "Use generateCombinationsIncremental directly for testing" };
}

/**
 * Generate K combinations with incremental batch callbacks.
 * Same as generateCombinations but calls onBatch every INCREMENTAL_BATCH_SIZE combos.
 * This allows the UI to render combinations progressively as they're generated.
 */
export async function generateCombinationsIncremental(
  bags: Item[],
  threats: Item[],
  nonThreats: Item[],
  k: number,
  onBatch: (batch: CombinatorialResult[], progress: { generated: number; total: number }) => void,
  threatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  nonThreatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  requireAtLeastOneNonThreat: boolean = false,
  existingIds: string[] = [],
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<GenerationResult> {
  const effectiveBatchSize = Math.max(1, batchSize);
  const startTime = Date.now();
  
  if (bags.length === 0) {
    console.log(`[CombinationGenerator] No bags provided, exiting early`);
    return { results: [], failures: [] };
  }
  if (k <= 0) {
    console.log(`[CombinationGenerator] k <= 0, exiting early`);
    return { results: [], failures: [] };
  }
  
  console.log(`[CombinationGenerator] Starting incremental generation:`, {
    k,
    bags: bags.length,
    threats: threats.length,
    nonThreats: nonThreats.length,
    existingIdsCount: existingIds.length
  });

  // Validate distributions
  const hasValidThreatDist = Object.values(threatDistribution).some(v => v > 0);
  const hasValidNonThreatDist = Object.values(nonThreatDistribution).some(v => v > 0);
  
  if (!hasValidThreatDist && threats.length > 0) {
    threatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  }
  if (!hasValidNonThreatDist && nonThreats.length > 0) {
    nonThreatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  }

  const results: CombinatorialResult[] = [];
  const failures: FailureLog[] = [];
  const seenFailures = new Set<string>();
  const usedIds = new Set<string>(existingIds);

  // Bug #2 fix: pre-compute the next sequence number ONCE from existingIds so
  // that every subsequent ID generation is O(1) instead of O(N) per combo.
  // We replicate the same date-prefix logic used by generateSynthesizedId.
  (function initIdCounter() {
    const now = new Date();
    const day   = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year  = String(now.getFullYear()).slice(-2);
    _idBasePrefix = `SB${day}${month}${year}`;
    let maxSeq = 0;
    for (const id of existingIds) {
      if (id.startsWith(_idBasePrefix + '-')) {
        const suffix = id.slice(_idBasePrefix.length + 1);
        if (suffix.length >= 6) {
          const letter = suffix.charAt(0);
          const num = parseInt(suffix.slice(1), 10);
          if (!isNaN(num) && letter >= 'A' && letter <= 'Z') {
            const seq = (letter.charCodeAt(0) - 65) * 99999 + num;
            if (seq > maxSeq) maxSeq = seq;
          }
        }
      }
    }
    _idSequence = maxSeq + 1;
  })();

  type BagEntry = {
    bag: Item;
    hasValidRegion: boolean;
    usageCount: number;
    isExhausted: boolean;
  };

  const bagEntries: BagEntry[] = [];
  for (const bag of bags) {
    const hasValidRegion = !!(bag.valid_region_points && (Array.isArray(bag.valid_region_points) ? bag.valid_region_points.length > 0 : true));
    bagEntries.push({ bag, hasValidRegion, usageCount: 0, isExhausted: false });
  }

  function selectWeightedBag(): BagEntry | null {
    const available = bagEntries.filter(p => !p.isExhausted);
    if (available.length === 0) return null;
    const maxUsage = Math.max(...available.map(p => p.usageCount), 1);
    let totalWeight = 0;
    const weighted = available.map(p => {
      const weight = maxUsage - p.usageCount + 1;
      totalWeight += weight;
      return { entry: p, weight, cumulative: totalWeight };
    });
    const random = Math.random() * totalWeight;
    for (const w of weighted) {
      if (random <= w.cumulative) return w.entry;
    }
    return available[0];
  }

  /**
   * Try to generate one combination for a bag entry (for clean combos fallback)
   */
  function tryGenerateOne(entry: BagEntry): CombinatorialResult | null {
    if (!entry.hasValidRegion) {
      entry.isExhausted = true;
      const failureKey = `${entry.bag.id}-novalidregion`;
      if (!seenFailures.has(failureKey)) {
        seenFailures.add(failureKey);
        failures.push({
          bagName: entry.bag.name,
          bagId: entry.bag.id,
          threatName: "N/A",
          threatId: "N/A",
          reason: `Bag "${entry.bag.name}" has no valid region defined — cannot place any items`,
          expected: 1,
          actual: 0,
        });
      }
      return null;
    }

    if (threats.length > 0) {
      const targetByCount: Record<number, { min: number; target: number; max: number }> = {};
      const totalWeight = Object.values(threatDistribution).reduce((sum, w) => sum + w, 0);
      const tolerance = 0.05;
      for (const [count, weight] of Object.entries(threatDistribution)) {
        const countNum = parseInt(count);
        if (countNum <= threats.length && weight > 0) {
          const target = Math.round((weight / totalWeight) * k);
          targetByCount[countNum] = {
            min: Math.max(0, Math.floor(target * (1 - tolerance))),
            target,
            max: Math.ceil(target * (1 + tolerance))
          };
        }
      }
      const { results: placements, failure } = generateMultiThreatPlacements(
        entry.bag, threats, targetByCount, nonThreats, nonThreatDistribution, requireAtLeastOneNonThreat, usedIds, nextSynthesizedId
      );
      if (placements.length > 0) {
        entry.usageCount++;
        return placements[0];
      } else {
        entry.isExhausted = true;
        if (failure) {
          const failureKey = `${entry.bag.id}-multi-threat`;
          if (!seenFailures.has(failureKey)) {
            seenFailures.add(failureKey);
            failures.push(failure);
          }
        }
        return null;
      }
    } else {
      const placements = generateCleanCombinations(entry.bag, 1, nonThreats, nonThreatDistribution, requireAtLeastOneNonThreat, usedIds, nextSynthesizedId);
      if (placements.length > 0) {
        entry.usageCount++;
        return placements[0];
      } else {
        entry.isExhausted = true;
        return null;
      }
    }
  }

  const maxConsecutiveFailures = bagEntries.length * 3;

  // Pre-calculate target distribution
  const targetByCount: Record<number, { min: number; target: number; max: number }> = {};
  const distributionWeights: Record<number, number> = {};
  if (threats.length > 0) {
    const totalWeight = Object.values(threatDistribution).reduce((sum, w) => sum + w, 0);
    const tolerance = 0.05;
    const targets: { count: number; min: number; target: number; max: number; weight: number }[] = [];
    for (const [count, weight] of Object.entries(threatDistribution)) {
      const countNum = parseInt(count);
      if (countNum <= threats.length && weight > 0) {
        const target = Math.round((weight / totalWeight) * k);
        targets.push({
          count: countNum,
          min: Math.max(0, Math.floor(target * (1 - tolerance))),
          target,
          max: Math.ceil(target * (1 + tolerance)),
          weight
        });
      }
    }
    for (const t of targets) {
      if (t.target > 0) {
        targetByCount[t.count] = { min: t.min, target: t.target, max: t.max };
        distributionWeights[t.count] = t.weight;
      }
    }
  }

  if (threats.length > 0 && Object.keys(targetByCount).length > 0) {
    let remainingByCount: Record<number, number> = {};
    let totalRemaining = 0;
    let totalMax = 0;
    for (const bounds of Object.values(targetByCount)) totalMax += bounds.max;
    const scale = Math.min(1, k / totalMax);
    for (const [countStr, bounds] of Object.entries(targetByCount)) {
      const countNum = parseInt(countStr);
      const capped = Math.min(bounds.max, Math.max(bounds.min || 0, Math.round(bounds.max * scale)));
      remainingByCount[countNum] = capped;
      totalRemaining += capped;
    }
    if (totalRemaining < k && Object.keys(remainingByCount).length > 0) {
      const deficit = k - totalRemaining;
      const totalWeight = Object.values(distributionWeights).reduce((s, w) => s + w, 0);
      const counts = Object.keys(remainingByCount).map(Number);
      for (const countNum of counts) {
        const weight = distributionWeights[countNum] || 0;
        const extra = Math.round((weight / totalWeight) * deficit);
        remainingByCount[countNum] += extra;
        totalRemaining += extra;
      }
      if (totalRemaining > k) {
        const sorted = counts.sort((a, b) => (distributionWeights[b] || 0) - (distributionWeights[a] || 0));
        for (const countNum of sorted) {
          const excess = totalRemaining - k;
          const canRemove = Math.min(excess, remainingByCount[countNum] - (targetByCount[countNum]?.min || 0));
          if (canRemove > 0) {
            remainingByCount[countNum] -= canRemove;
            totalRemaining -= canRemove;
          }
          if (totalRemaining <= k) break;
        }
      }
    }

    const consecutiveFailuresByCount: Record<number, number> = {};
    const exhaustedCount = new Set<number>();
    const maxConsecutivePerCount = Math.max(10, Math.ceil(k / 10));
    let attemptsWithoutProgress = 0;
    // Bug #1 fix: removed the Math.min(5000, ...) hard-cap so the loop can
    // exhaust all bags/rotations before giving up.  The limit is now generous
    // but still bounded to prevent infinite loops on truly impossible inputs.
    const maxAttemptsWithoutProgress = Math.max(k * 10, 50_000);
    let lastBatchIndex = 0;

    while (results.length < k && totalRemaining > 0 && attemptsWithoutProgress < maxAttemptsWithoutProgress) {
      attemptsWithoutProgress++;
      const entry = selectWeightedBag();
      if (!entry) break;
      if (!entry.hasValidRegion) { entry.isExhausted = true; continue; }

      const activeCounts = Object.keys(remainingByCount)
        .map(Number)
        .filter(c => !exhaustedCount.has(c) && (remainingByCount[c] || 0) > 0);
      if (activeCounts.length === 0) break;

      let selectionTotalWeight = 0;
      const selectionWeights: { count: number; weight: number; cumulative: number }[] = [];
      for (const countNum of activeCounts) {
        const remaining = remainingByCount[countNum] || 0;
        const distWeight = distributionWeights[countNum] || 1;
        const weight = remaining * distWeight;
        selectionTotalWeight += weight;
        selectionWeights.push({ count: countNum, weight, cumulative: selectionTotalWeight });
      }
      const selectionRandom = Math.random() * selectionTotalWeight;
      let selectedCount = activeCounts[0];
      for (const sw of selectionWeights) {
        if (selectionRandom <= sw.cumulative) { selectedCount = sw.count; break; }
      }

      const selectedThreats = pickRandomK(threats, selectedCount);
      const bagObj = createBagSceneObject(entry.bag);
      const placedThreats: { item: Item; x: number; y: number; rotation: number }[] = [];
      let placementFailed = false;
      const bagThreatPositions = new Map<string, Set<string>>();
      const threatObjs: SceneObject[] = [];

      for (const threat of selectedThreats) {
        const placement = generateSingleThreatPlacement(entry.bag, threat, bagObj, entry.bag.id, bagThreatPositions, threatObjs);
        if (!placement) { placementFailed = true; break; }
        placedThreats.push({ item: threat, ...placement });
      }

      if (placementFailed) {
        consecutiveFailuresByCount[selectedCount] = (consecutiveFailuresByCount[selectedCount] || 0) + 1;
        if (consecutiveFailuresByCount[selectedCount] >= maxConsecutivePerCount && !exhaustedCount.has(selectedCount)) {
          exhaustedCount.add(selectedCount);
          const failedRemaining = remainingByCount[selectedCount] || 0;
          delete remainingByCount[selectedCount];
          totalRemaining -= failedRemaining;
          if (failedRemaining > 0 && activeCounts.length > 1) {
            const otherCounts = activeCounts.filter(c => c !== selectedCount);
            const otherTotalWeight = otherCounts.reduce((s, c) => s + (distributionWeights[c] || 1), 0);
            if (otherTotalWeight > 0) {
              for (const otherCount of otherCounts) {
                const share = Math.round((failedRemaining * (distributionWeights[otherCount] || 1)) / otherTotalWeight);
                if (share > 0) { remainingByCount[otherCount] = (remainingByCount[otherCount] || 0) + share; totalRemaining += share; }
              }
              if (totalRemaining > k - results.length) {
                const excess = totalRemaining - (k - results.length);
                const sortedOthers = [...otherCounts].sort((a, b) => (remainingByCount[b] || 0) - (remainingByCount[a] || 0));
                let trimmed = 0;
                for (const c of sortedOthers) {
                  const canTrim = Math.min(excess - trimmed, remainingByCount[c] || 0);
                  if (canTrim > 0) { remainingByCount[c] = (remainingByCount[c] || 0) - canTrim; totalRemaining -= canTrim; trimmed += canTrim; }
                  if (trimmed >= excess) break;
                }
              }
            }
            const failureKey = `${entry.bag.id}-redistribute-${selectedCount}`;
            if (!seenFailures.has(failureKey)) {
              seenFailures.add(failureKey);
              failures.push({
                bagName: entry.bag.name, bagId: entry.bag.id,
                threatName: threats.map(t => t.name).join(", "), threatId: threats.map(t => t.id).join(","),
                reason: `Redistributed ${failedRemaining} remaining combos from ${selectedCount}-threat count to other counts`,
                expected: failedRemaining, actual: 0,
              });
            }
          }
        }
        continue;
      }

      for (let i = 0; i < placedThreats.length; i++) {
        const pt = placedThreats[i];
        threatObjs.push(createThreatSceneObject(pt.item, pt.x, pt.y, pt.rotation, i + 1));
      }

      let nonThreatPositions: { x: number; y: number; rotation: number }[] | null = [];
      let selectedNonThreats: Item[] = [];
      if (nonThreats.length > 0) {
        const nonThreatCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length, requireAtLeastOneNonThreat);
        selectedNonThreats = pickRandomK(nonThreats, nonThreatCount);
      }
      if (selectedNonThreats.length > 0) {
        nonThreatPositions = tryPlaceNonThreats(selectedNonThreats, bagObj, threatObjs);
        if (!nonThreatPositions) {
          console.log(`[CombinationGenerator] Failed to place non-threats in bag ${entry.bag.name}`);
          consecutiveFailuresByCount[selectedCount] = (consecutiveFailuresByCount[selectedCount] || 0) + 1;
          continue;
        }
      }

      const objects: SceneObject[] = [bagObj];
      let layer = 1;
      selectedNonThreats.forEach((item, idx) => {
        const ntObj = createNonThreatSceneObject(item, nonThreatPositions![idx].x, nonThreatPositions![idx].y, nonThreatPositions![idx].rotation, layer++);
        objects.push(ntObj);
      });
      for (const tObj of threatObjs) objects.push({ ...tObj, layer: layer++ });

      const id = nextSynthesizedId(usedIds);
      results.push({
        id, bag: entry.bag,
        threats: placedThreats.map(pt => pt.item),
        others: selectedNonThreats, objects,
      });

      remainingByCount[selectedCount] = (remainingByCount[selectedCount] || 0) - 1;
      totalRemaining--;
      entry.usageCount++;
      attemptsWithoutProgress = 0;
      consecutiveFailuresByCount[selectedCount] = 0;

      // Emit batch callback every effectiveBatchSize combos
      if (results.length - lastBatchIndex >= effectiveBatchSize) {
        const batch = results.slice(lastBatchIndex);
        lastBatchIndex = results.length;
        onBatch(batch, { generated: results.length, total: k });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Emit any remaining results as final batch
    if (lastBatchIndex < results.length) {
      const batch = results.slice(lastBatchIndex);
      onBatch(batch, { generated: results.length, total: k });
    }
  } else {
    let consecutiveFailures = 0;
    let lastBatchIndex = 0;
    while (results.length < k && consecutiveFailures < maxConsecutiveFailures) {
      const entry = selectWeightedBag();
      if (!entry) break;
      const combo = tryGenerateOne(entry);
      if (combo) {
        results.push(combo);
        consecutiveFailures = 0;

        // Emit batch callback every effectiveBatchSize combos
        if (results.length - lastBatchIndex >= effectiveBatchSize) {
          const batch = results.slice(lastBatchIndex);
          lastBatchIndex = results.length;
          onBatch(batch, { generated: results.length, total: k });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } else {
        consecutiveFailures++;
      }
    }
    // Emit any remaining results as final batch
    if (lastBatchIndex < results.length) {
      const batch = results.slice(lastBatchIndex);
      onBatch(batch, { generated: results.length, total: k });
    }
  }

  const endTime = Date.now();
  const elapsed = endTime - startTime;
  console.log(`[CombinationGenerator] Incremental completed in ${elapsed}ms`, {
    requested: k, generated: results.length, failures: failures.length,
    avgTimePerCombo: results.length > 0 ? `${(elapsed / results.length).toFixed(2)}ms` : 'N/A'
  });

  return { results, failures };
}

// Clear cache function for testing or when needed
export function clearCombinationCache() {
  validRegionCache.clear();
}
