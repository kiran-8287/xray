import React, { useEffect, useState } from "react";
import { Trash2, FolderOpen, Grid3X3 } from "lucide-react";

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
}

export default function SavedPage() {
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const getImageUrl = (filepath: string): string => {
    return `http://localhost:8080/data/library_images/${filepath}`;
  };

  const getCategoryBadge = (library: string): { bg: string; text: string; border: string } => {
    const lower = (library || "").toLowerCase();
    if (lower === "bag" || lower === "bags") return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    if (lower === "threat" || lower === "threats") return { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" };
    return { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" };
  };

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
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {layouts.map((layout) => {
            const objects = getObjects(layout);
            const bagObj = objects.find((o: LayoutObject) => (o.library || "").toLowerCase() === "bag" || (o.library || "").toLowerCase() === "bags");
            const threatObjs = objects.filter((o: LayoutObject) => (o.library || "").toLowerCase() === "threat" || (o.library || "").toLowerCase() === "threats");
            const otherObjs = objects.filter((o: LayoutObject) => {
              const lib = (o.library || "").toLowerCase();
              return lib !== "bag" && lib !== "bags" && lib !== "threat" && lib !== "threats";
            });

            return (
              <div key={layout.id} className="rounded-3xl border border-border bg-panel shadow-sm overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
                {/* Image Preview Area */}
                <div className="bg-surface p-3 flex items-center justify-center h-44 overflow-hidden border-b border-border">
                  {bagObj ? (
                    <img
                      src={getImageUrl(bagObj.filepath)}
                      alt={bagObj.name || "Bag"}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted/40">
                      <Grid3X3 size={32} />
                      <span className="text-xs text-muted/30">No bag image</span>
                    </div>
                  )}
                </div>

                {/* Info Section */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold text-ink truncate" title={layout.name}>{layout.name}</h2>
                      <p className="mt-1 text-xs text-muted">Saved {new Date(layout.created_at).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(layout.id)}
                      className="text-rose-600 hover:text-rose-800 rounded-full p-2 transition-colors shrink-0"
                      title="Delete layout"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Object Thumbnails */}
                  <div className="mt-4 space-y-3">
                    {/* Bag badge */}
                    {bagObj && (
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-xl border border-border overflow-hidden bg-white shrink-0">
                          <img src={getImageUrl(bagObj.filepath)} alt={bagObj.name} className="w-full h-full object-contain" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-ink truncate">{bagObj.name || "Bag"}</p>
                          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${getCategoryBadge("bag").bg} ${getCategoryBadge("bag").text} ${getCategoryBadge("bag").border}`}>
                            Bag
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Threat thumbs */}
                    {threatObjs.map((obj: LayoutObject) => (
                      <div key={obj.id} className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-xl border border-border overflow-hidden bg-white shrink-0">
                          <img src={getImageUrl(obj.filepath)} alt={obj.name} className="w-full h-full object-contain" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-ink truncate">{obj.name || "Threat"}</p>
                          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${getCategoryBadge("threat").bg} ${getCategoryBadge("threat").text} ${getCategoryBadge("threat").border}`}>
                            Threat
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* Other items thumbs (max 3 shown) */}
                    {otherObjs.slice(0, 3).map((obj: LayoutObject) => (
                      <div key={obj.id} className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-xl border border-border overflow-hidden bg-white shrink-0">
                          <img src={getImageUrl(obj.filepath)} alt={obj.name} className="w-full h-full object-contain" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-ink truncate">{obj.name || "Item"}</p>
                          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${getCategoryBadge(obj.library).bg} ${getCategoryBadge(obj.library).text} ${getCategoryBadge(obj.library).border}`}>
                            {obj.library || "Other"}
                          </span>
                        </div>
                      </div>
                    ))}
                    {otherObjs.length > 3 && (
                      <p className="text-xs text-muted">+{otherObjs.length - 3} more items</p>
                    )}

                    {objects.length === 0 && (
                      <p className="text-xs text-muted italic">No objects in this layout</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
