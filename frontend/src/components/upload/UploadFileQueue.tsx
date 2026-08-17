import React, { useMemo, useState, useRef, useEffect } from "react";
import ValidRegionEditor from "./ValidRegionEditor";
import { Trash2, Edit3, CheckSquare, Sparkles, Loader2, X, Plus, Minus } from "lucide-react";
import { LIBRARIES, getLibrarySubcategories, normalizeCategoryName, clearCustomSubcategoriesCache, refreshCustomSubcategories, findDuplicateSubcategory } from "../../config/categories";
import { API_BASE_URL } from "../../config/api";
import { escapeAttribute, sanitizeTag } from "../../lib/sanitize";
import AddSubcategoryModal from "../common/AddSubcategoryModal";
import ConfirmModal from "../common/ConfirmModal";
import { concurrencyController } from "../../lib/concurrencyController";

interface UploadFileQueueProps {
  files: File[];
  staged: any[];
  setStaged: React.Dispatch<React.SetStateAction<any[]>>;
  setFiles: (files: File[]) => void;
  uploading: boolean;
  processing?: boolean;
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
            {category && onAddNew && (
              <div
                onClick={() => { onAddNew(); setOpen(false); }}
                className="p-1.5 text-xs cursor-pointer text-accent font-medium hover:bg-surface border-b border-border"
              >
                + Add new
              </div>
            )}
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
          </div>
        </div>
      )}
    </div>
  );
}

export default function UploadFileQueue({ files, staged, setStaged, setFiles, uploading, processing = false, handleUpload, selectedForMass, onToggleSelect, onSelectAll }: UploadFileQueueProps) {
  console.log(`[UploadFileQueue] render called. files=${files.length}, staged=${staged.length}`);
  if (staged.length === 0) {
    console.log(`[UploadFileQueue] returning null because staged.length === 0`);
    return null;
  }

  const handleToggleSelect = (idx: number) => onToggleSelect(idx);

  const removeIndex = (idx: number) => {
    const copy = [...staged];
    const removedItem = copy[idx];
    copy.splice(idx, 1);
    setStaged(copy);

    const filesCopy = [...files];
    if (removedItem && (removedItem.file || removedItem.itemId)) {
      const targetName = removedItem.file?.name || removedItem.itemId;
      const idxInFiles = filesCopy.findIndex(
        (f) => f.name === targetName || f === removedItem.file
      );
      if (idxInFiles !== -1) {
        filesCopy.splice(idxInFiles, 1);
      }
    }
    setFiles(filesCopy);
  };

  const handleInlineValidRegion = (idx: number) => {
    setEditingIndex(idx);
    setEditDraft({ ...staged[idx] });
    setIsValidRegionEditorOpen(true);
  };

  const handleInlineCategoryChange = (idx: number, categoryValue: string) => {
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
  };

  const handleInlineSubcategoryChange = (idx: number, subcategoryValue: string) => {
    const copy = [...staged];
    copy[idx] = { ...copy[idx], subcategory: subcategoryValue };
    setStaged(copy);
  };

  const handleAutoGenerateRegionPage = (idx: number) => {
    handleAutoGenerateRegion(idx);
  };

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

  // Revision counter bumped every time the custom subcategories list is mutated
  // (add/remove). useMemo hooks that compute subcategory options depend on this
  // counter to guarantee they recompute against the freshly-refreshed cache.
  const [subcategoriesRev, setSubcategoriesRev] = useState<number>(0);

  // Tag selection state for inline editing
  const [activeTagRow, setActiveTagRow] = useState<number | null>(null);
  const tagSelectorRef = useRef<HTMLDivElement>(null);

  // Image preview modal state
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>("");
  const [previewIndex, setPreviewIndex] = useState<number>(-1);

  // Close preview on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewImage) {
        setPreviewImage(null);
      }
    };

    if (previewImage) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [previewImage]);

  // Mass tag assignment state
  const [showMassTagSelector, setShowMassTagSelector] = useState(false);
  const [massTagMode, setMassTagMode] = useState<"add" | "remove">("add");
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

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: "danger" | "primary";
    onConfirm?: () => void;
  }>({ isOpen: false, title: "", message: "" });

  const massSubcategoryOptions = useMemo(() => {
    if (!massCategory) return [];
    return getLibrarySubcategories(massCategory);
  }, [massCategory, subcategoriesRev]);

  const handleMassApplyToAll = () => {
    if (!massCategory) return;

    // Matches Mass Tags / Mass Auto-Gen scope rules:
    // - If items are selected via checkboxes (selectedForMass non-empty), only touch those.
    // - Otherwise, touch every staged item.
    let indices: number[];
    if (selectedForMass.size > 0) {
      indices = [...selectedForMass].filter(idx => idx >= 0 && idx < staged.length);
    } else {
      indices = staged.map((_, idx) => idx);
    }

    const targetIsBags = massCategory === "bags";

    setStaged((prev: any[]) => {
      const copy = [...prev];
      for (const idx of indices) {
        const s = copy[idx];
        if (!s) continue;

        const wasBags = s.category === "bags";

        // Assemble the new category payload
        const next: any = {
          ...s,
          category: massCategory,
          subcategory: massSubcategory || s.subcategory,
        };

        // -----------------------------------------------------------------
        // Category changed FROM "bags" → anything else:
        //   1. Valid regions are a bags-only concept. Strip them to prevent
        //      stale polygon overlays and unnecessary backend data.
        //   2. Also clean up any in-flight spinner state for this idx so
        //      the row stops showing "Generating valid region…" forever.
        // -----------------------------------------------------------------
        if (wasBags && !targetIsBags) {
          if (next.valid_region_points) {
            delete next.valid_region_points;
          }
          setAutoGeneratingIndices(prevSet => {
            if (!prevSet.has(idx)) return prevSet;
            const nextSet = new Set(prevSet);
            nextSet.delete(idx);
            return nextSet;
          });
        }

        copy[idx] = next;
      }
      return copy;
    });
  };

  function openEdit(idx: number) {
  setEditingIndex(idx);
  const { name, ...rest } = staged[idx];
  setEditDraft(rest);
}

  function closeEdit(save = false) {
    if (save && editingIndex != null) {
      // Compare final draft category vs the PREVIOUS category that was in
      // staged. If the draft moved it away from bags but somehow still has
      // valid_region_points attached (in case handleCategoryChange was
      // bypassed via setEditDraft direct manipulation elsewhere), strip it
      // and clean spinner state defensively here.
      const prev = staged[editingIndex];
      const prevCategory = normalizeCategoryName(prev?.category || "");
      const draftCategory = normalizeCategoryName(editDraft?.category || "");

      const isBags = (name: string) => name === "bags";

      let finalDraft: any = editDraft;
      if (isBags(prevCategory) && !isBags(draftCategory)) {
        if (editDraft?.valid_region_points) {
          finalDraft = { ...editDraft };
          delete finalDraft.valid_region_points;
        }
        setAutoGeneratingIndices(prevSet => {
          if (!prevSet.has(editingIndex)) return prevSet;
          const nextSet = new Set(prevSet);
          nextSet.delete(editingIndex);
          return nextSet;
        });
      }
      const copy = [...staged];
      copy[editingIndex] = finalDraft;
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
  }, [selectedCategory, subcategoriesRev]);

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
    const wasBags = normalizeCategoryName(editDraft?.category || "") === "bags";
    const isNowBags = normalizeCategoryName(categoryValue) === "bags";
    const subcategories = getLibrarySubcategories(categoryValue);

    const nextDraft: any = {
      ...editDraft,
      category: categoryValue,
      subcategory: subcategories[0]?.name || "General",
    };

    // Category flipped FROM "bags" → something else: bags-only fields are no
    // longer meaningful. Drop valid_region_points (overlay + backend storage)
    // and abort any in-flight auto-gen so the row spinner doesn't hang.
    if (wasBags && !isNowBags) {
      if (nextDraft.valid_region_points) {
        delete nextDraft.valid_region_points;
      }
      if (editingIndex != null) {
        setAutoGeneratingIndices(prevSet => {
          if (!prevSet.has(editingIndex)) return prevSet;
          const nextSet = new Set(prevSet);
          nextSet.delete(editingIndex);
          return nextSet;
        });
      }
    }

    setEditDraft(nextDraft);
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

  // getInlineSubcategoryOptions - uses staged directly (no page/local concept needed)
  function getInlineSubcategoryOptions(categorySlug: string) {
    if (!categorySlug) return [];
    return getLibrarySubcategories(categorySlug);
  }

  const handleAutoGenerateRegion = async (idx: number) => {
    if (autoGeneratingIndices.has(idx)) return;
    
    const stagedItem = staged[idx];
    if (!stagedItem || stagedItem.category !== "bags") return;
    
    setAutoGeneratingIndices(prev => new Set(prev).add(idx));
    
    try {
      // Use the pixelDataFilename from the staged item (includes highenrgy/ prefix)
      const pixelDataPath = stagedItem.pixelDataFilename || `${stagedItem.itemId}.npz`;
      
      const res = await fetch(`${API_BASE_URL}/api/auto-valid-region`, {
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
      
      // Re-verify category at write-back time: user may have flipped this item
      // from bags → threats/non-threats while the Python endpoint was running.
      // If so, drop the region points (valid regions are bags-only) and clean
      // the in-flight spinner state immediately.
      setStaged(prev => {
        const copy = [...prev];
        const current = copy[idx];
        if (!current || current.category !== "bags") {
          if (current && current.valid_region_points) {
            copy[idx] = { ...current };
            delete copy[idx].valid_region_points;
          }
          // Also kill the spinner here for this idx (the finally block also
          // does it, but doing it inside setStaged avoids a 1-frame race)
          setAutoGeneratingIndices(prevSet => {
            if (!prevSet.has(idx)) return prevSet;
            const nextSet = new Set(prevSet);
            nextSet.delete(idx);
            return nextSet;
          });
          return copy;
        }
        copy[idx] = {
          ...copy[idx],
          valid_region_points: {
            points: data.data.points,
            simplifiedPoints: data.data.points
          }
        };
        return copy;
      });
      
      // Show success notification
      console.log(`Auto-generated valid region with ${data.data.points.length} points for item ${idx + 1}`);
    } catch (err) {
      console.error("Failed to auto-generate valid region:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setConfirmDialog({
        isOpen: true,
        title: "Auto-generation Failed",
        message: msg,
        confirmLabel: "OK",
        confirmVariant: "primary",
        onConfirm: () => setConfirmDialog({ isOpen: false, title: "", message: "" }),
      });
    } finally {
      setAutoGeneratingIndices(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  };

  const handleMassAutoGenerateRegion = async () => {
    // -------------------------------------------------------------------------
    // PREPASS: Any staged item whose category is NOT "bags" but still carries
    // valid_region_points (leftover from user who e.g. mis-categorized a tip
    // file as "bags", auto-generated its region, then flipped it back to
    // threats/non-threats) gets the stale field removed here AND any in-flight
    // generating state cleaned up for those indices. This keeps the canvas
    // overlay and the backend payloads clean at generator-start.
    // -------------------------------------------------------------------------
    setStaged(prev => {
      let mutated = false;
      let copy: any[] | null = null;
      const staleInFlightIdx: number[] = [];

      for (let i = 0; i < prev.length; i++) {
        const s = prev[i];
        if (!s) continue;
        if (s.category !== "bags" && s.valid_region_points) {
          if (!copy) { copy = [...prev]; }
          copy[i] = { ...s };
          delete copy[i].valid_region_points;
          mutated = true;
          staleInFlightIdx.push(i);
        }
      }
      if (staleInFlightIdx.length > 0) {
        setAutoGeneratingIndices(prevSet => {
          let nextSet: Set<number> | null = null;
          for (const idx of staleInFlightIdx) {
            if (prevSet.has(idx)) {
              if (!nextSet) nextSet = new Set(prevSet);
              nextSet.delete(idx);
            }
          }
          return nextSet ?? prevSet;
        });
      }
      return mutated ? copy! : prev;
    });

    // Determine which indices to process:
    // - If items are selected (via checkboxes), use only those
    // - Otherwise, use all bag items
    // - Skip items that already have a valid region
    let indicesToProcess: number[] = [];
    let skippedCount = 0;
    
    // Helper: check if item has a valid region (points array with at least 2 items)
    function hasValidRegion(s: any): boolean {
      if (!s.valid_region_points) return false;
      const raw = Array.isArray(s.valid_region_points)
        ? s.valid_region_points
        : s.valid_region_points.simplifiedPoints || s.valid_region_points.points || [];
      return Array.isArray(raw) && raw.length >= 2;
    }
    
    if (selectedForMass.size > 0) {
      indicesToProcess = [...selectedForMass].filter(idx => {
        const s = staged[idx];
        if (s?.category !== "bags") return false;
        if (hasValidRegion(s)) { skippedCount++; return false; }
        return true;
      });
    } else {
      indicesToProcess = staged
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => {
          if (s.category !== "bags") return false;
          if (hasValidRegion(s)) { skippedCount++; return false; }
          return true;
        })
        .map(({ idx }) => idx);
    }
    
    if (indicesToProcess.length === 0) {
      const totalBags = staged.filter(s => s.category === "bags").length;
      if (skippedCount > 0 && skippedCount === totalBags) {
        setConfirmDialog({
          isOpen: true,
          title: "Nothing to Generate",
          message: `All ${totalBags} bag items already have valid regions. Nothing to generate.`,
          confirmLabel: "OK",
          confirmVariant: "primary",
          onConfirm: () => setConfirmDialog({ isOpen: false, title: "", message: "" }),
        });
      } else {
        setConfirmDialog({
          isOpen: true,
          title: "Nothing to Generate",
          message: "No bag items found to auto-generate valid regions.",
          confirmLabel: "OK",
          confirmVariant: "primary",
          onConfirm: () => setConfirmDialog({ isOpen: false, title: "", message: "" }),
        });
      }
      return;
    }
    
    const total = indicesToProcess.length;
    setMassAutoGen({ total, completed: 0, running: true });
    
    // Mark all as generating in one batch
    setAutoGeneratingIndices(prev => {
      const next = new Set(prev);
      indicesToProcess.forEach(idx => next.add(idx));
      return next;
    });
    
    let completedCount = 0;
    const UI_BATCH_SIZE = 10; // Update UI every 10 completed items
    
    // Snapshot staged once to avoid stale closure issues
    const queue = indicesToProcess.map(idx => ({ idx, stagedItem: staged[idx] }));
    
    // Collect results and apply them in batches
    const pendingResults: { idx: number; points: any; success: boolean }[] = [];
    
    // Process items in smaller batches to prevent overwhelming Python subprocesses
    // Each batch item spawns a separate Python process, so smaller batches = less memory contention
    const BATCH_SIZE = 5; // Process 5 items per batch request - reduced from 20
    const batches: { idx: number; stagedItem: any }[][] = [];
    
    // Split queue into batches
    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
      batches.push(queue.slice(i, i + BATCH_SIZE));
    }
    
    async function processBatch(batch: { idx: number; stagedItem: any }[]): Promise<void> {
      // Execute through concurrency controller to limit parallel requests
      return await concurrencyController.execute('auto-generate', async () => {
        try {
          const items = batch.map(task => ({
            itemId: task.stagedItem.itemId,
            pixelDataPath: task.stagedItem.pixelDataFilename || `${task.stagedItem.itemId}.npz`
          }));
          
          const res = await fetch(`${API_BASE_URL}/api/auto-valid-region-batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
          });
          const data = await res.json();
          
          if (!res.ok || !data.ok) {
            throw new Error(data.error || "Failed to auto-generate valid regions");
          }
          
          // Process results
          if (data.results && Array.isArray(data.results)) {
            const batchResults: { idx: number; points: any; success: boolean }[] = [];
            
            for (let i = 0; i < batch.length; i++) {
              const task = batch[i];
              const result = data.results[i];
              
              if (result && result.ok && result.data) {
                batchResults.push({
                  idx: task.idx,
                  points: result.data.points,
                  success: true
                });
              } else {
                batchResults.push({
                  idx: task.idx,
                  points: null,
                  success: false
                });
              }
              completedCount++;
            }
            
            // Add to pending results
            pendingResults.push(...batchResults);
            
            // Flush results periodically
            if (completedCount % UI_BATCH_SIZE === 0 || completedCount === total) {
              const resultsToFlush = pendingResults.splice(0, pendingResults.length);
              setStaged(prev => {
                const copy = [...prev];
                const categoryFlippedIdx: number[] = [];
                for (const r of resultsToFlush) {
                  const current = copy[r.idx];
                  if (!r.success || !current) continue;
                  // Re-verify category at write-back time: if user flipped this
                  // item from bags → threats/non-threats mid-generation, the
                  // valid region is no longer meaningful. Drop the in-flight
                  // points and track the idx so we can clean up its spinner.
                  if (current.category !== "bags") {
                    if (current.valid_region_points) {
                      copy[r.idx] = { ...current };
                      delete copy[r.idx].valid_region_points;
                    }
                    categoryFlippedIdx.push(r.idx);
                    continue;
                  }
                  copy[r.idx] = {
                    ...copy[r.idx],
                    valid_region_points: {
                      points: r.points,
                      simplifiedPoints: r.points
                    }
                  };
                }
                if (categoryFlippedIdx.length > 0) {
                  setAutoGeneratingIndices(prevSet => {
                    let nextSet: Set<number> | null = null;
                    for (const idx of categoryFlippedIdx) {
                      if (prevSet.has(idx)) {
                        if (!nextSet) nextSet = new Set(prevSet);
                        nextSet.delete(idx);
                      }
                    }
                    return nextSet ?? prevSet;
                  });
                }
                return copy;
              });
              setMassAutoGen({ total, completed: completedCount, running: completedCount < total });
            }
          }
        } catch (err) {
          console.error(`Failed to auto-generate batch:`, err);
          
          // Mark all items in batch as failed
          for (const task of batch) {
            pendingResults.push({ idx: task.idx, points: null, success: false });
            completedCount++;
          }
          
          // Flush results
          if (completedCount % UI_BATCH_SIZE === 0 || completedCount === total) {
            const resultsToFlush = pendingResults.splice(0, pendingResults.length);
            setStaged(prev => {
              const copy = [...prev];
              for (const r of resultsToFlush) {
                if (r.success) {
                  copy[r.idx] = {
                    ...copy[r.idx],
                    valid_region_points: {
                      points: r.points,
                      simplifiedPoints: r.points
                    }
                  };
                }
              }
              return copy;
            });
            setMassAutoGen({ total, completed: completedCount, running: completedCount < total });
          }
        }
      });
    }
    
    // Process batches sequentially through the concurrency controller
    // The controller will limit parallelism to x/4 (1 when processing, 2 when idle)
    for (const batch of batches) {
      await processBatch(batch);
    }
    
    // Flush any remaining results
    if (pendingResults.length > 0) {
      const batch = pendingResults.splice(0, pendingResults.length);
      setStaged(prev => {
        const copy = [...prev];
        const categoryFlippedIdx: number[] = [];
        for (const r of batch) {
          const current = copy[r.idx];
          if (!r.success || !current) continue;
          if (current.category !== "bags") {
            if (current.valid_region_points) {
              copy[r.idx] = { ...current };
              delete copy[r.idx].valid_region_points;
            }
            categoryFlippedIdx.push(r.idx);
            continue;
          }
          copy[r.idx] = {
            ...copy[r.idx],
            valid_region_points: {
              points: r.points,
              simplifiedPoints: r.points
            }
          };
        }
        if (categoryFlippedIdx.length > 0) {
          setAutoGeneratingIndices(prevSet => {
            let nextSet: Set<number> | null = null;
            for (const idx of categoryFlippedIdx) {
              if (prevSet.has(idx)) {
                if (!nextSet) nextSet = new Set(prevSet);
                nextSet.delete(idx);
              }
            }
            return nextSet ?? prevSet;
          });
        }
        return copy;
      });
    }
    
    // Clear generating indicators all at once
    setAutoGeneratingIndices(prev => {
      const next = new Set(prev);
      indicesToProcess.forEach(idx => next.delete(idx));
      return next;
    });
    
    setMassAutoGen({ total, completed: completedCount, running: false });
    
    // Summary: show skipped + succeeded + failed counts
    const failedCount = total - completedCount;
    const succeeded = completedCount - failedCount;
    if (skippedCount > 0) {
      console.log(`Mass auto-generation: ${succeeded} succeeded, ${failedCount} failed, ${skippedCount} skipped (already had valid region).`);
    }
    
    if (failedCount > 0) {
      setConfirmDialog({
        isOpen: true,
        title: "Mass Auto-generation Complete",
        message: `${succeeded} succeeded, ${failedCount} failed${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}.`,
        confirmLabel: "OK",
        confirmVariant: "primary",
        onConfirm: () => setConfirmDialog({ isOpen: false, title: "", message: "" }),
      });
    } else {
      console.log(`Mass auto-generation complete: ${completedCount} items processed successfully${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}.`);
    }
  };

  const handleAddCustomSubcategory = async (name: string): Promise<void> => {
    if (!addingSubcategoryFor) return;

    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      throw new Error("Subcategory name is required");
    }

    // ---- Frontend duplicate pre-check with same normalization as backend ----
    // Avoids a round-trip for known-duplicate cases and catches the same
    // fuzziness ("School Bag" / "school bag" / "SchoolBag" / "school-bag").
    const dup = findDuplicateSubcategory(addingSubcategoryFor, trimmedName);
    if (dup) {
      const where = dup.kind === "built-in" ? "built-in list" : "custom subcategories";
      throw new Error(`Subcategory already exists in ${where}: "${dup.name}"`);
    }

    const res = await fetch(`${API_BASE_URL}/api/custom-subcategories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: addingSubcategoryFor, name: trimmedName }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Failed to add subcategory" }));
      throw new Error(data.error || 'Failed to add subcategory');
    }

    // ---- Clear cache + re-fetch from server so custom subcategories are up-to-date ----
    // We must `await` this so we don't bump rev before the cache has the new entry.
    await refreshCustomSubcategories();

    // ---- Bump the revision counter to force every dropdown to re-render ----
    // All useMemo hooks that compute subcategory options (mass assign dropdown,
    // edit modal dropdown) depend on `subcategoriesRev`. Inline per-row subcategory
    // dropdowns re-evaluate each render, so the state bump is sufficient for them too.
    setSubcategoriesRev((prev) => prev + 1);
  };

  const openAddSubcategoryModal = (categorySlug: string) => {
    setAddingSubcategoryFor(categorySlug);
    setIsAddSubcategoryModalOpen(true);
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-nav flex-shrink-0">
        <span className="text-sm font-semibold text-ink font-heading">Staged Items</span>
        <span className="bg-surface text-muted text-xs font-mono px-2.5 py-0.5 rounded-full border border-border">{staged.length}</span>
      </div>

      {/* Mass Assign Row - Category/Subcategory apply to all */}
      <div className="px-5 py-3 border-b border-border bg-surface/30 flex items-center gap-4 overflow-visible">
        <span className="text-xs medium text-muted whitespace-nowrap">Mass Assign :</span>
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
          {selectedForMass.size > 0
            ? `Apply to Selected (${selectedForMass.size})`
            : "Apply to All"}
        </button>
        
        <div className="flex-1" />

        {/* Mass Auto Generate Valid Region */}
        <button
          onClick={handleMassAutoGenerateRegion}
          disabled={massAutoGen?.running ?? false}
          className="px-4 py-1.5 rounded-xl bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          title={processing ? "Auto-generating will run with reduced speed during upload" : "Auto-generate valid regions for all bag items (or selected ones)"}
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
            <Plus size={14} />
            Mass Tags
          </button>
          
          {showMassTagSelector && (
            <div ref={massTagSelectorRef} className="absolute top-full mt-2 left-0 p-3 border border-border rounded-lg bg-white shadow-xl z-50 w-[400px]">
              {/* Mode toggle: Add / Remove */}
              <div className="mb-2.5 flex gap-1 p-1 rounded-lg bg-surface/60 border border-border/50">
                <button
                  type="button"
                  onClick={() => {
                    setMassTagMode("add");
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all ${
                    massTagMode === "add"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-muted hover:text-ink hover:bg-white/60"
                  }`}
                >
                  <span className="inline-flex items-center gap-1 justify-center">
                    <Plus size={12} /> Add Tags
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMassTagMode("remove");
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all ${
                    massTagMode === "remove"
                      ? "bg-rose-600 text-white shadow-sm"
                      : "text-muted hover:text-ink hover:bg-white/60"
                  }`}
                >
                  <span className="inline-flex items-center gap-1 justify-center">
                    <Minus size={12} /> Remove Tags
                  </span>
                </button>
              </div>

              <div className="flex items-center justify-between mb-1">
                <div className={`text-xs font-semibold font-heading ${
                  massTagMode === "add" ? "text-emerald-700" : "text-rose-700"
                }`}>
                  {massTagMode === "add" ? "Assign Tags to Bag Items" : "Remove Tags from Bag Items"}
                </div>
                {/* Scope indicator */}
                <span className="text-[10px] font-mono text-muted">
                  Scope: {selectedForMass.size > 0 ? `${selectedForMass.size} selected` : "all bags"}
                </span>
              </div>

              <div className="text-[10px] text-muted mb-2">
                {massTagMode === "add"
                  ? "Select tags to apply to all bag items (or selected items):"
                  : "Select tags to remove from the following bag items (only items with these tags are affected):"}
              </div>

              {/* In remove mode: show summary of which items carry the currently-selected tags */}
              {massTagMode === "remove" && (() => {
                // Determine effective target indices (same rules as apply)
                let targetIndices: number[] = [];
                if (selectedForMass.size > 0) {
                  targetIndices = [...selectedForMass].filter(idx => staged[idx]?.category === "bags");
                } else {
                  targetIndices = staged
                    .map((s, idx) => ({ s, idx }))
                    .filter(({ s }) => s.category === "bags")
                    .map(({ idx }) => idx);
                }
                const selectedTagSlugs = Array.from(massSelectedTags);
                // Items with at least one of the selected tags present in their .tags array
                const itemsWithAny = targetIndices.filter(idx => {
                  const t = staged[idx]?.tags || [];
                  return selectedTagSlugs.some(slug => t.includes(slug));
                });
                const selectedCount = selectedTagSlugs.length;
                return (
                  <div className={`mb-2 rounded-lg border p-2 ${
                    selectedCount === 0
                      ? "bg-gray-50/60 border-gray-200 text-gray-500"
                      : itemsWithAny.length === 0
                        ? "bg-amber-50 border-amber-200 text-amber-800"
                        : "bg-rose-50/80 border-rose-200 text-rose-900"
                  }`}>
                    {selectedCount === 0 ? (
                      <div className="text-[10px]">
                        <span className="font-semibold">No tags selected.</span> Pick one or more tags above to see what will change.
                      </div>
                    ) : itemsWithAny.length === 0 ? (
                      <div className="text-[10px]">
                        <span className="font-semibold">No matching items.</span> None of the {targetIndices.length} targeted bag items carry any of the {selectedCount} selected tag{selectedCount === 1 ? "" : "s"}.
                      </div>
                    ) : (
                      <div className="text-[10px] leading-relaxed">
                        <div>
                          <span className="font-semibold">{itemsWithAny.length}</span> of <span className="font-semibold">{targetIndices.length}</span> targeted bag item{targetIndices.length === 1 ? "" : "s"}
                          {" "}contain at least one of the {selectedCount} selected tag{selectedCount === 1 ? "" : "s"}.
                        </div>
                        <div className="text-rose-800/90 mt-0.5">
                          These {itemsWithAny.length} item{itemsWithAny.length === 1 ? "" : "s"} will be modified.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-1 max-h-56 overflow-y-auto">
                {LIBRARIES.find(l => l.slug === "non-threats")?.subcategories.map((sub) => {
                  const isSelected = massSelectedTags.has(sub.slug);
                  return (
                    <label
                      key={sub.slug}
                      className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs ${
                        isSelected
                          ? massTagMode === "add"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
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
                        className={`rounded ${
                          massTagMode === "add"
                            ? "border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            : "border-gray-300 text-rose-600 focus:ring-rose-500"
                        }`}
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
                    const tagsToApply = Array.from(massSelectedTags);
                    if (tagsToApply.length === 0) {
                      setConfirmDialog({
                        isOpen: true,
                        title: "No Tags Selected",
                        message: "Please select at least one tag.",
                        confirmLabel: "OK",
                        confirmVariant: "primary",
                        onConfirm: () => setConfirmDialog({ isOpen: false, title: "", message: "" }),
                      });
                      return;
                    }

                    // Determine which indices to update
                    let indicesToUpdate: number[] = [];
                    if (selectedForMass.size > 0) {
                      indicesToUpdate = [...selectedForMass].filter(idx => staged[idx]?.category === "bags");
                    } else {
                      indicesToUpdate = staged
                        .map((s, idx) => ({ s, idx }))
                        .filter(({ s }) => s.category === "bags")
                        .map(({ idx }) => idx);
                    }

                    if (indicesToUpdate.length === 0) {
                      setConfirmDialog({
                        isOpen: true,
                        title: "No Bag Items Found",
                        message: "No bag items found in scope.",
                        confirmLabel: "OK",
                        confirmVariant: "primary",
                        onConfirm: () => setConfirmDialog({ isOpen: false, title: "", message: "" }),
                      });
                      return;
                    }

                    // ---- ADD MODE ----
                    if (massTagMode === "add") {
                      const copy = [...staged];
                      indicesToUpdate.forEach(idx => {
                        copy[idx] = {
                          ...copy[idx],
                          tags: [...new Set([...copy[idx].tags || [], ...tagsToApply])]
                        };
                      });
                      setStaged(copy);

                      setShowMassTagSelector(false);
                      setMassSelectedTags(new Set());

                      console.log(`Applied ${tagsToApply.length} tags to ${indicesToUpdate.length} bag items`);
                      return;
                    }

                    // ---- REMOVE MODE ----
                    // First, narrow indicesToUpdate to only items that actually contain any of the tags being removed
                    // (prevents a "0 changes made" confirmation dialog and keeps the counter honest)
                    const tagSet = new Set<string>(tagsToApply);
                    const actuallyAffected = indicesToUpdate.filter(idx => {
                      const t = staged[idx]?.tags || [];
                      return t.some((tag: string) => tagSet.has(tag));
                    });

                    if (actuallyAffected.length === 0) {
                      setConfirmDialog({
                        isOpen: true,
                        title: "Nothing to Remove",
                        message: `None of the targeted ${indicesToUpdate.length} bag item${indicesToUpdate.length === 1 ? "" : "s"} carry any of the ${tagsToApply.length} selected tag${tagsToApply.length === 1 ? "" : "s"}.`,
                        confirmLabel: "OK",
                        confirmVariant: "primary",
                        onConfirm: () => setConfirmDialog({ isOpen: false, title: "", message: "" }),
                      });
                      return;
                    }

                    // Confirmation dialog for destructive remove operation
                    setConfirmDialog({
                      isOpen: true,
                      title: "Remove Tags?",
                      message:
                        `You are about to remove ${tagsToApply.length} tag${tagsToApply.length === 1 ? "" : "s"} from ${actuallyAffected.length} bag item${actuallyAffected.length === 1 ? "" : "s"}. ` +
                        `This action cannot be undone for these item${actuallyAffected.length === 1 ? "" : "s"}.`,
                      confirmLabel: `Remove ${tagsToApply.length} Tag${tagsToApply.length === 1 ? "" : "s"}`,
                      cancelLabel: "Cancel",
                      confirmVariant: "danger",
                    onConfirm: () => {
                      const copy = [...staged];
                      actuallyAffected.forEach(idx => {
                        const prev = copy[idx]?.tags || [];
                        copy[idx] = {
                          ...copy[idx],
                          tags: prev.filter((t: string) => !tagSet.has(t)),
                        };
                      });
                        setStaged(copy);

                        setShowMassTagSelector(false);
                        setMassSelectedTags(new Set());
                        setConfirmDialog({ isOpen: false, title: "", message: "" });

                        console.log(`Removed ${tagsToApply.length} tags from ${actuallyAffected.length} bag items`);
                      },
                    });
                  }}
                  className={`flex-1 px-3 py-1.5 text-white text-xs rounded-lg font-semibold transition-all ${
                    massTagMode === "add"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-rose-600 hover:bg-rose-700"
                  }`}
                >
                  {massTagMode === "add"
                    ? `Apply to ${selectedForMass.size > 0 ? `Selected (${selectedForMass.size})` : "All Bags"}`
                    : `Remove from ${selectedForMass.size > 0 ? `Selected (${selectedForMass.size})` : "All Bags"}`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMassTagSelector(false);
                    setMassSelectedTags(new Set());
                    setMassTagMode("add");
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
              <th className="text-left py-3 px-3">Category</th>
              <th className="text-left py-3 px-3">Subcategory</th>
              <th className="text-right py-3 px-3 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staged.map((s, idx) => {
              const file = s.file as File;
              const preview = s.preProcessed
                ? `${API_BASE_URL}/data/library_images/${s.filepath}`
                : URL.createObjectURL(file);
              const isBags = s.category === "bags";
              const inlineSubOptions = getInlineSubcategoryOptions(s.category);
              const displayRowNumber = typeof s.globalIndex === "number" ? s.globalIndex + 1 : idx + 1;

              return (
                <tr key={idx} className="even:bg-surface/20">
                  <td className="py-3 px-3 align-top">
                    <input
                      type="checkbox"
                      checked={selectedForMass.has(idx)}
                      onChange={() => handleToggleSelect(idx)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="py-3 px-3 align-top text-sm font-mono text-muted text-center">
                    {displayRowNumber}
                  </td>
                  <td className="py-3 px-3 align-top">
                    <button
                      onClick={() => {
                        setPreviewImage(preview);
                        setPreviewFileName(file.name);
                        setPreviewIndex(idx);
                      }}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                      title="Click to enlarge"
                    >
                      <ThumbnailWithRegion
                        src={preview}
                        validRegionPoints={s.valid_region_points}
                        alt={file.name}
                      />
                    </button>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <div className="space-y-2">
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
                                const sanitizedTag = sanitizeTag(tagName);
                                return (
                                  <span
                                    key={tagSlug}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-medium"
                                    title={escapeAttribute(sanitizedTag)}
                                  >
                                    {sanitizedTag}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const copy = [...staged];
                                        const newTags = copy[idx].tags?.filter((t: string) => t !== tagSlug) || [];
                                        copy[idx] = { ...copy[idx], tags: newTags };
                                        setStaged(copy);
                                      }}
                                      className="hover:text-rose-600 transition-colors"
                                    >
                                      <X size={10} />
                                    </button>
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
                  <td className="py-3 px-3 align-top">
                    <ScrollableSelect
                      value={s.subcategory || ""}
                      options={inlineSubOptions}
                      onChange={(val) => handleInlineSubcategoryChange(idx, val)}
                      disabled={uploading || !s.category}
                      placeholder="NONE"
                      onAddNew={s.category ? () => openAddSubcategoryModal(s.category) : undefined}
                      category={s.category}
                    />
                  </td>
                  <td className="py-3 px-3 align-top">
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
                  </td>
                  <td className="py-3 px-3 align-top">
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
            if (selectedForMass.size === 0) return;

            const selectedLocalIndices = Array.from(selectedForMass).filter(i => i >= 0 && i < staged.length);
            if (selectedLocalIndices.length === 0) return;

            const orphanedItems = JSON.parse(sessionStorage.getItem('orphanedPreprocessedItems') || '[]');
            const itemsToDelete = staged.filter((_, idx) => selectedForMass.has(idx));
            const preProcessedIds = itemsToDelete
              .filter(item => item.preProcessed && item.itemId)
              .map(item => item.itemId);

            preProcessedIds.forEach(itemId => {
              fetch(`${API_BASE_URL}/api/temp-files/${itemId}`, {
                method: 'DELETE',
              }).catch(err => console.error('Failed to delete temp files:', err));
            });

            const updatedOrphanedItems = orphanedItems.filter((id: string) => !preProcessedIds.includes(id));
            sessionStorage.setItem('orphanedPreprocessedItems', JSON.stringify(updatedOrphanedItems));

            const deletedItemFiles = itemsToDelete
              .map(item => item.file)
              .filter(Boolean);

            const newStaged = staged.filter((_, idx) => !selectedForMass.has(idx));

            const newFiles = files.filter((f) => {
              return !deletedItemFiles.some((sf: File) => sf === f || sf.name === f.name);
            });

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
                        ? `${API_BASE_URL}/data/library_images/${editDraft.preGeneratedFilepath}`
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
              ? `${API_BASE_URL}/data/library_images/${editDraft.preGeneratedFilepath}`
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

      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel={confirmDialog.cancelLabel}
        confirmVariant={confirmDialog.confirmVariant}
        onConfirm={confirmDialog.onConfirm || (() => setConfirmDialog({ isOpen: false, title: "", message: "" }))}
        onCancel={() => setConfirmDialog({ isOpen: false, title: "", message: "" })}
      />

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          {/* Close button - positioned fixed to stay in top-right corner */}
          <button
            onClick={() => setPreviewImage(null)}
            className="fixed top-4 right-4 z-[110] p-2 bg-black/80 hover:bg-black rounded-full text-white transition-colors shadow-lg"
            title="Close preview"
          >
            <X size={24} />
          </button>
          
          <div className="relative flex items-center gap-20 max-w-7xl max-h-[90vh] p-4">
            
            {/* Navigation buttons */}
            {previewIndex > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const prevIdx = previewIndex - 1;
                  const prevItem = staged[prevIdx];
                  const prevPreview = prevItem.preProcessed
                    ? `${API_BASE_URL}/data/library_images/${prevItem.preGeneratedFilepath}`
                    : URL.createObjectURL(prevItem.file as File);
                  setPreviewImage(prevPreview);
                  setPreviewFileName((prevItem.file as File).name);
                  setPreviewIndex(prevIdx);
                }}
                className="absolute -left-10 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/70 hover:bg-black/90 rounded-full text-white transition-colors"
                title="Previous image"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            
            {previewIndex < staged.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const nextIdx = previewIndex + 1;
                  const nextItem = staged[nextIdx];
                  const nextPreview = nextItem.preProcessed
                    ? `${API_BASE_URL}/data/library_images/${nextItem.preGeneratedFilepath}`
                    : URL.createObjectURL(nextItem.file as File);
                  setPreviewImage(nextPreview);
                  setPreviewFileName((nextItem.file as File).name);
                  setPreviewIndex(nextIdx);
                }}
                className="absolute left-[calc(50%+6px)] top-1/2 -translate-y-1/2 z-10 p-3 bg-black/70 hover:bg-black/90 rounded-full text-white transition-colors"
                title="Next image"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            
            {/* Image on the left */}
            <img
              src={previewImage}
              alt={previewFileName}
              className="max-w-[50%] max-h-[75vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            
            {/* Tags panel on the right - only for bags */}
            {(() => {
              const currentIdx = staged.findIndex(s => {
                const file = s.file as File;
                const itemPreview = s.preProcessed
                  ? `${API_BASE_URL}/data/library_images/${s.preGeneratedFilepath}`
                  : URL.createObjectURL(file);
                return itemPreview === previewImage;
              });
              
              const isBags = currentIdx !== -1 && staged[currentIdx]?.category === "bags";
              
              if (!isBags) return null;
              
              return (
                <div className="w-64 bg-white rounded-lg shadow-2xl p-4 max-h-[75vh] overflow-y-auto">
                  <div className="text-sm font-semibold text-ink mb-1 font-heading">Tags</div>
                  <div className="text-xs text-muted mb-3">Select non-threat items:</div>
                  
                  {(() => {
                    const currentTags = staged[currentIdx].tags || [];
                    
                    return (
                      <>
                        <div className="space-y-1">
                          {LIBRARIES.find(l => l.slug === "non-threats")?.subcategories.map((sub) => {
                            const isSelected = currentTags.includes(sub.slug);
                            return (
                              <label
                                key={sub.slug}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm ${
                                  isSelected
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "hover:bg-surface"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    const copy = [...staged];
                                    const newTags = e.target.checked
                                      ? [...currentTags, sub.slug]
                                      : currentTags.filter((t: string) => t !== sub.slug);
                                    copy[currentIdx] = { ...copy[currentIdx], tags: newTags };
                                    setStaged(copy);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="rounded border-gray-300"
                                />
                                <span>{sub.name}</span>
                              </label>
                            );
                          })}
                        </div>
                        
                        {currentTags.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border">
                            <div className="text-xs font-medium text-muted mb-2">Selected Tags:</div>
                            <div className="flex flex-wrap gap-1">
                              {currentTags.map((tagSlug: string) => {
                                const tagName = tagSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                                return (
                                  <span
                                    key={tagSlug}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs font-medium"
                                  >
                                    {tagName}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const copy = [...staged];
                                        const newTags = currentTags.filter((t: string) => t !== tagSlug);
                                        copy[currentIdx] = { ...copy[currentIdx], tags: newTags };
                                        setStaged(copy);
                                      }}
                                      className="hover:text-rose-600 transition-colors"
                                    >
                                      <X size={12} />
                                    </button>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}