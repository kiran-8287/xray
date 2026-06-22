import type { Item } from "../types/library";
import type { Point } from "../types/geometry";
import { getTransformedValidRegion } from "./customizationHelpers";

/**
 * Generate a shuffled list of position+rotation candidates for a threat inside a bag.
 * This builds a quantized grid of positions inside the bag's valid region, adds
 * some random samples if the grid is sparse, forms the Cartesian product with
 * rotation angles, then shuffles the full candidate list to allow unbiased sampling.
 */
export function buildPositionRotationCandidates(
  bagObj: any,
  threat: Item,
  target: number,
  gridStepFactor: number = 0.6
): { x: number; y: number; rotation: number }[] {
  const validRegion: Point[] = getTransformedValidRegion(bagObj) || [];

  let minX = 0,
    maxX = 0,
    minY = 0,
    maxY = 0;
  if (validRegion.length >= 3) {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
    validRegion.forEach((p: Point) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
  }

  const threatW = threat.width ? Math.round(threat.width) : 120;
  const threatH = threat.height ? Math.round(threat.height) : 60;

  const gridStep = Math.max(threatW, threatH) * gridStepFactor;
  const positionCandidates: { x: number; y: number }[] = [];

  if (validRegion.length >= 3) {
    for (let px = minX + threatW / 2; px <= maxX - threatW / 2; px += gridStep) {
      for (let py = minY + threatH / 2; py <= maxY - threatH / 2; py += gridStep) {
        positionCandidates.push({ x: px, y: py });
      }
    }
  }

  // If grid produced too few candidates, add random ones to expand search
  const requiredRandom = Math.max(0, target * 10 - positionCandidates.length);
  for (let i = 0; i < requiredRandom; i++) {
    const rx = minX + threatW / 2 + Math.random() * Math.max(0, maxX - minX - threatW);
    const ry = minY + threatH / 2 + Math.random() * Math.max(0, maxY - minY - threatH);
    positionCandidates.push({ x: rx, y: ry });
  }

  // Rotation angles: choose a reasonable step depending on target size
  const rotationStep = target <= 12 ? 30 : target <= 24 ? 15 : target <= 72 ? 10 : 5;
  const rotationAngles: number[] = [];
  for (let angle = 0; angle < 360; angle += rotationStep) rotationAngles.push(angle);

  // Cartesian product of positions × rotations
  const candidates: { x: number; y: number; rotation: number }[] = [];
  for (const p of positionCandidates) {
    for (const r of rotationAngles) {
      candidates.push({ x: p.x, y: p.y, rotation: r });
    }
  }

  // Shuffle candidates using Fisher-Yates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // Cap the number of candidates to avoid excessive memory usage in extreme cases.
  const MAX_CANDIDATES = Math.max(1000, target * 200, 5000);
  if (candidates.length > MAX_CANDIDATES) {
    return candidates.slice(0, MAX_CANDIDATES);
  }

  return candidates;
}
