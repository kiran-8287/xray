import React from "react";
import type { Point } from "../types/geometry";
import { STENCIL_TOKENS, type StencilColors } from "./tokens";
import type { StencilId, StencilDescriptor } from "./types";

const viewBox: "0 0 100 100" = "0 0 100 100";

const suitcaseValidRegion: Point[] = [
  { x: 14, y: 28 },
  { x: 86, y: 28 },
  { x: 86, y: 86 },
  { x: 14, y: 86 },
];

const backpackValidRegion: Point[] = [
  { x: 26, y: 28 },
  { x: 74, y: 28 },
  { x: 78, y: 56 },
  { x: 72, y: 90 },
  { x: 28, y: 90 },
  { x: 22, y: 56 },
];

const duffelValidRegion: Point[] = [
  { x: 18, y: 32 },
  { x: 82, y: 32 },
  { x: 82, y: 80 },
  { x: 18, y: 80 },
];

const MAX_PIXEL = 65535;

export const STENCILS: Record<StencilId, StencilDescriptor> = {
  // --- Bags ---
  suitcase: {
    id: "suitcase",
    kind: "bag",
    name: "Suitcase",
    desc: "Standard rolling carry-on",
    viewBox,
    pixelValue: 45000,
    validRegion: suitcaseValidRegion,
    render: ({ fill, stroke, fillOpacity }) => (
      <g>
        {/* Main body */}
        <rect x="10" y="25" width="80" height="65" rx="8" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        {/* Top handle */}
        <rect x="35" y="18" width="30" height="10" rx="5" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        {/* Corners/wheels */}
        <rect x="12" y="82" width="12" height="6" rx="2" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
        <rect x="76" y="82" width="12" height="6" rx="2" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
      </g>
    ),
  },
  backpack: {
    id: "backpack",
    kind: "bag",
    name: "Backpack",
    desc: "Tactical dual-strap daypack",
    viewBox,
    pixelValue: 48000,
    validRegion: backpackValidRegion,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        {/* Main pack */}
        <path d="M30,90 C25,75 28,25 50,15 C72,25 75,75 70,90 C68,95 60,97 50,97 C40,97 32,95 30,90 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        {/* Front pocket */}
        <rect x="35" y="55" width="30" height="25" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        {/* Straps */}
        <path d="M40,25 C30,20 28,40 30,55" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <path d="M60,25 C70,20 72,40 70,55" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      </g>
    ),
  },
  duffel: {
    id: "duffel",
    kind: "bag",
    name: "Duffel",
    desc: "Cylindrical sports utility bag",
    viewBox,
    pixelValue: 42000,
    validRegion: duffelValidRegion,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        {/* Main cylinder */}
        <ellipse cx="50" cy="55" rx="40" ry="28" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        {/* End caps */}
        <ellipse cx="15" cy="55" rx="10" ry="20" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <ellipse cx="85" cy="55" rx="10" ry="20" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        {/* Top handle */}
        <path d="M30,35 Q50,15 70,35" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      </g>
    ),
  },
  trolley: {
    id: "trolley",
    kind: "bag",
    name: "Trolley",
    desc: "Expandable wheeled trolley",
    viewBox,
    pixelValue: 46000,
    validRegion: suitcaseValidRegion,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        {/* Main body */}
        <rect x="18" y="20" width="64" height="68" rx="6" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        {/* Telescoping handle */}
        <rect x="42" y="8" width="16" height="14" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <rect x="38" y="2" width="24" height="8" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        {/* Wheels */}
        <ellipse cx="25" cy="90" rx="8" ry="6" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
        <ellipse cx="75" cy="90" rx="8" ry="6" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
      </g>
    ),
  },
  handbag: {
    id: "handbag",
    kind: "bag",
    name: "Handbag",
    desc: "Elegant leather handbag",
    viewBox,
    pixelValue: 44000,
    validRegion: backpackValidRegion,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        {/* Body */}
        <path d="M20,45 Q20,75 50,78 Q80,75 80,45 L80,40 Q80,35 50,35 Q20,35 20,40 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        {/* Handles */}
        <path d="M30,40 Q30,20 50,15 Q70,20 70,40" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  },
  laptopBag: {
    id: "laptopBag",
    kind: "bag",
    name: "Laptop Bag",
    desc: "Professional laptop briefcase",
    viewBox,
    pixelValue: 47000,
    validRegion: suitcaseValidRegion,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        {/* Main body */}
        <rect x="15" y="20" width="70" height="70" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        {/* Front pocket */}
        <rect x="20" y="50" width="60" height="25" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        {/* Handle */}
        <rect x="40" y="12" width="20" height="10" rx="5" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        {/* Shoulder strap rings */}
        <circle cx="20" cy="30" r="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
        <circle cx="80" cy="30" r="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
      </g>
    ),
  },

  // --- Trays ---
  trayStandard: {
    id: "trayStandard",
    kind: "tray",
    name: "Standard Tray",
    desc: "Standard airport security tray",
    viewBox,
    pixelValue: 52000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="10" y="10" width="80" height="80" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="15" y="15" width="70" height="70" rx="3" fill="none" stroke={stroke} strokeWidth="1" strokeDasharray="3 3" />
      </g>
    ),
  },
  trayMetal: {
    id: "trayMetal",
    kind: "tray",
    name: "Metal Tray",
    desc: "Heavy-duty metal tray",
    viewBox,
    pixelValue: 55000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="8" y="8" width="84" height="84" rx="6" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="3" />
        <rect x="14" y="14" width="72" height="72" rx="4" fill="none" stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },

  // --- Clothes ---
  tshirt: {
    id: "tshirt",
    kind: "clothes",
    name: "T-Shirt",
    desc: "Cotton crew-neck t-shirt",
    viewBox,
    pixelValue: 35000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <path d="M35,20 L35,35 L20,45 L20,85 L80,85 L80,45 L65,35 L65,20 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <path d="M40,20 Q50,10 60,20" fill="none" stroke={stroke} strokeWidth="2" />
      </g>
    ),
  },
  jeans: {
    id: "jeans",
    kind: "clothes",
    name: "Jeans",
    desc: "Denim blue jeans",
    viewBox,
    pixelValue: 32000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <path d="M30,15 L70,15 L70,40 L60,40 L60,90 L40,90 L40,40 L30,40 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="38" y="18" width="24" height="8" rx="2" fill="none" stroke={stroke} strokeWidth="1" />
      </g>
    ),
  },
  sweater: {
    id: "sweater",
    kind: "clothes",
    name: "Sweater",
    desc: "Woolen crew-neck sweater",
    viewBox,
    pixelValue: 38000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <path d="M30,20 L30,38 L18,48 L18,88 L82,88 L82,48 L70,38 L70,20 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <path d="M35,20 Q50,12 65,20" fill="none" stroke={stroke} strokeWidth="2.5" />
      </g>
    ),
  },
  coat: {
    id: "coat",
    kind: "clothes",
    name: "Coat",
    desc: "Winter overcoat",
    viewBox,
    pixelValue: 40000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <path d="M25,18 L75,18 L78,40 L82,90 L50,90 L18,90 L22,40 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <path d="M38,18 L38,45" fill="none" stroke={stroke} strokeWidth="2" />
        <path d="M62,18 L62,45" fill="none" stroke={stroke} strokeWidth="2" />
      </g>
    ),
  },

  // --- Electronics ---
  laptop: {
    id: "laptop",
    kind: "electronics",
    name: "Laptop",
    desc: "Thin and light laptop",
    viewBox,
    pixelValue: 18000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="15" y="10" width="70" height="50" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="18" y="60" width="64" height="8" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <circle cx="50" cy="30" r="2" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
      </g>
    ),
  },
  phone: {
    id: "phone",
    kind: "electronics",
    name: "Smartphone",
    desc: "Modern touchscreen smartphone",
    viewBox,
    pixelValue: 15000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="30" y="10" width="40" height="80" rx="8" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="33" y="15" width="34" height="65" rx="5" fill="none" stroke={stroke} strokeWidth="1" />
        <circle cx="50" cy="86" r="3" fill="none" stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
  charger: {
    id: "charger",
    kind: "electronics",
    name: "Charger",
    desc: "Wall charger power adapter",
    viewBox,
    pixelValue: 20000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="30" y="20" width="40" height="45" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="35" y="70" width="12" height="10" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <rect x="53" y="70" width="12" height="10" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
  heatingCoil: {
    id: "heatingCoil",
    kind: "electronics",
    name: "Heating Coil",
    desc: "Portable heating coil",
    viewBox,
    pixelValue: 25000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="35" y="10" width="30" height="20" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <path d="M35,30 Q25,45 35,60 Q45,75 35,90" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <path d="M65,30 Q75,45 65,60 Q55,75 65,90" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      </g>
    ),
  },
  hairDryer: {
    id: "hairDryer",
    kind: "electronics",
    name: "Hair Dryer",
    desc: "Electric hair dryer",
    viewBox,
    pixelValue: 22000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="40" y="20" width="20" height="55" rx="10" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <ellipse cx="60" cy="30" rx="25" ry="18" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <circle cx="40" cy="75" r="6" fill="none" stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },

  // --- Food ---
  energyBar: {
    id: "energyBar",
    kind: "food",
    name: "Energy Bar",
    desc: "Protein energy bar wrapper",
    viewBox,
    pixelValue: 40000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="25" y="35" width="50" height="30" rx="6" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="28" y="38" width="44" height="24" rx="4" fill="none" stroke={stroke} strokeWidth="1" />
      </g>
    ),
  },
  banana: {
    id: "banana",
    kind: "food",
    name: "Banana",
    desc: "Curved yellow banana",
    viewBox,
    pixelValue: 45000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <path d="M30,65 Q20,40 40,20 Q60,10 75,30 Q65,50 60,70 Q50,85 35,75 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <ellipse cx="40" cy="18" rx="6" ry="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1" />
      </g>
    ),
  },
  waterBottle: {
    id: "waterBottle",
    kind: "food",
    name: "Water Bottle",
    desc: "Plastic water bottle",
    viewBox,
    pixelValue: 38000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="38" y="30" width="24" height="55" rx="6" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="43" y="18" width="14" height="15" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <rect x="42" y="12" width="16" height="8" rx="2" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },

  // --- Threats ---
  gun: {
    id: "gun",
    kind: "threat",
    name: "Gun",
    desc: "Compact semi-automatic firearm",
    viewBox: "0 0 230 120",
    pixelValue: 12000,
    densityCoeff: 0.15,
    render: ({ stroke, fill, fillOpacity }) => (
      <g>
        <rect x="120" y="22" width="98" height="14" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <rect x="80" y="18" width="136" height="22" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <path d="M80 38 L185 38 L185 58 L175 58 L175 48 L80 48 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <path d="M80 38 L90 38 L95 100 L55 104 L48 60 L60 38 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
  knife: {
    id: "knife",
    kind: "threat",
    name: "Knife",
    desc: "Fixed blade combat weapon",
    viewBox: "0 0 230 70",
    pixelValue: 14000,
    densityCoeff: 0.08,
    render: ({ stroke, fill, fillOpacity }) => (
      <g>
        <path d="M52 28 L195 14 L210 28 L195 42 L52 36 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <rect x="44" y="20" width="10" height="16" rx="2" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <rect x="5" y="22" width="40" height="12" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
  generic: {
    id: "generic",
    kind: "threat",
    name: "Generic Threat",
    desc: "Generic dense threat object",
    viewBox,
    pixelValue: 16000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <circle cx="50" cy="50" r="30" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="3" />
        <circle cx="50" cy="50" r="18" fill="none" stroke={stroke} strokeWidth="2" />
      </g>
    ),
  },

  // --- Stationary ---
  notebook: {
    id: "notebook",
    kind: "stationary",
    name: "Notebook",
    desc: "Spiral-bound notebook",
    viewBox,
    pixelValue: 43000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="20" y="15" width="60" height="75" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <line x1="28" y1="15" x2="28" y2="90" stroke={stroke} strokeWidth="4" />
        {[...Array(7)].map((_, i) => (
          <circle key={i} cx="28" cy={25 + i * 10} r="3" fill="white" stroke={stroke} strokeWidth="1" />
        ))}
      </g>
    ),
  },
  pen: {
    id: "pen",
    kind: "stationary",
    name: "Pen",
    desc: "Ballpoint pen with clip",
    viewBox,
    pixelValue: 41000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="35" y="12" width="30" height="8" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="35" y="20" width="30" height="60" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="50" y="15" width="12" height="25" rx="2" fill="none" stroke={stroke} strokeWidth="1.5" />
        <polygon points="40,80 50,90 60,80" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
  stapler: {
    id: "stapler",
    kind: "stationary",
    name: "Stapler",
    desc: "Standard office stapler",
    viewBox,
    pixelValue: 44000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="20" y="45" width="65" height="20" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <path d="M25,45 L40,25 L80,25 L85,45" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="70" y="50" width="10" height="10" rx="2" fill="none" stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },

  // --- LAG ---
  toothpaste: {
    id: "toothpaste",
    kind: "lag",
    name: "Toothpaste",
    desc: "Toothpaste tube",
    viewBox,
    pixelValue: 25000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="35" y="75" width="30" height="15" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <path d="M30,30 Q30,75 50,78 Q70,75 70,30 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="42" y="15" width="16" height="18" rx="3" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
  perfume: {
    id: "perfume",
    kind: "lag",
    name: "Perfume",
    desc: "Glass perfume bottle",
    viewBox,
    pixelValue: 22000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="32" y="40" width="36" height="45" rx="6" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="42" y="25" width="16" height="18" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <ellipse cx="50" cy="18" rx="8" ry="5" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
  shampoo: {
    id: "shampoo",
    kind: "lag",
    name: "Shampoo",
    desc: "Plastic shampoo bottle",
    viewBox,
    pixelValue: 28000,
    render: ({ fill, fillOpacity, stroke }) => (
      <g>
        <rect x="30" y="35" width="40" height="50" rx="8" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="2" />
        <rect x="40" y="20" width="20" height="18" rx="4" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
        <ellipse cx="50" cy="14" rx="8" ry="5" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth="1.5" />
      </g>
    ),
  },
};

export function renderObjectSvg(id: StencilId) {
  const stencil = STENCILS[id];
  const grayValue = Math.round((stencil.pixelValue / MAX_PIXEL) * 255);
  const grayColor = `rgb(${grayValue}, ${grayValue}, ${grayValue})`;
  return (
    <svg viewBox={stencil.viewBox} preserveAspectRatio="none" className="w-full h-full">
      {stencil.render({
        stroke: grayColor,
        fill: grayColor,
        fillOpacity: 1.0,
      })}
    </svg>
  );
}
