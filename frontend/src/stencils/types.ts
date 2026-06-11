import type { Point } from "../types/geometry";
import type { StencilColors } from "./tokens";

export type StencilId =
  | "suitcase"
  | "backpack"
  | "duffel"
  | "trolley"
  | "handbag"
  | "laptopBag"
  | "trayStandard"
  | "trayMetal"
  | "tshirt"
  | "jeans"
  | "sweater"
  | "coat"
  | "laptop"
  | "phone"
  | "charger"
  | "heatingCoil"
  | "hairDryer"
  | "energyBar"
  | "banana"
  | "waterBottle"
  | "gun"
  | "knife"
  | "generic"
  | "notebook"
  | "pen"
  | "stapler"
  | "toothpaste"
  | "perfume"
  | "shampoo";

export type StencilKind = "bag" | "tray" | "clothes" | "electronics" | "food" | "threat" | "stationary" | "lag";

export type StencilDescriptor = {
  id: StencilId;
  kind: StencilKind;
  name: string;
  desc: string;
  viewBox: string;
  pixelValue: number;
  densityCoeff?: number;
  validRegion?: Point[];
  render: (colors: Required<StencilColors>) => React.ReactNode;
};
