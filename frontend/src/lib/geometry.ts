import type { Point } from "../types/geometry";

export function isPointInPolygon(point: Point, vs: Point[]) {
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

export function getRectCorners(center: Point, size: { width: number; height: number }, rotDeg: number) {
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

export function lineSegmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const ccw = (a: Point, b: Point, c: Point) => {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  };
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export function edgeIntersectsPolygon(a: Point, b: Point, polygon: Point[]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    if (lineSegmentsIntersect(a, b, p1, p2)) {
      return true;
    }
  }
  return false;
}

export function getTransformedPolygon(
  center: Point,
  size: { width: number; height: number },
  rotDeg: number,
  outline: Point[]
): Point[] {
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

