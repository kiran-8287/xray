import { StencilKind } from "../stencils/types";
import type { TaxonomyCategory, TaxonomySubcategory } from "../types/library";

export interface CategoryStyle {
  bg: string;
  text: string;
  border: string;
  borderAccent: string;
  label: string;
  slug: string;
}

export const CATEGORY_MAP: Record<string, CategoryStyle> = {
  bags: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", borderAccent: "border-blue-500", label: "Bags", slug: "bags" },
  trays: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200", borderAccent: "border-slate-500", label: "Trays", slug: "trays" },
  clothing: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", borderAccent: "border-green-500", label: "Clothing", slug: "clothing" },
  clothes: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", borderAccent: "border-green-500", label: "Clothes", slug: "clothes" },
  electronics: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", borderAccent: "border-violet-500", label: "Electronics", slug: "electronics" },
  "food-drink": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", borderAccent: "border-amber-500", label: "Food & Drink", slug: "food-drink" },
  food: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", borderAccent: "border-amber-500", label: "Food", slug: "food" },
  "threat-prohibited-objects": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", borderAccent: "border-rose-500", label: "Threats", slug: "threat-prohibited-objects" },
  threats: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", borderAccent: "border-rose-500", label: "Threats", slug: "threats" },
  threat: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", borderAccent: "border-rose-500", label: "Threats", slug: "threat" },
  "non-threats": { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", borderAccent: "border-gray-500", label: "Non-Threats", slug: "non-threats" },
  bag: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", borderAccent: "border-blue-500", label: "Bags", slug: "bag" },
  tray: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200", borderAccent: "border-slate-500", label: "Trays", slug: "tray" },
  "toiletries-medical": { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", borderAccent: "border-sky-500", label: "Toiletries & Medical", slug: "toiletries-medical" },
  "stationery-office": { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", borderAccent: "border-indigo-500", label: "Stationery & Office", slug: "stationery-office" },
  stationary: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", borderAccent: "border-indigo-500", label: "Stationary", slug: "stationary" },
  "sports-outdoors": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", borderAccent: "border-emerald-500", label: "Sports & Outdoors", slug: "sports-outdoors" },
  miscellaneous: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", borderAccent: "border-gray-500", label: "Miscellaneous", slug: "miscellaneous" },
  misc: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", borderAccent: "border-gray-500", label: "Misc", slug: "misc" },
  lag: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", borderAccent: "border-sky-500", label: "LAG", slug: "lag" },
};

export function normalizeCategoryName(cat: string): string {
  const normalized = (cat || "").toLowerCase().trim();
  // Preserve explicit non-threat labels before threat matching
  if (normalized === "non-threats" || normalized === "non-threat" || normalized.includes("non threat")) {
    return "non-threats";
  }
  if (normalized.includes("bag")) return "bags";
  if (normalized.includes("threat") || normalized.includes("electronic") || normalized === "electronics") return "threats";
  // Everything else is non-threats (trays, clothes, food, misc, sports, stationery, etc.)
  return "non-threats";
}

export function mergeCategorizedItems(categorized: any): any {
  if (!categorized) return null;
  const merged: any = {};
  for (const [catKey, subcats] of Object.entries(categorized)) {
    const normalized = normalizeCategoryName(catKey);
    if (!merged[normalized]) {
      merged[normalized] = {};
    }
    for (const [subKey, items] of Object.entries(subcats || {})) {
      if (!merged[normalized][subKey]) {
        merged[normalized][subKey] = [];
      }
      if (Array.isArray(items)) {
        merged[normalized][subKey].push(...items);
      }
    }
  }
  return merged;
}

export function getLibrarySubcategories(taxonomy: TaxonomyCategory[] = [], librarySlug: string): TaxonomySubcategory[] {
  const seen: Record<string, boolean> = {};
  return taxonomy
    .filter((category) => normalizeCategoryName(category.slug || category.name) === librarySlug)
    .flatMap((category) => category.subcategories || [])
    .filter((subcategory) => {
      if (seen[subcategory.slug]) return false;
      seen[subcategory.slug] = true;
      return true;
    });
}

export const getCategoryConfig = (category: string): CategoryStyle => {
  const normalized = normalizeCategoryName(category);
  return CATEGORY_MAP[normalized] || CATEGORY_MAP.miscellaneous;
};

// Define library prefixes and display names (for Upload filename auto-matching)
export const LIBRARY_PREFIXES: Record<string, string> = {
  bag: "Bags",
  threat: "Threats",
  tray: "Trays",
  clothes: "Clothes",
  electronics: "Electronics",
  food: "Food",
  stationary: "Miscellaneous",
  lag: "Miscellaneous",
  misc: "Miscellaneous",
  sports: "Miscellaneous",
};

// Upload page list of target libraries
export const LIBRARIES = [
  { slug: "bags", name: "Bags", colorCls: "bg-blue-50 text-blue-700 border-blue-200" },
  { slug: "threats", name: "Threats", colorCls: "bg-rose-50 text-rose-700 border-rose-200" },
  { slug: "non-threats", name: "Non-Threats", colorCls: "bg-gray-50 text-gray-700 border-gray-200" },
];

export const getCategoryColorCls = (slug: string) => {
  const normalized = normalizeCategoryName(slug);
  const map: Record<string, string> = {
    bags: "bg-blue-500",
    bag: "bg-blue-500",
    threats: "bg-rose-500",
    threat: "bg-rose-500",
    trays: "bg-slate-500",
    tray: "bg-slate-500",
    clothes: "bg-green-500",
    clothing: "bg-green-500",
    electronics: "bg-violet-500",
    food: "bg-amber-500",
    "food-drink": "bg-amber-500",
    stationary: "bg-gray-500",
    lag: "bg-gray-500",
    misc: "bg-gray-500",
    miscellaneous: "bg-gray-500",
    sports: "bg-gray-500",
  };
  return map[normalized] || "bg-slate-400";
};

export const LIBRARY_NAMES: Record<StencilKind, string> = {
  bag: "Bags",
  tray: "Trays",
  clothes: "Clothes",
  electronics: "Electronics",
  food: "Food",
  threat: "Threats",
  stationary: "Miscellaneous",
  lag: "Miscellaneous",
};

export function getStencilKind(category: string): StencilKind {
  const normalized = category.toLowerCase();
  if (normalized.includes("bag")) return "bag";
  if (normalized.includes("tray")) return "tray";
  if (normalized.includes("threat") || normalized.includes("prohibited")) return "threat";
  if (normalized.includes("cloth")) return "clothes";
  if (normalized.includes("electronics")) return "electronics";
  if (normalized.includes("food") || normalized.includes("drink")) return "food";
  if (normalized.includes("stationery") || normalized.includes("stationary") || normalized.includes("office")) return "stationary";
  if (normalized.includes("lag")) return "lag";
  return "stationary"; // fallback
}
