export type SceneObject = {
  id: string;
  name: string;
  library: string;
  originalPixelValue: number;
  currentPixelValue: number;
  oldPixelValue: number | null;
  stencilId: string;
  filepath?: string;
  polygonOutline?: { x: number; y: number }[];
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  initialWidth?: number;
  initialHeight?: number;
  layer: number;
  subcategory?: string;
};

export type CombinatorialResult = {
  id: string;
  bag: import("../types/library").Item;
  threat?: import("../types/library").Item;
  others: import("../types/library").Item[];
  objects: SceneObject[];
};

export type FailureLog = {
  bagName: string;
  bagId: string;
  threatName: string;
  threatId: string;
  reason: string;
  expected: number;
  actual: number;
};

export type GenerationResult = {
  results: CombinatorialResult[];
  failures: FailureLog[];
};