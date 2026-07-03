import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { FolderOpen, Grid3X3, X, ChevronDown, Search } from "lucide-react";
import { getLibrarySubcategories } from "../config/categories";

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
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const CANVAS_W = 800;
const CANVAS_H = 600;
const IMAGE_BASE_URL = "http://localhost:8080/data/library_images/";
const API_BASE = "http://localhost:8080";

// Bag subcategories for filter dropdown
const BAG_SUBCATEGORIES = getLibrarySubcategories("bags");
// Threat subcategories for filter multi-select
const THREAT_SUBCATEGORIES = getLibrarySubcategories("threats");

function SavedLayoutPreview({ objects, bagOrigin }: { objects: LayoutObject[]; bagOrigin?: { x: number; y: number } }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  // Convert saved layout format (center/size/rotation) to transform format
  // Coordinates are relative to bag's top-left corner, so we add bagOrigin offset
  const sortedObjects = [...objects]
    .map((obj) => {
      if (obj.transform) return obj;
      // Convert from saved format to transform format
      if (obj.center && obj.size) {
        return {
          ...obj,
          transform: {
            x: (bagOrigin?.x || 0) + obj.center.x,
            y: (bagOrigin?.y || 0) + obj.center.y,
            width: obj.size.width,
            height: obj.size.height,
            rotation: obj.rotation || 0,
          },
        };
      }
      return null;
    })
    .filter((obj): obj is LayoutObject => obj !== null)
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));

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

  const scale = previewSize.width > 0 && previewSize.height > 0
    ? Math.min(previewSize.width / CANVAS_W, previewSize.height / CANVAS_H)
    : 1;

  return (
    <div ref={previewRef} className="relative w-full h-full overflow-hidden bg-white">
      <div
        className="absolute"
        style={{
          left: "50%",
          top: "50%",
          transformOrigin: "center",
          transform: `translate(-50%, -50%) scale(${scale})`,
          width: CANVAS_W,
          height: CANVAS_H,
        }}
      >
        {sortedObjects.map((obj) => {
          const transform = obj.transform!;
          const isBag = (obj.library || "").toLowerCase() === "bag" || (obj.library || "").toLowerCase() === "bags";

          return (
            <div
              key={obj.id}
              className="absolute"
              style={{
                left: transform.x - transform.width / 2,
                top: transform.y - transform.height / 2,
                width: transform.width,
                height: transform.height,
                transform: `rotate(${transform.rotation}deg)`,
                transformOrigin: "center",
                zIndex: obj.layer ?? 0,
                opacity: isBag ? 1 : 0.7,
                mixBlendMode: isBag ? "normal" : "multiply",
              }}
            >
              <img
                src={`${IMAGE_BASE_URL}${obj.filepath}`}
                alt={obj.name || "Object"}
                className="w-full h-full object-fill pointer-events-none"
                draggable={false}
              />
            </div>
          );
        })}

        {sortedObjects.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted/40">
            <Grid3X3 size={28} />
          </div>
        )}
      </div>
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

// Multi-select dropdown for threat types
function MultiSelectDropdown({ label, selected, options, onChange, placeholder }: {
  label: string;
  selected: string[];
  options: { slug: string; name: string }[];
  onChange: (vals: string[]) => void;
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

  const toggle = (slug: string) => {
    if (selected.includes(slug)) {
      onChange(selected.filter(s => s !== slug));
    } else {
      onChange([...selected, slug]);
    }
  };

  const displayText = selected.length === 0
    ? (placeholder || 'All')
    : selected.map(s => options.find(o => o.slug === s)?.name || s).join(', ');

  return (
    <div ref={ref} className="relative">
      <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">{label}</label>
      <div
        onClick={() => setOpen(!open)}
        className={`w-full p-2 border border-border rounded-lg text-xs bg-white cursor-pointer flex items-center justify-between gap-2 hover:border-accent ${selected.length > 0 ? 'text-ink' : 'text-muted'}`}
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown size={14} className={`text-muted transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-white border border-border rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = selected.includes(opt.slug);
            return (
              <label
                key={opt.slug}
                className={`flex items-center gap-2 p-2 text-xs cursor-pointer ${
                  isSelected ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-surface'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(opt.slug)}
                  className="rounded border-gray-300"
                />
                {opt.name}
              </label>
            );
          })}
          {selected.length > 0 && (
            <div className="sticky bottom-0 border-t border-border bg-white p-2">
              <button
                onClick={() => { onChange([]); setOpen(false); }}
                className="w-full px-2 py-1 text-[11px] text-muted hover:text-ink text-center"
              >
                Clear all
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

  // Filter state
  const [bagType, setBagType] = useState("");
  const [threatTypes, setThreatTypes] = useState<string[]>([]);

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
      if (bagType) params.set('bagType', bagType);
      if (threatTypes.length > 0) params.set('threatTypes', threatTypes.join(','));

      const res = await fetch(`${API_BASE}/api/saved-layouts/filtered?${params}`);
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
  }, [bagType, threatTypes]);

  // Load on mount and when filters change
  useEffect(() => {
    setPage(1);
    loadLayouts(1);
  }, [loadLayouts]);

  // Load on page change
  useEffect(() => {
    if (page > 1) loadLayouts(page);
  }, [page]);

  const getObjects = (layout: SavedLayout): LayoutObject[] => {
    try {
      return layout.layout_json?.objects || [];
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

  const handleApplyFilters = () => {
    setPage(1);
    loadLayouts(1);
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
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted">Saved Workspaces</p>
          <h1 className="text-3xl font-semibold text-ink">Saved Layouts</h1>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
          <FolderOpen size={18} />
          {pagination ? `${pagination.total} layouts` : '...'}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 rounded-2xl border border-border bg-panel p-4 shadow-sm">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="w-48">
            <FilterDropdown
              label="Bag Type"
              value={bagType}
              options={BAG_SUBCATEGORIES}
              onChange={setBagType}
              placeholder="All Bags"
            />
          </div>
          <div className="w-64">
            <MultiSelectDropdown
              label="Threat Types"
              selected={threatTypes}
              options={THREAT_SUBCATEGORIES}
              onChange={setThreatTypes}
              placeholder="All Threats"
            />
          </div>
          <button
            onClick={handleApplyFilters}
            className="px-5 py-2 rounded-xl bg-accent text-white text-sm font-semibold flex items-center gap-2 hover:bg-accent/90"
          >
            <Search size={16} />
            Apply Filters
          </button>
          {(bagType || threatTypes.length > 0) && (
            <button
              onClick={() => {
                setBagType("");
                setThreatTypes([]);
              }}
              className="px-4 py-2 rounded-xl border border-border text-sm text-muted hover:text-ink"
            >
              Clear
            </button>
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
                    <th className="text-left py-3 px-4 w-12">#</th>
                    <th className="text-left py-3 px-4">ID</th>
                    <th className="text-left py-3 px-4">Bag</th>
                    <th className="text-left py-3 px-4">Threats</th>
                    <th className="text-center py-3 px-4">Objects</th>
                    <th className="text-right py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {layouts.map((layout, idx) => {
                    const objects = getObjects(layout);
                    const bagObj = objects.find(o => (o.library || "").toLowerCase().includes("bag"));
                    const threatObjs = objects.filter(o => (o.library || "").toLowerCase().includes("threat"));
                    const bagName = bagObj?.name || "—";
                    const threatNames = threatObjs.map(t => t.name).filter(Boolean).join(", ") || "—";

                    return (
                      <tr
                        key={layout.id}
                        onClick={() => setSelectedLayout(layout)}
                        className="cursor-pointer hover:bg-surface/50 transition-colors even:bg-surface/20"
                      >
                        <td className="py-3 px-4 text-sm font-mono text-muted">
                          {((pagination?.page || 1) - 1) * pageSize + idx + 1}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm font-mono text-accent-sky font-medium">{layout.id}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-ink">{bagName}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-rose-700">{threatNames}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-surface text-xs font-semibold text-muted border border-border">
                            {objects.length}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-xs text-muted">{new Date(layout.created_at).toLocaleDateString()}</span>
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
                         objects={getObjects(selectedLayout)} 
                         bagOrigin={selectedLayout.layout_json?.bagOrigin}
                       />
                     </div>
                   </div>

                   {/* Right: Annotation Details */}
                   <div className="min-h-0 overflow-y-auto p-5">
                     <div className="space-y-4">
                       {selectedLayout.layout_json?.objects?.length > 0 && (
                         <div>
                           <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Objects in Layout</h3>
                           <div className="space-y-2">
                             {selectedLayout.layout_json.objects.map((obj: any, idx: number) => {
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
                                     <span className="text-xs font-semibold text-ink">{obj.name}</span>
                                     <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                                       obj.library === "bag" ? "bg-blue-50 text-blue-700 border-blue-200" :
                                       obj.library === "threat" ? "bg-rose-50 text-rose-700 border-rose-200" :
                                       "bg-gray-50 text-gray-600 border-gray-200"
                                     }`}>
                                       {obj.library}
                                     </span>
                                   </div>
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
                                 </div>
                               );
                             })}
                           </div>
                         </div>
                       )}
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