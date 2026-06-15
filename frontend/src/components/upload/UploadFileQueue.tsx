import React, { useMemo, useState } from "react";
import type { TaxonomyCategory } from "../../types/library";
import ValidRegionEditor from "../ValidRegionEditor";
import { Trash2 } from "lucide-react";
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
    if (!editDraft?.category) return "bags";
    const normalized = normalizeCategoryName(editDraft.category);
    return LIBRARIES.some((lib) => lib.slug === editDraft.category) ? editDraft.category : normalized;
  }, [editDraft]);

  const selectedCategory = useMemo(() => {
    return LIBRARIES.find((lib) => lib.slug === selectedCategorySlug) || LIBRARIES[0];
  }, [selectedCategorySlug]);

  const subcategoryOptions = useMemo(() => {
    return getLibrarySubcategories(taxonomy, selectedCategory.slug);
  }, [taxonomy, selectedCategory]);

  const categoryOptions = useMemo(() => {
    return LIBRARIES;
  }, []);

  const handleCategoryChange = (categoryValue: string) => {
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
    try {
      const categorySlug = selectedCategory ? selectedCategory.slug : editDraft?.category;
      const subSlug = String(subcategoryValue).toLowerCase().replace(/\s+/g, "-");
      const res = await fetch(`http://localhost:8080/api/subcategories/${categorySlug}/${subSlug}`);
      const data = await res.json();
      if (data.ok && data.subcategory && data.subcategory.valid_region_points) {
        setEditDraft((d: any) => ({ ...d, valid_region_points: data.subcategory.valid_region_points }));
      }
    } catch (err) {
      // ignore fetch errors, leave editDraft as-is
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

  return (
    <div className="bg-panel rounded-2xl border border-border shadow-card overflow-hidden flex flex-col max-h-[560px]">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-nav flex-shrink-0">
        <span className="text-sm font-semibold text-ink">Staged Collage</span>
        <span className="bg-surface text-muted text-xs font-mono px-2.5 py-0.5 rounded-full border border-border">{staged.length}</span>
      </div>

      <ul className="divide-y divide-border overflow-y-auto flex-1">
        {staged.map((s, idx) => {
          const file = s.file as File;
          const preview = URL.createObjectURL(file);
          return (
            <li key={idx} className="px-5 py-3 hover:bg-surface transition-colors even:bg-surface/30">
              <div className="flex gap-3 items-start">
                <img src={preview} alt={file.name} className="w-20 h-20 object-contain bg-white border border-border rounded-lg" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-ink" title={file.name}>{file.name}</p>
                  <p className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <p className="text-xs mt-2"><strong>Category:</strong> {s.category} • <strong>Sub:</strong> {s.subcategory}</p>
                  <p className="text-xs"><strong>Name:</strong> {s.name}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <button onClick={() => openEdit(idx)} className="px-3 py-1 text-sm rounded-xl border border-border bg-surface">Edit</button>
                  <button onClick={() => removeIndex(idx)} className="px-3 py-1 text-sm rounded-xl border border-border text-rose-600">Remove</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="px-5 py-3.5 bg-nav border-t border-border flex-shrink-0">
        <button onClick={() => { setFiles([]); setStaged([]); }} className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted hover:bg-surface flex items-center gap-2">
          <Trash2 size={15} /> Clear All
        </button>
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
                  <option value="">Select category</option>
                  {categoryOptions.map((category) => (
                    <option key={category.slug} value={category.slug}>{category.name}</option>
                  ))}
                </select>
                <label className="text-xs text-muted mt-2 block">Subcategory</label>
                <select
                  className="w-full p-2 border border-border rounded mt-1"
                  value={editDraft.subcategory || ""}
                  onChange={(e) => handleSubcategoryChange(e.target.value)}
                >
                  <option value="">Select subcategory</option>
                  {subcategoryOptions.length > 0 ? (
                    subcategoryOptions.map((sub) => (
                      <option key={sub.slug} value={sub.name}>{sub.name}</option>
                    ))
                  ) : (
                    <option value="General">General</option>
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
