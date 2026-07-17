import React from "react";
import { Search, LayoutGrid } from "lucide-react";

interface LibraryToolbarProps {
  title: string;
  itemCount: number;
  subcategoryCount: number;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
}

export default function LibraryToolbar({
  title,
  itemCount,
  subcategoryCount,
  searchQuery,
  setSearchQuery,
}: LibraryToolbarProps) {
  return (
    <div className="px-3 py-1.5 border-b border-border bg-panel flex items-center justify-between flex-shrink-0">
      <div className="flex-shrink-0">
        <h2 className="text-lg font-bold text-ink tracking-tight">{title}</h2>
        <p className="text-[11px] text-muted mt-0.5 leading-none">
          {itemCount} items · {subcategoryCount} subcategories
        </p>
      </div>

      {/* Search Input */}
      <div className="relative max-w-xs">
        <input
          type="text"
          placeholder="Search scanned bags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-surface border border-border rounded-md pl-7 pr-2.5 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-all"
        />
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted w-3.5 h-3.5 pointer-events-none" />
      </div>
    </div>
  );
}