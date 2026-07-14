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

// Performance optimization: Cache for transformed valid regions
const validRegionCache = new Map<string, Point[]>();
const CACHE_MAX_SIZE = 100;

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
  const count = min + Math.floor(Math.random() * (max - min + 1));
  return shuffleArray(arr).slice(0, Math.min(count, arr.length));
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
 * OPTIMIZED: Reduced max attempts and added fast bounding box pre-check.
 */
function tryPlaceNonThreats(
  items: Item[],
  bagObj: SceneObject,
  threatObjs: SceneObject[],
  maxAttempts: number = 30
): { x: number; y: number; rotation: number }[] | null {
  const positions: { x: number; y: number; rotation: number }[] = [];

  for (const item of items) {
    const outline = parseOutline(item);
    const w = item.width ? Math.round(item.width) : 80;
    const h = item.height ? Math.round(item.height) : 80;

    let placed = false;
    // OPTIMIZATION: Reduced max attempts from 50 to 30
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pos = getRandomPositionInContainer(w, h, bagObj, outline);
      if (!pos) continue;
      
      // OPTIMIZATION: Fast bounding box check before expensive polygon test
      let overlapsThreat = false;
      for (const threatObj of threatObjs) {
        if (fastBoundingBoxOverlap(pos.x, pos.y, w, h, threatObj.transform.x, threatObj.transform.y, threatObj.transform.width, threatObj.transform.height)) {
          overlapsThreat = true;
          break;
        }
      }
      if (overlapsThreat) continue;

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

      // Check if inside bag
      if (!isObjectInsideContainer(testObj, bagObj)) continue;

      // Full overlap check with threats (only if bounding box overlapped)
      let fullOverlapsThreat = false;
      for (const threatObj of threatObjs) {
        if (doObjectsOverlap(testObj, threatObj)) {
          fullOverlapsThreat = true;
          break;
        }
      }
      if (fullOverlapsThreat) continue;

      // Check overlap with already placed non-threats
      let overlapsExisting = false;
      for (let i = 0; i < positions.length; i++) {
        const existingPos = positions[i];
        if (fastBoundingBoxOverlap(pos.x, pos.y, w, h, existingPos.x, existingPos.y, w, h)) {
          const existingObj: SceneObject = {
            id: "existing",
            name: "",
            library: "non-threat",
            originalPixelValue: 0,
            currentPixelValue: 0,
            oldPixelValue: null,
            stencilId: "item",
            transform: { x: existingPos.x, y: existingPos.y, width: w, height: h, rotation: existingPos.rotation },
            layer: 0,
          };
          if (doObjectsOverlap(testObj, existingObj)) {
            overlapsExisting = true;
            break;
          }
        }
      }
      if (overlapsExisting) continue;

      positions.push({ x: pos.x, y: pos.y, rotation: pos.rotation ?? 0 });
      placed = true;
      break;
    }

    if (!placed) return null; // Couldn't place this non-threat
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

  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  if (validRegion.length >= 3) {
    minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
    for (let i = 0; i < validRegion.length; i++) {
      const p = validRegion[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
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
 * Generate unique placements for a single threat inside a bag.
 * Used for multi-threat combos where each threat is placed independently.
 * Tracks used placements across a shared set.
 * OPTIMIZED: Reduced max attempts and added early termination.
 */
function generateSingleThreatPlacement(
  bag: Item,
  threat: Item,
  bagObj: SceneObject,
  target: number,
  usedPlacements: Set<string>
): { x: number; y: number; rotation: number } | null {
  const candidates = buildPositionRotationCandidates(bagObj, threat, target);
  // OPTIMIZATION: Reduced max attempts (was target * 100, 2000, now target * 50, 1000)
  const maxAttempts = Math.min(candidates.length, Math.max(target * 50, 1000));

  for (let idx = 0; idx < maxAttempts; idx++) {
    const cand = candidates[idx];
    const pos = { x: cand.x, y: cand.y };
    const rotation = cand.rotation;

    // Check if this placement is valid
    if (!tryPlaceThreat(threat, bagObj, pos.x, pos.y, rotation)) continue;

    // Check uniqueness
    const hash = placementHash(threat.id, pos.x, pos.y, rotation);
    if (usedPlacements.has(hash)) continue;

    usedPlacements.add(hash);
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
 * Generate a multi-threat combo: pick 1-4 random threats based on distribution,
 * place all inside bag without overlapping each other, then add non-threats.
 */
function generateMultiThreatPlacements(
  bag: Item,
  threats: Item[],
  target: number,
  nonThreats: Item[],
  threatDistribution: Record<number, number>,
  nonThreatDistribution: Record<number, number>,
  requireAtLeastOneNonThreat: boolean = false,
  globalUsedIds?: Set<string>
): { results: CombinatorialResult[]; failure: FailureLog | null } {
  const results: CombinatorialResult[] = [];
  const usedIds = globalUsedIds ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);

  // Track used placements per threat type to ensure diversity
  const usedPlacementsMap = new Map<string, Set<string>>();
  for (const t of threats) {
    usedPlacementsMap.set(t.id, new Set<string>());
  }

  // OPTIMIZATION: Reduced max attempts (was target * 200, 2000, now target * 100, 1000)
  const maxAttempts = Math.min(5000, Math.max(target * 100, 1000));

  for (let attempt = 0; attempt < maxAttempts && results.length < target; attempt++) {
    // Pick threat count based on percentage distribution
    const threatCount = pickThreatCountByDistribution(threatDistribution, threats.length);
    const selectedThreats = shuffleArray(threats).slice(0, threatCount);

    // Try to place all selected threats without overlap
    const placedThreats: { item: Item; x: number; y: number; rotation: number }[] = [];
    let placementFailed = false;

    for (const threat of selectedThreats) {
      const placement = generateSingleThreatPlacement(
        bag, threat, bagObj, target,
        usedPlacementsMap.get(threat.id)!
      );

      if (!placement) {
        placementFailed = true;
        break;
      }

      // Check overlap with already-placed threats
      const testObj: SceneObject = createThreatSceneObject(
        threat, placement.x, placement.y, placement.rotation, 1
      );

      let overlapsOtherThreat = false;
      for (const placed of placedThreats) {
        const otherObj = createThreatSceneObject(
          placed.item, placed.x, placed.y, placed.rotation, 1
        );
        if (doObjectsOverlap(testObj, otherObj)) {
          overlapsOtherThreat = true;
          break;
        }
      }

      if (overlapsOtherThreat) {
        // Remove the placement hash we just added since it didn't work out
        usedPlacementsMap.get(threat.id)!.delete(
          placementHash(threat.id, placement.x, placement.y, placement.rotation)
        );
        placementFailed = true;
        break;
      }

      placedThreats.push({ item: threat, ...placement });
    }

    if (placementFailed) continue;

    // Create threat scene objects
    const threatObjs: SceneObject[] = placedThreats.map((pt, i) =>
      createThreatSceneObject(pt.item, pt.x, pt.y, pt.rotation, i + 1)
    );

    // Select and place non-threats based on distribution
    let nonThreatPositions: { x: number; y: number; rotation: number }[] | null = [];
    let selectedNonThreats: Item[] = [];

    if (nonThreats.length > 0) {
      const nonThreatCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length, requireAtLeastOneNonThreat);
      selectedNonThreats = shuffleArray(nonThreats).slice(0, nonThreatCount);
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
    const generatedId = generateSynthesizedId(bag.id, Array.from(usedIds));
    usedIds.add(generatedId.id);

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
  if (results.length < target) {
    if (results.length === 0) {
      failure = {
        bagName: bag.name,
        bagId: bag.id,
        threatName: threats.map(t => t.name).join(", "),
        threatId: threats.map(t => t.id).join(","),
        reason: `No multi-threat combination could be placed in bag "${bag.name}"`,
        expected: target,
        actual: 0,
      };
    } else {
      failure = {
        bagName: bag.name,
        bagId: bag.id,
        threatName: threats.map(t => t.name).join(", "),
        threatId: threats.map(t => t.id).join(","),
        reason: `Only ${results.length} of ${target} multi-threat combos found for bag "${bag.name}"`,
        expected: target,
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
      selectedNonThreats = shuffleArray(nonThreats).slice(0, nonThreatCount);
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
  globalUsedIds?: Set<string>
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
      selectedNonThreats = shuffleArray(nonThreats).slice(0, nonThreatCount);
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
      const generatedId = generateSynthesizedId(bag.id, Array.from(usedIds));
      usedIds.add(generatedId.id);
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
    const generatedId = generateSynthesizedId(bag.id, Array.from(usedIds));
    usedIds.add(generatedId.id);
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
  if (bags.length === 0) return { results: [], failures: [] };
  if (k <= 0) return { results: [], failures: [] };

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
      const { results: placements, failure } = generateMultiThreatPlacements(
        entry.bag,
        threats,
        1,
        nonThreats,
        threatDistribution,
        nonThreatDistribution,
        requireAtLeastOneNonThreat,
        usedIds
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
        usedIds
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

  let consecutiveFailures = 0;
  const maxConsecutiveFailures = bagEntries.length * 3;

  while (results.length < k && consecutiveFailures < maxConsecutiveFailures) {
    const entry = selectWeightedBag();
    if (!entry) break;

    const combo = tryGenerateOne(entry);
    if (combo) {
      results.push(combo);
      consecutiveFailures = 0;
      
      // OPTIMIZATION: Yield to UI every 50 combinations to prevent freezing
      if (results.length % 50 === 0) {
        // Allow React to update UI
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } else {
      consecutiveFailures++;
    }
  }

  return { results, failures };
}

// Clear cache function for testing or when needed
export function clearCombinationCache() {
  validRegionCache.clear();
}