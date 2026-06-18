import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { TaxonomyCategory } from "../types/library";
import { CheckCircle2, AlertCircle, Upload as UploadIcon, AlertTriangle, Wand2 } from "lucide-react";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";
import { LIBRARY_PREFIXES, LIBRARIES, getLibrarySubcategories } from "../config/categories";
import { useUploadContext } from "../context/UploadContext";

export default function UploadPage() {
  const { files, setFiles, staged, setStaged, clearAll } = useUploadContext();
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("My Upload");
  const [taxonomy, setTaxonomy] = useState<TaxonomyCategory[]>([]);
  const [massCategory, setMassCategory] = useState("");
  const [massSubcategory, setMassSubcategory] = useState("");
  const [selectedForMass, setSelectedForMass] = useState<Set<number>>(new Set());

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    const startIdx = staged.length;
    const newStaged = newFiles.map((f) => ({
      file: f,
      category: "",
      subcategory: "",
      name: f.name,
      valid_region_points: null,
    }));
    setStaged((prev) => [...prev, ...newStaged]);
    // Auto-select only the newly added files in mass panel
    const newIndices = new Set<number>();
    for (let i = startIdx; i < startIdx + newFiles.length; i++) {
      newIndices.add(i);
    }
    setSelectedForMass(newIndices);
    setMassCategory("");
    setMassSubcategory("");
  };

  const handleUpload = async () => {
    // --- Validation ---
    const missingCategory: string[] = [];
    const missingBagsRegion: string[] = [];

    staged.forEach((s, i) => {
      const sn = `#${i + 1}`;
      if (!s.category || !s.subcategory) {
        missingCategory.push(sn);
      }
      if (s.category === "bags" && !s.valid_region_points) {
        missingBagsRegion.push(sn);
      }
    });

    if (missingCategory.length > 0 || missingBagsRegion.length > 0) {
      const lines: string[] = [];
      if (missingCategory.length > 0) {
        lines.push(`Set category & subcategory for item(s) ${missingCategory.join(", ")}`);
      }
      if (missingBagsRegion.length > 0) {
        lines.push(`Draw valid region for bag item(s) ${missingBagsRegion.join(", ")}`);
      }
      setValidationMessage(lines.join(" | "));
      setTimeout(() => setValidationMessage(null), 5000);
      return;
    }
    // --- End Validation ---

    setUploading(true);
    setUploadStatus("idle");
    setValidationMessage(null);
    try {
      const formData = new FormData();
      formData.append("folderName", folderName);
      // Append files and metadata
      staged.forEach((s) => {
        formData.append("images", s.file);
      });
      // Build metadata array describing each file
      const metadata = staged.map((s) => ({
        originalname: s.file.name,
        category: s.category,
        subcategory: s.subcategory,
        name: s.name,
        valid_region_points: s.valid_region_points || null,
      }));
      formData.append("metadata", JSON.stringify(metadata));

      const res = await fetch("http://localhost:8080/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.ok) {
        setUploadStatus("success");
        // Clear files on success after small delay
        setTimeout(() => {
          clearAll();
        }, 1000);
      } else {
        setUploadStatus("error");
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("error");
    } finally {
      setUploading(false);
      // Dismiss toast after 3500ms
      setTimeout(() => {
          setUploadStatus("idle");
      }, 3500);
    }
  };

  useEffect(() => {
    const fetchTaxonomy = async () => {
      try {
        const res = await fetch("http://localhost:8080/api/taxonomy");
        const data = await res.json();
        if (data.ok && Array.isArray(data.taxonomy)) {
          setTaxonomy(data.taxonomy);
        }
      } catch (err) {
        console.error("Failed to fetch taxonomy:", err);
      }
    };
    fetchTaxonomy();
  }, []);

  const massSubcategoryOptions = useMemo(() => {
    if (!massCategory) return [];
    return getLibrarySubcategories(taxonomy, massCategory);
  }, [taxonomy, massCategory]);

  const handleMassApply = () => {
    if (!massCategory) return;
    setStaged((prev) =>
      prev.map((s, idx) => {
        if (!selectedForMass.has(idx)) return s;
        const subcats = getLibrarySubcategories(taxonomy, massCategory);
        return {
          ...s,
          category: massCategory,
          subcategory: massSubcategory || subcats[0]?.name || "General",
        };
      })
    );
    // Keep panel open for reuse; reset category/subcategory but keep selection
    setMassCategory("");
    setMassSubcategory("");
  };

  const toggleSelectAll = () => {
    if (selectedForMass.size === staged.length) {
      setSelectedForMass(new Set());
    } else {
      setSelectedForMass(new Set(staged.map((_, i) => i)));
    }
  };

  const toggleSelect = (idx: number) => {
    setSelectedForMass((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="max-w-7xl mx-auto py-10 px-6 animate-fade-in">
      {/* Hero Header */}
      <div className="border-l-4 border-accent pl-4 mb-8">
        <h2 className="text-3xl font-bold text-ink tracking-tight">Upload Images</h2>
      </div>

      <div className="space-y-6">
        {/* Dropzone at the top - the file picker */}
        <UploadDropZone onFilesSelected={handleFilesSelected} />

        {/* Mass Assign Panel - always visible when files are staged */}
        {staged.length > 0 && (
          <div className="bg-panel rounded-2xl border border-border p-5 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <Wand2 size={16} className="text-accent" />
              <span className="text-sm font-semibold text-ink">Mass Assign Category</span>
            </div>

            {/* File selector with checkboxes */}
            <div className="mb-3 max-h-40 overflow-y-auto border border-border rounded-lg bg-white">
              <div className="flex items-center gap-2 p-2 border-b border-border bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedForMass.size === staged.length}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
                <span className="text-xs font-medium text-muted">Select All</span>
              </div>
              {staged.map((s, idx) => (
                <label key={idx} className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b border-border last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selectedForMass.has(idx)}
                    onChange={() => toggleSelect(idx)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs text-ink truncate flex-1">#{idx + 1} {s.file.name}</span>
                  {s.category && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">
                      {s.category}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted font-medium">Category</label>
                <select
                  className="w-36 p-2 border border-border rounded-lg text-xs bg-white"
                  value={massCategory}
                  onChange={(e) => {
                    setMassCategory(e.target.value);
                    setMassSubcategory("");
                  }}
                >
                  <option value="">Select category</option>
                  {LIBRARIES.map((cat) => (
                    <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted font-medium">Subcategory</label>
                <select
                  className="w-36 p-2 border border-border rounded-lg text-xs bg-white"
                  value={massSubcategory}
                  onChange={(e) => setMassSubcategory(e.target.value)}
                  disabled={!massCategory}
                >
                  <option value="">Select subcategory</option>
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
                onClick={handleMassApply}
                disabled={!massCategory || selectedForMass.size === 0}
                className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                Apply to Selected ({selectedForMass.size})
              </button>
            </div>
          </div>
        )}

        {/* Upload Button below dropzone */}
        <div className="bg-panel rounded-2xl border border-border p-6 shadow-card">
          <button
            onClick={handleUpload}
            disabled={uploading || staged.length === 0}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky transition-all hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              "Uploading..."
            ) : (
              <>
                <UploadIcon size={20} />
                Upload {staged.length > 0 ? `${staged.length} Files` : "Files"}
              </>
            )}
          </button>

          {/* Empty state text when no files are selected */}
          {staged.length === 0 && (
            <div className="mt-4 text-center">
              <p className="text-sm font-medium text-muted">No files selected</p>
              <p className="text-xs text-muted/70 mt-1">
                Drag a folder or files into the dropzone to queue them for upload
              </p>
            </div>
          )}
        </div>

        {/* Validation Warning Toast */}
        {validationMessage && (
          <div className="fixed bottom-24 right-6 z-50 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3 shadow-card animate-slide-up max-w-md">
            <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={14} />
            </div>
            <span className="text-sm font-medium">{validationMessage}</span>
          </div>
        )}

        {/* Selected files section - appears below the upload button when files are staged */}
        {staged.length > 0 && (
          <UploadFileQueue
            files={files}
            staged={staged}
            setStaged={setStaged}
            setFiles={setFiles}
            uploading={uploading}
            handleUpload={handleUpload}
            taxonomy={taxonomy}
            selectedForMass={selectedForMass}
            onToggleSelect={toggleSelect}
            onSelectAll={toggleSelectAll}
          />
        )}
      </div>

      {/* Floating Status Toasts */}
      {uploadStatus === "success" && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-emerald-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <span className="text-sm font-medium">Upload successful! Go to Collage page to see combinations.</span>
        </div>
      )}

      {uploadStatus === "error" && (
        <div className="fixed bottom-6 right-6 z-50 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-rose-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <AlertCircle size={14} />
          </div>
          <span className="text-sm font-medium">Upload failed. Please try again.</span>
        </div>
      )}
    </div>
  );
}