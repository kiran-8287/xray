export const STENCIL_TOKENS = {
  fillCol: "#BFDBFE",
  strokeCol: "#1E40AF",
  strokeW: 1.8,
  fillOpacity: 0.5,
  overlayStroke: "rgba(255,255,255,0.65)",
  overlayFill: "rgba(255,255,255,0.12)",
} as const;

export type StencilColors = {
  stroke?: string;
  fill?: string;
  fillOpacity?: number;
};

