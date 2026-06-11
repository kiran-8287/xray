// backend/src/lib/geometry.js

export function isPointInPolygon(point, vs) {
  const x = point.x;
  const y = point.y;
  let inside = false;

  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x;
    const yi = vs[i].y;
    const xj = vs[j].x;
    const yj = vs[j].y;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

export function getRectCorners(center, size, rotDeg) {
  const rad = (rotDeg * Math.PI) / 180;
  const halfW = size.width / 2;
  const halfH = size.height / 2;

  const localCorners = [
    { dx: -halfW, dy: -halfH },
    { dx: halfW, dy: -halfH },
    { dx: halfW, dy: halfH },
    { dx: -halfW, dy: halfH },
  ];

  return localCorners.map((c) => {
    const rotX = c.dx * Math.cos(rad) - c.dy * Math.sin(rad);
    const rotY = c.dx * Math.sin(rad) + c.dy * Math.cos(rad);
    return { x: center.x + rotX, y: center.y + rotY };
  });
}

export function lineSegmentsIntersect(p1, p2, p3, p4) {
  const ccw = (a, b, c) => {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  };
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export function edgeIntersectsPolygon(a, b, polygon) {
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    if (lineSegmentsIntersect(a, b, p1, p2)) {
      return true;
    }
  }
  return false;
}

export function getTransformedPolygon(center, size, rotDeg, outline) {
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return outline.map((p) => {
    const dx = p.x * size.width;
    const dy = p.y * size.height;
    const rotX = dx * cos - dy * sin;
    const rotY = dx * sin + dy * cos;
    return { x: center.x + rotX, y: center.y + rotY };
  });
}

export const getTransformedValidRegion = (bag) => {
  if (bag.polygonOutline && bag.polygonOutline.length >= 3) {
    return getTransformedPolygon(
      { x: bag.transform.x, y: bag.transform.y },
      { width: bag.transform.width, height: bag.transform.height },
      bag.transform.rotation,
      bag.polygonOutline
    );
  }
  return [];
};

export const isObjectInsideContainer = (obj, container) => {
  const containerPolygon = getTransformedValidRegion(container);
  if (containerPolygon.length < 3) return false;

  let objPolygon = [];
  if (obj.polygonOutline && obj.polygonOutline.length >= 3) {
    objPolygon = getTransformedPolygon(
      { x: obj.transform.x, y: obj.transform.y },
      { width: obj.transform.width, height: obj.transform.height },
      obj.transform.rotation,
      obj.polygonOutline
    );
  } else {
    objPolygon = getRectCorners(
      { x: obj.transform.x, y: obj.transform.y },
      { width: obj.transform.width, height: obj.transform.height },
      obj.transform.rotation
    );
  }

  // Check all corners inside the container valid region
  for (const corner of objPolygon) {
    if (!isPointInPolygon(corner, containerPolygon)) {
      return false;
    }
  }

  // Check every object edge for intersections with container boundary
  for (let i = 0; i < objPolygon.length; i++) {
    const a = objPolygon[i];
    const b = objPolygon[(i + 1) % objPolygon.length];
    if (edgeIntersectsPolygon(a, b, containerPolygon)) {
      return false;
    }
  }

  return true;
};

export const getRandomPositionInContainer = (width, height, polygonOutline, container) => {
  const validRegion = getTransformedValidRegion(container);
  if (validRegion.length < 3) {
    // Fallback if no valid region exists
    const containerMinX = container.transform.x - container.transform.width / 2;
    const containerMaxX = container.transform.x + container.transform.width / 2;
    const containerMinY = container.transform.y - container.transform.height / 2;
    const containerMaxY = container.transform.y + container.transform.height / 2;

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
  validRegion.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  for (let i = 0; i < 1000; i++) {
    const candidateX = minX + width / 2 + Math.random() * (maxX - minX - width);
    const candidateY = minY + height / 2 + Math.random() * (maxY - minY - height);
    const randomRotation = Math.random() * 360;

    const testObj = {
      polygonOutline,
      transform: {
        x: candidateX,
        y: candidateY,
        width,
        height,
        rotation: randomRotation
      }
    };

    if (isObjectInsideContainer(testObj, container)) {
      return { x: candidateX, y: candidateY, rotation: randomRotation };
    }
  }

  return { x: container.transform.x, y: container.transform.y, rotation: 0 };
};
