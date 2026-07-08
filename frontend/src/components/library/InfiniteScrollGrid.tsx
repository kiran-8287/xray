import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Item } from "../../types/library";
import ItemCard from "./ItemCard";

interface InfiniteScrollGridProps {
  allItems: Item[];
  selectedItems: Set<string>;
  onSelect: (itemId: string) => void;
  onOpen: (item: Item) => void;
  onEditRegion: (item: Item) => void;
  onDelete: (itemId: string) => void;
  itemsPerPage?: number;
}

export default function InfiniteScrollGrid({
  allItems,
  selectedItems,
  onSelect,
  onOpen,
  onEditRegion,
  onDelete,
  itemsPerPage = 100,
}: InfiniteScrollGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [displayedItems, setDisplayedItems] = useState<Item[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Responsive column count
  const columnCount = useMemo(() => {
    if (typeof window === "undefined") return 5;
    const width = window.innerWidth;
    if (width < 640) return 2;
    if (width < 768) return 3;
    if (width < 1280) return 4;
    return 5;
  }, []);

  const rowHeight = 320;

  // Load initial items
  useEffect(() => {
    const initialItems = allItems.slice(0, itemsPerPage);
    setDisplayedItems(initialItems);
    setCurrentPage(1);
    setHasMore(allItems.length > itemsPerPage);
  }, [allItems, itemsPerPage]);

  // Load more items when scrolling
  const loadMoreItems = useCallback(() => {
    if (!hasMore) return;

    const nextPage = currentPage + 1;
    const startIdx = (nextPage - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const nextItems = allItems.slice(0, endIdx);

    setDisplayedItems(nextItems);
    setCurrentPage(nextPage);
    setHasMore(endIdx < allItems.length);
  }, [allItems, currentPage, itemsPerPage, hasMore]);

  // Virtualizer for rows
  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(displayedItems.length / columnCount),
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  // Get items for a specific row
  const getItemsForRow = (rowIndex: number) => {
    const startIdx = rowIndex * columnCount;
    return displayedItems.slice(startIdx, startIdx + columnCount);
  };

  // Check if user is near bottom to load more
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

    // Load more when 80% scrolled
    if (scrollPercentage > 0.8 && hasMore) {
      loadMoreItems();
    }
  }, [hasMore, loadMoreItems]);

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto"
      style={{ contain: "strict" }}
      onScroll={handleScroll}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowItems = getItemsForRow(virtualRow.index);
          const isSelected = (itemId: string) => selectedItems.has(itemId);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4 px-5"
            >
              {rowItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isSelected={isSelected(item.id)}
                  onSelect={() => onSelect(item.id)}
                  onOpen={() => onOpen(item)}
                  onEditRegion={() => onEditRegion(item)}
                  onDelete={() => onDelete(item.id)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Loading indicator */}
      {hasMore && (
        <div className="flex items-center justify-center py-4">
          <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* End message */}
      {!hasMore && displayedItems.length > 0 && (
        <div className="text-center py-4 text-sm text-muted">
          Showing all {displayedItems.length} items
        </div>
      )}
    </div>
  );
}