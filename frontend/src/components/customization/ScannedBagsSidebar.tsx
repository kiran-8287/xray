import React, { useState, useEffect } from "react";
import { Activity, ArrowLeft, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Item } from "../../types/library";
import { getCategoryConfig, normalizeCategoryName } from "../../config/categories";

interface ScannedBagsSidebarProps {
  activeLibrary: string | null;
  setActiveLibrary: (lib: string | null) => void;
  hasBag: boolean;
  handleAddObject: (item: Item) => void;
  categorizedList: any;
}

const CATEGORY_LABELS: Record<string, string> = {
  bags: "Bags",
  bag: "Bags",
  trays: "Trays",
  tray: "Trays",
  clothes: "Clothes",
  clothing: "Clothing",
  electronics: "Electronics",
  food: "Food",
  threats: "Threats",
  threat: "Threats",
  "non-threats": "Non-Threats",
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
  const navigate = useNavigate();

  if (!categorizedList) {
    return (
      <aside className="w-72 border-r border-border bg-nav flex flex-col items-center justify-center text-muted p-4">
        <span className="text-xs font-semibold">Loading library items...</span>
      </aside>
    );
  }

  // categorizedList is already merged and normalized by the parent page
  const mergedList = categorizedList;

  // Collect items from ALL categories (bags, threats, non-threats, etc.)
  // and group them properly
  const allThreatItems: Item[] = [];
  const allNonThreatItems: Item[] = [];
  const categoryButtons: { key: string; label: string; count: number; config: any }[] = [];

  for (const [catKey, subcats] of Object.entries(mergedList)) {
    const flattenedItems = Object.values(subcats || {}).flat() as Item[];
    const count = flattenedItems.length;
    if (count === 0) continue;

    const normalized = normalizeCategoryName(catKey);
    const displayName = CATEGORY_LABELS[catKey] || catKey;
    const config = getCategoryConfig(catKey);

    // Skip bags category entirely if there's already a bag on the canvas
    if (hasBag && (normalized === "bags" || catKey === "bag")) continue;

    // Categorize items for the main view
    if (normalized === "threats") {
      allThreatItems.push(...flattenedItems);
    } else if (normalized === "bags") {
      // Bags are shown as a category button only if no bag on canvas
      categoryButtons.push({ key: catKey, label: displayName, count, config });
    } else {
      // Everything else is a non-threat
      allNonThreatItems.push(...flattenedItems);
    }

    // Add as category button (for drill-down)
    if (normalized !== "threats" && normalized !== "bags") {
      categoryButtons.push({ key: catKey, label: displayName, count, config });
    }
  }

  return (
    <aside className="w-72 border-r border-border bg-nav flex flex-col overflow-hidden flex-shrink-0 text-sm">
      <div className="px-4 py-3 border-b border-border bg-panel flex items-center justify-between">
        <h3 className="font-semibold text-ink flex items-center gap-2 text-xs uppercase tracking-wider">
          <Activity size={14} className="text-accent" />
          Library Items
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
      
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {!activeLibrary ? (
          <>
            {/* Threats Section */}
            {allThreatItems.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between px-3">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">Threats</h4>
                  <span className="text-[11px] text-muted">{allThreatItems.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {allThreatItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleAddObject(item)}
                      className="group h-24 overflow-hidden rounded-2xl border border-border bg-panel p-2 text-left transition hover:border-rose-400 hover:bg-rose-50"
                    >
                      <div className="h-12 bg-white rounded-xl overflow-hidden flex items-center justify-center mb-2">
                        <img src={`http://localhost:8080/data/library_images/${item.filepath}`} alt={item.name} className="max-h-full max-w-full object-contain" />
                      </div>
                      <p className="text-[11px] font-semibold text-ink truncate">{item.name}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Non-Threats Section */}
            {allNonThreatItems.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between px-3">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">Non-Threats</h4>
                  <span className="text-[11px] text-muted">{allNonThreatItems.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {allNonThreatItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleAddObject(item)}
                      className="group h-24 overflow-hidden rounded-2xl border border-border bg-panel p-2 text-left transition hover:border-accent/40 hover:bg-accent/4"
                    >
                      <div className="h-12 bg-white rounded-xl overflow-hidden flex items-center justify-center mb-2">
                        <img src={`http://localhost:8080/data/library_images/${item.filepath}`} alt={item.name} className="max-h-full max-w-full object-contain" />
                      </div>
                      <p className="text-[11px] font-semibold text-ink truncate">{item.name}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Category buttons for drill-down */}
            {categoryButtons.length > 0 && (
              <div className="space-y-1">
                {categoryButtons.map(({ key, label, count, config }) => (
                  <button
                    key={key}
                    onClick={() => setActiveLibrary(key)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-panel text-sm font-medium text-ink cursor-pointer transition-all hover:border-accent/40 hover:bg-accent/4 hover:shadow-card"
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${config.bg} ${config.text}`}>
                      {label.charAt(0)}
                    </div>
                    <span className="text-xs font-semibold text-ink flex-1 text-left truncate">{label}</span>
                    <span className="text-xs font-mono text-muted">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* No items available state */}
            {allThreatItems.length === 0 && allNonThreatItems.length === 0 && categoryButtons.length === 0 && (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 bg-surface rounded-full flex items-center justify-center mx-auto mb-3 border border-border">
                  <BookOpen size={20} className="text-muted/40" />
                </div>
                <p className="text-xs text-muted mb-4">No additional items available in the library.</p>
                <button
                  onClick={() => navigate("/library")}
                  className="px-4 py-2 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover transition-all text-xs inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <BookOpen size={12} />
                  Go to Library
                </button>
              </div>
            )}
          </>
        ) : (
          /* Drill-down view for a specific category */
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