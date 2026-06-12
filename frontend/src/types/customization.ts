import type { StencilId, StencilKind } from "../stencils/types";

export type SceneObject = {
  id: string;
  name: string;
  library: StencilKind;
  originalPixelValue: number;
  currentPixelValue: number;
  oldPixelValue: number | null;
  stencilId: StencilId;
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
};
