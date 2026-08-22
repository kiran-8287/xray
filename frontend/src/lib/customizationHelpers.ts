import { isPointInPolygon, getRectCorners, edgeIntersectsPolygon, getTransformedPolygon } from "./geometry";
import type { Point } from "../types/geometry";
import type { SceneObject } from "../types/customization";
import { getObjectPixelBounds } from "../lib/xrayRenderer";

export const getTransformedValidRegion = (
  bag: SceneObject,
  actualImageDimensions?: { width: number; height: number } | null
): Point[] => {
  // Use the polygon outline stored directly on the object (from DB polygon_json or valid_region)
  if (bag.polygonOutline && bag.polygonOutline.length >= 3) {
    // Images are drawn stretched to fill the container via drawImage(),
    // so use the full transform dimensions directly — no aspect-ratio correction needed.
    const displayWidth = bag.transform.width;
    const displayHeight = bag.transform.height;

    return getTransformedPolygon(
      { x: bag.transform.x, y: bag.transform.y },
      { width: displayWidth, height: displayHeight },
      bag.transform.rotation,
      bag.polygonOutline.map(p => ({ x: p.x - 0.5, y: p.y - 0.5 }))
    );
  }
  // No valid region defined — fall back to bounding box corners
  return [];
};

/**
 * Return the object's footprint polygon in canvas coords. Uses the segmentation
 * mask / polygonOutline when present (normalized [0,1], shifted to [-0.5,0.5]),
 * otherwise the transformed rect corners.
 */
export const getObjectFootprintPolygon = (
  obj: {
    polygonOutline?: Point[];
    transform: { x: number; y: number; width: number; height: number; rotation: number };
  }
): Point[] => {
  if (obj.polygonOutline && obj.polygonOutline.length >= 3) {
    return getTransformedPolygon(
      { x: obj.transform.x, y: obj.transform.y },
      { width: obj.transform.width, height: obj.transform.height },
      obj.transform.rotation,
      obj.polygonOutline.map(p => ({ x: p.x - 0.5, y: p.y - 0.5 }))
    );
  }
  return getRectCorners(
    { x: obj.transform.x, y: obj.transform.y },
    { width: obj.transform.width, height: obj.transform.height },
    obj.transform.rotation
  );
};

/**
 * Axis-aligned bounding box (in canvas coords, never tilted) of the object's
 * footprint — i.e. derived from the segmentation mask/outline, so the box hugs
 * the threat instead of the full original image rectangle.
 */
export const getObjectAxisAlignedBox = (
  obj: {
    id?: string;
    polygonOutline?: Point[];
    transform: { x: number; y: number; width: number; height: number; rotation: number };
  }
): { left: number; top: number; width: number; height: number; centerX: number; centerY: number } => {
  if (obj.id) {
    const cachedBounds = getObjectPixelBounds(obj.id);
    if (cachedBounds) {
      return {
        left: cachedBounds.left,
        top: cachedBounds.top,
        width: cachedBounds.width,
        height: cachedBounds.height,
        centerX: cachedBounds.left + cachedBounds.width / 2,
        centerY: cachedBounds.top + cachedBounds.height / 2,
      };
    }
  }

  const b = getAxisAlignedBounds(getObjectFootprintPolygon(obj));
  const left = b.minX;
  const top = b.minY;
  const width = Math.max(1, b.maxX - b.minX);
  const height = Math.max(1, b.maxY - b.minY);
  return { left, top, width, height, centerX: left + width / 2, centerY: top + height / 2 };
};

/**
 * Compute the axis-aligned bounding box (AABB) of a set of points.
 * Used so placement/out-of-bounds checks use standard detection-style boxes
 * (never tilted), regardless of the object's/mask's rotation.
 */
export const getAxisAlignedBounds = (points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

export const isObjectInsideContainer = (
  obj: {
    polygonOutline?: Point[];
    transform: { x: number; y: number; width: number; height: number; rotation: number };
  },
  container: SceneObject
): boolean => {
  const validRegion = getTransformedValidRegion(container);
  if (validRegion.length < 3) return true;
  
  const objectOutline = obj.polygonOutline && obj.polygonOutline.length >= 3
    ? getTransformedPolygon(
        { x: obj.transform.x, y: obj.transform.y },
        { width: obj.transform.width, height: obj.transform.height },
        obj.transform.rotation,
        obj.polygonOutline.map(p => ({ x: p.x - 0.5, y: p.y - 0.5 }))
      )
    : getRectCorners(
        { x: obj.transform.x, y: obj.transform.y },
        { width: obj.transform.width, height: obj.transform.height },
        obj.transform.rotation
      );

  // Check the actual shape outline, not an inflated axis-aligned bounding box.
  // Using the AABB of a rotated polygon produces false positives because the
  // bounding-box corners extend beyond the real rotated shape.
  const objectBox = objectOutline;

  // 1. Verify all actual corners are inside the valid region
  for (const corner of objectBox) {
    if (!isPointInPolygon(corner, validRegion)) {
      return false;
    }
  }

  // 2. Verify no shape edge crosses the valid region boundary
  for (let i = 0; i < objectBox.length; i++) {
    const a = objectBox[i];
    const b = objectBox[(i + 1) % objectBox.length];
    if (edgeIntersectsPolygon(a, b, validRegion)) {
      return false;
    }
  }
  
  return true;
};


export const getRandomPositionInContainer = (
  width: number,
  height: number,
  container: SceneObject,
  polygonOutline?: Point[]
): { x: number; y: number; rotation?: number } | null => {
  const validRegion = getTransformedValidRegion(container);
  const actualWidth = Math.max(width, 1);
  const actualHeight = Math.max(height, 1);

  if (validRegion.length < 3) {
    const margin = 10;
    const containerMinX = container.transform.x - container.transform.width / 2 + margin;
    const containerMaxX = container.transform.x + container.transform.width / 2 - margin;
    const containerMinY = container.transform.y - container.transform.height / 2 + margin;
    const containerMaxY = container.transform.y + container.transform.height / 2 - margin;
    const minX = containerMinX + actualWidth / 2;
    const maxX = containerMaxX - actualWidth / 2;
    const minY = containerMinY + actualHeight / 2;
    const maxY = containerMaxY - actualHeight / 2;

    if (minX > maxX || minY > maxY) return null;

    for (let attempt = 0; attempt < 20; attempt++) {
      const candidateX = minX + Math.random() * (maxX - minX);
      const candidateY = minY + Math.random() * (maxY - minY);
      const randomRotation = Math.random() * 360;
      const testObj = {
        polygonOutline,
        transform: { x: candidateX, y: candidateY, width: actualWidth, height: actualHeight, rotation: randomRotation }
      };
      if (isObjectInsideContainer(testObj, container)) {
        return { x: candidateX, y: candidateY, rotation: randomRotation };
      }
    }

    return null;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  validRegion.forEach((p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  for (let i = 0; i < 1000; i++) {
    const candidateX = minX + actualWidth / 2 + Math.random() * Math.max(0, maxX - minX - actualWidth);
    const candidateY = minY + actualHeight / 2 + Math.random() * Math.max(0, maxY - minY - actualHeight);
    const randomRotation = Math.random() * 360;
    const testObj = {
      polygonOutline,
      transform: { x: candidateX, y: candidateY, width: actualWidth, height: actualHeight, rotation: randomRotation }
    };
    if (isObjectInsideContainer(testObj, container)) {
      return { x: candidateX, y: candidateY, rotation: randomRotation };
    }
  }

  return null;
};

export const doObjectsOverlap = (obj1: SceneObject, obj2: SceneObject): boolean => {
  const box1 = getObjectAxisAlignedBox(obj1);
  const box2 = getObjectAxisAlignedBox(obj2);
  return !(
    box1.centerX + box1.width / 2 < box2.centerX - box2.width / 2 ||
    box1.centerX - box1.width / 2 > box2.centerX + box2.width / 2 ||
    box1.centerY + box1.height / 2 < box2.centerY - box2.height / 2 ||
    box1.centerY - box1.height / 2 > box2.centerY + box2.height / 2
  );
};
