import React, { useMemo, useState, useRef, useEffect } from "react";
import type { TaxonomyCategory } from "../../types/library";
import ValidRegionEditor from "../ValidRegionEditor";
import { Trash2, Edit3 } from "lucide-react";
import { LIBRARIES, getLibrarySubcategories, normalizeCategoryName } from "../../config/categories";

interface UploadFileQueueProps {
  files: File[];
  staged: any[];
  setStaged: (s: any[]) => void;
  setFiles: (files: File[]) => void;
  uploading: boolean;
  handleUpload: () => void;
  taxonomy: TaxonomyCategory[];
}

// Simple canvas component that draws the image + valid region overlay
function ThumbnailWithRegion({ src, validRegionPoints, alt }: { src: string; validRegionPoints: any; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Set canvas to 96x96 (match the w-24 h-24 class)
      canvas.width = 96;
      canvas.height = 96;
      ctx.clearRect(0, 0, 96, 96);
      ctx.drawImage(img, 0, 0, 96, 96);

      // Draw valid region overlay if points exist
      if (validRegionPoints) {
        let points: { x: number; y: number }[] = [];
        // Support both direct points array and { simplifiedPoints, shapes } format
        const raw = Array.isArray(validRegionPoints)
          ? validRegionPoints
          : validRegionPoints.simplifiedPoints || validRegionPoints.shapes?.[0]?.points || [];
        points = raw.map((p: any) => ({
          x: typeof p.x === "number" && p.x <= 1 ? p.x * 96 : p.x,
          y: typeof p.y === "number" && p.y <= 1 ? p.y * 96 : p.y,
        }));

        if (points.length >= 2) {
          ctx.save();
          ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 2]);
          ctx.fillStyle = "rgba(37, 99, 235, 0.25)";
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          if (points.length > 2) ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    };
    img.src = src;
  }, [src, validRegionPoints]);

  return (
    <canvas
      ref={canvasRef}
      className="w-24 h-24 object-contain bg-white border border-border rounded-lg"
      title={alt}
    />
  );
}

export default function UploadFileQueue({ files, staged, setStaged, setFiles, uploading, handleUpload, taxonomy }: UploadFileQueueProps) {
  if (files.length === 0) {
    return null;
  }

  // Modal/editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<any>(null);
  const [isValidRegionEditorOpen, setIsValidRegionEditorOpen] = useState(false);

  function openEdit(idx: number) {
    setEditingIndex(idx);
    setEditDraft({ ...staged[idx] });
  }

  function closeEdit(save = false) {
    if (save && editingIndex != null) {
      const copy = [...staged];
      copy[editingIndex] = editDraft;
      setStaged(copy);
    }
    setEditingIndex(null);
    setEditDraft(null);
    setIsValidRegionEditorOpen(false);
  }

  const selectedCategorySlug = useMemo(() => {
    if (!editDraft?.category) return "";
    const normalized = normalizeCategoryName(editDraft.category);
    return LIBRARIES.some((lib) => lib.slug === editDraft.category) ? editDraft.category : normalized;
  }, [editDraft]);

  const selectedCategory = useMemo(() => {
    if (!selectedCategorySlug) return null;
    return LIBRARIES.find((lib) => lib.slug === selectedCategorySlug) || LIBRARIES[0];
  }, [selectedCategorySlug]);

  const subcategoryOptions = useMemo(() => {
    if (!selectedCategory) return [];
    return getLibrarySubcategories(taxonomy, selectedCategory.slug);
  }, [taxonomy, selectedCategory]);

  const categoryOptions = useMemo(() => {
    return LIBRARIES;
  }, []);

  const handleCategoryChange = (categoryValue: string) => {
    if (!categoryValue) {
      setEditDraft({
        ...editDraft,
        category: "",
        subcategory: "",
      });
      return;
    }
    const subcategories = getLibrarySubcategories(taxonomy, categoryValue);
    setEditDraft({
      ...editDraft,
      category: categoryValue,
      subcategory: subcategories[0]?.name || "General",
    });
  };

  const handleSubcategoryChange = async (subcategoryValue: string) => {
    setEditDraft({ ...editDraft, subcategory: subcategoryValue });

    // Attempt to fetch canonical valid region for this subcategory
    if (!subcategoryValue || !selectedCategory) return;
    try {
      const categorySlug = selectedCategory.slug;
      const subSlug = String(subcategoryValue).toLowerCase().replace(/\s+/g, "-");
      const res = await fetch(`http://localhost:8080/api/subcategories/${categorySlug}/${subSlug}`);
      const data = await res.json();
      if (data.ok && data.subcategory && data.subcategory.valid_region_points) {
        setEditDraft((d: any) => ({ ...d, valid_region_points: data.subcategory.valid_region_points }));
      }
    } catch (err) {
      console.warn('Failed to fetch subcategory valid region', err);
    }
  };

  const handleValidRegionSave = (points: any, shapes?: any) => {
    setEditDraft({
      ...editDraft,
      valid_region_points: shapes ? { shapes, simplifiedPoints: points } : points,
    });
    setIsValidRegionEditorOpen(false);
  };

  function removeIndex(idx: number) {
    const copy = [...staged];
    copy.splice(idx, 1);
    setStaged(copy);
    // Also remove file from files list
    const filesCopy = [...files];
    filesCopy.splice(idx, 1);
    setFiles(filesCopy);
  }

  // Handle inline category dropdown change (for the row display)
  function handleInlineCategoryChange(idx: number, categoryValue: string) {
    const copy = [...staged];
    if (!categoryValue) {
      copy[idx] = { ...copy[idx], category: "", subcategory: "" };
    } else {
      const subcategories = getLibrarySubcategories(taxonomy, categoryValue);
      copy[idx] = {
        ...copy[idx],
        category: categoryValue,
        subcategory: subcategories[0]?.name || "General",
      };
    }
    setStaged(copy);
  }

  function handleInlineSubcategoryChange(idx: number, subcategoryValue: string) {
    const copy = [...staged];
    copy[idx] = { ...copy[idx], subcategory: subcategoryValue };
    setStaged(copy);
  }

  function getInlineSubcategoryOptions(categorySlug: string) {
    if (!categorySlug) return [];
    return getLibrarySubcategories(taxonomy, categorySlug);
  }

  const handleInlineValidRegion = (idx: number) => {
    setEditingIndex(idx);
    setEditDraft({ ...staged[idx] });
    setIsValidRegionEditorOpen(true);
  };

  return (
    <div className="bg-panel rounded-2xl border border-border shadow-card overflow-hidden flex flex-col">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-nav flex-shrink-0">
        <span className="text-sm font-semibold text-ink">Staged Items</span>
        <span className="bg-surface text-muted text-xs font-mono px-2.5 py-0.5 rounded-full border border-border">{staged.length}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max divide-y divide-border">
          <thead className="bg-surface/50">
            <tr className="text-xs font-semibold text-muted uppercase tracking-wider">
              <th className="text-left py-3 px-4 w-28">Image</th>
              <th className="text-left py-3 px-4">Category</th>
              <th className="text-left py-3 px-4">Subcategory</th>
              <th className="text-left py-3 px-4">Name</th>
              <th className="text-left py-3 px-4">Valid Region</th>
              <th className="text-right py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staged.map((s, idx) => {
              const file = s.file as File;
              const preview = URL.createObjectURL(file);
              const isBags = s.category === "bags";
              const inlineSubOptions = getInlineSubcategoryOptions(s.category);

              return (
                <tr key={idx} className="hover:bg-surface/50 transition-colors even:bg-surface/20">
                  <td className="py-3 px-4 align-top">
                    <ThumbnailWithRegion
                      src={preview}
                      validRegionPoints={s.valid_region_points}
                      alt={file.name}
                    />
                  </td>
                  <td className="py-3 px-4 align-top">
                    <select
                      className="w-36 p-1.5 border border-border rounded-lg text-xs bg-white"
                      value={s.category || ""}
                      onChange={(e) => handleInlineCategoryChange(idx, e.target.value)}
                      disabled={uploading}
                    >
                      <option value="">NONE</option>
                      {categoryOptions.map((cat) => (
                        <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 align-top">
                    <select
                      className="w-36 p-1.5 border border-border rounded-lg text-xs bg-white"
                      value={s.subcategory || ""}
                      onChange={(e) => handleInlineSubcategoryChange(idx, e.target.value)}
                      disabled={uploading || !s.category}
                    >
                      <option value="">NONE</option>
                      {inlineSubOptions.length > 0 ? (
                        inlineSubOptions.map((sub) => (
                          <option key={sub.slug} value={sub.name}>{sub.name}</option>
                        ))
                      ) : (
                        s.category ? <option value="General">General</option> : null
                      )}
                    </select>
                  </td>
                  <td className="py-3 px-4 align-top">
                    <span className="text-sm text-ink truncate block max-w-[200px]" title={file.name}>
                      {s.name || file.name}
                    </span>
                    <span className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                  </td>
                  <td className="py-3 px-4 align-top">
                    {isBags ? (
                      <button
                        type="button"
                        onClick={() => handleInlineValidRegion(idx)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface/80 transition-colors flex items-center gap-1"
                      >
                        <Edit3 size={12} />
                        {s.valid_region_points ? "Edit" : "Set"}
                      </button>
                    ) : (
                      <span className="text-xs text-muted/50">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right align-top">
                    <button
                      onClick={() => removeIndex(idx)}
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors"
                      title="Remove"
                      disabled={uploading}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 bg-nav border-t border-border flex-shrink-0 flex justify-between items-center">
        <button
          onClick={() => { setFiles([]); setStaged([]); }}
          className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted hover:bg-surface flex items-center gap-2"
        >
          <Trash2 size={15} /> Clear All
        </button>
        <span className="text-xs text-muted">{staged.length} item{staged.length !== 1 ? 's' : ''} staged</span>
      </div>

      {/* Edit Modal */}
      {editingIndex != null && editDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-[720px] max-w-full">
            <h3 className="text-lg font-semibold mb-4">Edit: {(editDraft.file as File).name}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <img src={URL.createObjectURL(editDraft.file)} alt={(editDraft.file as File).name} className="w-full h-56 object-contain bg-surface border border-border rounded" />
              </div>
              <div>
                <label className="text-xs text-muted">Category</label>
                <select
                  className="w-full p-2 border border-border rounded mt-1"
                  value={selectedCategory?.slug || editDraft.category || ""}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  <option value="">NONE</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                  ))}
                </select>
                <label className="text-xs text-muted mt-2 block">Subcategory</label>
                <select
                  className="w-full p-2 border border-border rounded mt-1"
                  value={editDraft.subcategory || ""}
                  onChange={(e) => handleSubcategoryChange(e.target.value)}
                >
                  <option value="">NONE</option>
                  {subcategoryOptions.length > 0 ? (
                    subcategoryOptions.map((sub) => (
                      <option key={sub.slug} value={sub.name}>{sub.name}</option>
                    ))
                  ) : (
                    editDraft.category ? <option value="General">General</option> : null
                  )}
                </select>
                <label className="text-xs text-muted mt-2 block">Item Name</label>
                <input className="w-full p-2 border border-border rounded mt-1" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                {selectedCategory?.slug === "bags" ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-muted">Valid Region</label>
                      <button
                        type="button"
                        onClick={() => setIsValidRegionEditorOpen(true)}
                        className="text-xs px-2 py-1 rounded-xl border border-border bg-surface hover:bg-surface/80"
                      >
                        Edit valid region
                      </button>
                    </div>
                    <textarea className="w-full p-2 border border-border rounded mt-2 h-28 font-mono text-xs" value={editDraft.valid_region_points ? JSON.stringify(editDraft.valid_region_points) : ""} readOnly />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => { setEditingIndex(null); setEditDraft(null); }} className="px-4 py-2 rounded-xl border">Cancel</button>
              <button onClick={() => { const copy = [...staged]; copy[editingIndex] = editDraft; setStaged(copy); setEditingIndex(null); setEditDraft(null); }} className="px-4 py-2 rounded-xl bg-accent text-white">Save</button>
            </div>
          </div>
        </div>
      )}
      {editingIndex != null && editDraft && isValidRegionEditorOpen && (
        <ValidRegionEditor
          imageSrc={URL.createObjectURL(editDraft.file)}
          initialPoints={editDraft.valid_region_points || []}
          itemId={(editDraft.file as File).name}
          onSave={(points, shapes) => handleValidRegionSave(points, shapes)}
          onCancel={() => setIsValidRegionEditorOpen(false)}
          onDelete={() => {
            setEditDraft({ ...editDraft, valid_region_points: null });
            setIsValidRegionEditorOpen(false);
          }}
        />
      )}
    </div>
  );
}