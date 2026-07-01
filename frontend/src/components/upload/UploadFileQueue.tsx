import React, { useMemo, useState, useRef, useEffect } from "react";
import ValidRegionEditor from "./ValidRegionEditor";
import { Trash2, Edit3, CheckSquare, Sparkles, Loader2, X } from "lucide-react";
import { LIBRARIES, getLibrarySubcategories, normalizeCategoryName, clearCustomSubcategoriesCache } from "../../config/categories";
import AddSubcategoryModal from "../common/AddSubcategoryModal";

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

// Custom scrollable dropdown component that shows max 8 items with scroll
function ScrollableSelect({ value, options, onChange, disabled, placeholder, onAddNew, category }: {
  value: string;
  options: { slug: string; name: string }[];
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onAddNew?: () => void;
  category?: string;
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

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { if (!disabled) setOpen(!open); }}
        className={`w-full p-1.5 border border-border rounded-lg text-xs bg-white cursor-pointer flex items-center justify-between gap-1 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-accent'}`}
      >
        <span className={value ? 'text-ink' : 'text-muted'}>{value || placeholder || 'Select...'}</span>
        <svg className={`w-3 h-3 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>
      {open && (
        <div className="absolute top-full mt-0.5 left-0 right-0 z-50 bg-white border border-border rounded-lg shadow-xl">
          <div className="max-h-[232px] overflow-y-auto">
            <div
              onClick={() => { onChange(''); setOpen(false); }}
              className={`p-1.5 text-xs cursor-pointer hover:bg-surface ${!value ? 'bg-accent/10 text-accent' : ''}`}
            >
              None
            </div>
            {options.map((opt) => (
              <div
                key={opt.slug}
                onClick={() => { onChange(opt.name); setOpen(false); }}
                className={`p-1.5 text-xs cursor-pointer hover:bg-surface ${value === opt.name ? 'bg-accent/10 text-accent' : ''}`}
              >
                {opt.name}
              </div>
            ))}
            {category && onAddNew && (
              <div
                onClick={() => { onAddNew(); setOpen(false); }}
                className="p-1.5 text-xs cursor-pointer text-accent font-medium hover:bg-surface border-t border-border"
              >
                + Add new
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
  
  // Auto-generate valid region state
  const [autoGeneratingIndices, setAutoGeneratingIndices] = useState<Set<number>>(new Set());
  
  // Mass auto-generate valid region state
  const [massAutoGen, setMassAutoGen] = useState<{ total: number; completed: number; running: boolean } | null>(null);

  // Add subcategory modal state
  const [isAddSubcategoryModalOpen, setIsAddSubcategoryModalOpen] = useState(false);
  const [addingSubcategoryFor, setAddingSubcategoryFor] = useState<string>("");

  // Tag selection state for inline editing
  const [activeTagRow, setActiveTagRow] = useState<number | null>(null);
  const tagSelectorRef = useRef<HTMLDivElement>(null);

  // Mass tag assignment state
  const [showMassTagSelector, setShowMassTagSelector] = useState(false);
  const [massSelectedTags, setMassSelectedTags] = useState<Set<string>>(new Set());
  const massTagSelectorRef = useRef<HTMLDivElement>(null);

  // Close mass tag selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (massTagSelectorRef.current && !massTagSelectorRef.current.contains(event.target as Node)) {
        setShowMassTagSelector(false);
      }
    };

    if (showMassTagSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMassTagSelector]);

  // Close tag selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagSelectorRef.current && !tagSelectorRef.current.contains(event.target as Node)) {
        setActiveTagRow(null);
      }
    };

    if (activeTagRow !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [activeTagRow]);

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

  const handleAutoGenerateRegion = async (idx: number) => {
    if (autoGeneratingIndices.has(idx)) return;
    
    const stagedItem = staged[idx];
    if (!stagedItem || stagedItem.category !== "bags") return;
    
    setAutoGeneratingIndices(prev => new Set(prev).add(idx));
    
    try {
      // Use the itemId to find the pixel data file (now .npz format)
      const pixelDataPath = `${stagedItem.itemId}.npz`;
      
      const res = await fetch(`http://localhost:8080/api/auto-valid-region`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: stagedItem.itemId,
          pixelDataPath: pixelDataPath
        }),
      });
      const data = await res.json();
      
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to auto-generate valid region");
      }
      
      // Update staged item with generated region
      const copy = [...staged];
      copy[idx] = {
        ...copy[idx],
        valid_region_points: {
          points: data.data.points,
          simplifiedPoints: data.data.points
        }
      };
      setStaged(copy);
      
      // Show success notification
      console.log(`Auto-generated valid region with ${data.data.points.length} points for item ${idx + 1}`);
    } catch (err) {
      console.error("Failed to auto-generate valid region:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      alert(`Auto-generation failed: ${msg}`);
    } finally {
      setAutoGeneratingIndices(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  };

  const handleMassAutoGenerateRegion = async () => {
    // Determine which indices to process:
    // - If items are selected (via checkboxes), use only those
    // - Otherwise, use all bag items
    let indicesToProcess: number[] = [];
    if (selectedForMass.size > 0) {
      indicesToProcess = [...selectedForMass].filter(idx => staged[idx]?.category === "bags");
    } else {
      indicesToProcess = staged
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => s.category === "bags")
        .map(({ idx }) => idx);
    }
    
    if (indicesToProcess.length === 0) {
      alert("No bag items found to auto-generate valid regions.");
      return;
    }
    
    setMassAutoGen({ total: indicesToProcess.length, completed: 0, running: true });
    
    let completedCount = 0;
    const failedItems: number[] = [];
    
    for (const idx of indicesToProcess) {
      setAutoGeneratingIndices(prev => new Set(prev).add(idx));
      
      const stagedItem = staged[idx];
      try {
        const pixelDataPath = `${stagedItem.itemId}.npz`;
        
        const res = await fetch(`http://localhost:8080/api/auto-valid-region`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: stagedItem.itemId,
            pixelDataPath: pixelDataPath
          }),
        });
        const data = await res.json();
        
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to auto-generate valid region");
        }
        
        // Update staged item with generated region using functional updater
        // to avoid stale closure issues when processing multiple items
        setStaged(prev => {
          const copy = [...prev];
          copy[idx] = {
            ...copy[idx],
            valid_region_points: {
              points: data.data.points,
              simplifiedPoints: data.data.points
            }
          };
          return copy;
        });
        
        completedCount++;
        setMassAutoGen({ total: indicesToProcess.length, completed: completedCount, running: true });
      } catch (err) {
        console.error(`Failed to auto-generate valid region for item ${idx + 1}:`, err);
        failedItems.push(idx);
        completedCount++;
        setMassAutoGen({ total: indicesToProcess.length, completed: completedCount, running: true });
      } finally {
        setAutoGeneratingIndices(prev => {
          const next = new Set(prev);
          next.delete(idx);
          return next;
        });
      }
    }
    
    setMassAutoGen({ total: indicesToProcess.length, completed: completedCount, running: false });
    
    if (failedItems.length > 0) {
      alert(`Mass auto-generation complete. ${completedCount - failedItems.length} succeeded, ${failedItems.length} failed.`);
    } else {
      console.log(`Mass auto-generation complete: ${completedCount} items processed successfully.`);
    }
  };

  const handleAddCustomSubcategory = async (name: string): Promise<void> => {
    if (!addingSubcategoryFor) return;
    
    const res = await fetch('/api/custom-subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: addingSubcategoryFor, name }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add subcategory');
    }
    
    // Clear cache to reload subcategories
    clearCustomSubcategoriesCache();
  };

  const openAddSubcategoryModal = (categorySlug: string) => {
    setAddingSubcategoryFor(categorySlug);
    setIsAddSubcategoryModalOpen(true);
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-nav flex-shrink-0">
        <span className="text-sm font-semibold text-ink">Staged Items</span>
        <span className="bg-surface text-muted text-xs font-mono px-2.5 py-0.5 rounded-full border border-border">{staged.length}</span>
      </div>

      {/* Mass Assign Row - Category/Subcategory apply to all */}
      <div className="px-5 py-3 border-b border-border bg-surface/30 flex items-center gap-4 overflow-visible">
        <span className="text-xs font-medium text-muted whitespace-nowrap">Mass Assign :</span>
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
        <div className="w-36">
          <ScrollableSelect
            value={massSubcategory}
            options={massSubcategoryOptions}
            onChange={(val) => setMassSubcategory(val)}
            disabled={!massCategory}
            placeholder="Subcategory"
            onAddNew={massCategory ? () => openAddSubcategoryModal(massCategory) : undefined}
            category={massCategory}
          />
        </div>
        <button
          onClick={handleMassApplyToAll}
          disabled={!massCategory}
          className="px-4 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <CheckSquare size={14} />
          Apply to All
        </button>
        
        <div className="flex-1" />

        {/* Mass Auto Generate Valid Region */}
        <button
          onClick={handleMassAutoGenerateRegion}
          disabled={massAutoGen?.running ?? false}
          className="px-4 py-1.5 rounded-xl bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          title="Auto-generate valid regions for all bag items (or selected ones)"
        >
          {massAutoGen?.running ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {massAutoGen?.running
            ? `Generating ${massAutoGen.completed}/${massAutoGen.total}...`
            : "Mass Auto Generate"}
        </button>

        {/* Mass Tag Assignment */}
        <div className="relative">
          <button
            onClick={() => {
              const hasBags = staged.some(s => s.category === "bags");
              if (hasBags) {
                setShowMassTagSelector(!showMassTagSelector);
              }
            }}
            disabled={!staged.some(s => s.category === "bags")}
            className="px-4 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            title="Assign tags to all bag items (or selected ones)"
          >
            <X size={14} />
            Mass Tags
          </button>
          
          {showMassTagSelector && (
            <div ref={massTagSelectorRef} className="absolute top-full mt-2 left-0 p-3 border border-border rounded-lg bg-white shadow-xl z-50 w-[400px]">
              <div className="text-xs font-semibold text-ink mb-2">Assign Tags to Bag Items</div>
              <div className="text-[10px] text-muted mb-2">Select tags to apply to all bag items (or selected items):</div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {LIBRARIES.find(l => l.slug === "non-threats")?.subcategories.map((sub) => {
                  const isSelected = massSelectedTags.has(sub.slug);
                  return (
                    <label
                      key={sub.slug}
                      className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs ${
                        isSelected
                          ? "bg-emerald-50 text-emerald-700"
                          : "hover:bg-surface"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          const newSet = new Set(massSelectedTags);
                          if (e.target.checked) {
                            newSet.add(sub.slug);
                          } else {
                            newSet.delete(sub.slug);
                          }
                          setMassSelectedTags(newSet);
                        }}
                        className="rounded border-gray-300"
                      />
                      <span>{sub.name}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    // Apply selected tags to all bag items (or selected ones)
                    const tagsToApply = Array.from(massSelectedTags);
                    if (tagsToApply.length === 0) {
                      alert("Please select at least one tag");
                      return;
                    }

                    // Determine which indices to update
                    let indicesToUpdate: number[] = [];
                    if (selectedForMass.size > 0) {
                      // Apply to selected items only
                      indicesToUpdate = [...selectedForMass].filter(idx => staged[idx]?.category === "bags");
                    } else {
                      // Apply to all bag items
                      indicesToUpdate = staged
                        .map((s, idx) => ({ s, idx }))
                        .filter(({ s }) => s.category === "bags")
                        .map(({ idx }) => idx);
                    }

                    if (indicesToUpdate.length === 0) {
                      alert("No bag items found to apply tags.");
                      return;
                    }

                    // Apply tags
                    const copy = [...staged];
                    indicesToUpdate.forEach(idx => {
                      copy[idx] = {
                        ...copy[idx],
                        tags: [...tagsToApply]
                      };
                    });
                    setStaged(copy);

                    // Close selector and reset
                    setShowMassTagSelector(false);
                    setMassSelectedTags(new Set());
                    
                    console.log(`Applied ${tagsToApply.length} tags to ${indicesToUpdate.length} bag items`);
                  }}
                  className="flex-1 px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:bg-accent/90"
                >
                  Apply to {selectedForMass.size > 0 ? `Selected (${selectedForMass.size})` : "All Bags"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMassTagSelector(false);
                    setMassSelectedTags(new Set());
                  }}
                  className="px-3 py-1.5 border border-border text-xs rounded-lg hover:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full divide-y divide-border">
          <thead className="bg-surface/50">
            <tr className="text-xs font-semibold text-muted uppercase tracking-wider">
              <th className="text-left py-3 px-3 w-12">
                <input
                  type="checkbox"
                  checked={selectedForMass.size === staged.length && staged.length > 0}
                  onChange={onSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="text-left py-3 px-3 w-12 text-center">#</th>
              <th className="text-left py-3 px-3 w-32">Image</th>
              <th className="text-left py-3 px-3">Category / Subcategory / Valid Region</th>
              <th className="text-right py-3 px-3 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staged.map((s, idx) => {
              const file = s.file as File;
              const preview = s.preProcessed
                ? `http://localhost:8080/data/library_images/${s.preGeneratedFilepath}`
                : URL.createObjectURL(file);
              const isBags = s.category === "bags";
              const inlineSubOptions = getInlineSubcategoryOptions(s.category);

              return (
                <tr key={idx} className="even:bg-surface/20">
                  <td className="py-3 px-3 align-top">
                    <input
                      type="checkbox"
                      checked={selectedForMass.has(idx)}
                      onChange={() => onToggleSelect(idx)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="py-3 px-3 align-top text-sm font-mono text-muted text-center">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-3 align-top">
                    <ThumbnailWithRegion
                      src={preview}
                      validRegionPoints={s.valid_region_points}
                      alt={file.name}
                    />
                  </td>
                  <td className="py-3 px-3 align-top">
                    <div className="space-y-2">
                      {/* First line: Category, Subcategory, Auto, Set buttons */}
                      <div className="flex items-center justify-between gap-4">
                        <select
                          className="w-32 p-1.5 border border-border rounded-lg text-xs bg-white"
                          value={s.category || ""}
                          onChange={(e) => handleInlineCategoryChange(idx, e.target.value)}
                          disabled={uploading}
                        >
                          <option value="">NONE</option>
                          {categoryOptions.map((cat) => (
                            <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                          ))}
                        </select>
                        <div className="w-40">
                          <ScrollableSelect
                            value={s.subcategory || ""}
                            options={inlineSubOptions}
                            onChange={(val) => handleInlineSubcategoryChange(idx, val)}
                            disabled={uploading || !s.category}
                            placeholder="NONE"
                            onAddNew={s.category ? () => openAddSubcategoryModal(s.category) : undefined}
                            category={s.category}
                          />
                        </div>
                        {isBags ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleAutoGenerateRegion(idx)}
                              disabled={autoGeneratingIndices.has(idx)}
                              className="text-xs px-3 py-1.5 rounded-lg border border-border bg-surface flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Auto-generate valid region from pixel data"
                            >
                              {autoGeneratingIndices.has(idx) ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Sparkles size={12} />
                              )}
                              Auto
                            </button>
                            <button
                              type="button"
                              onClick={() => handleInlineValidRegion(idx)}
                              className="text-xs px-3 py-1.5 rounded-lg border border-border bg-surface flex items-center gap-1.5"
                            >
                              <Edit3 size={12} />
                              {s.valid_region_points ? "Edit" : "Set"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted/50">—</span>
                        )}
                      </div>
                      
                      {/* Tags Section - Below the first line */}
                      {isBags && (
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTagRow(activeTagRow === idx ? null : idx);
                            }}
                            className="text-[11px] px-2 py-1 rounded border border-border bg-surface hover:bg-emerald-50 hover:border-emerald-300 flex items-center gap-1"
                          >
                            {s.tags && s.tags.length > 0 ? (
                              <>
                                <span className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                                  {s.tags.length}
                                </span>
                                <span className="text-emerald-700">Tags</span>
                              </>
                            ) : (
                              <span>+ Tags</span>
                            )}
                          </button>
                          
                          {activeTagRow === idx && (
                            <div ref={tagSelectorRef} className="mt-1 p-2 border border-border rounded-lg bg-white shadow-lg z-20 relative" style={{ maxHeight: "220px", overflowY: "auto" }}>
                              <div className="text-[10px] text-muted mb-1.5 font-medium sticky top-0 bg-white pb-1 z-10">Select non-threat items:</div>
                              <div className="space-y-0.5">
                                {LIBRARIES.find(l => l.slug === "non-threats")?.subcategories.map((sub) => {
                                  const isSelected = s.tags?.includes(sub.slug);
                                  return (
                                    <label
                                      key={sub.slug}
                                      className={`flex items-center gap-1.5 p-1 rounded cursor-pointer text-[11px] ${
                                        isSelected
                                          ? "bg-emerald-50 text-emerald-700"
                                          : "hover:bg-surface"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                          const copy = [...staged];
                                          const currentTags = copy[idx].tags || [];
                                          const newTags = e.target.checked
                                            ? [...currentTags, sub.slug]
                                            : currentTags.filter((t: string) => t !== sub.slug);
                                          copy[idx] = { ...copy[idx], tags: newTags };
                                          setStaged(copy);
                                        }}
                                        className="rounded border-gray-300"
                                      />
                                      <span>{sub.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={() => setActiveTagRow(null)}
                                className="mt-2 w-full px-2 py-1 bg-accent text-white text-[11px] rounded-lg hover:bg-accent/90"
                              >
                                Done
                              </button>
                            </div>
                          )}
                          
                          {s.tags && s.tags.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {s.tags.slice(0, 3).map((tagSlug: string) => {
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
                              {s.tags.length > 3 && (
                                <span className="text-[10px] text-muted">+{s.tags.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right align-top">
                    <button
                      onClick={() => removeIndex(idx)}
                      className="p-1.5 rounded-lg text-rose-500"
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
          className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-rose-600 flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
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
                <img
                  src={
                    editDraft.preProcessed
                      ? `http://localhost:8080/data/library_images/${editDraft.preGeneratedFilepath}`
                      : URL.createObjectURL(editDraft.file as File)
                  }
                  alt={(editDraft.file as File).name}
                  className="w-full h-56 object-contain bg-surface border border-border rounded"
                />
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
                  onChange={(e) => {
                    if (e.target.value === "__add_new__") {
                      openAddSubcategoryModal(selectedCategory?.slug || "");
                    } else {
                      handleSubcategoryChange(e.target.value);
                    }
                  }}
                >
                  <option value="">NONE</option>
                  {subcategoryOptions.length > 0 ? (
                    subcategoryOptions.map((sub) => (
                      <option key={sub.slug} value={sub.name}>{sub.name}</option>
                    ))
                  ) : (
                    editDraft.category ? <option value="General">General</option> : null
                  )}
                  {selectedCategory && (
                    <option value="__add_new__" className="text-accent font-medium">+ Add new subcategory</option>
                  )}
                </select>

                {selectedCategory?.slug === "bags" ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-muted">Valid Region</label>
                      <button
                        type="button"
                        onClick={() => setIsValidRegionEditorOpen(true)}
                        className="text-xs px-2 py-1 rounded-xl border border-border bg-surface"
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
          imageSrc={
            editDraft.preProcessed
              ? `http://localhost:8080/data/library_images/${editDraft.preGeneratedFilepath}`
              : URL.createObjectURL(editDraft.file as File)
          }
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
          onAutoGenerate={editDraft.category === "bags" ? () => handleAutoGenerateRegion(editingIndex!) : undefined}
          isAutoGenerating={editingIndex != null ? autoGeneratingIndices.has(editingIndex) : false}
        />
      )}

      {/* Add Subcategory Modal */}
      <AddSubcategoryModal
        isOpen={isAddSubcategoryModalOpen}
        onClose={() => setIsAddSubcategoryModalOpen(false)}
        onAdd={handleAddCustomSubcategory}
        categoryName={LIBRARIES.find(lib => lib.slug === addingSubcategoryFor)?.name || addingSubcategoryFor}
      />
    </div>
  );
}
