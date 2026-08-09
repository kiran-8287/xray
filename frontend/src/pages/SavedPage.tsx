import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { FolderOpen, Grid3X3, X, ChevronDown, Search, Check, CheckCircle2, Loader2, Trash2, Download } from "lucide-react";
import { getLibrarySubcategories } from "../config/categories";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";

interface SavedLayout {
  id: string;
  name: string;
  filepath: string | null;
  layout_json: any;
  created_at: string;
}

interface LayoutObject {
  id: string;
  name: string;
  library: string;
  filepath: string;
  layer?: number;
  transform?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  // Saved layout format (from layout_json.objects)
  center?: { x: number; y: number };
  size?: { width: number; height: number };
  rotation?: number;
  tags?: string[];
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const IMAGE_BASE_URL = `${API_BASE_URL}/data/library_images/`;
const API_BASE = API_BASE_URL;

// Bag subcategories for filter dropdown
const BAG_SUBCATEGORIES = getLibrarySubcategories("bags");
// Threat subcategories for filter multi-select
const THREAT_SUBCATEGORIES = getLibrarySubcategories("threats");

function SavedLayoutPreview({ layoutJson }: { layoutJson: any }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isBlank, setIsBlank] = useState(false);

  // Fetch rendered preview from backend when layoutJson changes
  useEffect(() => {
    if (!layoutJson?.objects) {
      setErrorMessage("No layout data available — cannot render preview.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPreviewUrl(null);
    setErrorMessage(null);
    setWarnings([]);
    setIsBlank(false);

    fetch(`${API_BASE}/api/render-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects: layoutJson.objects }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `Render failed (HTTP ${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          if (data.warnings && data.warnings.length > 0) {
            setWarnings(data.warnings);
          }
          if (data.isBlank) {
            setIsBlank(true);
            setErrorMessage("Preview rendered as blank — pixel data or images are missing for all objects.");
          } else if (data.image) {
            const url = `data:image/png;base64,${data.image}`;
            setPreviewUrl(url);
          } else {
            setErrorMessage("Preview returned no image data.");
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error rendering preview:', err);
        if (!cancelled) {
          setErrorMessage(err.message || "Failed to render preview.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [layoutJson]);

  useLayoutEffect(() => {
    const node = previewRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setPreviewSize({ width: rect.width, height: rect.height });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={previewRef} className="relative w-full h-full overflow-hidden bg-white flex flex-col items-center justify-center">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" />
          Rendering preview...
        </div>
      ) : previewUrl ? (
        <>
          <img
            src={previewUrl}
            alt="Layout preview"
            className="max-w-full max-h-full object-contain"
          />
          {warnings.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 bg-amber-50 border-t border-amber-200 px-3 py-2">
              <p className="text-[10px] text-amber-800 font-medium">⚠️ Preview warnings:</p>
              {warnings.map((w, i) => (
                <p key={i} className="text-[9px] text-amber-700">{w}</p>
              ))}
            </div>
          )}
        </>
      ) : errorMessage ? (
        <div className="flex flex-col items-center justify-center p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center mb-2">
            <span className="text-amber-600 text-lg font-bold">!</span>
          </div>
          <p className="text-xs text-amber-800 font-medium">{errorMessage}</p>
          {warnings.length > 0 && (
            <div className="mt-2 text-[10px] text-amber-600">
              {warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center text-muted/40">
          <Grid3X3 size={28} />
        </div>
      )}
    </div>
  );
}

// Custom dropdown component
function FilterDropdown({ label, value, options, onChange, placeholder }: {
  label: string;
  value: string;
  options: { slug: string; name: string }[];
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedName = value ? options.find(o => o.slug === value)?.name || value : '';

  return (
    <div ref={ref} className="relative">
      <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">{label}</label>
      <div
        onClick={() => setOpen(!open)}
        className={`w-full p-2 border border-border rounded-lg text-xs bg-white cursor-pointer flex items-center justify-between gap-2 hover:border-accent ${value ? 'text-ink' : 'text-muted'}`}
      >
        <span className="truncate">{selectedName || placeholder || 'All'}</span>
        <ChevronDown size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-white border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
          <div
            onClick={() => { onChange(''); setOpen(false); }}
            className={`p-2 text-xs cursor-pointer hover:bg-surface ${!value ? 'bg-accent/10 text-accent font-medium' : ''}`}
          >
            All
          </div>
          {options.map((opt) => (
            <div
              key={opt.slug}
              onClick={() => { onChange(opt.slug); setOpen(false); }}
              className={`p-2 text-xs cursor-pointer hover:bg-surface ${value === opt.slug ? 'bg-accent/10 text-accent font-medium' : ''}`}
            >
              {opt.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Multi-select dropdown component with search
function MultiSelectDropdown({ selected, options, onChange, placeholder }: {
  selected: string[];
  options: { id: string; name: string }[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    // Clear search when dropdown closes
    if (!open) {
      setSearchQuery("");
    }
  }, [open]);

  // Filter options based on search query (case-insensitive)
  const filteredOptions = searchQuery.trim()
    ? options.filter(opt => opt.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  const toggle = (id: string) => {
    if (id === 'ALL') {
      // Toggle all items
      if (selected.length === options.length) {
        onChange([]);
      } else {
        onChange(options.map(o => o.id));
      }
    } else {
      if (selected.includes(id)) {
        onChange(selected.filter(s => s !== id));
      } else {
        onChange([...selected, id]);
      }
    }
  };

  const isAllSelected = selected.length === options.length && options.length > 0;
  const displayText = selected.length === 0
    ? (placeholder || 'None selected')
    : isAllSelected
    ? 'All selected'
    : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen(!open)}
        className={`w-full px-3 py-2 border border-border rounded-lg text-sm bg-white cursor-pointer flex items-center justify-between gap-2 hover:border-accent transition-colors ${selected.length > 0 ? 'text-ink' : 'text-muted'}`}
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown size={16} className={`text-muted transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </div>
      
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-white border border-border rounded-lg shadow-xl">
          {/* Search input */}
          <div className="sticky top-0 bg-white border-b border-border rounded-t-lg">
            <div className="flex items-center gap-2 px-3 py-2">
              <Search size={14} className="text-muted shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full text-sm text-ink bg-transparent outline-none placeholder:text-muted/60"
                onClick={(e) => e.stopPropagation()}
              />
              {searchQuery && (
                <button
                  onClick={(e) => { e.stopPropagation(); setSearchQuery(""); }}
                  className="text-muted hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <div className="p-3 text-xs text-muted text-center">No options available</div>
            ) : (
              <>
                {/* ALL option at top (always visible) */}
                <div
                  onClick={() => toggle('ALL')}
                  className={`flex items-center gap-2 p-2.5 text-sm cursor-pointer transition-colors ${
                    isAllSelected ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-surface text-ink'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                    isAllSelected ? 'bg-accent border-accent' : 'border-gray-300'
                  }`}>
                    {isAllSelected && <Check size={12} className="text-white" />}
                  </div>
                  <span className="truncate font-medium">All Items</span>
                </div>
                
                {filteredOptions.length > 0 && <div className="border-t border-border my-1" />}
                
                {filteredOptions.length === 0 ? (
                  <div className="p-3 text-xs text-muted text-center">No matches found</div>
                ) : (
                  filteredOptions.map((opt) => {
                    const isSelected = selected.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        onClick={() => toggle(opt.id)}
                        className={`flex items-center gap-2 p-2.5 text-sm cursor-pointer transition-colors ${
                          isSelected ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-surface text-ink'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-accent border-accent' : 'border-gray-300'
                        }`}>
                          {isSelected && <Check size={12} className="text-white" />}
                        </div>
                        <span className="truncate">{opt.name}</span>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>

          {selected.length > 0 && (
            <div className="sticky bottom-0 border-t border-border bg-white p-2">
              <button
                onClick={(e) => { e.stopPropagation(); onChange([]); }}
                className="w-full px-2 py-1.5 text-xs text-muted hover:text-ink text-center font-medium"
              >
                Clear all selections
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SavedPage() {
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<SavedLayout | null>(null);
  const [integrityIssues, setIntegrityIssues] = useState<Map<string, any[]>>(new Map());
  const [integrityLoading, setIntegrityLoading] = useState(false);
  
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; layout: SavedLayout | null }>({ show: false, layout: null });
  const [deleting, setDeleting] = useState(false);
  
  // Toast notifications
  const [exporting, setExporting] = useState(false);
  const [exportMode, setExportMode] = useState<'all' | 'selected' | 'single' | null>(null);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  
  // Exports path configuration state
  const [showExportsPathModal, setShowExportsPathModal] = useState(false);
  const [exportsPath, setExportsPath] = useState('');
  const [savingExportsPath, setSavingExportsPath] = useState(false);
  const [exportsPathConfigured, setExportsPathConfigured] = useState(false);
  
  // References for cancelling a running bulk export (Save All / Save Selected)
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportJobIdRef = useRef<string | null>(null);
  
  const [toasts, setToasts] = useState<{ id: string; type: 'success' | 'error' | 'info'; message: string }[]>([]);
  
  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // Advanced filter state
  const [selectedBagSubcategories, setSelectedBagSubcategories] = useState<string[]>([]);
  const [selectedThreatSubcategories, setSelectedThreatSubcategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterLogic, setFilterLogic] = useState<'or' | 'and'>('or');
  const [showFilters, setShowFilters] = useState(false);
  const [showTagsFilter, setShowTagsFilter] = useState(false);

  // All available subcategories from config
  const allBagSubcategories = getLibrarySubcategories("bags");
  const allThreatSubcategories = getLibrarySubcategories("threats");
  const allTags = getLibrarySubcategories("non-threats");

  // Pagination state
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  // Mirrored text input for page-jump — kept in sync with `page` via useEffect
  const [pageInput, setPageInput] = useState<string>("1");
  const pageSize = 50;

  // Load layouts with filters
  const loadLayouts = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', String(pageSize));
      
      // Filter by bag subcategories
      if (selectedBagSubcategories.length > 0) params.set('bagSubcategories', selectedBagSubcategories.join(','));
      // Filter by threat subcategories
      if (selectedThreatSubcategories.length > 0) params.set('threatSubcategories', selectedThreatSubcategories.join(','));
      // Filter by tags
      if (selectedTags.length > 0) params.set('tags', selectedTags.join(','));
      // Filter logic mode
      params.set('filterLogic', filterLogic);

      const res = await fetchWithTimeout(`${API_BASE}/api/saved-layouts/filtered?${params}`);
      const data = await res.json();
      if (data.ok) {
        setLayouts(data.layouts);
        setPagination(data.pagination);
      } else {
        setError(data.error || "Failed to load layouts");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedBagSubcategories, selectedThreatSubcategories, selectedTags, filterLogic]);

  // Auto-apply filters when any filter changes (AND logic between different filter types)
  useEffect(() => {
    setPage(1);
    loadLayouts(1);
  }, [selectedBagSubcategories, selectedThreatSubcategories, selectedTags, filterLogic, loadLayouts]);

  // Keep the typed page-number input in sync whenever the real page number changes
  // (e.g. Prev/Next buttons, filter resets that go back to page 1, deleting a layout that
  // triggers a pagination.totalPages recalc that could put page out of range, etc.)
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  // When pagination arrives (or its totalPages shrinks due to delete/filter),
  // clamp `page` back into range if needed, and notify user via a light toast.
  useEffect(() => {
    if (!pagination) return;
    const clamped = Math.min(Math.max(1, page), Math.max(1, pagination.totalPages));
    if (clamped !== page) {
      setPage(clamped);
    }
  }, [pagination, page]);

  // Load on page change
  useEffect(() => {
    loadLayouts(page);
  }, [page]);

  // Check data integrity when layouts change - DISABLED to prevent connection overload
  // useEffect(() => {
  //   if (layouts.length === 0) return;
  //   
  //   const checkIntegrity = async () => {
  //     setIntegrityLoading(true);
  //     try {
  //       const res = await fetchWithTimeout(`${API_BASE}/api/saved-layouts/integrity`);
  //       const data = await res.json();
  //       if (data.ok) {
  //         const issuesMap = new Map();
  //         for (const result of data.results) {
  //           if (result.hasIssues) {
  //             issuesMap.set(result.layoutId, result.issues);
  //           }
  //         }
  //         setIntegrityIssues(issuesMap);
  //       }
  //     } catch (err) {
  //       console.error('Failed to check integrity:', err);
  //     } finally {
  //       setIntegrityLoading(false);
  //     }
  //   };
  //   
  //   checkIntegrity();
  // }, [layouts.length]);

  // Check if exports path is configured on mount
  useEffect(() => {
    const checkExportsPathConfig = async () => {
      // Check localStorage first to avoid unnecessary API calls
      const storedConfigured = localStorage.getItem('exportsPathConfigured');
      if (storedConfigured === 'true') {
        setExportsPathConfigured(true);
        return;
      }

      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/user-config/has-exports-path`);
        const data = await res.json();
        if (data.ok && data.configured) {
          setExportsPathConfigured(true);
          localStorage.setItem('exportsPathConfigured', 'true');
        } else {
          // Show modal to configure exports path
          setShowExportsPathModal(true);
        }
      } catch (err) {
        console.error('Failed to check exports path configuration:', err);
        // On error, still show the modal
        setShowExportsPathModal(true);
      }
    };

    checkExportsPathConfig();
  }, []);

  // Save exports path configuration
  const saveExportsPath = async () => {
    if (!exportsPath || savingExportsPath) return;

    setSavingExportsPath(true);
    try {
      const apiKey = localStorage.getItem('apiKey');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      const res = await fetchWithTimeout(`${API_BASE}/api/user-config/exports-path`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ exportsPath }),
      }, 30000);

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to save exports path (HTTP ${res.status})`);
      }

      const result = await res.json();
      if (result.ok) {
        setExportsPathConfigured(true);
        localStorage.setItem('exportsPathConfigured', 'true');
        setShowExportsPathModal(false);
        showToast('success', `Exports folder configured successfully at:\n${exportsPath}`);
      } else {
        throw new Error(result.error || 'Failed to save exports path');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error saving exports path:', err);
      showToast('error', `Failed to save exports path: ${errorMessage}`);
    } finally {
      setSavingExportsPath(false);
    }
  };

  const getObjects = (layout: SavedLayout): LayoutObject[] => {
    try {
      const obj = layout.layout_json?.objects;
      if (!obj) return [];
      // New structure: { bag: {...}, threats: [...], non-threats: [...] }
      if (obj.bag || obj.threats || obj["non-threats"]) {
        const result: LayoutObject[] = [];
        if (obj.bag) result.push({ ...obj.bag, library: "bag" });
        if (Array.isArray(obj.threats)) {
          obj.threats.forEach((t: any) => result.push({ ...t, library: "threat" }));
        }
        if (Array.isArray(obj["non-threats"])) {
          obj["non-threats"].forEach((n: any) => result.push({ ...n, library: "non-threat" }));
        }
        return result;
      }
      // Legacy flat array structure
      if (Array.isArray(obj)) return obj;
      return [];
    } catch {
      return [];
    }
  };

  const getCategoryBadge = (library: string): { bg: string; text: string; border: string } => {
    const lower = (library || "").toLowerCase();
    if (lower === "bag" || lower === "bags") return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    if (lower === "threat" || lower === "threats") return { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" };
    return { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" };
  };

  // -------- Pagination jump-input (robust edge-case handling) --------
  const maxPageForInput = Math.max(1, pagination?.totalPages ?? 1);

  const clampPage = (n: number) => Math.min(maxPageForInput, Math.max(1, Math.floor(n)));

  const parsePageInput = (raw: string): { value: number; clamped: boolean; invalid: boolean; rawParsed: number | null } => {
    const trimmed = raw.trim();
    if (trimmed === "") return { value: page, clamped: false, invalid: true, rawParsed: null };
    const digitsOnly = trimmed.replace(/\D/g, "");
    if (digitsOnly === "") return { value: page, clamped: false, invalid: true, rawParsed: null };
    if (digitsOnly.length > 9) {
      const bigParsed = parseInt(digitsOnly, 10);
      return { value: maxPageForInput, clamped: true, invalid: false, rawParsed: isNaN(bigParsed) ? null : bigParsed };
    }
    const parsed = parseInt(digitsOnly, 10);
    if (isNaN(parsed) || !isFinite(parsed)) return { value: page, clamped: false, invalid: true, rawParsed: null };
    if (parsed < 1) return { value: 1, clamped: true, invalid: false, rawParsed: parsed };
    if (parsed > maxPageForInput) return { value: maxPageForInput, clamped: true, invalid: false, rawParsed: parsed };
    if (parsed === page) return { value: page, clamped: false, invalid: false, rawParsed: parsed };
    return { value: parsed, clamped: false, invalid: false, rawParsed: parsed };
  };

  const handlePageInputBeforeInput = (e: React.FormEvent<HTMLInputElement>) => {
    const ev = e.nativeEvent as InputEvent;
    if ((ev.inputType && ev.inputType.startsWith("delete")) || ev.data === null) return;
    if (!/^\d+$/.test(ev.data)) e.preventDefault();
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value.replace(/\D/g, ""));
  };

  const goToPageFromInput = (value: number, rawParsed: number | null, clamped: boolean) => {
    if (clamped && rawParsed !== null) {
      if (rawParsed > maxPageForInput) {
        showToast("info", `No page ${rawParsed} — max is ${maxPageForInput}. Jumping to last page.`);
      } else if (rawParsed < 1) {
        showToast("info", `Page numbers start at 1. Jumping to page 1.`);
      }
    }
    setPage(value);
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const { value, rawParsed, clamped } = parsePageInput(pageInput);
      goToPageFromInput(value, rawParsed, clamped);
      setPageInput(String(value));
    } else if (e.key === "Escape") {
      setPageInput(String(page));
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPage(clampPage(page + 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setPage(clampPage(page - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPage(1);
    } else if (e.key === "End") {
      e.preventDefault();
      setPage(maxPageForInput);
    }
  };

  const handlePageInputBlur = () => {
    const { value, rawParsed, clamped } = parsePageInput(pageInput);
    if (value !== page) goToPageFromInput(value, rawParsed, clamped);
    setPageInput(String(value));
  };

  const handleClearFilters = () => {
    setSelectedBagSubcategories([]);
    setSelectedThreatSubcategories([]);
    setSelectedTags([]);
    setFilterLogic('or');
    setPage(1);
  };

  // Toggle layout selection for mass export
  const toggleLayoutSelection = (layoutId: string) => {
    setSelectedForExport(prev => {
      const next = new Set(prev);
      if (next.has(layoutId)) {
        next.delete(layoutId);
      } else {
        next.add(layoutId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedForExport.size === layouts.length) {
      setSelectedForExport(new Set());
    } else {
      setSelectedForExport(new Set(layouts.map(l => l.id)));
    }
  };

  const clearExportSelection = () => setSelectedForExport(new Set());

  // Delete selected layouts using batch endpoint
  const deleteSelected = async () => {
    if (selectedForExport.size === 0) {
      showToast('error', 'No layouts selected for deletion');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedForExport.size} layout(s)?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    setDeleting(true);
    try {
      const ids = Array.from(selectedForExport);
      
      // Use batch delete endpoint to avoid timeout issues
      const res = await fetchWithTimeout(`${API_BASE}/api/saved-layouts/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }, 120000); // 2 minute timeout for batch delete

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
      }

      const result = await res.json();
      const successCount = result.successCount || 0;
      const failCount = result.failCount || 0;
      const deletedIds = Array.from(selectedForExport);
      const remainingOnCurrentPage = layouts.filter(layout => !deletedIds.includes(layout.id)).length;
      const nextTotalPages = pagination ? Math.max(1, Math.ceil(Math.max(0, pagination.total - successCount) / pagination.limit)) : 1;
      const targetPage = remainingOnCurrentPage === 0 && pagination
        ? (page < nextTotalPages ? page + 1 : Math.min(page, nextTotalPages))
        : page;

      // Clear selection first so the UI stops showing deleted items immediately.
      clearExportSelection();

      // Always reload the target page directly to ensure immediate UI update.
      // Don't rely on setPage() -> useEffect() which can be async.
      await loadLayouts(targetPage);
      
      // Update page state if it changed
      if (targetPage !== page) {
        setPage(targetPage);
      }

      // Show result message
      if (failCount === 0) {
        showToast('success', `Successfully deleted ${successCount} layout(s)`);
      } else {
        showToast('error', `Deleted ${successCount} layout(s), failed to delete ${failCount} layout(s)`);
      }

      // Close detail modal if selected layout was deleted
      if (selectedLayout && deletedIds.includes(selectedLayout.id)) {
        setSelectedLayout(null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error deleting layouts:', error);
      showToast('error', `Failed to delete layouts: ${errorMessage}`);
    } finally {
      setDeleting(false);
    }
  };

  // Cancel a running bulk export (Save All / Save Selected).
  // Aborts the client fetch immediately and notifies the backend so the
  // running export loop stops at the next layout boundary.
  const stopExport = async () => {
    const jobId = exportJobIdRef.current;
    const controller = exportAbortRef.current;

    // Clear references first so double-clicks are safe and the Stop button
    // is hidden immediately.
    exportAbortRef.current = null;
    exportJobIdRef.current = null;
    setExporting(false);
    setExportMode(null);

    // Abort the client-side fetch so we stop waiting for the response.
    if (controller) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }

    // Notify the backend to stop processing remaining layouts.
    if (jobId) {
      try {
        await fetchWithTimeout(`${API_BASE}/api/saved-layouts/export/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        }, 10000);
      } catch (err) {
        console.warn('Failed to notify backend of export cancellation:', err);
      }
    }

    showToast('info', 'Save process stopped.');
  };

  // Export selected layouts - saves to exports folder with high/low resolution
  const exportSelected = async () => {
    if (selectedForExport.size === 0) {
      showToast('error', 'No layouts selected for export');
      return;
    }
    if (exporting) return;

    const jobId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    exportJobIdRef.current = jobId;

    setExporting(true);
    setExportMode('selected');

    try {
      const ids = Array.from(selectedForExport).join(',');
      
      // Get API key from localStorage
      const apiKey = localStorage.getItem('apiKey');
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add API key header if available
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
      
      const res = await fetchWithTimeout(`${API_BASE}/api/saved-layouts/export?ids=${encodeURIComponent(ids)}&jobId=${encodeURIComponent(jobId)}&saveMode=selected`, {
        headers,
        signal: controller.signal,
      }, 300000);
      
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 401) {
          throw new Error('Authentication required. Please configure your API key in Settings.');
        }
        throw new Error(data?.error || `Export failed (HTTP ${res.status})`);
      }
      
      const result = await res.json();
      
      if (result.ok) {
        // Show detailed success message
        const { summary, savedPaths } = result;
        const fileCount = summary?.fileCount;
        const fileCountMsg = fileCount
          ? ` (${fileCount.high} high, ${fileCount.low} low${fileCount.annotations > 0 ? `, ${fileCount.annotations} annotations${fileCount.annotationPartitions > 1 ? ` in ${fileCount.annotationPartitions} partitions` : ''}` : ''})`
          : '';
        if (result.cancelled) {
          showToast('info', `Save stopped. Exported ${summary.success}/${summary.total} layouts so far.`);
        } else if (summary.failed > 0) {
          showToast('info', `Exported ${summary.success}/${summary.total} layouts (${summary.failed} failed)${fileCountMsg}`);
        } else {
          showToast('success', `Successfully exported ${summary.success} layout(s)${fileCountMsg}`);
        }
        
        // Log the saved paths for debugging
        console.log('Export completed:', {
          summary,
          savedPaths: {
            high: savedPaths.high.length,
            low: savedPaths.low.length,
            annotations: savedPaths.annotations?.length || 0
          }
        });
      } else {
        throw new Error(result.error || 'Export failed');
      }
    } catch (err) {
      // User-initiated cancellation via the Stop Saving button.
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.log('Export cancelled by user.');
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Error exporting layouts:', err);
        showToast('error', `Failed to export layouts: ${errorMessage}`);
      }
    } finally {
      exportAbortRef.current = null;
      exportJobIdRef.current = null;
      setExporting(false);
      setExportMode(null);
    }
  };

  // Export all layouts - saves to exports folder with high/low resolution.
  // Supports cancellation via the Stop Saving button (jobId + AbortController).
  const exportAll = async () => {
    if (!pagination || pagination.total === 0) {
      showToast('error', 'No layouts to export');
      return;
    }
    if (exporting) return;
    
    const confirmed = window.confirm(
      `Export all ${pagination.total} layouts?\n\nThis will render and save high and low resolution images for each layout to the exports folder.`
    );
    
    if (!confirmed) return;

    const jobId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    exportJobIdRef.current = jobId;
    
    setExporting(true);
    setExportMode('all');

    try {
      // Get API key from localStorage
      const apiKey = localStorage.getItem('apiKey');
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add API key header if available
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
      
      const res = await fetchWithTimeout(`${API_BASE}/api/saved-layouts/export?jobId=${encodeURIComponent(jobId)}&saveMode=all`, {
        headers,
        signal: controller.signal,
      }, 300000); // 5 minute timeout
      
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 401) {
          throw new Error('Authentication required. Please configure your API key in Settings.');
        }
        throw new Error(data?.error || `Export failed (HTTP ${res.status})`);
      }
      
      const result = await res.json();
      
      if (result.ok) {
        // Show detailed success message
        const { summary, savedPaths } = result;
        const fileCount = summary?.fileCount;
        const fileCountMsg = fileCount
          ? ` (${fileCount.high} high, ${fileCount.low} low${fileCount.annotations > 0 ? `, ${fileCount.annotations} annotations${fileCount.annotationPartitions > 1 ? ` in ${fileCount.annotationPartitions} partitions` : ''}` : ''})`
          : '';
        if (result.cancelled) {
          showToast('info', `Save stopped. Exported ${summary.success}/${summary.total} layouts so far.`);
        } else if (summary.failed > 0) {
          showToast('info', `Exported ${summary.success}/${summary.total} layouts (${summary.failed} failed)${fileCountMsg}`);
        } else {
          showToast('success', `Successfully exported all ${summary.success} layouts${fileCountMsg}`);
        }
        
        // Log the saved paths
        console.log('Export all completed:', {
          summary,
          savedPaths: {
            high: savedPaths.high.length,
            low: savedPaths.low.length,
            annotations: savedPaths.annotations?.length || 0
          }
        });
      } else {
        throw new Error(result.error || 'Export failed');
      }
    } catch (err) {
      // User-initiated cancellation via the Stop Saving button.
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.log('Export all cancelled by user.');
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Error exporting all layouts:', err);
        showToast('error', `Failed to export layouts: ${errorMessage}`);
      }
    } finally {
      exportAbortRef.current = null;
      exportJobIdRef.current = null;
      setExporting(false);
      setExportMode(null);
    }
  };

  // Delete layout handler
  const handleDelete = async (layoutId: string) => {
    if (!deleteConfirm.layout || deleteConfirm.layout.id !== layoutId) return;
    
    setDeleting(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/saved-layouts/${layoutId}`, {
        method: 'DELETE',
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to delete layout (HTTP ${res.status})`);
      }
      
      const remainingOnCurrentPage = layouts.filter(layout => layout.id !== layoutId).length;
      const nextTotalPages = pagination ? Math.max(1, Math.ceil(Math.max(0, pagination.total - 1) / pagination.limit)) : 1;
      const targetPage = remainingOnCurrentPage === 0 && pagination
        ? (page < nextTotalPages ? page + 1 : Math.min(page, nextTotalPages))
        : page;

      // Close detail modal if this layout was selected
      if (selectedLayout?.id === layoutId) {
        setSelectedLayout(null);
      }

      // Always reload the target page directly to ensure immediate UI update.
      // Don't rely on setPage() -> useEffect() which can be async.
      await loadLayouts(targetPage);
      
      // Update page state if it changed
      if (targetPage !== page) {
        setPage(targetPage);
      }

      // Close confirmation dialog
      setDeleteConfirm({ show: false, layout: null });

      // Show success message
      showToast('success', `Layout ${layoutId} deleted successfully`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error deleting layout:', error);
      showToast('error', `Failed to delete layout: ${errorMessage}`);
    } finally {
      setDeleting(false);
    }
  };

  // Close detail on Escape
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedLayout(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Toast notification styles
  const toastStyles = `
    @keyframes slide-down {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-slide-down { animation: slide-down 0.2s ease-out; }
  `;

  return (
    <div className="p-6">
      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <>
          <style>{toastStyles}</style>
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
            {toasts.map(t => (
              <div
                key={t.id}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium animate-slide-down"
                style={{
                  backgroundColor: t.type === 'success' ? '#ECFDF5' : t.type === 'error' ? '#FEF2F2' : '#EFF4FF',
                  borderColor: t.type === 'success' ? '#6EE7B7' : t.type === 'error' ? '#FCA5A5' : '#BFDBFE',
                  color: t.type === 'success' ? '#065F46' : t.type === 'error' ? '#991B1B' : '#1E40AF'
                }}
              >
                {t.type === 'success' && <CheckCircle2 size={16} className="text-emerald-600" />}
                {t.type === 'error' && <Trash2 size={16} className="text-rose-600" />}
                {t.type === 'info' && <Check size={16} className="text-blue-600" />}
                {t.message}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="border-l-4 border-accent pl-4">
          <h2 className="text-3xl font-bold text-ink tracking-tight font-heading">Saved Layouts</h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
          <FolderOpen size={18} />
          {pagination ? `${pagination.total} layouts` : '...'}
        </div>
      </div>

      {/* Export Actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={exportAll}
          disabled={exporting || !pagination || pagination.total === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Export all layouts as ZIP"
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Save All
        </button>
        <button
          onClick={exportSelected}
          disabled={exporting || selectedForExport.size === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={`Export ${selectedForExport.size} selected layout(s) as ZIP`}
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Save Selected ({selectedForExport.size})
        </button>
        {/* Stop Saving button — shown only while a bulk save (Save All / Save Selected) is running */}
        {exporting && (exportMode === 'all' || exportMode === 'selected') && (
          <button
            onClick={stopExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-300 bg-rose-600 text-sm font-semibold text-white hover:bg-rose-700 transition-colors shadow-sm"
            title="Stop the current save process"
          >
            <X size={16} />
            Stop Saving
          </button>
        )}
        <button
          onClick={deleteSelected}
          disabled={deleting || selectedForExport.size === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={`Delete ${selectedForExport.size} selected layout(s)`}
        >
          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          Delete Selected ({selectedForExport.size})
        </button>
        {selectedForExport.size > 0 && (
          <button
            onClick={clearExportSelection}
            className="text-xs text-muted hover:text-ink underline"
          >
            Clear selection
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="mb-6 rounded-2xl border border-border bg-panel p-4 shadow-sm">
        <div className="space-y-4">
          {/* Filter 1: Bags and Objects */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Filters</span>
              <button
                onClick={() => setShowTagsFilter(!showTagsFilter)}
                className="text-xs px-3 py-1.5 rounded-lg border border-border bg-white hover:bg-surface text-ink font-medium"
              >
                {showTagsFilter ? 'Hide' : 'Show'} Tags
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Bag Subcategory Filter */}
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Bag Type</label>
                <MultiSelectDropdown
                  selected={selectedBagSubcategories}
                  options={allBagSubcategories.map(s => ({ id: s.slug, name: s.name }))}
                  onChange={setSelectedBagSubcategories}
                  placeholder="Select..."
                />
              </div>

              {/* Threat Subcategory Filter */}
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Threat Type</label>
                <MultiSelectDropdown
                  selected={selectedThreatSubcategories}
                  options={allThreatSubcategories.map(s => ({ id: s.slug, name: s.name }))}
                  onChange={setSelectedThreatSubcategories}
                  placeholder="Select..."
                />
              </div>
            </div>
          </div>

          {/* Filter 2: Tags (Toggleable) */}
          {showTagsFilter && (
            <div className="pt-3 border-t border-border">
              <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Tags</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <MultiSelectDropdown
                    selected={selectedTags}
                    options={allTags.map(s => ({ id: s.slug, name: s.name }))}
                    onChange={setSelectedTags}
                    placeholder="Select..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Filter Logic Segmented Control (applies to both threats and tags) */}
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Match Logic</label>
            <div className="inline-flex items-center rounded-lg border border-border bg-white p-1">
              <button
                onClick={() => setFilterLogic('or')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  filterLogic === 'or'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-muted hover:text-ink hover:bg-surface'
                }`}
                title="Match ANY selected item"
              >
                OR
              </button>
              <button
                onClick={() => setFilterLogic('and')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  filterLogic === 'and'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-muted hover:text-ink hover:bg-surface'
                }`}
                title="Match ALL selected items"
              >
                AND
              </button>
            </div>
          </div>

          {(selectedBagSubcategories.length > 0 || selectedThreatSubcategories.length > 0 || selectedTags.length > 0) && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearFilters}
                className="px-4 py-2 rounded-xl border border-border text-sm text-muted hover:text-ink"
              >
                Clear All
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted">Loading saved layouts...</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">{error}</div>
      ) : layouts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted">
          {pagination && pagination.total > 0
            ? "No layouts match the current filters."
            : "No saved layouts yet."}
        </div>
      ) : (
        <>
          {/* List View Table */}
          <div className="rounded-2xl border border-border bg-panel overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-border">
                <thead className="bg-surface/50">
                  <tr className="text-xs font-semibold text-muted uppercase tracking-wider">
                    <th className="text-left py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedForExport.size === layouts.length && layouts.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-border"
                        title="Select all for export"
                      />
                    </th>
                    <th className="text-left py-3 px-4 w-16">#</th>
                    <th className="text-left py-3 px-4 w-40">ID</th>
                    <th className="text-left py-3 px-4 w-48">Bag</th>
                    <th className="text-left py-3 px-4 w-64">Threats</th>
                    <th className="text-left py-3 px-4 w-56">Non-Threats</th>
                    <th className="text-left py-3 px-4 w-56">Tags</th>
                    <th className="text-center py-3 px-4 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {layouts.map((layout, idx) => {
                    const objects = getObjects(layout);
                    const bagObj = objects.find(o => (o.library || "").toLowerCase().includes("bag"));
                    const threatObjs = objects.filter(o => {
                      const lib = (o.library || "").toLowerCase();
                      return lib.includes("threat") && !lib.includes("non");
                    });
                    const nonThreatObjs = objects.filter(o => (o.library || "").toLowerCase().includes("non-threat"));
                    const bagName = bagObj?.id || bagObj?.name || "—";
                    const threatNames = threatObjs.map(t => t.id || t.name).filter(Boolean).join(", ") || "—";
                    const nonThreatNames = nonThreatObjs.map(t => t.id || t.name).filter(Boolean).join(", ") || "—";
                    const bagTags = bagObj?.tags || [];
                    const tagsDisplay = bagTags.length > 0 
                      ? bagTags.map((tag: string) => tag.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(", ")
                      : "—";

                    const layoutIssues = integrityIssues.get(layout.id);
                    
                    return (
                      <tr
                        key={layout.id}
                        onClick={() => setSelectedLayout(layout)}
                        className={`cursor-pointer hover:bg-surface/50 transition-colors even:bg-surface/20 ${
                          layoutIssues ? 'bg-amber-50/50' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={selectedForExport.has(layout.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleLayoutSelection(layout.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded border-border"
                          />
                        </td>
                        <td className="py-3 px-4 text-sm font-mono text-muted whitespace-nowrap">
                          {((pagination?.page || 1) - 1) * pageSize + idx + 1}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono text-accent-sky font-medium">{layout.id}</span>
                            {layoutIssues && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200" title={`${layoutIssues.length} issue(s) found`}>
                                ⚠️ {layoutIssues.length}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="text-sm text-ink">{bagName}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-rose-700">{threatNames}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-ink">{nonThreatNames}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-emerald-700">{tagsDisplay}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  // Export single layout
                                  try {
                                    setExporting(true);

                                    // Get API key from localStorage
                                    const apiKey = localStorage.getItem('apiKey');

                                    const headers: Record<string, string> = {
                                      'Content-Type': 'application/json',
                                    };

                                    // Add API key header if available
                                    if (apiKey) {
                                      headers['X-API-Key'] = apiKey;
                                    }

                                    const res = await fetchWithTimeout(`${API_BASE}/api/saved-layouts/export?ids=${encodeURIComponent(layout.id)}&saveMode=individual`, {
                                      headers,
                                    });

                                    if (!res.ok) {
                                      const data = await res.json().catch(() => null);
                                      if (res.status === 401) {
                                        throw new Error('Authentication required. Please configure your API key in Settings.');
                                      }
                                      throw new Error(data?.error || `Export failed (HTTP ${res.status})`);
                                    }
                                    const result = await res.json();
                                    if (result.ok) {
                                      showToast('success', `Exported layout ${layout.id}`);
                                      console.log('Single export completed:', result);
                                    } else {
                                      throw new Error(result.error || 'Export failed');
                                    }
                                  } catch (err) {
                                    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                                    console.error('Error exporting layout:', err);
                                    showToast('error', `Failed to export: ${errorMessage}`);
                                  } finally {
                                    setExporting(false);
                                  }
                                }}
                                disabled={exporting}
                                className="p-1.5 rounded-md bg-panel border border-border text-muted hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Save this layout"
                              >
                                <Download size={14} />
                              </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirm({ show: true, layout });
                              }}
                              className="p-1.5 rounded-md bg-panel border border-border text-muted hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 transition-colors"
                              title="Delete layout"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination Footer */}
          {pagination && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Showing {pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1 || pagination.totalPages <= 1}
                  className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                {/* Direct page-number input */}
                <div className="flex items-center gap-1.5">
                  <span className="hidden sm:inline text-sm text-muted whitespace-nowrap">Page</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pageInput}
                    onChange={handlePageInputChange}
                    onBeforeInput={handlePageInputBeforeInput}
                    onKeyDown={handlePageInputKeyDown}
                    onBlur={handlePageInputBlur}
                    className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-center text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-40"
                    placeholder="1"
                    title="Type page number, then Enter. Arrow keys, Home, End also work. Esc cancels."
                    disabled={pagination.totalPages <= 1}
                  />
                  <span className="text-sm text-muted whitespace-nowrap">/ {pagination.totalPages}</span>
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages || pagination.totalPages <= 1}
                  className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Detail Panel */}
          {selectedLayout && (
            <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedLayout(null)}>
              <div
                className="w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-3xl border border-border bg-panel shadow-2xl flex flex-col"
                onClick={(event) => event.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-4 border-b border-border bg-nav px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-ink font-heading">{selectedLayout.id}</h2>
                    <p className="text-xs text-muted">Saved {new Date(selectedLayout.created_at).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => setSelectedLayout(null)}
                    className="rounded-full border border-border bg-panel p-2 text-muted hover:text-ink"
                    title="Close details"
                  >
                    <X size={16} />
                  </button>
                </div>

                 <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1.2fr_0.8fr]">
                   {/* Left: Preview */}
                   <div className="min-h-0 border-b border-border bg-surface p-4 lg:border-b-0 lg:border-r">
                     <div className="h-full rounded-2xl overflow-hidden border border-border bg-white">
                       <SavedLayoutPreview 
                         layoutJson={selectedLayout.layout_json}
                       />
                     </div>
                   </div>

                   {/* Right: Annotation Details */}
                   <div className="min-h-0 overflow-y-auto p-5">
                     <div className="space-y-4">
                     {(() => {
                       const layoutObjects = selectedLayout.layout_json?.objects;
                       if (!layoutObjects) {
                         return (
                           <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                             <p className="text-xs text-amber-800 font-medium">No layout data available.</p>
                             <p className="text-[10px] text-amber-600 mt-1">This saved layout contains no object data. Preview cannot be rendered.</p>
                           </div>
                         );
                       }
                       const objs = getObjects(selectedLayout);
                       if (objs.length === 0) {
                         return (
                           <div>
                             <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Objects in Layout</h3>
                             <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                               <p className="text-xs text-amber-800 font-medium">No object data found in this saved layout.</p>
                               <p className="text-[10px] text-amber-600 mt-1">The layout may be corrupted or missing object position data. The preview may not render correctly.</p>
                             </div>
                           </div>
                         );
                       }
                       return (
                         <div>
                           <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Objects in Layout</h3>
                           <div className="space-y-2">
                             {objs.map((obj: any, idx: number) => {
                                // Use center (now relative to bag origin) and size
                                const transform = obj.center && obj.size ? {
                                  x: obj.center.x,
                                  y: obj.center.y,
                                  width: obj.size.width,
                                  height: obj.size.height,
                                  rotation: obj.rotation || 0
                                } : null;
                                
                                return (
                                  <div key={idx} className="rounded-xl border border-border bg-white p-2.5">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-xs font-semibold text-ink">{obj.id || obj.name}</span>
                                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                                        obj.library === "bag" ? "bg-blue-50 text-blue-700 border-blue-200" :
                                        obj.library === "threat" ? "bg-rose-50 text-rose-700 border-rose-200" :
                                        "bg-gray-50 text-gray-600 border-gray-200"
                                      }`}>
                                        {obj.library}
                                      </span>
                                    </div>
                                    {obj.subcategory && (
                                      <div className="text-[10px] text-muted mb-2">
                                        <span className="font-medium">Subcategory:</span> {obj.subcategory}
                                      </div>
                                    )}
                                    {transform && (
                                      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                                        <div className="bg-surface rounded px-1.5 py-1">
                                          <span className="text-muted">X:</span> <span className="text-ink">{Math.round(transform.x)}</span>
                                        </div>
                                        <div className="bg-surface rounded px-1.5 py-1">
                                          <span className="text-muted">Y:</span> <span className="text-ink">{Math.round(transform.y)}</span>
                                        </div>
                                        <div className="bg-surface rounded px-1.5 py-1">
                                          <span className="text-muted">W:</span> <span className="text-ink">{Math.round(transform.width)}</span>
                                        </div>
                                        <div className="bg-surface rounded px-1.5 py-1">
                                          <span className="text-muted">H:</span> <span className="text-ink">{Math.round(transform.height)}</span>
                                        </div>
                                        <div className="bg-surface rounded px-1.5 py-1 col-span-2">
                                          <span className="text-muted">Rot:</span> <span className="text-ink">{Math.round(transform.rotation)}°</span>
                                        </div>
                                      </div>
                                    )}
                                     {/* Show tags for bag objects */}
                                     {(obj.library || "").toLowerCase().includes("bag") && obj.tags && obj.tags.length > 0 && (
                                       <div className="mt-2 pt-2 border-t border-border">
                                         <div className="text-[10px] text-muted mb-1 font-medium">Tags:</div>
                                         <div className="flex flex-wrap gap-1">
                                           {obj.tags.map((tagSlug: string) => {
                                             const tagName = tagSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                                             return (
                                               <span
                                                 key={tagSlug}
                                                 className="inline-flex items-center px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-medium"
                                                 title={tagName}
                                               >
                                                 {tagName}
                                               </span>
                                             );
                                           })}
                                         </div>
                                       </div>
                                     )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                   </div>
                 </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.show && deleteConfirm.layout && (
        <div className="fixed inset-0 z-[60] bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDeleteConfirm({ show: false, layout: null })}>
          <div
            className="w-full max-w-md bg-panel rounded-2xl border border-border shadow-2xl p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                <Trash2 size={20} className="text-rose-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink">Delete Layout</h3>
                <p className="text-xs text-muted">This action cannot be undone</p>
              </div>
            </div>
            
            <p className="text-sm text-ink mb-6">
              Are you sure you want to delete layout <span className="font-mono font-semibold text-accent-sky">{deleteConfirm.layout.id}</span>? 
              This will permanently remove it from the backend storage.
            </p>
            
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm({ show: false, layout: null })}
                disabled={deleting}
                className="px-4 py-2 rounded-lg border border-border bg-white text-sm text-ink hover:bg-surface transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.layout!.id)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exports Path Configuration Modal */}
      {showExportsPathModal && (
        <div className="fixed inset-0 z-[70] bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="w-full max-w-2xl bg-panel rounded-2xl border border-border shadow-2xl p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center">
                <FolderOpen size={20} className="text-sky-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink">Configure Exports Folder</h3>
                <p className="text-xs text-muted">This will only be asked once</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-sm text-ink mb-3">
                  Where would you like to store exported layouts and images? This folder will contain:
                </p>
                <ul className="space-y-1.5 text-xs text-muted ml-4 list-disc">
                  <li><span className="font-mono text-ink">high/</span> - High-resolution PNG images</li>
                  <li><span className="font-mono text-ink">low/</span> - Low-resolution PNG images</li>
                  <li><span className="font-mono text-ink">annotations/</span> - JSON annotation files</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Exports Folder Path <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={exportsPath}
                  onChange={(e) => setExportsPath(e.target.value)}
                  placeholder={exportsPath || "e.g., C:\\xray_exports"}
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  disabled={savingExportsPath}
                  autoFocus
                />
                <p className="text-xs text-muted mt-1.5">
                  Enter an absolute path where you want to save exported files. The backend will create subfolders automatically.
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-800">
                  <span className="font-semibold">Default location:</span> If you don't specify a path, exports will be saved to{' '}
                  <span className="font-mono">data/exports</span> in the backend directory.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  // Use default path
                  setExportsPath('');
                  saveExportsPath();
                }}
                disabled={savingExportsPath}
                className="px-4 py-2 rounded-lg border border-border bg-white text-sm text-ink hover:bg-surface transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                Use Default
              </button>
              <button
                onClick={saveExportsPath}
                disabled={savingExportsPath || !exportsPath}
                className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-2"
              >
                {savingExportsPath ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    Save Configuration
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
