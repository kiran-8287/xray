import React from "react";
import { Search, LayoutGrid, List } from "lucide-react";

interface LibraryToolbarProps {
  title: string;
  itemCount: number;
  subcategoryCount: number;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  viewMode: "grid" | "list";
  setViewMode: (val: "grid" | "list") => void;
}

export default function LibraryToolbar({
  title,
  itemCount,
  subcategoryCount,
  searchQuery,
  setSearchQuery,
  viewMode,
  setViewMode,
}: LibraryToolbarProps) {
  return (
    <div className="px-6 py-4 border-b border-border bg-panel flex items-center justify-between flex-shrink-0">
      <div>
        <h2 className="text-xl font-bold text-ink tracking-tight">{title}</h2>
        <p className="text-xs text-muted mt-0.5">
          {itemCount} items · {subcategoryCount} subcategories
        </p>
      </div>

      <div className="flex items-center gap-3">
        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search scanned bags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-surface border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-48 transition-all"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted w-4 h-4 pointer-events-none" />
        </div>

        {/* Grid/List View Toggle */}
        <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded ${
              viewMode === "grid" ? "bg-panel text-accent shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded ${
              viewMode === "list" ? "bg-panel text-accent shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <List size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
