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
      bag.polygonOutline
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
    return {
      x: minX + Math.random() * (maxX - minX),
      y: minY + Math.random() * (maxY - minY),
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
    const candidateX = minX + width/2 + Math.random() * (maxX - minX - width);
    const candidateY = minY + height/2 + Math.random() * (maxY - minY - height);
    const randomRotation = Math.random() * 360;
    
    const testObj = {
      polygonOutline,
      transform: {
        x: candidateX, y: candidateY, width, height, rotation: randomRotation
      }
    };
    
    if (isObjectInsideContainer(testObj, container)) {
      return { x: candidateX, y: candidateY, rotation: randomRotation };
    }
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
