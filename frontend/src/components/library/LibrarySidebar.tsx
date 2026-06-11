import React from "react";
import { ChevronRight, Folder, Check, Trash2 } from "lucide-react";
import type { Item, UploadSession, CategorizedItems, TaxonomyCategory } from "../../types/library";
import { getCategoryConfig } from "../../config/categories";

interface LibrarySidebarProps {
  sessions: UploadSession[];
  categorizedItems: CategorizedItems;
  taxonomy: TaxonomyCategory[];
  activeCategory: string;
  setActiveCategory: (cat: string) => void;
  activeSubcategory: string;
  setActiveSubcategory: (subcat: string) => void;
  expandedCategories: Set<string>;
  toggleCategoryExpansion: (cat: string) => void;
  selectedItems: Set<string>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleDeleteSession: (sessionId: string, sessionName: string, itemCount: number) => void;
  handleDeleteSubcategory: (categoryKey: string, subKey: string) => void;
}

export default function LibrarySidebar({
  sessions,
  categorizedItems,
  taxonomy,
  activeCategory,
  setActiveCategory,
  activeSubcategory,
  setActiveSubcategory,
  expandedCategories,
  toggleCategoryExpansion,
  selectedItems,
  setSelectedItems,
  handleDeleteSession,
  handleDeleteSubcategory,
}: LibrarySidebarProps) {
  const getCategoryIcon = (category: string) => {
    return <Folder size={16} />;
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

  const isSubcategorySelected = (categoryKey: string, subKey: string) => {
    const items = categorizedItems[categoryKey]?.[subKey] || [];
    return items.length > 0 && items.every(item => selectedItems.has(item.id));
  };

  const isSubcategoryPartiallySelected = (categoryKey: string, subKey: string) => {
    const items = categorizedItems[categoryKey]?.[subKey] || [];
    const someSelected = items.some(item => selectedItems.has(item.id));
    const allSelected = items.every(item => selectedItems.has(item.id));
    return someSelected && !allSelected;
  };

  const selectSubcategory = (categoryKey: string, subKey: string) => {
    const newSelected = new Set(selectedItems);
    const items = categorizedItems[categoryKey]?.[subKey] || [];
    items.forEach(item => newSelected.add(item.id));
    setSelectedItems(newSelected);
  };

  const deselectSubcategory = (categoryKey: string, subKey: string) => {
    const newSelected = new Set(selectedItems);
    const items = categorizedItems[categoryKey]?.[subKey] || [];
    items.forEach(item => newSelected.delete(item.id));
    setSelectedItems(newSelected);
  };

  return (
    <aside className="w-72 border-r border-border bg-nav flex flex-col overflow-y-auto flex-shrink-0">
      {/* Upload Sessions Section */}
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Upload Sessions
          </span>
          <span className="text-[10px] font-mono text-muted bg-surface px-1.5 py-0.5 rounded-full border border-border">
            {sessions.length}
          </span>
        </div>
        <div className="space-y-1">
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center gap-1">
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface">
                <span className="text-xs truncate">{session.folder_name}</span>
                <span className="text-[10px] font-mono text-muted ml-auto">
                  {session.item_count}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(session.id, session.folder_name, session.item_count);
                }}
                className="p-0.5 rounded-full cursor-pointer transition-all border bg-surface border-border text-muted hover:bg-red-50 hover:border-red-200 hover:text-red-600"
                title={`Delete upload session "${session.folder_name}"`}
              >
                <Trash2 size={9} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Categories Section */}
      <span className="text-xs font-semibold uppercase tracking-wider text-muted px-4 pt-4 pb-2">
        Categories
      </span>
      <div className="p-2 space-y-2">
        {Object.keys(categorizedItems).map((categoryKey) => {
          const isActive = activeCategory === categoryKey;
          const isExpanded = expandedCategories.has(categoryKey);
          const config = getCategoryConfig(categoryKey);
          const itemCount = Object.values(categorizedItems[categoryKey]).flat().length;
          const subcategories = categorizedItems[categoryKey] || {};
          
          return (
            <div key={categoryKey} className="space-y-1">
              {/* Category Button */}
              <div className="flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCategoryExpansion(categoryKey);
                  }}
                  className={`p-1 rounded-lg transition-colors ${isExpanded ? 'text-accent' : 'text-muted hover:text-ink'}`}
                >
                  <ChevronRight 
                    size={16} 
                    className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                  />
                </button>
                <button
                  onClick={() => {
                    setActiveCategory(categoryKey);
                    setActiveSubcategory("all");
                    // Auto-expand when category is activated
                    if (!expandedCategories.has(categoryKey)) {
                      toggleCategoryExpansion(categoryKey);
                    }
                  }}
                  className={`flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-150 cursor-pointer ${
                    isActive
                      ? `bg-panel border-border shadow-card border-l-4 ${config.borderAccent} pl-2 font-semibold`
                      : 'border-transparent bg-transparent text-ink hover:bg-panel hover:border-border hover:shadow-card'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg} ${config.text}`}>
                    {getCategoryIcon(categoryKey)}
                  </div>
                  <span className="text-sm font-semibold text-ink flex-1 text-left truncate">
                    {config.label}
                  </span>
                  <span className="text-xs font-mono text-muted bg-surface px-2 py-0.5 rounded-full border border-border">
                    {itemCount}
                  </span>
                </button>
              </div>

              {/* Subcategories (Expanded) */}
              {isExpanded && (
                <div className="ml-8 space-y-1">
                  {/* "All" Subcategory */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setActiveCategory(categoryKey);
                        setActiveSubcategory("all");
                      }}
                      className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                        isActive && activeSubcategory === "all"
                          ? `bg-panel border-border shadow-sm ${config.text} font-medium`
                          : 'border-transparent bg-transparent text-muted hover:bg-surface hover:border-border'
                      }`}
                    >
                      <span className="text-xs truncate">All Items</span>
                      <span className="text-[10px] font-mono text-muted bg-surface px-1.5 py-0.5 rounded-full border border-border ml-auto">
                        {itemCount}
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const allItems = Object.values(subcategories).flat();
                        const allSelected = allItems.length > 0 && allItems.every(item => selectedItems.has(item.id));
                        const newSelected = new Set(selectedItems);
                        if (allSelected) {
                          allItems.forEach(item => newSelected.delete(item.id));
                        } else {
                          allItems.forEach(item => newSelected.add(item.id));
                        }
                        setSelectedItems(newSelected);
                      }}
                      className={`p-0.5 rounded-full cursor-pointer transition-all border ${
                        Object.values(subcategories).flat().length > 0 && 
                        Object.values(subcategories).flat().every(item => selectedItems.has(item.id))
                          ? 'bg-accent text-white border-accent'
                          : Object.values(subcategories).flat().some(item => selectedItems.has(item.id))
                          ? 'bg-accent/30 text-accent border-accent/30'
                          : 'bg-surface border-border text-muted hover:bg-accent/10 hover:border-accent/40 hover:text-accent'
                      }`}
                      title="Select/deselect all items"
                    >
                      <Check size={9} />
                    </button>
                  </div>

                  {/* Individual Subcategories */}
                  {Object.keys(subcategories).map((subKey) => {
                    const itemsList = subcategories[subKey] || [];
                    const { displaySubcategory } = getDisplayNames(categoryKey, subKey);
                    const isSubActive = isActive && activeSubcategory === subKey;
                    const isAllSelected = isSubcategorySelected(categoryKey, subKey);
                    const isPartiallySelected = isSubcategoryPartiallySelected(categoryKey, subKey);

                    return (
                      <div key={subKey} className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setActiveCategory(categoryKey);
                            setActiveSubcategory(subKey);
                          }}
                          className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                            isSubActive
                              ? `bg-panel border-border shadow-sm ${config.text} font-medium`
                              : 'border-transparent bg-transparent text-muted hover:bg-surface hover:border-border'
                          }`}
                        >
                          <span className="text-xs truncate">{displaySubcategory}</span>
                          <span className="text-[10px] font-mono text-muted bg-surface px-1.5 py-0.5 rounded-full border border-border ml-auto">
                            {itemsList.length}
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isAllSelected) {
                              deselectSubcategory(categoryKey, subKey);
                            } else {
                              selectSubcategory(categoryKey, subKey);
                            }
                          }}
                          className={`p-0.5 rounded-full cursor-pointer transition-all border ${
                            isAllSelected
                              ? 'bg-accent text-white border-accent'
                              : isPartiallySelected
                              ? 'bg-accent/30 text-accent border-accent/30'
                              : 'bg-surface border-border text-muted hover:bg-accent/10 hover:border-accent/40 hover:text-accent'
                          }`}
                          title={`Select/deselect all in ${displaySubcategory}`}
                        >
                          <Check size={9} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSubcategory(categoryKey, subKey);
                          }}
                          className="p-0.5 rounded-full cursor-pointer transition-all border bg-surface border-border text-muted hover:bg-red-50 hover:border-red-200 hover:text-red-600"
                          title={`Delete all items in ${displaySubcategory}`}
                        >
                          <Trash2 size={9} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
