import React, { useMemo, useState, useRef, useEffect } from "react";
import ValidRegionEditor from "../ValidRegionEditor";
import { Trash2, Edit3, CheckSquare } from "lucide-react";
import { LIBRARIES, getLibrarySubcategories, normalizeCategoryName } from "../../config/categories";

interface UploadFileQueueProps {
  files: File[];
  staged: any[];
  setStaged: React.Dispatch<React.SetStateAction<any[]>>;
  setFiles: (files: File[]) => void;
  uploading: boolean;
  handleUpload: () => void;
  selectedForMass: Set<number>;
  onToggleSelect: (idx: number) => void;
  onSelectAll: () => void;
}

// Simple canvas component that draws the image + valid region overlay
function ThumbnailWithRegion({ src, validRegionPoints, alt }: { src: string; validRegionPoints: any; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Cleanup previous retry timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;

    const drawImage = (imageSrc: string) => {
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
          // Support both direct points array and { points, simplifiedPoints } format
          const raw = Array.isArray(validRegionPoints)
            ? validRegionPoints
            : validRegionPoints.simplifiedPoints || validRegionPoints.points || [];
          points = raw.map((p: any) => ({
            x: typeof p.x === "number" && p.x <= 1 ? p.x * 96 : p.x,
            y: typeof p.y === "number" && p.y <= 1 ? p.y * 96 : p.y,
          }));

          if (points.length >= 2) {
            ctx.save();
            ctx.strokeStyle = "rgba(22, 163, 74, 0.9)";
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 2]);
            ctx.fillStyle = "rgba(22, 163, 74, 0.25)";
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
      img.onerror = () => {
        // Retry with exponential backoff: 500ms, 1s, 2s, 4s, 8s (max 5 retries)
        if (retryCountRef.current < 5) {
          const delay = 500 * Math.pow(2, retryCountRef.current);
          retryCountRef.current += 1;
          retryTimerRef.current = window.setTimeout(() => {
            drawImage(imageSrc);
          }, delay);
        } else {
          // Give up — draw placeholder
          canvas.width = 96;
          canvas.height = 96;
          ctx.clearRect(0, 0, 96, 96);
          ctx.fillStyle = "#e5e7eb";
          ctx.fillRect(0, 0, 96, 96);
          ctx.fillStyle = "#9ca3af";
          ctx.font = "10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("loading...", 48, 52);
        }
      };
      img.src = imageSrc;
    };

    drawImage(src);

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [src, validRegionPoints]);

  return (
    <canvas
      ref={canvasRef}
      className="w-24 h-24 object-contain bg-white border border-border rounded-lg"
      title={alt}
    />
  );
}

export default function UploadFileQueue({ files, staged, setStaged, setFiles, uploading, handleUpload, selectedForMass, onToggleSelect, onSelectAll }: UploadFileQueueProps) {
  console.log(`[UploadFileQueue] render called. files=${files.length}, staged=${staged.length}`);
  if (files.length === 0) {
    console.log(`[UploadFileQueue] returning null because files.length === 0`);
    return null;
  }

  // Modal/editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<any>(null);
  const [isValidRegionEditorOpen, setIsValidRegionEditorOpen] = useState(false);

  // Mass assign state (for the top row dropdowns)
  const [massCategory, setMassCategory] = useState("");
  const [massSubcategory, setMassSubcategory] = useState("");

  const massSubcategoryOptions = useMemo(() => {
    if (!massCategory) return [];
    return getLibrarySubcategories(massCategory);
  }, [massCategory]);

  const handleMassApplyToAll = () => {
    if (!massCategory) return;
    setStaged((prev: any[]) =>
      prev.map((s: any) => ({
        ...s,
        category: massCategory,
        subcategory: massSubcategory,
      }))
    );
  };

  function openEdit(idx: number) {
  setEditingIndex(idx);
  const { name, ...rest } = staged[idx];
  setEditDraft(rest);
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
    return getLibrarySubcategories(selectedCategory.slug);
  }, [selectedCategory]);

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
    const subcategories = getLibrarySubcategories(categoryValue);
    setEditDraft({
      ...editDraft,
      category: categoryValue,
      subcategory: subcategories[0]?.name || "General",
    });
  };

  const handleSubcategoryChange = (subcategoryValue: string) => {
    setEditDraft({ ...editDraft, subcategory: subcategoryValue });
  };

  const handleValidRegionSave = (points: any) => {
    console.log('ValidRegionEditor returned points:', points);
    // Store in the format expected by backend: { points, simplifiedPoints }
    const regionData = {
      points: points,
      simplifiedPoints: points
    };
    setEditDraft({
      ...editDraft,
      valid_region_points: regionData,
    });
    // Immediately save to staged array
    if (editingIndex != null) {
      const copy = [...staged];
      copy[editingIndex] = {
        ...copy[editingIndex],
        valid_region_points: regionData,
      };
      setStaged(copy);
      console.log('Updated staged array:', copy);
    }
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
      const subcategories = getLibrarySubcategories(categoryValue);
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
    return getLibrarySubcategories(categorySlug);
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

      {/* Mass Assign Row - Category/Subcategory apply to all */}
      <div className="px-5 py-3 border-b border-border bg-surface/30 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted whitespace-nowrap">Mass Assign :</span>
        </div>
        <div className="flex flex-col gap-1">
          <select
            className="w-36 p-1.5 border border-border rounded-lg text-xs bg-white"
            value={massCategory}
            onChange={(e) => {
              setMassCategory(e.target.value);
              setMassSubcategory("");
            }}
          >
            <option value="">Category</option>
            {LIBRARIES.map((cat) => (
              <option key={cat.slug} value={cat.slug}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <select
            className="w-36 p-1.5 border border-border rounded-lg text-xs bg-white"
            value={massSubcategory}
            onChange={(e) => setMassSubcategory(e.target.value)}
            disabled={!massCategory}
          >
            <option value="">Subcategory</option>
            {massSubcategoryOptions.length > 0 ? (
              massSubcategoryOptions.map((sub: any) => (
                <option key={sub.slug} value={sub.name}>{sub.name}</option>
              ))
            ) : (
              massCategory ? <option value="General">General</option> : null
            )}
          </select>
        </div>
        <button
          onClick={handleMassApplyToAll}
          disabled={!massCategory}
          className="px-4 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center gap-1.5"
        >
          <CheckSquare size={14} />
          Apply to All
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max divide-y divide-border">
          <thead className="bg-surface/50">
            <tr className="text-xs font-semibold text-muted uppercase tracking-wider">
              <th className="text-left py-3 px-4 w-10">
                <input
                  type="checkbox"
                  checked={selectedForMass.size === staged.length && staged.length > 0}
                  onChange={onSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="text-left py-3 px-4 w-10">#</th>
              <th className="text-left py-3 px-4 w-28">Image</th>
              <th className="text-left py-3 px-4">Category</th>
              <th className="text-left py-3 px-4">Subcategory</th>
              
              <th className="text-left py-3 px-4">Valid Region</th>
              <th className="text-right py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staged.map((s, idx) => {
              const file = s.file as File;
              const preview = s.preProcessed
                ? `http://localhost:8080/data/library_images/${s.itemId}.png`
                : URL.createObjectURL(file);
              const isBags = s.category === "bags";
              const inlineSubOptions = getInlineSubcategoryOptions(s.category);

              return (
                <tr key={idx} className="hover:bg-surface/50 transition-colors even:bg-surface/20">
                  <td className="py-3 px-4 align-top">
                    <input
                      type="checkbox"
                      checked={selectedForMass.has(idx)}
                      onChange={() => onToggleSelect(idx)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="py-3 px-4 align-top text-sm font-mono text-muted">
                    {idx + 1}
                  </td>
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
                      disabled={uploading || (s.preProcessed && s.fileType === "dump")}
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
                      disabled={uploading || !s.category || (s.preProcessed && s.fileType === "dump")}
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
          onClick={() => {
            const selectedSet = new Set<number>();
            staged.forEach((_, idx) => {
              if (selectedForMass.has(idx)) selectedSet.add(idx);
            });
            if (selectedSet.size === 0) return;
            const newStaged = staged.filter((_, idx) => !selectedSet.has(idx));
            const newFiles = files.filter((_, idx) => !selectedSet.has(idx));
            setStaged(newStaged);
            setFiles(newFiles);
          }}
          disabled={selectedForMass.size === 0}
          className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 size={15} /> Delete Selected ({selectedForMass.size})
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
          initialPoints={
            editDraft.valid_region_points
              ? (Array.isArray(editDraft.valid_region_points)
                ? editDraft.valid_region_points
                : editDraft.valid_region_points.simplifiedPoints || editDraft.valid_region_points.points || [])
              : []
          }
          itemId={(editDraft.file as File).name}
          onSave={(points) => handleValidRegionSave(points)}
          onCancel={() => setIsValidRegionEditorOpen(false)}
          onDelete={() => {
            setEditDraft({ ...editDraft, valid_region_points: null });
            // Immediately save to staged array
            if (editingIndex != null) {
              const copy = [...staged];
              copy[editingIndex] = {
                ...copy[editingIndex],
                valid_region_points: null,
              };
              setStaged(copy);
            }
            setIsValidRegionEditorOpen(false);
          }}
        />
      )}
    </div>
  );
}