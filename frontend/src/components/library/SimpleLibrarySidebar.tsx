import React, { useState } from 'react';
import { Folder, Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { BsFillLuggageFill } from 'react-icons/bs';
import { GiPistolGun } from 'react-icons/gi';
import { LuFolderCheck } from 'react-icons/lu';
import type { Item } from '../../types/library';
import { getCategoryConfig } from '../../config/categories';

interface Props {
  categorizedItems: Record<string, Record<string, Item[]>>;
  activeCategory: string;
  setActiveCategory: (c: string) => void;
  activeSubcategory: string;
  setActiveSubcategory: (s: string) => void;
  selectedItems: Set<string>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSelectAllCategory: (category: string) => void;
  onSelectAllSubcategory: (category: string, subcategory: string) => void;
  onDeleteCategory: (category: string) => void;
  onDeleteSubcategory: (category: string, subcategory: string) => void;
}

export default function SimpleLibrarySidebar({
  categorizedItems,
  activeCategory,
  setActiveCategory,
  activeSubcategory,
  setActiveSubcategory,
  selectedItems,
  setSelectedItems,
  onSelectAllCategory,
  onSelectAllSubcategory,
  onDeleteCategory,
  onDeleteSubcategory,
}: Props) {
  const categories = ['bags', 'threats', 'non-threats'];
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const toggleCollapse = (catKey: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catKey)) {
        next.delete(catKey);
      } else {
        next.add(catKey);
      }
      return next;
    });
  };

  return (
    <aside className="w-96 border-r border-border bg-nav flex flex-col overflow-y-auto flex-shrink-0 select-none shadow-sm">
      <div className="p-4">
        <div className="border-l-4 border-accent pl-4">
          <h2 className="text-3xl font-bold text-ink tracking-tight">Library Images</h2>
        </div>
      </div>
      <div className="p-3 space-y-3 flex-1 overflow-y-auto">
        {['bags', 'threats', 'non-threats'].map((catKey) => {
          const config = getCategoryConfig(catKey);
          const subcats = categorizedItems[catKey] || {};
          const itemsInCat = Object.values(subcats).flat();
          const isCatActive = activeCategory === catKey;
          const selectedCount = itemsInCat.filter((item) => selectedItems.has(item.id)).length;
          const allSelected = itemsInCat.length > 0 && itemsInCat.every(item => selectedItems.has(item.id));
          const someSelected = selectedCount > 0 && !allSelected;
          const isCollapsed = collapsedCategories.has(catKey);

          return (
            <div key={catKey} className="space-y-2 bg-panel/30 rounded-2xl border border-border/60 p-2 shadow-sm transition-all hover:border-border/80">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleCollapse(catKey)}
                  className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-muted hover:text-ink hover:bg-panel/60 transition-all"
                  title={isCollapsed ? "Expand category" : "Collapse category"}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <button
                  onClick={() => {
                    setActiveCategory(catKey);
                    setActiveSubcategory('all');
                  }}
                  className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${isCatActive ? 'bg-panel border-border shadow-sm font-bold text-accent' : 'hover:bg-panel/50 text-ink'}`}
                >
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm transition-transform group-hover:scale-105 ${config.bg} ${config.text}`}>
                    {catKey === 'bags' ? <BsFillLuggageFill /> : catKey === 'threats' ? <GiPistolGun /> : catKey === 'non-threats' ? <LuFolderCheck /> : <Folder size={14} />}
                  </div>
                  <span className="text-xs font-bold uppercase tracking-tight truncate">{config.label}</span>
                  <span className="ml-auto text-[10px] font-bold font-mono text-muted/70 bg-surface px-2 py-0.5 rounded-full border border-border">{itemsInCat.length}</span>
                </button>
                <button
                  onClick={() => {
                    if (allSelected) {
                      // Deselect all in this category
                      setSelectedItems((prev) => {
                        const next = new Set(prev);
                        itemsInCat.forEach((item) => next.delete(item.id));
                        return next;
                      });
                    } else {
                      onSelectAllCategory(catKey);
                    }
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-[9px] font-bold uppercase tracking-tighter transition-all ${
                    allSelected
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-surface text-muted'
                  }`}
                >
                  SELECT ALL
                </button>
                <button
                  onClick={() => onDeleteCategory(catKey)}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[9px] font-bold text-muted"
                  title="Delete all items in this category"
                >
                  <Trash2 size={11} />
                </button>
              </div>

              {!isCollapsed && (
                <div className="pl-4 space-y-1.5 mt-1 border-l border-border/40 ml-4">
                  <button
                    onClick={() => {
                      setActiveCategory(catKey);
                      setActiveSubcategory('all');
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${isCatActive && activeSubcategory === 'all' ? 'bg-panel border-border font-bold text-accent shadow-sm' : 'hover:bg-panel/40 text-muted'}`}
                  >
                    <span className="text-[11px] uppercase tracking-wide">All {config.label}</span>
                    <span className="ml-auto text-[9px] font-bold font-mono text-muted/60 bg-surface/50 px-1.5 py-0.5 rounded-full border border-border/50">{itemsInCat.length}</span>
                  </button>
                  {Object.keys(subcats).map((subKey) => {
                    const subItems = subcats[subKey] || [];
                    const isSubAllSelected = subItems.length > 0 && subItems.every((item) => selectedItems.has(item.id));
                    const isSubSomeSelected = subItems.some((item) => selectedItems.has(item.id)) && !isSubAllSelected;

                    return (
                      <div key={subKey} className="flex items-center gap-2 group/sub">
                        <button
                          onClick={() => {
                            setActiveCategory(catKey);
                            setActiveSubcategory(subKey);
                          }}
                          className={`flex-1 text-left px-3 py-1.5 rounded-lg transition-all ${isCatActive && activeSubcategory === subKey ? 'bg-panel border-border font-bold text-accent shadow-sm' : 'hover:bg-panel/40 text-muted group-hover/sub:text-ink'}`}
                        >
                          <span className="text-[11px] font-medium truncate">{subKey}</span>
                          <span className="ml-2 text-[9px] font-bold font-mono text-muted/60 bg-surface/50 px-1.5 py-0.5 rounded-full border border-border/50">{subItems.length}</span>
                        </button>
                        <button
                          onClick={() => {
                            if (isSubAllSelected) {
                              // Deselect all in this subcategory
                              setSelectedItems((prev) => {
                                const next = new Set(prev);
                                subItems.forEach((item) => next.delete(item.id));
                                return next;
                              });
                            } else {
                              onSelectAllSubcategory(catKey, subKey);
                            }
                          }}
                          className={`rounded-lg border px-3 py-1.5 text-[9px] font-bold uppercase tracking-tighter transition-all ${
                            isSubAllSelected
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-border bg-surface text-muted'
                          }`}
                        >
                          SELECT ALL
                        </button>
                        <button
                          onClick={() => onDeleteSubcategory(catKey, subKey)}
                          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[9px] font-bold text-muted"
                          title={`Delete all items in ${subKey}`}
                        >
                          <Trash2 size={11} />
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