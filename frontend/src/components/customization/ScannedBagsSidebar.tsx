import React from "react";
import { Activity, ArrowLeft } from "lucide-react";
import type { Item } from "../../types/library";
import { getCategoryConfig } from "../../config/categories";

interface ScannedBagsSidebarProps {
  activeLibrary: string | null;
  setActiveLibrary: (lib: string | null) => void;
  hasBag: boolean;
  handleAddObject: (item: Item) => void;
  categorizedList: any;
}

// Helper to normalize category name
function normalizeCategoryName(cat: string) {
  const normalized = cat.toLowerCase();
  if (["misc", "sports", "stationery", "lag"].includes(normalized)) {
    return "miscellaneous";
  }
  return normalized;
}

const CATEGORY_LABELS: Record<string, string> = {
  bags: "Bags",
  trays: "Trays",
  clothes: "Clothes",
  clothing: "Clothing",
  electronics: "Electronics",
  food: "Food",
  threats: "Threats",
  misc: "Miscellaneous",
  miscellaneous: "Miscellaneous",
  sports: "Miscellaneous",
  stationery: "Miscellaneous",
  lag: "Miscellaneous",
};

export default function ScannedBagsSidebar({
  activeLibrary,
  setActiveLibrary,
  hasBag,
  handleAddObject,
  categorizedList,
}: ScannedBagsSidebarProps) {
  if (!categorizedList) {
    return (
      <aside className="w-52 border-r border-border bg-nav flex flex-col items-center justify-center text-muted p-4">
        <span className="text-xs font-semibold">Loading scanned bags...</span>
      </aside>
    );
  }

  // categorizedList is already merged and normalized by the parent page
  const mergedList = categorizedList;

  // Filter categories to hide bags if a bag is already in the workspace
  const categoryKeys = Object.keys(mergedList).filter(
    (cat) => !(hasBag && (cat === "bags" || cat === "bag"))
  );

  return (
    <aside className="w-52 border-r border-border bg-nav flex flex-col overflow-hidden flex-shrink-0 text-sm">
      <div className="px-4 py-3 border-b border-border bg-panel flex items-center justify-between">
        <h3 className="font-semibold text-ink flex items-center gap-2 text-xs uppercase tracking-wider">
          <Activity size={14} className="text-accent" />
          Scanned Bags
        </h3>
        {activeLibrary && (
          <button
            onClick={() => setActiveLibrary(null)}
            className="text-xs text-muted hover:text-ink flex items-center gap-0.5 cursor-pointer font-medium"
          >
            <ArrowLeft size={12} />
            Back
          </button>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {!activeLibrary ? (
          <div className="space-y-1">
            {categoryKeys.map((lib) => {
              const subcategories = mergedList[lib] || {};
              const count = Object.values(subcategories).flat().length;
              const config = getCategoryConfig(lib);
              const displayName = CATEGORY_LABELS[lib] || lib;
              
              return (
                <button
                  key={lib}
                  onClick={() => setActiveLibrary(lib)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-panel text-sm font-medium text-ink cursor-pointer transition-all hover:border-accent/40 hover:bg-accent/4 hover:shadow-card"
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${config.bg} ${config.text}`}>
                    {displayName.charAt(0)}
                  </div>
                  <span className="text-xs font-semibold text-ink flex-1 text-left truncate">
                    {displayName}
                  </span>
                  <span className="text-xs font-mono text-muted">{count}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3 p-1">
            <button
              onClick={() => setActiveLibrary(null)}
              className="text-xs text-muted hover:text-accent flex items-center gap-1 mb-2 font-semibold cursor-pointer"
            >
              <ArrowLeft size={12} />
              Categories
            </button>
            <div className="grid grid-cols-2 gap-2">
              {(Object.values(mergedList[activeLibrary] || {}).flat() as Item[]).map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleAddObject(item)}
                  className="p-2 w-full rounded-xl border border-border bg-panel hover:border-accent/40 hover:bg-accent/4 hover:shadow-card transition-all flex flex-col items-center gap-2 group"
                >
                  <div className="w-10 h-10 aspect-square flex items-center justify-center overflow-hidden">
                    <img
                      src={`http://localhost:8080/data/library_images/${item.filepath}`}
                      alt={item.name}
                      className="max-w-full max-h-full object-contain filter opacity-70 group-hover:opacity-95 transition-opacity"
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-ink text-center leading-tight truncate w-full">
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
