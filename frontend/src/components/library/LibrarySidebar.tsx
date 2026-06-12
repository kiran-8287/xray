import React from "react";
import { ChevronRight, Folder, Check, Trash2 } from "lucide-react";
import type { Item, UploadSession, TaxonomyCategory } from "../../types/library";
import { getCategoryConfig, normalizeCategoryName } from "../../config/categories";

interface LibrarySidebarProps {
  sessions: UploadSession[];
  taxonomy: TaxonomyCategory[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  activeCategory: string;
  setActiveCategory: (cat: string) => void;
  activeSubcategory: string;
  setActiveSubcategory: (subcat: string) => void;
  expandedSessions: Set<string>;
  toggleSessionExpansion: (sessionId: string) => void;
  expandedCategories: Set<string>;
  toggleCategoryExpansion: (catKey: string) => void;
  selectedItems: Set<string>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleDeleteSession: (sessionId: string, sessionName: string, itemCount: number) => void;
  handleDeleteSubcategory: (sessionId: string, categoryKey: string, subKey: string) => void;
}

export default function LibrarySidebar({
  sessions,
  taxonomy,
  activeSessionId,
  setActiveSessionId,
  activeCategory,
  setActiveCategory,
  activeSubcategory,
  setActiveSubcategory,
  expandedSessions,
  toggleSessionExpansion,
  expandedCategories,
  toggleCategoryExpansion,
  selectedItems,
  setSelectedItems,
  handleDeleteSession,
  handleDeleteSubcategory,
}: LibrarySidebarProps) {
  
  // Helper to categorize session items in the sidebar
  function getCategorizedSessionItems(items: Item[]): Record<string, Record<string, Item[]>> {
    const categorized: any = {};
    for (const item of items) {
      const cat = item.category || "misc";
      const normalized = normalizeCategoryName(cat);
      if (!categorized[normalized]) {
        categorized[normalized] = {};
      }
      const subcat = item.subcategory || "General";
      if (!categorized[normalized][subcat]) {
        categorized[normalized][subcat] = [];
      }
      categorized[normalized][subcat].push(item);
    }
    return categorized;
  }

  const getCategoryIcon = (category: string) => {
    return <Folder size={14} />;
  };

  const getDisplayNames = (categorySlug: string, subcategorySlug: string) => {
    let displayCategory = categorySlug;
    let displaySubcategory = subcategorySlug;
    
    for (const cat of taxonomy) {
      let matches = false;
      if (categorySlug === 'bags' && cat.slug.toLowerCase().includes('bag')) matches = true;
      else if (categorySlug === 'trays' && cat.slug.toLowerCase().includes('tray')) matches = true;
      else if (categorySlug === 'clothes' && cat.slug.toLowerCase().includes('cloth')) matches = true;
      else if (categorySlug === 'electronics' && cat.slug.toLowerCase().includes('electronics')) matches = true;
      else if (categorySlug === 'food' && cat.slug.toLowerCase().includes('food')) matches = true;
      else if (categorySlug === 'threats' && cat.slug.toLowerCase().includes('threat')) matches = true;
      
      if (matches) {
        displayCategory = cat.name;
        for (const subcat of cat.subcategories) {
          if (subcat.slug === subcategorySlug) {
            displaySubcategory = subcat.name;
            break;
          }
        }
        break;
      }
    }
    return { displayCategory, displaySubcategory };
  };

  return (
    <aside className="w-72 border-r border-border bg-nav flex flex-col overflow-y-auto flex-shrink-0 select-none">
      {/* Upload Sessions Title Header */}
      <div className="p-4 border-b border-border bg-panel flex items-center justify-between flex-shrink-0">
        <h3 className="font-semibold text-ink text-xs uppercase tracking-wider">
          Upload Sessions
        </h3>
        <span className="text-[10px] font-mono text-muted bg-surface px-2 py-0.5 rounded-full border border-border">
          {sessions.length}
        </span>
      </div>

      {/* Hierarchical tree view */}
      <div className="p-3 space-y-3 flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted">
            No active sessions. Please upload files.
          </div>
        ) : (
          sessions.map((session) => {
            const isSessionExpanded = expandedSessions.has(session.id);
            const isSessionActive = activeSessionId === session.id;
            const sessionCategorized = getCategorizedSessionItems(session.items || []);
            const firstCat = Object.keys(sessionCategorized)[0] || "bags";

            return (
              <div key={session.id} className="space-y-1 bg-panel/30 rounded-xl border border-border/60 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                {/* Session Header Folder Row */}
                <div className="flex items-center gap-1 group">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSessionExpansion(session.id);
                    }}
                    className={`p-1 rounded-lg transition-colors ${isSessionExpanded ? 'text-accent bg-accent/5' : 'text-muted hover:text-ink hover:bg-surface'}`}
                  >
                    <ChevronRight 
                      size={14} 
                      className={`transition-transform duration-150 ${isSessionExpanded ? 'rotate-90' : ''}`} 
                    />
                  </button>
                  
                  <button
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setActiveCategory(firstCat);
                      setActiveSubcategory("all");
                      if (!isSessionExpanded) {
                        toggleSessionExpansion(session.id);
                      }
                    }}
                    className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all text-left truncate cursor-pointer ${
                      isSessionActive
                        ? 'bg-panel border-border shadow-sm font-semibold text-accent'
                        : 'border-transparent text-ink hover:bg-panel'
                    }`}
                  >
                    <Folder size={14} className={isSessionActive ? "text-accent" : "text-muted"} />
                    <span className="text-xs font-semibold truncate flex-1">{session.folder_name}</span>
                    <span className="text-[10px] font-mono text-muted bg-surface px-1.5 py-0.5 rounded-full border border-border">
                      {session.item_count}
                    </span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(session.id, session.folder_name, session.item_count);
                    }}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 cursor-pointer transition-all hover:bg-rose-50 hover:text-rose-600 text-muted"
                    title={`Delete session "${session.folder_name}"`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Categories inside this Session */}
                {isSessionExpanded && (
                  <div className="pl-3 space-y-1 border-l border-border/80 ml-3.5 mt-1 animate-fade-in">
                    {Object.keys(sessionCategorized).length === 0 ? (
                      <div className="text-[11px] text-muted italic pl-4 py-1">
                        No items in this session
                      </div>
                    ) : (
                      Object.keys(sessionCategorized)
                        .sort((a, b) => {
                          const labelA = getCategoryConfig(a).label.toLowerCase();
                          const labelB = getCategoryConfig(b).label.toLowerCase();
                          return labelA.localeCompare(labelB);
                        })
                        .map((categoryKey) => {
                          const isCatActive = isSessionActive && activeCategory === categoryKey;
                          const isCatExpanded = expandedCategories.has(`${session.id}_${categoryKey}`);
                          const config = getCategoryConfig(categoryKey);
                          const itemsInCat = Object.values(sessionCategorized[categoryKey]).flat();
                          const subcategories = sessionCategorized[categoryKey] || {};

                          return (
                            <div key={categoryKey} className="space-y-1">
                              {/* Category Folder Row */}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCategoryExpansion(`${session.id}_${categoryKey}`);
                                  }}
                                  className={`p-0.5 rounded transition-colors ${isCatExpanded ? 'text-accent bg-accent/5' : 'text-muted hover:text-ink hover:bg-surface'}`}
                                >
                                  <ChevronRight 
                                    size={12} 
                                    className={`transition-transform duration-150 ${isCatExpanded ? 'rotate-90' : ''}`} 
                                  />
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveSessionId(session.id);
                                    setActiveCategory(categoryKey);
                                    setActiveSubcategory("all");
                                    if (!isCatExpanded) {
                                      toggleCategoryExpansion(`${session.id}_${categoryKey}`);
                                    }
                                  }}
                                  className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md border transition-all text-left truncate cursor-pointer ${
                                    isCatActive
                                      ? `bg-panel border-border shadow-sm font-medium ${config.text}`
                                      : 'border-transparent text-muted hover:bg-panel/50'
                                  }`}
                                >
                                  <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${config.bg} ${config.text}`}>
                                    {getCategoryIcon(categoryKey)}
                                  </div>
                                  <span className="text-xs truncate flex-1">{config.label}</span>
                                  <span className="text-[10px] font-mono text-muted bg-surface px-1.5 py-0.5 rounded-full border border-border">
                                    {itemsInCat.length}
                                  </span>
                                </button>
                              </div>

                              {/* Subcategories (If Category Expanded) */}
                              {isCatExpanded && (
                                <div className="pl-4 space-y-1 border-l border-border/60 ml-2 mt-1 animate-fade-in">
                                  {/* "All [Category]" Row */}
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => {
                                        setActiveSessionId(session.id);
                                        setActiveCategory(categoryKey);
                                        setActiveSubcategory("all");
                                      }}
                                      className={`flex-1 flex items-center gap-2 px-2 py-1 rounded border transition-all text-left truncate cursor-pointer ${
                                        isCatActive && activeSubcategory === "all"
                                          ? `bg-panel border-border shadow-sm font-semibold ${config.text}`
                                          : 'border-transparent text-muted/80 hover:bg-panel/40'
                                      }`}
                                    >
                                      <span className="text-[11px] truncate flex-1">All {config.label}</span>
                                      <span className="text-[9px] font-mono text-muted bg-surface px-1.5 py-0.2 rounded-full border border-border">
                                        {itemsInCat.length}
                                      </span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const allSelected = itemsInCat.length > 0 && itemsInCat.every(item => selectedItems.has(item.id));
                                        const newSelected = new Set(selectedItems);
                                        if (allSelected) {
                                          itemsInCat.forEach(item => newSelected.delete(item.id));
                                        } else {
                                          const skippedBags: string[] = [];
                                          itemsInCat.forEach(item => {
                                            if (categoryKey === "bags") {
                                              const hasRegion = item.valid_region_points && (Array.isArray(item.valid_region_points) ? item.valid_region_points.length > 0 : true);
                                              if (!hasRegion) {
                                                skippedBags.push(item.name);
                                                return;
                                              }
                                            }
                                            newSelected.add(item.id);
                                          });
                                          if (skippedBags.length > 0) {
                                            alert(`Some bags were not selected because they do not have a valid region drawn:\n${skippedBags.join(", ")}`);
                                          }
                                        }
                                        setSelectedItems(newSelected);
                                      }}
                                      className={`p-1 rounded-full cursor-pointer transition-all border ${
                                        itemsInCat.length > 0 && itemsInCat.every(item => selectedItems.has(item.id))
                                          ? 'bg-accent text-white border-accent'
                                          : itemsInCat.some(item => selectedItems.has(item.id))
                                          ? 'bg-accent/20 text-accent border-accent/20'
                                          : 'bg-surface border-border text-muted hover:bg-accent/10 hover:border-accent/40 hover:text-accent'
                                      }`}
                                      title="Select/deselect all in category"
                                    >
                                      <Check size={8} />
                                    </button>
                                  </div>

                                  {/* Subcategory Rows */}
                                  {Object.keys(subcategories).map((subKey) => {
                                    const subItems = subcategories[subKey] || [];
                                    const isSubActive = isCatActive && activeSubcategory === subKey;
                                    const isSubSelected = subItems.length > 0 && subItems.every(item => selectedItems.has(item.id));
                                    const isSubPartialSelected = subItems.some(item => selectedItems.has(item.id)) && !isSubSelected;
                                    const { displaySubcategory } = getDisplayNames(categoryKey, subKey);

                                    return (
                                      <div key={subKey} className="flex items-center gap-1 group/sub">
                                        <button
                                          onClick={() => {
                                            setActiveSessionId(session.id);
                                            setActiveCategory(categoryKey);
                                            setActiveSubcategory(subKey);
                                          }}
                                          className={`flex-1 flex items-center gap-2 px-2 py-1 rounded border transition-all text-left truncate cursor-pointer ${
                                            isSubActive
                                              ? `bg-panel border-border shadow-sm font-semibold ${config.text}`
                                              : 'border-transparent text-muted/80 hover:bg-panel/40'
                                          }`}
                                        >
                                          <span className="text-[11px] truncate flex-1">{displaySubcategory}</span>
                                          <span className="text-[9px] font-mono text-muted bg-surface px-1.5 py-0.2 rounded-full border border-border">
                                            {subItems.length}
                                          </span>
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const newSelected = new Set(selectedItems);
                                            if (isSubSelected) {
                                              subItems.forEach(item => newSelected.delete(item.id));
                                            } else {
                                              const skippedBags: string[] = [];
                                              subItems.forEach(item => {
                                                if (categoryKey === "bags") {
                                                  const hasRegion = item.valid_region_points && (Array.isArray(item.valid_region_points) ? item.valid_region_points.length > 0 : true);
                                                  if (!hasRegion) {
                                                    skippedBags.push(item.name);
                                                    return;
                                                  }
                                                }
                                                newSelected.add(item.id);
                                              });
                                              if (skippedBags.length > 0) {
                                                alert(`Some bags were not selected because they do not have a valid region drawn:\n${skippedBags.join(", ")}`);
                                              }
                                            }
                                            setSelectedItems(newSelected);
                                          }}
                                          className={`p-1 rounded-full cursor-pointer transition-all border ${
                                            isSubSelected
                                              ? 'bg-accent text-white border-accent'
                                              : isSubPartialSelected
                                              ? 'bg-accent/20 text-accent border-accent/20'
                                              : 'bg-surface border-border text-muted hover:bg-accent/10 hover:border-accent/40 hover:text-accent'
                                          }`}
                                          title={`Select all in ${displaySubcategory}`}
                                        >
                                          <Check size={8} />
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteSubcategory(session.id, categoryKey, subKey);
                                          }}
                                          className="p-1 rounded opacity-0 group-hover/sub:opacity-100 cursor-pointer transition-all hover:bg-rose-50 hover:text-rose-600 text-muted"
                                          title={`Delete all in ${displaySubcategory}`}
                                        >
                                          <Trash2 size={10} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
