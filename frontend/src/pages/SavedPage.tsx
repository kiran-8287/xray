import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trash2, FolderOpen, Grid3X3, X } from "lucide-react";

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
}

const CANVAS_W = 800;
const CANVAS_H = 600;
const IMAGE_BASE_URL = "http://localhost:8080/data/library_images/";

function SavedLayoutPreview({ objects }: { objects: LayoutObject[] }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const sortedObjects = [...objects]
    .filter((obj) => obj.transform)
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

export default function SavedPage() {
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLayout, setSelectedLayout] = useState<SavedLayout | null>(null);
  const pageSize = 20;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedLayout(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    fetch("http://localhost:8080/api/saved-layouts")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setLayouts(data.layouts);
        } else {
          setError(data.error || "Failed to load layouts");
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this saved layout?")) return;
    const response = await fetch(`http://localhost:8080/api/saved-layouts/${id}`, { method: "DELETE" });
    if (response.ok) {
      setLayouts(layouts.filter((layout) => layout.id !== id));
    }
  };

  const getObjects = (layout: SavedLayout): LayoutObject[] => {
    try {
      return layout.layout_json?.objects || [];
    } catch {
      return [];
    }
  };

  const getImageUrl = (filepath: string): string => `${IMAGE_BASE_URL}${filepath}`;

  const getCategoryBadge = (library: string): { bg: string; text: string; border: string } => {
    const lower = (library || "").toLowerCase();
    if (lower === "bag" || lower === "bags") return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    if (lower === "threat" || lower === "threats") return { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" };
    return { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" };
  };

  const totalPages = Math.max(1, Math.ceil(layouts.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedLayouts = layouts.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted">Saved Workspaces</p>
          <h1 className="text-3xl font-semibold text-ink">Saved Layouts</h1>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
          <FolderOpen size={18} />
          {layouts.length} layouts
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted">Loading saved layouts...</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">{error}</div>
      ) : layouts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted">No saved layouts yet.</div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Showing {((safeCurrentPage - 1) * pageSize) + 1}-{Math.min(safeCurrentPage * pageSize, layouts.length)} of {layouts.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCurrentPage === 1}
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-sm text-muted">
                Page {safeCurrentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={safeCurrentPage === totalPages}
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {pagedLayouts.map((layout) => {
            const objects = getObjects(layout);
            const bagCount = objects.filter((o: LayoutObject) => (o.library || "").toLowerCase().includes("bag")).length;
            const threatCount = objects.filter((o: LayoutObject) => (o.library || "").toLowerCase().includes("threat")).length;
            const otherCount = Math.max(0, objects.length - bagCount - threatCount);

            return (
              <div
                key={layout.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedLayout(layout)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedLayout(layout);
                  }
                }}
                className="rounded-3xl border border-border bg-panel shadow-sm overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 min-w-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {/* Image Preview Area */}
                <div className="bg-surface p-4 flex items-center justify-center h-64 sm:h-72 overflow-hidden border-b border-border">
                  <div className="w-full h-full rounded-2xl overflow-hidden border border-border bg-white">
                    <SavedLayoutPreview objects={objects} />
                  </div>
                </div>

                {/* Info Section */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold text-ink truncate" title={layout.name}>{layout.name}</h2>
                      <p className="mt-1 text-xs text-muted">Saved {new Date(layout.created_at).toLocaleString()}</p>
                      <p className="mt-2 text-xs text-muted">
                        {objects.length} objects · {bagCount} bag{bagCount !== 1 ? "s" : ""} · {threatCount} threat{threatCount !== 1 ? "s" : ""} · {otherCount} other
                      </p>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(layout.id);
                      }}
                      className="text-rose-600 hover:text-rose-800 rounded-full p-2 transition-colors shrink-0"
                      title="Delete layout"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          </div>

          {selectedLayout && (
            <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedLayout(null)}>
              <div
                className="w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-3xl border border-border bg-panel shadow-2xl flex flex-col"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-4 border-b border-border bg-nav px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-ink">{selectedLayout.name}</h2>
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
                  <div className="min-h-0 border-b border-border bg-surface p-4 lg:border-b-0 lg:border-r">
                    <div className="h-full rounded-2xl overflow-hidden border border-border bg-white">
                      <SavedLayoutPreview objects={getObjects(selectedLayout)} />
                    </div>
                  </div>

                  <div className="min-h-0 overflow-y-auto p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-border bg-white p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted">Objects</p>
                        <p className="mt-1 text-sm font-semibold text-ink">{getObjects(selectedLayout).length}</p>
                      </div>
                      <div className="rounded-2xl border border-border bg-white p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted">Created</p>
                        <p className="mt-1 text-sm font-semibold text-ink">{new Date(selectedLayout.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {getObjects(selectedLayout).map((obj: LayoutObject) => {
                        const transform = obj.transform;
                        const isBag = (obj.library || "").toLowerCase().includes("bag");
                        const isThreat = (obj.library || "").toLowerCase().includes("threat");
                        const badge = getCategoryBadge(obj.library);

                        return (
                          <div key={obj.id} className="rounded-2xl border border-border bg-white p-3">
                            <div className="flex items-start gap-3">
                              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border bg-surface">
                                <img src={getImageUrl(obj.filepath)} alt={obj.name} className="h-full w-full object-contain" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-ink">{obj.name || "Unnamed object"}</p>
                                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text} ${badge.border}`}>
                                    {isBag ? "Bag" : isThreat ? "Threat" : obj.library || "Other"}
                                  </span>
                                </div>
                                <p className="mt-1 break-all text-xs text-muted">{obj.filepath}</p>
                                {transform && (
                                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted">
                                    <span>X: {Math.round(transform.x)}</span>
                                    <span>Y: {Math.round(transform.y)}</span>
                                    <span>W: {Math.round(transform.width)}</span>
                                    <span>H: {Math.round(transform.height)}</span>
                                    <span>Rot: {Math.round(transform.rotation)}°</span>
                                    <span>Layer: {obj.layer ?? 0}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
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
