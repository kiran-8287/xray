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
const DEFAULT_BATCH_SIZE = 200;  // Emit every 200 combos (2 pages) for responsive UI
const YIELD_INTERVAL = 10;       // Yield to event loop every 10 combos
const validRegionCache = new Map<string, Point[]>();
const CACHE_MAX_SIZE = 100;
let _idBasePrefix = '';
let _idSequence = 1;

function nextSynthesizedId(usedIds: Set<string>): string {
  let seq = _idSequence;
  let id: string;
  do {
    const letterIndex = Math.floor((seq - 1) / 99999);
    const numberPart = ((seq - 1) % 99999) + 1;
    const letter = String.fromCharCode(65 + letterIndex);
    id = `${_idBasePrefix}-${letter}${String(numberPart).padStart(5, '0')}`;
    seq++;
  } while (usedIds.has(id));
  _idSequence = seq;
  usedIds.add(id);
  return id;
}

function parseOutline(item: Item): { x: number; y: number }[] | undefined {
  // Prefer the segmentation mask (normalized [0,1] polygon over the item) so
  // random placement uses the tight mask footprint -> axis-aligned box, never
  // the original image rectangle.
  if (Array.isArray(item.segmentationMask) && item.segmentationMask.length >= 3) {
    return item.segmentationMask;
  }
  if (item.valid_region_points) {
    const raw = typeof item.valid_region_points === "string" ? JSON.parse(item.valid_region_points) : item.valid_region_points;
    if (Array.isArray(raw)) return raw;
    else if (raw && typeof raw === "object") return raw.simplifiedPoints || raw.points || raw.shapes?.[0]?.points;
  }
  if (item.polygon_json) {
    return typeof item.polygon_json === "string" ? JSON.parse(item.polygon_json) : item.polygon_json;
  }
  return undefined;
}

function createBagSceneObject(bag: Item): SceneObject {
  const outline = parseOutline(bag);
  const bagWidth = bag.width || bag.height || Math.min(CANVAS_W, CANVAS_H);
  const bagHeight = bag.height || bag.width || Math.min(CANVAS_W, CANVAS_H);
  return {
    id: bag.id, name: bag.name, library: "bag", subcategory: bag.subcategory,
    originalPixelValue: bag.pixel_value, currentPixelValue: bag.pixel_value,
    stencilId: "bag", filepath: bag.filepath, polygonOutline: outline,
    transform: { x: bagWidth / 2, y: bagHeight / 2, width: bagWidth, height: bagHeight, rotation: 0 },
    initialWidth: bagWidth, initialHeight: bagHeight, layer: 0, tags: bag.tags || [],
  };
}

function createThreatSceneObject(threat: Item, x: number, y: number, rotation: number, layer: number): SceneObject {
  const outline = parseOutline(threat);
  const w = threat.width ? Math.round(threat.width) : 120;
  const h = threat.height ? Math.round(threat.height) : 60;
  return {
    id: threat.id, name: threat.name, library: "threat", subcategory: threat.subcategory,
    originalPixelValue: threat.pixel_value, currentPixelValue: threat.pixel_value,
    stencilId: "threat", filepath: threat.filepath, polygonOutline: outline,
    transform: { x, y, width: w, height: h, rotation }, initialWidth: w, initialHeight: h, layer,
  };
}

function createNonThreatSceneObject(item: Item, x: number, y: number, rotation: number, layer: number): SceneObject {
  const outline = parseOutline(item);
  const w = item.width ? Math.round(item.width) : 80;
  const h = item.height ? Math.round(item.height) : 80;
  return {
    id: item.id, name: item.name, library: "non-threat", subcategory: item.subcategory,
    originalPixelValue: item.pixel_value, currentPixelValue: item.pixel_value,
    stencilId: "item", filepath: item.filepath, polygonOutline: outline,
    transform: { x, y, width: w, height: h, rotation }, initialWidth: w, initialHeight: h, layer,
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

function pickRandomK<T>(arr: T[], k: number): T[] {
  const n = arr.length;
  if (k <= 0 || k >= n) return k === 1 ? [arr[Math.floor(Math.random() * n)]] : shuffleArray([...arr]);
  const result = new Array(k);
  if (k * 32 < n) {
    const swapped = new Map<number, number>();
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const iVal = swapped.has(i) ? swapped.get(i)! : i;
      const jVal = swapped.has(j) ? swapped.get(j)! : j;
      result[i] = arr[jVal];
      swapped.set(j, iVal);
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

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getCachedValidRegion(bagObj: SceneObject): Point[] {
  const cacheKey = `${bagObj.id}_${bagObj.transform.width}_${bagObj.transform.height}_${bagObj.transform.rotation}`;
  if (validRegionCache.has(cacheKey)) return validRegionCache.get(cacheKey)!;
  const region = getTransformedValidRegion(bagObj);
  if (validRegionCache.size >= CACHE_MAX_SIZE) {
    const firstKey = validRegionCache.keys().next().value;
    if (firstKey) validRegionCache.delete(firstKey);
  }
  validRegionCache.set(cacheKey, region);
  return region;
}

function tryPlaceThreat(threat: Item, bagObj: SceneObject, x: number, y: number, rotation: number): boolean {
  const outline = parseOutline(threat);
  const w = threat.width ? Math.round(threat.width) : 120;
  const h = threat.height ? Math.round(threat.height) : 60;
  const testObj = { polygonOutline: outline, transform: { x, y, width: w, height: h, rotation } };
  return isObjectInsideContainer(testObj, bagObj);
}

function tryPlaceNonThreats(items: Item[], bagObj: SceneObject, threatObjs: SceneObject[], maxAttempts: number = 25): { x: number; y: number; rotation: number }[] | null {
  const positions: { x: number; y: number; rotation: number }[] = [];
  for (const item of items) {
    const outline = parseOutline(item);
    const w = item.width ? Math.round(item.width) : 80;
    const h = item.height ? Math.round(item.height) : 80;
    let placed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pos = getRandomPositionInContainer(w, h, bagObj, outline);
      if (!pos) continue;
      const testObj: SceneObject = {
        id: "temp", name: item.name, library: "non-threat",
        originalPixelValue: item.pixel_value, currentPixelValue: item.pixel_value,
        stencilId: "item", filepath: item.filepath, polygonOutline: outline,
        transform: { x: pos.x, y: pos.y, width: w, height: h, rotation: pos.rotation ?? 0 }, layer: 0,
      };
      if (!isObjectInsideContainer(testObj, bagObj)) continue;
      positions.push({ x: pos.x, y: pos.y, rotation: pos.rotation ?? 0 });
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  return positions;
}

function buildPositionRotationCandidates(bagObj: SceneObject, threat: Item, target: number): { x: number; y: number; rotation: number }[] {
  const validRegion: Point[] = getCachedValidRegion(bagObj) || [];
  let minX: number, maxX: number, minY: number, maxY: number;
  if (validRegion.length >= 3) {
    minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
    for (const p of validRegion) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  } else {
    minX = bagObj.transform.x - bagObj.transform.width / 2;
    maxX = bagObj.transform.x + bagObj.transform.width / 2;
    minY = bagObj.transform.y - bagObj.transform.height / 2;
    maxY = bagObj.transform.y + bagObj.transform.height / 2;
  }
  const threatW = threat.width ? Math.round(threat.width) : 120;
  const threatH = threat.height ? Math.round(threat.height) : 60;
  const gridStep = Math.max(threatW, threatH) * 0.4;
  const positionCandidates: { x: number; y: number }[] = [];
  if (validRegion.length >= 3) {
    for (let px = minX + threatW / 2; px <= maxX - threatW / 2; px += gridStep) {
      for (let py = minY + threatH / 2; py <= maxY - threatH / 2; py += gridStep) {
        positionCandidates.push({ x: px, y: py });
      }
    }
  }
  const requiredRandom = Math.max(0, target * 15 - positionCandidates.length);
  for (let i = 0; i < requiredRandom; i++) {
    const rx = minX + threatW / 2 + Math.random() * Math.max(0, maxX - minX - threatW);
    const ry = minY + threatH / 2 + Math.random() * Math.max(0, maxY - minY - threatH);
    positionCandidates.push({ x: rx, y: ry });
  }
  const rotationStep = target <= 12 ? 30 : target <= 24 ? 20 : target <= 72 ? 15 : 10;
  const rotationAngles: number[] = [];
  for (let angle = 0; angle < 360; angle += rotationStep) rotationAngles.push(angle);
  const candidates: { x: number; y: number; rotation: number }[] = [];
  for (const p of positionCandidates) {
    for (const r of rotationAngles) {
      candidates.push({ x: p.x, y: p.y, rotation: r });
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const MAX_CANDIDATES = Math.max(1000, target * 200, 5000);
  return candidates.length > MAX_CANDIDATES ? candidates.slice(0, MAX_CANDIDATES) : candidates;
}

function generateSingleThreatPlacement(
  bag: Item, threat: Item, bagObj: SceneObject, bagId: string,
  bagThreatPositions: Map<string, Set<string>>, existingThreats: SceneObject[] = []
): { x: number; y: number; rotation: number } | null {
  const candidates = buildPositionRotationCandidates(bagObj, threat, 10);
  const maxAttempts = Math.min(candidates.length, 100);
  const trackingKey = `${bagId}_${threat.id}`;
  const usedPositions = bagThreatPositions.get(trackingKey) || new Set<string>();
  
  for (let idx = 0; idx < Math.min(maxAttempts, 10); idx++) {
    const cand = candidates[idx];
    const pos = { x: cand.x, y: cand.y };
    const rotation = cand.rotation;
    if (!tryPlaceThreat(threat, bagObj, pos.x, pos.y, rotation)) continue;
    const testObj = createThreatSceneObject(threat, pos.x, pos.y, rotation, 1);
    let overlaps = false;
    for (const existing of existingThreats) {
      if (doObjectsOverlap(testObj, existing)) { overlaps = true; break; }
    }
    if (overlaps) continue;
    const posHash = `${Math.round(pos.x)}_${Math.round(pos.y)}_${rotation}`;
    if (usedPositions.has(posHash)) continue;
    usedPositions.add(posHash);
    if (usedPositions.size > 50) {
      const firstHash = usedPositions.values().next().value;
      if (firstHash) usedPositions.delete(firstHash);
    }
    bagThreatPositions.set(trackingKey, usedPositions);
    return { x: pos.x, y: pos.y, rotation };
  }
  for (let idx = 10; idx < maxAttempts; idx++) {
    const cand = candidates[idx];
    const pos = { x: cand.x, y: cand.y };
    const rotation = cand.rotation;
    if (!tryPlaceThreat(threat, bagObj, pos.x, pos.y, rotation)) continue;
    const posHash = `${Math.round(pos.x)}_${Math.round(pos.y)}_${rotation}`;
    if (usedPositions.has(posHash)) continue;
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

function pickThreatCountByDistribution(distribution: Record<number, number>, availableThreats: number): number {
  const eligible: { count: number; weight: number }[] = [];
  for (let i = 1; i <= Math.min(4, availableThreats); i++) {
    const weight = distribution[i] ?? 0;
    if (weight > 0) eligible.push({ count: i, weight });
  }
  if (eligible.length === 0) return 1 + Math.floor(Math.random() * Math.min(4, availableThreats));
  const totalWeight = eligible.reduce((sum, e) => sum + e.weight, 0);
  const random = Math.random() * totalWeight;
  let cumulative = 0;
  for (const e of eligible) {
    cumulative += e.weight;
    if (random <= cumulative) return e.count;
  }
  return eligible[eligible.length - 1].count;
}

function pickNonThreatCountByDistribution(distribution: Record<number, number>, availableNonThreats: number, requireAtLeastOne: boolean = false): number {
  const eligible: { count: number; weight: number }[] = [];
  for (let i = 1; i <= Math.min(4, availableNonThreats); i++) {
    const weight = distribution[i] ?? 0;
    if (weight > 0) eligible.push({ count: i, weight });
  }
  if (eligible.length === 0) {
    if (requireAtLeastOne && availableNonThreats > 0) return 1;
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

function generateMultiThreatPlacements(
  bag: Item, threats: Item[], targetByCount: Record<number, { min: number; target: number; max: number }>,
  nonThreats: Item[], nonThreatDistribution: Record<number, number>, requireAtLeastOneNonThreat: boolean = false,
  globalUsedIds?: Set<string>, nextId?: (usedIds: Set<string>) => string
): { results: CombinatorialResult[]; failure: FailureLog | null } {
  const results: CombinatorialResult[] = [];
  const usedIds = globalUsedIds ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);
  const totalTarget = Object.values(targetByCount).reduce((sum, bounds) => sum + bounds.target, 0);
  const maxAttempts = Math.max(totalTarget * 5, 1000);

  for (let attempt = 0; attempt < maxAttempts && results.length < totalTarget; attempt++) {
    const remainingTargets: { count: number; remaining: number }[] = [];
    for (const [count, bounds] of Object.entries(targetByCount)) {
      const countNum = parseInt(count);
      const currentCount = results.filter(r => r.threats.length === countNum).length;
      const remaining = bounds.max - currentCount;
      if (remaining > 0) remainingTargets.push({ count: countNum, remaining });
    }
    if (remainingTargets.length === 0) break;
    const totalRemaining = remainingTargets.reduce((sum, rt) => sum + rt.remaining, 0);
    const random = Math.random() * totalRemaining;
    let cumulative = 0;
    let selectedCount = remainingTargets[0].count;
    for (const rt of remainingTargets) {
      cumulative += rt.remaining;
      if (random <= cumulative) { selectedCount = rt.count; break; }
    }
    const selectedThreats = pickRandomK(threats, selectedCount);
    const placedThreats: { item: Item; x: number; y: number; rotation: number }[] = [];
    let placementFailed = false;
    const bagThreatPositions = new Map<string, Set<string>>();
    const threatObjs: SceneObject[] = [];
    for (const threat of selectedThreats) {
      const placement = generateSingleThreatPlacement(bag, threat, bagObj, bag.id, bagThreatPositions, threatObjs);
      if (!placement) { placementFailed = true; break; }
      placedThreats.push({ item: threat, ...placement });
    }
    if (placementFailed) continue;
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
      if (!nonThreatPositions) continue;
    }
    const objects: SceneObject[] = [bagObj];
    let layer = 1;
    selectedNonThreats.forEach((item, idx) => {
      const ntObj = createNonThreatSceneObject(item, nonThreatPositions![idx].x, nonThreatPositions![idx].y, nonThreatPositions![idx].rotation, layer++);
      objects.push(ntObj);
    });
    for (const tObj of threatObjs) objects.push({ ...tObj, layer: layer++ });
    const generatedId = nextId ? { id: nextId(usedIds) } : generateSynthesizedId(bag.id, Array.from(usedIds));
    if (!nextId) usedIds.add(generatedId.id);
    results.push({ id: generatedId.id, bag, threats: placedThreats.map(pt => pt.item), others: selectedNonThreats, objects });
  }
  let failure: FailureLog | null = null;
  if (results.length < totalTarget) {
    if (results.length === 0) {
      failure = { bagName: bag.name, bagId: bag.id, threatName: threats.map(t => t.name).join(", "), threatId: threats.map(t => t.id).join(","), reason: `No multi-threat combination could be placed in bag "${bag.name}"`, expected: totalTarget, actual: 0 };
    } else {
      failure = { bagName: bag.name, bagId: bag.id, threatName: threats.map(t => t.name).join(", "), threatId: threats.map(t => t.id).join(","), reason: `Only ${results.length} of ${totalTarget} multi-threat combos found for bag "${bag.name}"`, expected: totalTarget, actual: results.length };
    }
  }
  return { results, failure };
}

function generateThreatPlacements(
  bag: Item, threat: Item, target: number, nonThreats: Item[], nonThreatDistribution: Record<number, number>,
  existingUsed?: Set<string>, globalUsedIds?: Set<string>
): { results: CombinatorialResult[]; failure: FailureLog | null } {
  const results: CombinatorialResult[] = [];
  const usedPlacements = existingUsed ?? new Set<string>();
  const usedIds = globalUsedIds ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);
  const candidates = buildPositionRotationCandidates(bagObj, threat, target);
  const maxAttempts = Math.min(candidates.length, Math.max(target * 50, 1000));
  for (let idx = 0; idx < candidates.length && results.length < target && idx < maxAttempts; idx++) {
    const cand = candidates[idx];
    const pos = { x: cand.x, y: cand.y };
    const rotation = cand.rotation;
    if (!tryPlaceThreat(threat, bagObj, pos.x, pos.y, rotation)) continue;
    const hash = placementHash(threat.id, pos.x, pos.y, rotation);
    if (usedPlacements.has(hash)) continue;
    const threatObj = createThreatSceneObject(threat, pos.x, pos.y, rotation, 1);
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
    usedPlacements.add(hash);
    const objects: SceneObject[] = [bagObj];
    let layer = 1;
    selectedNonThreats.forEach((item, idx) => {
      const ntObj = createNonThreatSceneObject(item, nonThreatPositions![idx].x, nonThreatPositions![idx].y, nonThreatPositions![idx].rotation, layer++);
      objects.push(ntObj);
    });
    objects.push({ ...threatObj, layer: layer++ });
    const generatedId = generateSynthesizedId(bag.id, Array.from(usedIds));
    usedIds.add(generatedId.id);
    results.push({ id: generatedId.id, bag, threats: [threat], others: selectedNonThreats, objects });
  }
  let failure: FailureLog | null = null;
  if (results.length < target) {
    if (results.length === 0) {
      failure = { bagName: bag.name, bagId: bag.id, threatName: threat.name, threatId: threat.id, reason: `Threat "${threat.name}" does not fit inside bag "${bag.name}" at any rotation or position`, expected: target, actual: 0 };
    } else {
      failure = { bagName: bag.name, bagId: bag.id, threatName: threat.name, threatId: threat.id, reason: `Only ${results.length} of ${target} unique placements found for threat "${threat.name}" in bag "${bag.name}"`, expected: target, actual: results.length };
    }
  }
  return { results, failure };
}

function generateCleanCombinations(
  bag: Item, target: number, nonThreats: Item[], nonThreatDistribution: Record<number, number>,
  requireAtLeastOneNonThreat: boolean = false, globalUsedIds?: Set<string>, nextId?: (usedIds: Set<string>) => string
): CombinatorialResult[] {
  const results: CombinatorialResult[] = [];
  const usedHashes = new Set<string>();
  const usedIds = globalUsedIds ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);
  const maxAttempts = Math.min(3000, Math.max(target * 30, 500));
  for (let attempt = 0; attempt < maxAttempts && results.length < target; attempt++) {
    let selectedNonThreats: Item[];
    if (nonThreats.length === 0) selectedNonThreats = [];
    else {
      const nonThreatCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length, requireAtLeastOneNonThreat);
      selectedNonThreats = pickRandomK(nonThreats, nonThreatCount);
    }
    if (requireAtLeastOneNonThreat && selectedNonThreats.length === 0) continue;
    if (selectedNonThreats.length === 0) {
      const hash = "empty_bag";
      if (usedHashes.has(hash)) continue;
      usedHashes.add(hash);
      const generatedId = nextId ? { id: nextId(usedIds) } : generateSynthesizedId(bag.id, Array.from(usedIds));
      if (!nextId) usedIds.add(generatedId.id);
      results.push({ id: generatedId.id, bag, threats: [], others: [], objects: [bagObj] });
      continue;
    }
    const positions = tryPlaceNonThreats(selectedNonThreats, bagObj, []);
    if (!positions) continue;
    const hash = nonThreatComboHash(selectedNonThreats.map(nt => nt.id), positions);
    if (usedHashes.has(hash)) continue;
    usedHashes.add(hash);
    const objects: SceneObject[] = [bagObj];
    let layer = 1;
    selectedNonThreats.forEach((item, idx) => {
      const ntObj = createNonThreatSceneObject(item, positions[idx].x, positions[idx].y, positions[idx].rotation, layer++);
      objects.push(ntObj);
    });
    const generatedId = nextId ? { id: nextId(usedIds) } : generateSynthesizedId(bag.id, Array.from(usedIds));
    if (!nextId) usedIds.add(generatedId.id);
    results.push({ id: generatedId.id, bag, threats: [], others: selectedNonThreats, objects });
  }
  return results;
}

export async function generateCombinations(
  bags: Item[], threats: Item[], nonThreats: Item[], k: number,
  threatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  nonThreatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  requireAtLeastOneNonThreat: boolean = false, existingIds: string[] = []
): Promise<GenerationResult> {
  const startTime = Date.now();
  if (bags.length === 0 || k <= 0) {
    return { results: [], failures: [] };
  }
  const hasValidThreatDist = Object.values(threatDistribution).some(v => v > 0);
  const hasValidNonThreatDist = Object.values(nonThreatDistribution).some(v => v > 0);
  if (!hasValidThreatDist && threats.length > 0) threatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  if (!hasValidNonThreatDist && nonThreats.length > 0) nonThreatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  const results: CombinatorialResult[] = [];
  const failures: FailureLog[] = [];
  const seenFailures = new Set<string>();
  const usedIds = new Set<string>(existingIds);
  (function initIdCounter() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hour = String(now.getHours()).padStart(2, '0');
    _idBasePrefix = `SB${day}${month}${year}${hour}`;
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
  type BagEntry = { bag: Item; hasValidRegion: boolean; usageCount: number; isExhausted: boolean };
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
    const weighted = available.map(p => { const weight = maxUsage - p.usageCount + 1; totalWeight += weight; return { entry: p, weight, cumulative: totalWeight }; });
    const random = Math.random() * totalWeight;
    for (const w of weighted) { if (random <= w.cumulative) return w.entry; }
    return available[0];
  }
  function tryGenerateOne(entry: BagEntry): CombinatorialResult | null {
    if (!entry.hasValidRegion) {
      entry.isExhausted = true;
      const failureKey = `${entry.bag.id}-novalidregion`;
      if (!seenFailures.has(failureKey)) {
        seenFailures.add(failureKey);
        failures.push({ bagName: entry.bag.name, bagId: entry.bag.id, threatName: "N/A", threatId: "N/A", reason: `Bag "${entry.bag.name}" has no valid region defined`, expected: 1, actual: 0 });
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
          targetByCount[countNum] = { min: Math.max(0, Math.floor(target * (1 - tolerance))), target, max: Math.ceil(target * (1 + tolerance)) };
        }
      }
      const { results: placements, failure } = generateMultiThreatPlacements(entry.bag, threats, targetByCount, nonThreats, nonThreatDistribution, requireAtLeastOneNonThreat, usedIds, nextSynthesizedId);
      if (placements.length > 0) { entry.usageCount++; return placements[0]; }
      else { entry.isExhausted = true; if (failure) { const failureKey = `${entry.bag.id}-multi-threat`; if (!seenFailures.has(failureKey)) { seenFailures.add(failureKey); failures.push(failure); } } return null; }
    } else {
      const placements = generateCleanCombinations(entry.bag, 1, nonThreats, nonThreatDistribution, requireAtLeastOneNonThreat, usedIds, nextSynthesizedId);
      if (placements.length > 0) { entry.usageCount++; return placements[0]; }
      else { entry.isExhausted = true; return null; }
    }
  }
  const maxConsecutiveFailures = bagEntries.length * 3;
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
        targets.push({ count: countNum, min: Math.max(0, Math.floor(target * (1 - tolerance))), target, max: Math.ceil(target * (1 + tolerance)), weight });
      }
    }
    for (const t of targets) {
      if (t.target > 0) { targetByCount[t.count] = { min: t.min, target: t.target, max: t.max }; distributionWeights[t.count] = t.weight; }
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
          if (canRemove > 0) { remainingByCount[countNum] -= canRemove; totalRemaining -= canRemove; }
          if (totalRemaining <= k) break;
        }
      }
    }
    const consecutiveFailuresByCount: Record<number, number> = {};
    const exhaustedCount = new Set<number>();
    const maxConsecutivePerCount = Math.max(10, Math.ceil(k / 10));
    const maxAttemptsWithoutProgress = Math.max(k * 10, 50_000);
    let attemptsWithoutProgress = 0;
    let lastLogTime = Date.now();
    const LOG_INTERVAL_MS = 2000;
    console.log(`[CombinationGenerator] Entering main generation loop...`);
    while (results.length < k && totalRemaining > 0 && attemptsWithoutProgress < maxAttemptsWithoutProgress) {
      attemptsWithoutProgress++;
      const now = Date.now();
      if (now - lastLogTime >= LOG_INTERVAL_MS) {
        lastLogTime = now;
        const exhausted = bagEntries.filter(b => b.isExhausted).length;
        console.log(`[CombinationGenerator] Status: ${results.length}/${k} generated, ${exhausted}/${bagEntries.length} bags exhausted, ${attemptsWithoutProgress} attempts without progress`);
      }
      const entry = selectWeightedBag();
      if (!entry) { console.log(`[CombinationGenerator] No bags available - all exhausted`); break; }
      if (!entry.hasValidRegion) { entry.isExhausted = true; continue; }
      const activeCounts = Object.keys(remainingByCount).map(Number).filter(c => !exhaustedCount.has(c) && (remainingByCount[c] || 0) > 0);
      if (activeCounts.length === 0) { console.log(`[CombinationGenerator] No active threat counts remaining`); break; }
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
      for (const sw of selectionWeights) { if (selectionRandom <= sw.cumulative) { selectedCount = sw.count; break; } }
      const MAX_PLACEMENT_ATTEMPTS = 20;
      let placementSucceeded = false;
      let finalPlacedThreats: { item: Item; x: number; y: number; rotation: number }[] = [];
      let finalThreatObjs: SceneObject[] = [];
      let finalNonThreatPositions: { x: number; y: number; rotation: number }[] = [];
      let finalSelectedNonThreats: Item[] = [];
      let finalBagObj: SceneObject | null = null;
      for (let placementAttempt = 0; placementAttempt < MAX_PLACEMENT_ATTEMPTS && !placementSucceeded; placementAttempt++) {
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
        if (placementFailed) continue;
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
          if (!nonThreatPositions) continue;
        }
        finalPlacedThreats = placedThreats;
        finalThreatObjs = threatObjs;
        finalNonThreatPositions = nonThreatPositions;
        finalSelectedNonThreats = selectedNonThreats;
        finalBagObj = bagObj;
        placementSucceeded = true;
        break;
      }
      if (!placementSucceeded) {
        consecutiveFailuresByCount[selectedCount] = (consecutiveFailuresByCount[selectedCount] || 0) + 1;
        if (consecutiveFailuresByCount[selectedCount] >= maxConsecutivePerCount && !exhaustedCount.has(selectedCount)) {
          console.log(`[CombinationGenerator] Exhausting ${selectedCount}-threat count after ${consecutiveFailuresByCount[selectedCount]} failures`);
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
              failures.push({ bagName: entry.bag.name, bagId: entry.bag.id, threatName: threats.map(t => t.name).join(", "), threatId: threats.map(t => t.id).join(","), reason: `Redistributed ${failedRemaining} remaining combos from ${selectedCount}-threat count to other counts`, expected: failedRemaining, actual: 0 });
            }
          }
        }
        continue;
      }
      const objects: SceneObject[] = [finalBagObj!];
      let layer = 1;
      finalSelectedNonThreats.forEach((item, idx) => {
        const ntObj = createNonThreatSceneObject(item, finalNonThreatPositions[idx].x, finalNonThreatPositions[idx].y, finalNonThreatPositions[idx].rotation, layer++);
        objects.push(ntObj);
      });
      for (const tObj of finalThreatObjs) objects.push({ ...tObj, layer: layer++ });
      const generatedId = nextSynthesizedId(usedIds);
      usedIds.add(generatedId);
      results.push({ id: generatedId, bag: entry.bag, threats: finalPlacedThreats.map(pt => pt.item), others: finalSelectedNonThreats, objects });
      remainingByCount[selectedCount] = (remainingByCount[selectedCount] || 0) - 1;
      totalRemaining--;
      entry.usageCount++;
      attemptsWithoutProgress = 0;
      consecutiveFailuresByCount[selectedCount] = 0;
      if (results.length % 50 === 0) {
        console.log(`[CombinationGenerator] Progress: ${results.length}/${k} (${((results.length/k)*100).toFixed(1)}%)`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  } else {
    let consecutiveFailures = 0;
    while (results.length < k && consecutiveFailures < maxConsecutiveFailures) {
      const entry = selectWeightedBag();
      if (!entry) break;
      const combo = tryGenerateOne(entry);
      if (combo) {
        results.push(combo);
        consecutiveFailures = 0;
        if (results.length % 50 === 0) {
          console.log(`[CombinationGenerator] Progress: ${results.length}/${k} (${((results.length/k)*100).toFixed(1)}%)`);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } else { consecutiveFailures++; }
    }
  }
  const endTime = Date.now();
  const elapsed = endTime - startTime;
  console.log(`[CombinationGenerator] Completed in ${elapsed}ms`, { requested: k, generated: results.length, failures: failures.length, avgTimePerCombo: results.length > 0 ? `${(elapsed / results.length).toFixed(2)}ms` : 'N/A' });
  return { results, failures };
}

export function testGenerationSpeed() {
  console.log("Testing generation speed with sample data...");
  return { message: "Use generateCombinationsIncremental directly for testing" };
}

export async function generateCombinationsIncremental(
  bags: Item[], threats: Item[], nonThreats: Item[], k: number,
  onBatch: (batch: CombinatorialResult[], progress: { generated: number; total: number }) => void,
  threatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  nonThreatDistribution: Record<number, number> = { 1: 25, 2: 25, 3: 25, 4: 25 },
  requireAtLeastOneNonThreat: boolean = false, existingIds: string[] = [], batchSize: number = DEFAULT_BATCH_SIZE
): Promise<GenerationResult> {
  const effectiveBatchSize = Math.max(1, batchSize);
  const startTime = Date.now();
  if (bags.length === 0 || k <= 0) {
    return { results: [], failures: [] };
  }
  const hasValidThreatDist = Object.values(threatDistribution).some(v => v > 0);
  const hasValidNonThreatDist = Object.values(nonThreatDistribution).some(v => v > 0);
  if (!hasValidThreatDist && threats.length > 0) threatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  if (!hasValidNonThreatDist && nonThreats.length > 0) nonThreatDistribution = { 1: 25, 2: 25, 3: 25, 4: 25 };
  const results: CombinatorialResult[] = [];
  const failures: FailureLog[] = [];
  const seenFailures = new Set<string>();
  const usedIds = new Set<string>(existingIds);
  (function initIdCounter() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hour = String(now.getHours()).padStart(2, '0');
    _idBasePrefix = `SB${day}${month}${year}${hour}`;
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
  type BagEntry = { bag: Item; hasValidRegion: boolean; usageCount: number; isExhausted: boolean };
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
    const weighted = available.map(p => { const weight = maxUsage - p.usageCount + 1; totalWeight += weight; return { entry: p, weight, cumulative: totalWeight }; });
    const random = Math.random() * totalWeight;
    for (const w of weighted) { if (random <= w.cumulative) return w.entry; }
    return available[0];
  }
  function tryGenerateOne(entry: BagEntry): CombinatorialResult | null {
    if (!entry.hasValidRegion) {
      entry.isExhausted = true;
      const failureKey = `${entry.bag.id}-novalidregion`;
      if (!seenFailures.has(failureKey)) {
        seenFailures.add(failureKey);
        failures.push({ bagName: entry.bag.name, bagId: entry.bag.id, threatName: "N/A", threatId: "N/A", reason: `Bag "${entry.bag.name}" has no valid region defined`, expected: 1, actual: 0 });
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
          targetByCount[countNum] = { min: Math.max(0, Math.floor(target * (1 - tolerance))), target, max: Math.ceil(target * (1 + tolerance)) };
        }
      }
      const { results: placements, failure } = generateMultiThreatPlacements(entry.bag, threats, targetByCount, nonThreats, nonThreatDistribution, requireAtLeastOneNonThreat, usedIds, nextSynthesizedId);
      if (placements.length > 0) { entry.usageCount++; return placements[0]; }
      else { entry.isExhausted = true; if (failure) { const failureKey = `${entry.bag.id}-multi-threat`; if (!seenFailures.has(failureKey)) { seenFailures.add(failureKey); failures.push(failure); } } return null; }
    } else {
      const placements = generateCleanCombinations(entry.bag, 1, nonThreats, nonThreatDistribution, requireAtLeastOneNonThreat, usedIds, nextSynthesizedId);
      if (placements.length > 0) { entry.usageCount++; return placements[0]; }
      else { entry.isExhausted = true; return null; }
    }
  }
  const maxConsecutiveFailures = bagEntries.length * 3;
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
        targets.push({ count: countNum, min: Math.max(0, Math.floor(target * (1 - tolerance))), target, max: Math.ceil(target * (1 + tolerance)), weight });
      }
    }
    for (const t of targets) {
      if (t.target > 0) { targetByCount[t.count] = { min: t.min, target: t.target, max: t.max }; distributionWeights[t.count] = t.weight; }
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
          if (canRemove > 0) { remainingByCount[countNum] -= canRemove; totalRemaining -= canRemove; }
          if (totalRemaining <= k) break;
        }
      }
    }
    const consecutiveFailuresByCount: Record<number, number> = {};
    const exhaustedCount = new Set<number>();
    const maxConsecutivePerCount = Math.max(10, Math.ceil(k / 10));
    const maxAttemptsWithoutProgress = Math.max(k * 10, 50_000);
    let attemptsWithoutProgress = 0;
    let lastBatchIndex = 0;
    let lastProgressTime = Date.now();
    const PROGRESS_INTERVAL_MS = 2000;
    while (results.length < k && totalRemaining > 0 && attemptsWithoutProgress < maxAttemptsWithoutProgress) {
      attemptsWithoutProgress++;
      
      // Send periodic progress updates even when no combos generated yet
      const now = Date.now();
      if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
        lastProgressTime = now;
        onBatch([], { generated: results.length, total: k });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      const entry = selectWeightedBag();
      if (!entry) break;
      if (!entry.hasValidRegion) { entry.isExhausted = true; continue; }
      const activeCounts = Object.keys(remainingByCount).map(Number).filter(c => !exhaustedCount.has(c) && (remainingByCount[c] || 0) > 0);
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
      for (const sw of selectionWeights) { if (selectionRandom <= sw.cumulative) { selectedCount = sw.count; break; } }
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
              failures.push({ bagName: entry.bag.name, bagId: entry.bag.id, threatName: threats.map(t => t.name).join(", "), threatId: threats.map(t => t.id).join(","), reason: `Redistributed ${failedRemaining} remaining combos from ${selectedCount}-threat count to other counts`, expected: failedRemaining, actual: 0 });
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
          // Non-threat placement failed. Try a different non-threat selection
          // instead of exhausting the threat count. If we can't place any
          // non-threats after retries, fall back to generating without them.
          let retried = false;
          for (let retry = 0; retry < 3 && !retried; retry++) {
            const retryCount = pickNonThreatCountByDistribution(nonThreatDistribution, nonThreats.length, false);
            const retryNonThreats = pickRandomK(nonThreats, retryCount);
            if (retryNonThreats.length === 0) { retried = true; break; }
            const retryPositions = tryPlaceNonThreats(retryNonThreats, bagObj, threatObjs);
            if (retryPositions) {
              selectedNonThreats = retryNonThreats;
              nonThreatPositions = retryPositions;
              retried = true;
            }
          }
          if (!retried) {
            // Fall back to generating without non-threats
            selectedNonThreats = [];
            nonThreatPositions = [];
          }
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
      results.push({ id, bag: entry.bag, threats: placedThreats.map(pt => pt.item), others: selectedNonThreats, objects });
      remainingByCount[selectedCount] = (remainingByCount[selectedCount] || 0) - 1;
      totalRemaining--;
      entry.usageCount++;
      attemptsWithoutProgress = 0;
      consecutiveFailuresByCount[selectedCount] = 0;
      
      // Yield to event loop frequently to keep UI responsive
      if (results.length % YIELD_INTERVAL === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      // Emit batch when reaching batch size
      if (results.length - lastBatchIndex >= effectiveBatchSize) {
        const batch = results.slice(lastBatchIndex);
        lastBatchIndex = results.length;
        onBatch(batch, { generated: results.length, total: k });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
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
        if (results.length - lastBatchIndex >= effectiveBatchSize) {
          const batch = results.slice(lastBatchIndex);
          lastBatchIndex = results.length;
          onBatch(batch, { generated: results.length, total: k });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } else { consecutiveFailures++; }
    }
    if (lastBatchIndex < results.length) {
      const batch = results.slice(lastBatchIndex);
      onBatch(batch, { generated: results.length, total: k });
    }
  }
  const endTime = Date.now();
  const elapsed = endTime - startTime;
  console.log(`[CombinationGenerator] Incremental completed in ${elapsed}ms`, { requested: k, generated: results.length, failures: failures.length, avgTimePerCombo: results.length > 0 ? `${(elapsed / results.length).toFixed(2)}ms` : 'N/A' });
  return { results, failures };
}

export function clearCombinationCache() {
  validRegionCache.clear();
}