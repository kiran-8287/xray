import React, { useState, useEffect, useRef } from "react";

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

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const toastStyles = `
  @keyframes slide-down {
    from { transform: translate(-50%, -20px); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
  }
  .animate-slide-down { animation: slide-down 0.25s ease-out; }
`;

type Toast = { id: string; type: "info"; message: string };

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
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (type: Toast["type"], message: string) => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  };

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

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  // Normalize user text input to an integer in [1, totalPages], with robust edge-case handling.
  // Returns { value, clamped, invalid, rawParsed } — rawParsed is the actual number entered (before clamping) for toast feedback.
  const parsePageInput = (raw: string): { value: number; clamped: boolean; invalid: boolean; rawParsed: number | null } => {
    const trimmed = raw.trim();
    if (trimmed === "") return { value: currentPage, clamped: false, invalid: true, rawParsed: null };
    const digitsOnly = trimmed.replace(/\D/g, "");
    if (digitsOnly === "") return { value: currentPage, clamped: false, invalid: true, rawParsed: null };
    if (digitsOnly.length > 9) {
      const bigParsed = parseInt(digitsOnly, 10);
      return { value: totalPages, clamped: true, invalid: false, rawParsed: isNaN(bigParsed) ? null : bigParsed };
    }
    const parsed = parseInt(digitsOnly, 10);
    if (isNaN(parsed) || !isFinite(parsed)) return { value: currentPage, clamped: false, invalid: true, rawParsed: null };
    if (parsed < 1) return { value: 1, clamped: true, invalid: false, rawParsed: parsed };
    if (parsed > totalPages) return { value: totalPages, clamped: true, invalid: false, rawParsed: parsed };
    if (parsed === currentPage) return { value: currentPage, clamped: false, invalid: false, rawParsed: parsed };
    return { value: parsed, clamped: false, invalid: false, rawParsed: parsed };
  };

  const goToPageFromInput = (value: number, rawParsed: number | null, clamped: boolean) => {
    if (clamped && rawParsed !== null) {
      if (rawParsed > totalPages) {
        showToast("info", `No page ${rawParsed} — max is ${totalPages}. Jumping to last page.`);
      } else if (rawParsed < 1) {
        showToast("info", `Page numbers start at 1. Jumping to page 1.`);
      }
    }
    onPageChange(value);
  };

  // Reject non-digit keystrokes at the input level (backspace, nav keys, select-all, copy/paste, cut still work; paste gets re-parsed at blur/Enter anyway)
  const handleInputBeforeInput = (e: React.FormEvent<HTMLInputElement>) => {
    const ev = e.nativeEvent as InputEvent;
    // Allow deletions (no data)
    if (ev.inputType.startsWith("delete") || ev.data === null) return;
    // Insertions: only digits
    if (!/^\d+$/.test(ev.data)) {
      e.preventDefault();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow user to type freely — just store raw value. Validation happens on Enter / blur.
    // But strip non-digits immediately so they can't even be entered (avoids a second validation trip).
    const sanitized = e.target.value.replace(/\D/g, "");
    setPageInput(sanitized);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const { value, rawParsed, clamped } = parsePageInput(pageInput);
      goToPageFromInput(value, rawParsed, clamped);
      setPageInput(String(value));
    } else if (e.key === "Escape") {
      setPageInput(String(currentPage));
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onPageChange(clamp(currentPage + 1, 1, totalPages));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onPageChange(clamp(currentPage - 1, 1, totalPages));
    } else if (e.key === "Home") {
      e.preventDefault();
      onPageChange(1);
    } else if (e.key === "End") {
      e.preventDefault();
      onPageChange(totalPages);
    }
  };

  const handleInputBlur = () => {
    const { value, rawParsed, clamped } = parsePageInput(pageInput);
    if (value !== currentPage) goToPageFromInput(value, rawParsed, clamped);
    setPageInput(String(value));
  };

  // Always show pagination shell (includes select-all + showing X-Y). Nav controls only when >1 page.
  const showNav = totalPages > 1;

  return (
    <>
      <style>{toastStyles}</style>
      {toasts.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 shadow-lg text-sm font-medium animate-slide-down"
            >
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1 || totalPages <= 1}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40 transition-all hover:bg-panel"
            >
              Prev
            </button>
            {/* Direct page-number input */}
            <div className="flex items-center gap-1.5">
              <span className="hidden sm:inline text-xs text-muted whitespace-nowrap">Page</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pageInput}
                onChange={handleInputChange}
                onBeforeInput={handleInputBeforeInput}
                onKeyDown={handleInputKeyDown}
                onBlur={handleInputBlur}
                className="w-14 rounded-lg border border-border bg-surface px-2 py-1 text-center text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-40"
                placeholder="1"
                title="Type page number, then Enter. Arrow keys, Home, End also work. Esc cancels."
                disabled={totalPages <= 1}
              />
              <span className="text-xs text-muted whitespace-nowrap">/ {totalPages}</span>
            </div>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages || totalPages <= 1}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40 transition-all hover:bg-panel"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}
