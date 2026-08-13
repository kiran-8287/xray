/**
 * Fetch segmentation masks for threat/non-threat items from the backend and
 * attach them to the items in memory so placement (Customization page random
 * placement, out-of-bounds checks, and the combination generator) can use the
 * tight mask footprint (-> axis-aligned box) instead of the raw image rectangle.
 *
 * The backend computes these masks *before* any save (from pixel data) and
 * caches them per item id, so calling this early in the flow means we never
 * fall back to original-image bounding boxes.
 */
import type { Point } from "../types/geometry";
import type { Item } from "../types/library";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout } from "./fetchWithTimeout";

// In-memory cache so repeated generation runs / page loads don't re-fetch.
const maskCache = new Map<string, Point[]>();

export function clearSegmentationMaskCache(): void {
  maskCache.clear();
}

export function getCachedSegmentationMask(itemId: string): Point[] | undefined {
  return maskCache.get(itemId);
}

/**
 * Resolve the segmentation masks for a list of item ids (comma-safe batching)
 * and return a map of itemId -> normalized points.
 */
export async function fetchSegmentationMasks(itemIds: string[]): Promise<Map<string, Point[]>> {
  const result = new Map<string, Point[]>();
  const missing = itemIds.filter((id) => id && !maskCache.has(id));
  for (const id of itemIds) {
    const cached = maskCache.get(id);
    if (cached) result.set(id, cached);
  }
  if (missing.length === 0) return result;

  // Batch in chunks of 40 ids to keep the URL reasonably sized.
  const CHUNK = 40;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/api/items/segmentation-masks?ids=${encodeURIComponent(chunk.join(","))}`,
        undefined,
        60000,
        1,
        1000
      );
      const data = await res.json();
      if (!data?.ok || !data.masks) continue;
      for (const [id, pts] of Object.entries(data.masks)) {
        if (Array.isArray(pts) && pts.length >= 3) {
          maskCache.set(id, pts as Point[]);
          result.set(id, pts as Point[]);
        }
      }
    } catch (err) {
      console.warn("[segmentationMasks] fetch chunk failed:", err);
    }
  }
  return result;
}

/**
 * Attach segmentation masks to the given items (mutates `item.segmentationMask`).
 * Only items without one are fetched; already-populated items are skipped.
 */
export async function attachSegmentationMasks(items: Array<Item | undefined | null>): Promise<void> {
  const targets = (items || []).filter((it): it is Item =>
    !!it && !!it.id && !(Array.isArray(it.segmentationMask) && it.segmentationMask.length >= 3)
  );
  if (targets.length === 0) return;
  const ids = targets.map((it) => it.id);
  const masks = await fetchSegmentationMasks(ids);
  for (const it of targets) {
    const m = masks.get(it.id);
    if (m && Array.isArray(m) && m.length >= 3) it.segmentationMask = m;
  }
}

/**
 * Return the placement outline for an Item, preferring the segmentation mask
 * (normalized [0,1]) over polygon_json when available. Mirrors how the app
 * constructs polygonOutline for scene objects.
 */
export function resolveItemOutline(item: Item): Point[] | undefined {
  if (Array.isArray(item.segmentationMask) && item.segmentationMask.length >= 3) {
    return item.segmentationMask;
  }
  if (item.polygon_json) {
    return typeof item.polygon_json === "string" ? JSON.parse(item.polygon_json) : item.polygon_json;
  }
  return undefined;
}