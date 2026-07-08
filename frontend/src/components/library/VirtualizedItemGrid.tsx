import React, { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Item } from "../../types/library";
import ItemCard from "./ItemCard";

interface VirtualizedItemGridProps {
  items: Item[];
  selectedItems: Set<string>;
  onSelect: (itemId: string) => void;
  onOpen: (item: Item) => void;
  onEditRegion: (item: Item) => void;
  onDelete: (itemId: string) => void;
}

export default function VirtualizedItemGrid({
  items,
  selectedItems,
  onSelect,
  onOpen,
  onEditRegion,
  onDelete,
}: VirtualizedItemGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Responsive column count based on viewport width
  const columnCount = useMemo(() => {
    if (typeof window === "undefined") return 5;
    const width = window.innerWidth;
    if (width < 640) return 2;      // sm
    if (width < 768) return 3;      // md
    if (width < 1280) return 4;     // lg
    return 5;                        // xl
  }, []);

  // Calculate row height (card height + gap)
  const rowHeight = 320; // Approximate height of ItemCard + gap

  // Get total rows needed
  const rowCount = Math.ceil(items.length / columnCount);

  // Virtualizer for rows
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 3, // Render 3 extra rows above/below viewport
  });

  // Get items for a specific row
  const getItemsForRow = (rowIndex: number) => {
    const startIdx = rowIndex * columnCount;
    return items.slice(startIdx, startIdx + columnCount);
  };

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto"
      style={{ contain: "strict" }}
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
    </div>
  );
}