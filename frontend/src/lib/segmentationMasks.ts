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
 *
 * The `concurrency` option controls how many chunk requests run in parallel.
 * The default is 1 (fully sequential), which preserves the original behaviour so
 * other pages keep a low, predictable load. Callers that bulk-prefetch a large
 * number of items (e.g. the combination generator) may pass a higher value.
 */
export interface SegmentationMaskFetchOptions {
  concurrency?: number;
}

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

export async function fetchSegmentationMasks(
  itemIds: string[],
  options?: SegmentationMaskFetchOptions
): Promise<Map<string, Point[]>> {
  const result = new Map<string, Point[]>();
  const missing = itemIds.filter((id) => id && !maskCache.has(id));
  for (const id of itemIds) {
    const cached = maskCache.get(id);
    if (cached) result.set(id, cached);
  }
  if (missing.length === 0) return result;

  // Batch in chunks of 40 ids to keep the URL reasonably sized.
  const CHUNK = 40;
  const chunks = chunkIds(missing, CHUNK);
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 1, chunks.length));

  let cursor = 0;
  async function runWorker(): Promise<void> {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++];
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
  }

  const runners: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) runners.push(runWorker());
  await Promise.all(runners);
  return result;
}

/**
 * Attach segmentation masks to the given items (mutates `item.segmentationMask`).
 * Only items without one are fetched; already-populated items are skipped.
 */
export async function attachSegmentationMasks(
  items: Array<Item | undefined | null>,
  options?: SegmentationMaskFetchOptions
): Promise<void> {
  const targets = (items || []).filter((it): it is Item =>
    !!it && !!it.id && !(Array.isArray(it.segmentationMask) && it.segmentationMask.length >= 3)
  );
  if (targets.length === 0) return;
  const ids = targets.map((it) => it.id);
  const masks = await fetchSegmentationMasks(ids, options);
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