import React from 'react';
import { Folder, Check, Trash2 } from 'lucide-react';
import type { Item } from '../../types/library';
import { getCategoryConfig } from '../../config/categories';

interface Props {
  categorizedItems: Record<string, Record<string, Item[]>>;
  taxonomy?: any[];
  activeCategory: string;
  setActiveCategory: (c: string) => void;
  activeSubcategory: string;
  setActiveSubcategory: (s: string) => void;
  selectedItems: Set<string>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSelectAllCategory: (category: string) => void;
  onSelectAllSubcategory: (category: string, subcategory: string) => void;
  onDeleteCategory: (category: string) => void;
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
}: Props) {
  const categories = ['bags', 'threats', 'non-threats'];

  return (
    <aside className="w-80 border-r border-border bg-nav flex flex-col overflow-y-auto flex-shrink-0 select-none">
      <div className="p-4 border-b border-border bg-panel flex items-center justify-between flex-shrink-0">
        <h3 className="font-semibold text-ink text-xs uppercase tracking-wider">Library</h3>
        <span className="text-[10px] font-mono text-muted bg-surface px-2 py-0.5 rounded-full border border-border">{categories.length}</span>
      </div>

      <div className="p-3 space-y-3 flex-1 overflow-y-auto">
        {['bags', 'threats', 'non-threats'].map((catKey) => {
          const config = getCategoryConfig(catKey);
          const subcats = categorizedItems[catKey] || {};
          const itemsInCat = Object.values(subcats).flat();
          const isCatActive = activeCategory === catKey;
          const selectedCount = itemsInCat.filter((item) => selectedItems.has(item.id)).length;
          return (
            <div key={catKey} className="space-y-1 bg-panel/30 rounded-xl border border-border/60 p-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setActiveCategory(catKey);
                    setActiveSubcategory('all');
                  }}
                  className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${isCatActive ? 'bg-panel border-border shadow-sm font-semibold' : 'hover:bg-panel'}`}
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${config.bg} ${config.text}`}>
                    <Folder size={14} />
                  </div>
                  <span className="text-xs truncate">{config.label}</span>
                  <span className="ml-auto text-[10px] font-mono text-muted bg-surface px-1.5 py-0.5 rounded-full border border-border">{itemsInCat.length}</span>
                </button>
                <button
                  onClick={() => onSelectAllCategory(catKey)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:border-accent/50 hover:text-accent"
                >
                  Select all
                </button>
                <button
                  onClick={() => onDeleteCategory(catKey)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:border-red-500/50 hover:text-red-600 flex items-center gap-1"
                  title="Delete all items in this category"
                >
                  <Trash2 size={10} />
                  Delete
                </button>
              </div>

              <div className="pl-4 space-y-1 mt-2">
                <button
                  onClick={() => {
                    setActiveCategory(catKey);
                    setActiveSubcategory('all');
                  }}
                  className={`flex items-center gap-2 px-2 py-1 rounded ${isCatActive && activeSubcategory === 'all' ? 'bg-panel border-border font-medium' : 'hover:bg-panel/40'}`}
                >
                  <span className="text-[11px]">All {config.label}</span>
                  <span className="ml-auto text-[9px] font-mono text-muted bg-surface px-1.5 py-0.2 rounded-full border border-border">{itemsInCat.length}</span>
                </button>
                {Object.keys(subcats).map((subKey) => {
                  const selectedSubCount = (subcats[subKey] || []).filter((item) => selectedItems.has(item.id)).length;
                  return (
                    <div key={subKey} className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setActiveCategory(catKey);
                          setActiveSubcategory(subKey);
                        }}
                        className={`flex-1 text-left px-2 py-1 rounded ${isCatActive && activeSubcategory === subKey ? 'bg-panel border-border font-medium' : 'hover:bg-panel/40'}`}
                      >
                        <span className="text-[11px] truncate">{subKey}</span>
                        <span className="ml-2 text-[9px] font-mono text-muted bg-surface px-1.5 py-0.2 rounded-full border border-border">{(subcats[subKey] || []).length}</span>
                      </button>
                      <button
                        onClick={() => onSelectAllSubcategory(catKey, subKey)}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:border-accent/50 hover:text-accent"
                      >
                        Select
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
