export type SceneObject = {
  id: string;
  /** Original library item id. When the same item is placed multiple times,
   *  each instance gets a unique `id` (e.g. `${itemId}__<n>`), and `itemId`
   *  always points back to the original library item so pixel data / masks
   *  can still be resolved. */
  itemId?: string;
  name: string;
  library: string;
  originalPixelValue: number;
  currentPixelValue: number;
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
  tags?: string[];
};

export type CombinatorialResult = {
  id: string;
  bag: import("../types/library").Item;
  threats: import("../types/library").Item[];
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