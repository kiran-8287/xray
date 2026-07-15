import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { FolderOpen, Grid3X3, X, ChevronDown, Search, Check, Loader2 } from "lucide-react";
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

  // Load on page change
  useEffect(() => {
    loadLayouts(page);
  }, [page]);

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

  const handleClearFilters = () => {
    setSelectedBagSubcategories([]);
    setSelectedThreatSubcategories([]);
    setSelectedTags([]);
    setFilterLogic('or');
    setPage(1);
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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="border-l-4 border-accent pl-4">
          <h2 className="text-3xl font-bold text-ink tracking-tight">Saved Layouts</h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
          <FolderOpen size={18} />
          {pagination ? `${pagination.total} layouts` : '...'}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 rounded-2xl border border-border bg-panel p-4 shadow-sm">
        <div className="space-y-4">
          {/* Filter 1: Bags and Objects */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider">Filter by Bags & Objects</label>
              <button
                onClick={() => setShowTagsFilter(!showTagsFilter)}
                className="text-xs px-3 py-1.5 rounded-lg border border-border bg-white hover:bg-surface text-ink font-medium flex items-center gap-1.5"
              >
                {showTagsFilter ? 'Hide' : 'Show'} Tags Filter
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bag Subcategory Filter */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Filter by Bag Subcategory</label>
                <MultiSelectDropdown
                  selected={selectedBagSubcategories}
                  options={allBagSubcategories.map(s => ({ id: s.slug, name: s.name }))}
                  onChange={setSelectedBagSubcategories}
                  placeholder="Choose bag subcategories..."
                />
              </div>

              {/* Threat Subcategory Filter */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Filter by Threat Subcategory</label>
                <MultiSelectDropdown
                  selected={selectedThreatSubcategories}
                  options={allThreatSubcategories.map(s => ({ id: s.slug, name: s.name }))}
                  onChange={setSelectedThreatSubcategories}
                  placeholder="Choose threat subcategories..."
                />
              </div>
            </div>
          </div>

          {/* Filter 2: Tags (Toggleable) */}
          {showTagsFilter && (
            <div className="pt-3 border-t border-border">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Filter by Tags</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <MultiSelectDropdown
                    selected={selectedTags}
                    options={allTags.map(s => ({ id: s.slug, name: s.name }))}
                    onChange={setSelectedTags}
                    placeholder="Choose tags..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Filter Logic Segmented Control (applies to both threats and tags) */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Filter Logic (Threats & Tags)</label>
            <div className="inline-flex items-center rounded-lg border border-border bg-white p-1">
              <button
                onClick={() => setFilterLogic('or')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  filterLogic === 'or'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-muted hover:text-ink hover:bg-surface'
                }`}
                title="Show layouts with ANY selected threat or tag"
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
                title="Show layouts with ALL selected threats and tags together"
              >
                AND
              </button>
            </div>
            <p className="text-[10px] text-muted mt-1">
              {filterLogic === 'or' && 'Shows layouts with ANY selected threat or tag (backpack+gun OR backpack+knife)'}
              {filterLogic === 'and' && 'Shows layouts with ALL selected threats and tags together (backpack+gun+knife)'}
            </p>
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
          {/* Pagination Header */}
          {pagination && (
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Showing {((pagination.page - 1) * pagination.limit) + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                  className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-sm text-muted">
                  Page {pagination.page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* List View Table */}
          <div className="rounded-2xl border border-border bg-panel overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-border">
                <thead className="bg-surface/50">
                  <tr className="text-xs font-semibold text-muted uppercase tracking-wider">
                    <th className="text-left py-3 px-4 w-16">#</th>
                    <th className="text-left py-3 px-4 w-40">ID</th>
                    <th className="text-left py-3 px-4 w-48">Bag</th>
                    <th className="text-left py-3 px-4 w-64">Threats</th>
                    <th className="text-left py-3 px-4 w-56">Non-Threats</th>
                    <th className="text-left py-3 px-4 w-56">Tags</th>
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

                    return (
                      <tr
                        key={layout.id}
                        onClick={() => setSelectedLayout(layout)}
                        className="cursor-pointer hover:bg-surface/50 transition-colors even:bg-surface/20"
                      >
                        <td className="py-3 px-4 text-sm font-mono text-muted whitespace-nowrap">
                          {((pagination?.page || 1) - 1) * pageSize + idx + 1}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="text-sm font-mono text-accent-sky font-medium">{layout.id}</span>
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

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
                    <h2 className="truncate text-lg font-semibold text-ink">{selectedLayout.id}</h2>
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
    </div>
  );
}