import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
  totalItems: number;
  pageItemsCount: number;
  pageSelectedCount: number;
  onSelectAllPage: () => void;
  onDeselectAllPage: () => void;
}

export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  itemsPerPage,
  totalItems,
  pageItemsCount,
  pageSelectedCount,
  onSelectAllPage,
  onDeselectAllPage,
}: PaginationProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [pageInput, setPageInput] = useState(String(currentPage));

  const allSelected = pageItemsCount > 0 && pageSelectedCount === pageItemsCount;
  const someSelected = pageSelectedCount > 0 && pageSelectedCount < pageItemsCount;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const handleSelectAllToggle = () => {
    if (allSelected || someSelected) {
      onDeselectAllPage();
    } else {
      onSelectAllPage();
    }
  };

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);

      if (currentPage > 3) {
        pages.push("...");
      }

      const start = Math.max(2, currentPage - 2);
      const end = Math.min(totalPages - 1, currentPage + 2);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 3) {
        pages.push("...");
      }

      pages.push(totalPages);
    }

    return pages;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const parsed = parseInt(pageInput, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
        onPageChange(parsed);
      } else {
        setPageInput(String(currentPage));
      }
    }
  };

  const handleInputBlur = () => {
    const parsed = parseInt(pageInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
      onPageChange(parsed);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const showNav = totalPages > 1;

  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-t border-border bg-panel">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={handleSelectAllToggle}
            className="w-3.5 h-3.5 border border-border rounded bg-surface text-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <span className="text-xs font-medium text-muted">
            {pageSelectedCount > 0
              ? `Select page (${pageSelectedCount}/${pageItemsCount})`
              : `Select all on page (${pageItemsCount})`}
          </span>
        </label>

        <div className="text-xs text-muted">
          Showing <span className="font-semibold text-ink">{startItem}</span> to{" "}
          <span className="font-semibold text-ink">{endItem}</span> of{" "}
          <span className="font-semibold text-ink">{totalItems}</span> items
        </div>
      </div>

      {showNav && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-surface text-xs font-medium text-ink hover:bg-panel disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={14} />
            <span className="hidden sm:inline">Previous</span>
          </button>

          <div className="flex items-center gap-1">
            {getPageNumbers().map((page, index) => {
              if (page === "...") {
                return (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-2 py-1 text-xs text-muted"
                  >
                    ...
                  </span>
                );
              }

              const pageNum = page as number;
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`min-w-[30px] px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    currentPage === pageNum
                      ? "bg-accent text-white shadow-sm"
                      : "border border-border bg-surface text-ink hover:bg-panel"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-surface text-xs font-medium text-ink hover:bg-panel disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={14} />
          </button>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pageInput}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-center text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
            placeholder={`/${totalPages}`}
          />
        </div>
      )}
    </div>
  );
}
