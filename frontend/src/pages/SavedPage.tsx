import React, { useEffect, useState } from "react";
import { Trash2, FolderOpen } from "lucide-react";

interface SavedLayout {
  id: string;
  name: string;
  filepath: string | null;
  layout_json: any;
  created_at: string;
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {layouts.map((layout) => (
            <div key={layout.id} className="rounded-3xl border border-border bg-panel p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-ink">{layout.name}</h2>
                  <p className="mt-1 text-xs text-muted">Saved {new Date(layout.created_at).toLocaleString()}</p>
                </div>
                <button
                  onClick={() => handleDelete(layout.id)}
                  className="text-rose-600 hover:text-rose-800 rounded-full p-2 transition-colors"
                  title="Delete layout"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-4 space-y-2 text-sm text-muted">
                <div className="rounded-2xl border border-border bg-surface p-3">Objects: {layout.layout_json?.objects?.length ?? 0}</div>
                <div className="rounded-2xl border border-border bg-surface p-3">Valid region: {layout.layout_json?.validRegionPolygon?.length ?? 0} points</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
