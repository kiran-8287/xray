import { isPointInPolygon, getRectCorners, edgeIntersectsPolygon, getTransformedPolygon } from "./geometry";
import type { Point } from "../types/geometry";
import type { SceneObject } from "../types/customization";

const MAX_PIXEL = 65535;

export const getTransformedValidRegion = (bag: SceneObject): Point[] => {
  // Use the polygon outline stored directly on the object (from DB polygon_json or valid_region)
  if (bag.polygonOutline && bag.polygonOutline.length >= 3) {
    return getTransformedPolygon(
      { x: bag.transform.x, y: bag.transform.y },
      { width: bag.transform.width, height: bag.transform.height },
      bag.transform.rotation,
      bag.polygonOutline.map(p => ({ x: p.x - 0.5, y: p.y - 0.5 }))
    );
  }
  // No valid region defined — fall back to bounding box corners
  return [];
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
        obj.polygonOutline
      )
    : getRectCorners(
        { x: obj.transform.x, y: obj.transform.y },
        { width: obj.transform.width, height: obj.transform.height },
        obj.transform.rotation
      );
  
  // 1. Verify all corners are inside the valid region
  for (const corner of objectOutline) {
    if (!isPointInPolygon(corner, validRegion)) {
      return false;
    }
  }
  
  // 2. Verify no edge crosses the valid region boundary
  for (let i = 0; i < objectOutline.length; i++) {
    const a = objectOutline[i];
    const b = objectOutline[(i + 1) % objectOutline.length];
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
): { x: number; y: number; rotation?: number } => {
  const validRegion = getTransformedValidRegion(container);
  if (validRegion.length < 3) {
    const margin = 10;
    const containerMinX = container.transform.x - container.transform.width / 2 + margin;
    const containerMaxX = container.transform.x + container.transform.width / 2 - margin;
    const containerMinY = container.transform.y - container.transform.height / 2 + margin;
    const containerMaxY = container.transform.y + container.transform.height / 2 - margin;
    const minX = containerMinX + width / 2;
    const maxX = containerMaxX - width / 2;
    const minY = containerMinY + height / 2;
    const maxY = containerMaxY - height / 2;
    
    const finalMinX = Math.min(minX, maxX);
    const finalMaxX = Math.max(minX, maxX);
    const finalMinY = Math.min(minY, maxY);
    const finalMaxY = Math.max(minY, maxY);

    return {
      x: finalMinX + Math.random() * (finalMaxX - finalMinX),
      y: finalMinY + Math.random() * (finalMaxY - finalMinY),
      rotation: Math.random() * 360
    };
  }
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  validRegion.forEach((p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  
  for (let i = 0; i < 1000; i++) {
    let checkW = width;
    let checkH = height;
    if (i > 100) {
      checkW = width * 0.8;
      checkH = height * 0.8;
    }
    if (i > 300) {
      checkW = width * 0.5;
      checkH = height * 0.5;
    }
    if (i > 600) {
      checkW = 0;
      checkH = 0;
    }

    const rangeX = maxX - minX - checkW;
    const rangeY = maxY - minY - checkH;
    
    let candidateX, candidateY;
    if (rangeX > 0) {
      candidateX = minX + checkW / 2 + Math.random() * rangeX;
    } else {
      candidateX = minX + (maxX - minX) / 2;
    }
    if (rangeY > 0) {
      candidateY = minY + checkH / 2 + Math.random() * rangeY;
    } else {
      candidateY = minY + (maxY - minY) / 2;
    }
    
    const randomRotation = Math.random() * 360;
    
    const testObj = {
      polygonOutline,
      transform: {
        x: candidateX, y: candidateY, width: checkW || 1, height: checkH || 1, rotation: randomRotation
      }
    };
    
    if (isObjectInsideContainer(testObj, container)) {
      return { x: candidateX, y: candidateY, rotation: randomRotation };
    }
  }
  
  if (validRegion.length >= 3) {
    let sumX = 0, sumY = 0;
    validRegion.forEach(p => { sumX += p.x; sumY += p.y; });
    return { x: sumX / validRegion.length, y: sumY / validRegion.length, rotation: 0 };
  }
  
  return { x: container.transform.x, y: container.transform.y, rotation: 0 };
};

export const doObjectsOverlap = (obj1: SceneObject, obj2: SceneObject): boolean => {
  return !(
    obj1.transform.x + obj1.transform.width / 2 < obj2.transform.x - obj2.transform.width / 2 ||
    obj1.transform.x - obj1.transform.width / 2 > obj2.transform.x + obj2.transform.width / 2 ||
    obj1.transform.y + obj1.transform.height / 2 < obj2.transform.y - obj2.transform.height / 2 ||
    obj1.transform.y - obj1.transform.height / 2 > obj2.transform.y + obj2.transform.height / 2
  );
};

export const calculatePixelValues = (objs: SceneObject[], threatOnly = false): SceneObject[] => {
  return objs.map((obj) => {
    let newPixelValue = obj.originalPixelValue;
    
    if (!threatOnly || obj.library === "threat") {
      let overlappingPixel = null;
      for (const other of objs) {
        if (other.id !== obj.id && other.layer < obj.layer && doObjectsOverlap(obj, other)) {
          overlappingPixel = other.currentPixelValue;
          break;
        }
      }

      if (overlappingPixel !== null) {
        newPixelValue = Math.round((obj.originalPixelValue * overlappingPixel) / MAX_PIXEL);
      }
    }

    return {
      ...obj,
      oldPixelValue: obj.currentPixelValue,
      currentPixelValue: newPixelValue,
    };
  });
};
