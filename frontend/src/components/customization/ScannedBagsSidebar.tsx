import React, { useState, useEffect } from "react";
import { Activity, ArrowLeft, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Item } from "../../types/library";
import { normalizeCategoryName, getCategoryConfig } from "../../config/categories";
import { API_BASE_URL } from "../../config/api";

interface ScannedBagsSidebarProps {
  activeLibrary: string | null;
  setActiveLibrary: (lib: string | null) => void;
  hasBag: boolean;
  handleAddObject: (item: Item) => void;
  categorizedList: any;
  sidebarSearch: string;
  setSidebarSearch: (search: string) => void;
  canvasObjects: any[];
  selectedObjectId: string | null;
  onSelectCanvasObject: (id: string | null) => void;
  onRemoveCanvasObject: (id: string) => void;
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
  sidebarSearch,
  setSidebarSearch,
  canvasObjects,
  selectedObjectId,
  onSelectCanvasObject,
  onRemoveCanvasObject,
}: ScannedBagsSidebarProps) {
  const navigate = useNavigate();
  const [collapsedSubcats, setCollapsedSubcats] = useState<Set<string>>(new Set());
  const [isOnCanvasCollapsed, setIsOnCanvasCollapsed] = useState(false);

  const toggleSubcategory = (subKey: string) => {
    setCollapsedSubcats((prev) => {
      const next = new Set(prev);
      if (next.has(subKey)) {
        next.delete(subKey);
      } else {
        next.add(subKey);
      }
      return next;
    });
  };

  const toggleOnCanvas = () => {
    setIsOnCanvasCollapsed((prev) => !prev);
  };

  if (!categorizedList) {
    return (
      <aside className="w-80 border-r border-border bg-nav flex flex-col items-center justify-center text-muted p-4">
        <span className="text-xs font-semibold">Loading library items...</span>
      </aside>
    );
  }

  // categorizedList is already merged and normalized by the parent page
  const mergedList = categorizedList;

  // Collect items from ALL categories (bags, threats, non-threats, etc.)
  // and group them properly
  const threatsBySubcategory: Record<string, Item[]> = {};
  const nonThreatsBySubcategory: Record<string, Item[]> = {};
  const categoryButtons: { key: string; label: string; count: number; config: any }[] = [];

  for (const [catKey, subcats] of Object.entries(mergedList)) {
    const flattenedItems = Object.values(subcats || {}).flat() as Item[];
    const count = flattenedItems.length;
    if (count === 0) continue;

    const normalized = normalizeCategoryName(catKey);
    const displayName = CATEGORY_LABELS[catKey] || catKey;
    const config = getCategoryConfig(catKey);
    
    // Defensive check: ensure config has required properties
    if (!config || !config.bg || !config.text) {
      console.warn(`[ScannedBagsSidebar] Invalid config for category: ${catKey}`);
      continue;
    }

    // Skip bags category entirely if there's already a bag on the canvas
    if (hasBag && (normalized === "bags" || catKey === "bag")) continue;

    // Categorize items for the main view, grouped by subcategory
    if (normalized === "threats") {
      const subcatsObj = subcats as Record<string, Item[]>;
      for (const [subKey, items] of Object.entries(subcatsObj)) {
        if (!threatsBySubcategory[subKey]) {
          threatsBySubcategory[subKey] = [];
        }
        threatsBySubcategory[subKey].push(...items);
      }
    } else if (normalized === "bags") {
      // Bags are shown as a category button only if no bag on canvas
      categoryButtons.push({ key: catKey, label: displayName, count, config });
    } else {
      // Everything else is a non-threat
      const subcatsObj = subcats as Record<string, Item[]>;
      for (const [subKey, items] of Object.entries(subcatsObj)) {
        if (!nonThreatsBySubcategory[subKey]) {
          nonThreatsBySubcategory[subKey] = [];
        }
        nonThreatsBySubcategory[subKey].push(...items);
      }
    }

    // Add as category button (for drill-down)
    // Skip threats and bags (shown inline), and also skip non-threats (shown inline)
    if (normalized !== "threats" && normalized !== "bags" && normalized !== "non-threats") {
      categoryButtons.push({ key: catKey, label: displayName, count, config });
    }
  }
  
  const allThreatItems = Object.values(threatsBySubcategory).flat();
  const allNonThreatItems = Object.values(nonThreatsBySubcategory).flat();

  // Filter items based on search
  const searchLower = sidebarSearch.toLowerCase().trim();
  const filteredThreatsBySubcategory: Record<string, Item[]> = {};
  const filteredNonThreatsBySubcategory: Record<string, Item[]> = {};
  let filteredThreatCount = 0;
  let filteredNonThreatCount = 0;

  if (searchLower) {
    for (const [subKey, items] of Object.entries(threatsBySubcategory)) {
      const filtered = items.filter(item => item.name.toLowerCase().includes(searchLower));
      if (filtered.length > 0) {
        filteredThreatsBySubcategory[subKey] = filtered;
        filteredThreatCount += filtered.length;
      }
    }
    for (const [subKey, items] of Object.entries(nonThreatsBySubcategory)) {
      const filtered = items.filter(item => item.name.toLowerCase().includes(searchLower));
      if (filtered.length > 0) {
        filteredNonThreatsBySubcategory[subKey] = filtered;
        filteredNonThreatCount += filtered.length;
      }
    }
  }

  const displayThreatsBySubcategory = searchLower ? filteredThreatsBySubcategory : threatsBySubcategory;
  const displayNonThreatsBySubcategory = searchLower ? filteredNonThreatsBySubcategory : nonThreatsBySubcategory;
  const displayThreatCount = searchLower ? filteredThreatCount : allThreatItems.length;
  const displayNonThreatCount = searchLower ? filteredNonThreatCount : allNonThreatItems.length;

  return (
    <aside className="w-80 border-r border-border bg-nav flex flex-col overflow-hidden flex-shrink-0 text-sm shadow-sm">
      <div className="px-5 py-4 border-l-4 border-accent bg-panel">
        <h3 className="font-bold text-ink flex items-center gap-2 text-xs uppercase tracking-[0.05em] font-heading">
          <Activity size={14} className="text-accent" />
          Library Items
        </h3>
        {activeLibrary && (
          <button
            onClick={() => setActiveLibrary(null)}
            className="text-[10px] text-muted hover:text-ink flex items-center gap-0.5 cursor-pointer font-medium mt-1"
          >
            <ArrowLeft size={10} />
            Back to categories
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="px-3 py-2 border-b border-border/60 bg-panel/50">
        <div className="relative">
          <input
            type="text"
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            placeholder="Search items..."
            className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded-lg text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/60">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          {sidebarSearch && (
            <button
              onClick={() => setSidebarSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Collapse/Expand all button */}
      {!activeLibrary && (allThreatItems.length > 0 || allNonThreatItems.length > 0) && (
        <div className="px-3 py-1.5 border-b border-border/60 bg-panel/30 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Subcategories</span>
          <button
            onClick={() => {
              const allSubs = new Set([
                ...Object.keys(threatsBySubcategory),
                ...Object.keys(nonThreatsBySubcategory),
              ]);
              const allCollapsed = allSubs.size > 0 && Array.from(allSubs).every(s => collapsedSubcats.has(s));
              if (allCollapsed) {
                setCollapsedSubcats(new Set());
              } else {
                setCollapsedSubcats(allSubs);
              }
            }}
            className="text-[10px] font-bold text-accent hover:text-accent-sky transition-colors uppercase tracking-tight cursor-pointer"
          >
            {(() => {
              const allSubs = new Set([
                ...Object.keys(threatsBySubcategory),
                ...Object.keys(nonThreatsBySubcategory),
              ]);
              const allCollapsed = allSubs.size > 0 && Array.from(allSubs).every(s => collapsedSubcats.has(s));
              return allCollapsed ? "Expand All" : "Collapse All";
            })()}
          </button>
        </div>
      )}

      {/* On-canvas items section */}
      {!activeLibrary && canvasObjects.length > 0 && (
        <div className="px-3 py-2 border-b border-border/60 bg-panel/30">
          <button
            onClick={toggleOnCanvas}
            className="flex items-center justify-between w-full cursor-pointer hover:opacity-80"
          >
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">On Canvas ({canvasObjects.length})</span>
            <span className={`text-[10px] transition-transform ${isOnCanvasCollapsed ? 'rotate-0' : 'rotate-90'}`}>▶</span>
          </button>
          {!isOnCanvasCollapsed && (
            <div className="space-y-1 max-h-40 overflow-y-auto mt-1.5">
              {canvasObjects.map((obj) => {
                const isSelected = selectedObjectId === obj.id;
                const config = getCategoryConfig(obj.library);
                return (
                  <div
                    key={obj.id}
                    onClick={() => onSelectCanvasObject(isSelected ? null : obj.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-accent/10 border-accent/40 shadow-sm"
                        : "bg-surface border-border/60 hover:border-accent/30 hover:bg-panel"
                    }`}
                  >
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${config?.bg || 'bg-gray-100'} ${config?.text || 'text-gray-700'}`}>
                      {obj.library === "bag" ? "B" : obj.library === "threat" ? "T" : "N"}
                    </div>
                    <span className={`text-[11px] font-medium truncate flex-1 ${isSelected ? "text-accent" : "text-ink"}`}>
                      {obj.name}
                    </span>
                    {obj.library !== "bag" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCanvasObject(obj.id);
                        }}
                        className="text-muted hover:text-rose-600 transition-colors"
                        title="Remove from canvas"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        {!activeLibrary ? (
          <>
            {/* Threats Section - grouped by subcategory */}
            {displayThreatCount > 0 && (
              <section className="space-y-3">
                <div className="border-l-4 border-rose-400 pl-3 py-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-rose-700">Threats</h4>
                    <span className="bg-rose-100 text-rose-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{displayThreatCount}</span>
                  </div>
                </div>
                {Object.entries(displayThreatsBySubcategory).map(([subKey, items]) => {
                  const isCollapsed = collapsedSubcats.has(subKey);
                  return (
                    <div key={subKey} className="space-y-1.5">
                      <button
                        onClick={() => toggleSubcategory(subKey)}
                        className="flex items-center gap-1.5 px-1 w-full text-left cursor-pointer hover:opacity-80"
                      >
                        <span className={`text-[10px] transition-transform ${isCollapsed ? 'rotate-0' : 'rotate-90'}`}>▶</span>
                        <span className="text-[10px] font-semibold text-rose-700 uppercase tracking-tight">{subKey}</span>
                        <span className="text-[9px] font-mono text-rose-400 bg-rose-50 px-1.5 py-0.5 rounded-full border border-rose-200">{items.length}</span>
                      </button>
                      {!isCollapsed && (
                        <div className="grid grid-cols-2 gap-2">
                          {items.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleAddObject(item)}
                              className="group h-28 overflow-hidden rounded-2xl border border-border bg-panel p-2.5 text-left transition-all hover:border-rose-400 hover:bg-rose-50 hover:shadow-sm"
                            >
                              <div className="h-14 bg-white rounded-xl overflow-hidden flex items-center justify-center mb-2 border border-border/50 group-hover:border-rose-200">
                                <img src={`${API_BASE_URL}/data/library_images/${item.filepath}`} alt={item.name} className="max-h-full max-w-full object-contain" />
                              </div>
                              <p className="text-[11px] font-bold text-ink truncate group-hover:text-rose-700">{item.name}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Non-Threats Section - grouped by subcategory */}
            {displayNonThreatCount > 0 && (
              <section className="space-y-3">
                <div className="border-l-4 border-emerald-400 pl-3 py-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-700">Non-Threats</h4>
                    <span className="bg-emerald-50 text-emerald-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-200">{displayNonThreatCount}</span>
                  </div>
                </div>
                {Object.entries(displayNonThreatsBySubcategory).map(([subKey, items]) => {
                  const isCollapsed = collapsedSubcats.has(subKey);
                  return (
                    <div key={subKey} className="space-y-1.5">
                      <button
                        onClick={() => toggleSubcategory(subKey)}
                        className="flex items-center gap-1.5 px-1 w-full text-left cursor-pointer hover:opacity-80"
                      >
                        <span className={`text-[10px] transition-transform ${isCollapsed ? 'rotate-0' : 'rotate-90'}`}>▶</span>
                        <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-tight">{subKey}</span>
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200">{items.length}</span>
                      </button>
                      {!isCollapsed && (
                        <div className="grid grid-cols-2 gap-2">
                          {items.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleAddObject(item)}
                              className="group h-28 overflow-hidden rounded-2xl border border-border bg-panel p-2.5 text-left transition-all hover:border-accent/40 hover:bg-accent/4 hover:shadow-sm"
                            >
                              <div className="h-14 bg-white rounded-xl overflow-hidden flex items-center justify-center mb-2 border border-border/50 group-hover:border-accent/20">
                                <img src={`${API_BASE_URL}/data/library_images/${item.filepath}`} alt={item.name} className="max-h-full max-w-full object-contain" />
                              </div>
                              <p className="text-[11px] font-bold text-ink truncate group-hover:text-accent">{item.name}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Category buttons for drill-down */}
            {categoryButtons.length > 0 && (
              <div className="space-y-1">
                {categoryButtons.map(({ key, label, count, config }) => (
                  <button
                    key={key}
                    onClick={() => setActiveLibrary(key)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-panel text-sm font-medium text-ink cursor-pointer transition-all hover:border-accent/40 hover:bg-accent/4 hover:shadow-md group"
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shadow-sm transition-transform group-hover:scale-110 ${config.bg} ${config.text}`}>
                      {label.charAt(0)}
                    </div>
                    <span className="text-xs font-bold text-ink flex-1 text-left truncate group-hover:text-accent">{label}</span>
                    <span className="text-[10px] font-bold font-mono text-muted/60 bg-surface px-1.5 py-0.5 rounded border border-border">{count}</span>
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
                  className="px-4 py-2 rounded-xl font-semibold text-white bg-blue-600 shadow-btn hover:shadow-btn-hover transition-all text-xs inline-flex items-center gap-1.5 cursor-pointer"
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
                      src={`${API_BASE_URL}/data/library_images/${item.filepath}`}
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