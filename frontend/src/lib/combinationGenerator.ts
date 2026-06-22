import type { Item } from "../types/library";
import type { SceneObject, CombinatorialResult, FailureLog, GenerationResult } from "../types/customization";
import {
  isObjectInsideContainer,
  getRandomPositionInContainer,
  doObjectsOverlap,
  getTransformedValidRegion,
} from "./customizationHelpers";
import type { Point } from "../types/geometry";

const CANVAS_W = 800;
const CANVAS_H = 600;
const BAG_DISPLAY_SIZE = Math.min(CANVAS_W, CANVAS_H) * 0.85;

function normalizeCategoryName(cat: string): string {
  const normalized = (cat || "").toLowerCase().trim();
  if (normalized === "non-threats" || normalized === "non-threat" || normalized.includes("non threat")) {
    return "non-threats";
  }
  if (normalized.includes("bag")) return "bags";
  if (normalized.includes("threat") || normalized.includes("electronic") || normalized === "electronics") return "threats";
  return "non-threats";
}

function getStencilKind(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes("bag")) return "bag";
  if (normalized.includes("tray")) return "tray";
  if (normalized.includes("threat") || normalized.includes("prohibited")) return "threat";
  if (normalized.includes("cloth")) return "clothes";
  if (normalized.includes("electronics")) return "electronics";
  if (normalized.includes("food") || normalized.includes("drink")) return "food";
  if (normalized.includes("stationery") || normalized.includes("stationary") || normalized.includes("office")) return "stationary";
  if (normalized.includes("lag")) return "lag";
  return "stationary";
}

function parseOutline(item: Item): { x: number; y: number }[] | undefined {
  if (item.valid_region_points) {
    return typeof item.valid_region_points === "string"
      ? JSON.parse(item.valid_region_points)
      : item.valid_region_points;
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
  return {
    id: `bag-${bag.id}`,
    name: bag.name,
    library: "bag",
    originalPixelValue: bag.pixel_value,
    currentPixelValue: bag.pixel_value,
    oldPixelValue: null,
    stencilId: "bag",
    filepath: bag.filepath,
    polygonOutline: outline,
    transform: {
      x: CANVAS_W / 2,
      y: CANVAS_H / 2,
      width: BAG_DISPLAY_SIZE,
      height: BAG_DISPLAY_SIZE,
      rotation: 0,
    },
    initialWidth: BAG_DISPLAY_SIZE,
    initialHeight: BAG_DISPLAY_SIZE,
    layer: 0,
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
    id: `threat-${threat.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: threat.name,
    library: "threat",
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
    id: `nonthreat-${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: item.name,
    library: getStencilKind(item.category),
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
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Try to place a threat inside a bag at a given position and rotation.
 * Returns the position if valid, null otherwise.
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
 * Try to place non-threat items inside a bag, avoiding overlap with the threat.
 * Returns array of {x, y, rotation} if all placed, null otherwise.
 */
function tryPlaceNonThreats(
  items: Item[],
  bagObj: SceneObject,
  threatObj: SceneObject | null,
  maxAttempts: number = 50
): { x: number; y: number; rotation: number }[] | null {
  const positions: { x: number; y: number; rotation: number }[] = [];

  for (const item of items) {
    const outline = parseOutline(item);
    const w = item.width ? Math.round(item.width) : 80;
    const h = item.height ? Math.round(item.height) : 80;

    let placed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pos = getRandomPositionInContainer(w, h, bagObj, outline);
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

      // Check overlap with threat
      if (threatObj && doObjectsOverlap(testObj, threatObj)) continue;

      // Check overlap with already placed non-threats
      let overlapsExisting = false;
      for (const existingPos of positions) {
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
 * Generate unique placements for a (bag, threat) pair.
 * Uses systematic rotation stepping and random position sampling.
 * Returns the results and a failure log if the pair couldn't meet its target.
 */
function generateThreatPlacements(
  bag: Item,
  threat: Item,
  target: number,
  density: "empty" | "few" | "filled",
  nonThreats: Item[],
  existingUsed?: Set<string>
): { results: CombinatorialResult[]; failure: FailureLog | null } {
  const results: CombinatorialResult[] = [];
  const usedPlacements = existingUsed ?? new Set<string>();
  const bagObj = createBagSceneObject(bag);

  // Build an unbiased, shuffled candidate list (positions × rotations)
  // and iterate through it without modulo cycling to avoid bias.
  // The helper will return a shuffled Cartesian product of positions and rotations.
  // Import placed candidates generator from placementUtils.
  // (Positions are quantized to a grid and expanded with random samples.)
  const candidates = (function () {
    try {
      // Lazy import to avoid circular dependency issues
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { buildPositionRotationCandidates } = require("./placementUtils");
      return buildPositionRotationCandidates(bagObj, threat, target);
    } catch (e) {
      // Fallback to existing generation if import fails
      const validRegion = getTransformedValidRegion(bagObj);
      let minX = 0, maxX = 0, minY = 0, maxY = 0;
      if (validRegion.length >= 3) {
        minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
        validRegion.forEach((p: Point) => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
      }
      const threatW = threat.width ? Math.round(threat.width) : 120;
      const threatH = threat.height ? Math.round(threat.height) : 60;
      const gridStep = Math.max(threatW, threatH) * 0.6;
      const positionCandidates: { x: number; y: number }[] = [];
      if (validRegion.length >= 3) {
        for (let px = minX + threatW / 2; px <= maxX - threatW / 2; px += gridStep) {
          for (let py = minY + threatH / 2; py <= maxY - threatH / 2; py += gridStep) {
            positionCandidates.push({ x: px, y: py });
          }
        }
      }
      if (positionCandidates.length < target * 2) {
        for (let i = 0; i < target * 10; i++) {
          const rx = minX + threatW / 2 + Math.random() * (maxX - minX - threatW || 0);
          const ry = minY + threatH / 2 + Math.random() * (maxY - minY - threatH || 0);
          positionCandidates.push({ x: rx, y: ry });
        }
      }
      const rotationStep = target <= 12 ? 30 : target <= 24 ? 15 : target <= 72 ? 10 : 5;
      const rotationAngles: number[] = [];
      for (let angle = 0; angle < 360; angle += rotationStep) rotationAngles.push(angle);
      const all: { x: number; y: number; rotation: number }[] = [];
      for (const p of positionCandidates) for (const r of rotationAngles) all.push({ x: p.x, y: p.y, rotation: r });
      return shuffleArray(all);
    }
  })();

  const maxAttempts = Math.max(target * 100, 2000);

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

    // Select and place non-threats
    let nonThreatPositions: { x: number; y: number; rotation: number }[] | null = [];
    let selectedNonThreats: Item[] = [];

    if (density === "empty") {
      selectedNonThreats = [];
    } else if (density === "few") {
      selectedNonThreats = pickRandomSubset(nonThreats, 1, 2);
    } else {
      selectedNonThreats = pickRandomSubset(nonThreats, 2, Math.min(4, nonThreats.length));
    }

    if (selectedNonThreats.length > 0) {
      nonThreatPositions = tryPlaceNonThreats(selectedNonThreats, bagObj, threatObj);
      if (!nonThreatPositions) continue; // Couldn't place non-threats, skip this combo
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

    results.push({
      id: `${bag.id}-${threat.id}-${results.length}`,
      bag,
      threat,
      others: selectedNonThreats,
      objects,
    });
  }

  // Determine if there's a failure
  let failure: FailureLog | null = null;
  if (results.length < target) {
    if (results.length === 0) {
      // Check if the issue is that the threat simply doesn't fit at all
        let anyValidPlacement = false;
        if (Array.isArray((candidates as any) || [])) {
          for (const c of candidates as any[]) {
            if (tryPlaceThreat(threat, bagObj, c.x, c.y, c.rotation)) {
              anyValidPlacement = true;
              break;
            }
          }
        }
      failure = {
        bagName: bag.name,
        bagId: bag.id,
        threatName: threat.name,
        threatId: threat.id,
        reason: anyValidPlacement
          ? `Threat "${threat.name}" could not be placed in bag "${bag.name}" — no valid non-overlapping position found for non-threat items`
          : `Threat "${threat.name}" does not fit inside bag "${bag.name}" at any rotation or position`,
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
  density: "empty" | "few" | "filled",
  nonThreats: Item[]
): CombinatorialResult[] {
  const results: CombinatorialResult[] = [];
  const usedHashes = new Set<string>();
  const bagObj = createBagSceneObject(bag);

  const maxAttempts = Math.max(target * 50, 1000);

  for (let attempt = 0; attempt < maxAttempts && results.length < target; attempt++) {
    // Select non-threat subset
    let selectedNonThreats: Item[];
    if (density === "empty") {
      selectedNonThreats = [];
    } else if (density === "few") {
      selectedNonThreats = pickRandomSubset(nonThreats, 1, 2);
    } else {
      selectedNonThreats = pickRandomSubset(nonThreats, 2, Math.min(4, nonThreats.length));
    }

    if (selectedNonThreats.length === 0) {
      // Empty bag combo - only one unique version
      const hash = "empty_bag";
      if (usedHashes.has(hash)) continue;
      usedHashes.add(hash);

      results.push({
        id: `${bag.id}-clean-${results.length}`,
        bag,
        others: [],
        objects: [bagObj],
      });
      continue;
    }

    // Try to place non-threats
    const positions = tryPlaceNonThreats(selectedNonThreats, bagObj, null);
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

    results.push({
      id: `${bag.id}-clean-${results.length}`,
      bag,
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
 * - K is distributed evenly across all bags
 * - For each bag, K is distributed evenly across all threats
 * - Each (bag, threat) pair gets unique placements
 * - If no threats, each bag gets unique clean combos
 *
 * @param bags - Selected bag items
 * @param threats - Selected threat items
 * @param nonThreats - Selected non-threat items
 * @param k - Target number of combinations
 * @param density - Density preset for non-threats
 * @returns GenerationResult with results array and failures array
 */
export function generateCombinations(
  bags: Item[],
  threats: Item[],
  nonThreats: Item[],
  k: number,
  density: "empty" | "few" | "filled" = "filled"
): GenerationResult {
  if (bags.length === 0) return { results: [], failures: [] };
  if (k <= 0) return { results: [], failures: [] };

  const results: CombinatorialResult[] = [];
  const failures: FailureLog[] = [];

  if (threats.length > 0) {
    // Build initial allocation per bag and per threat (round-robin remainder distribution)
    const combosPerBag = Math.floor(k / bags.length);
    const remainderBags = k % bags.length;

    // Build pair entries with initial targets
    type PairEntry = {
      bag: Item;
      threat: Item;
      remaining: number;
      used: Set<string>;
      hasValidRegion: boolean;
    };

    const pairs: PairEntry[] = [];

    for (let bi = 0; bi < bags.length; bi++) {
      const bag = bags[bi];
      const bagTarget = combosPerBag + (bi < remainderBags ? 1 : 0);
      if (bagTarget <= 0) continue;

      const combosPerThreat = Math.floor(bagTarget / threats.length);
      const remainderThreats = bagTarget % threats.length;

      for (let ti = 0; ti < threats.length; ti++) {
        const threat = threats[ti];
        const threatTarget = combosPerThreat + (ti < remainderThreats ? 1 : 0);
        if (threatTarget <= 0) continue;

        const hasValidRegion = !!(bag.valid_region_points && (Array.isArray(bag.valid_region_points) ? bag.valid_region_points.length > 0 : true));
        pairs.push({ bag, threat, remaining: threatTarget, used: new Set<string>(), hasValidRegion: hasValidRegion });
      }
    }

    // Round-robin across pairs, requesting one placement at a time to maximize fairness
    let producedThisCycle = -1;
    while (results.length < k && pairs.some(p => p.remaining > 0)) {
      producedThisCycle = 0;
      for (const p of pairs) {
        if (results.length >= k) break;
        if (p.remaining <= 0) continue;
        if (!p.hasValidRegion) {
          // Log and mark exhausted
          failures.push({
            bagName: p.bag.name,
            bagId: p.bag.id,
            threatName: p.threat.name,
            threatId: p.threat.id,
            reason: `Bag "${p.bag.name}" has no valid region defined — cannot place any items`,
            expected: p.remaining,
            actual: 0,
          });
          p.remaining = 0;
          continue;
        }

        const { results: placements, failure } = generateThreatPlacements(p.bag, p.threat, 1, density, nonThreats, p.used);
        if (placements.length > 0) {
          results.push(...placements);
          p.remaining -= placements.length;
          producedThisCycle += placements.length;
        } else {
          // Mark this pair exhausted; record failure if provided
          p.remaining = 0;
          if (failure) failures.push(failure);
        }
      }

      // If no placements produced in a full cycle, break to avoid infinite loop
      if (producedThisCycle === 0) break;
    }
  } else {
    // No threats - generate clean combos
    const combosPerBag = Math.floor(k / bags.length);
    const remainderBags = k % bags.length;

    for (let bi = 0; bi < bags.length; bi++) {
      const bag = bags[bi];
      const bagTarget = combosPerBag + (bi < remainderBags ? 1 : 0);
      if (bagTarget <= 0) continue;

      const placements = generateCleanCombinations(bag, bagTarget, density, nonThreats);
      results.push(...placements);
    }
  }

  return { results, failures };
}