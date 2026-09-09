import type { CombinatorialResult } from "../types/customization";
import { getTransformedPolygon } from "./geometry";

interface LayoutObject {
  id: string;
  subcategory?: string;
  filepath: string;
  center: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number;
  originalPixelValue?: number;
  currentPixelValue?: number;
  layer: number;
}

interface LayoutBag extends LayoutObject {
  polygonOutline?: { x: number; y: number }[];
  validRegionPolygon?: { x: number; y: number }[];
  tags?: string[];
}

interface LayoutPayload {
  id: string;
  name: string;
  filepath: string | null;
  layout_json: {
    threat_count: number;
    non_threat_count: number;
    objects: {
      bag: LayoutBag | null;
      threats: LayoutObject[];
      "non-threats": LayoutObject[];
    };
    createdAt: string;
  };
}

function toLayoutObject(obj: {
  id: string;
  itemId?: string;
  subcategory?: string;
  filepath?: string;
  transform: { x: number; y: number; width: number; height: number; rotation: number };
  originalPixelValue?: number;
  currentPixelValue?: number;
  layer: number;
}): LayoutObject {
  return {
    id: obj.itemId || obj.id,
    subcategory: obj.subcategory?.toLowerCase().replace(/\s+/g, "-"),
    filepath: obj.filepath || "",
    center: { x: obj.transform.x, y: obj.transform.y },
    size: { width: obj.transform.width, height: obj.transform.height },
    rotation: obj.transform.rotation,
    originalPixelValue: obj.originalPixelValue,
    currentPixelValue: obj.currentPixelValue,
    layer: obj.layer,
  };
}

export function buildLayoutPayload(comb: CombinatorialResult): LayoutPayload {
  const bagObject = comb.objects.find((o) => o.library === "bag");
  let validRegionPolygon: { x: number; y: number }[] = [];

  if (bagObject?.polygonOutline) {
    try {
      validRegionPolygon = getTransformedPolygon(
        { x: bagObject.transform.x, y: bagObject.transform.y },
        { width: bagObject.transform.width, height: bagObject.transform.height },
        bagObject.transform.rotation,
        bagObject.polygonOutline
      );
    } catch {
      // ignore invalid polygon
    }
  }

  const bagObj: LayoutBag | null = bagObject
    ? {
        ...toLayoutObject(bagObject),
        polygonOutline: bagObject.polygonOutline,
        validRegionPolygon,
        tags: bagObject.tags,
      }
    : null;

  const threats = comb.objects
    .filter((o) => o.library === "threat" && o.id !== bagObject?.id)
    .map((obj) => toLayoutObject(obj));

  const nonThreats = comb.objects
    .filter((o) => o.library !== "bag" && o.library !== "threat" && o.id !== bagObject?.id)
    .map((obj) => toLayoutObject(obj));

  return {
    id: comb.id,
    name: comb.id,
    filepath: null,
    layout_json: {
      threat_count: threats.length,
      non_threat_count: nonThreats.length,
      objects: { bag: bagObj, threats, "non-threats": nonThreats },
      createdAt: new Date().toISOString(),
    },
  };
}
