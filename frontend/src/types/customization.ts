export type SceneObject = {
  id: string;
  /** Original backend library item id when this object was added from the library.
   *  The renderer uses this to fetch 16-bit .npz pixel data; `id` itself may be a
   *  throwaway `custom-object-*` key used only for React-list identity. */
  sourceItemId?: string;
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