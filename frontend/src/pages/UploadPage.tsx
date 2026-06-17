import React, { useState, useEffect, useCallback } from "react";
import type { TaxonomyCategory } from "../types/library";
import { CheckCircle2, AlertCircle, Upload as UploadIcon, AlertTriangle } from "lucide-react";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";
import { LIBRARY_PREFIXES } from "../config/categories";
import { useUploadContext } from "../context/UploadContext";

export default function UploadPage() {
  const { files, setFiles, staged, setStaged, clearAll } = useUploadContext();
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("My Upload");
  const [taxonomy, setTaxonomy] = useState<TaxonomyCategory[]>([]);

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    const newStaged = newFiles.map((f) => ({
      file: f,
      category: "",
      subcategory: "",
      name: f.name,
      valid_region_points: null,
    }));
    setStaged((prev) => [...prev, ...newStaged]);
  };

  const handleUpload = async () => {
    // --- Validation ---
    const missingCategory: string[] = [];
    const missingBagsRegion: string[] = [];

    staged.forEach((s) => {
      if (!s.category || !s.subcategory) {
        missingCategory.push(s.file.name);
      }
      if (s.category === "bags" && !s.valid_region_points) {
        missingBagsRegion.push(s.file.name);
      }
    });

    if (missingCategory.length > 0 || missingBagsRegion.length > 0) {
      const lines: string[] = [];
      if (missingCategory.length > 0) {
        lines.push(`Set category & subcategory for: ${missingCategory.join(", ")}`);
      }
      if (missingBagsRegion.length > 0) {
        lines.push(`Draw valid region for bags: ${missingBagsRegion.join(", ")}`);
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

  return (
    <div className="max-w-5xl mx-auto py-10 px-6 animate-fade-in">
      {/* Hero Header */}
      <div className="border-l-4 border-accent pl-4 mb-8">
        <h2 className="text-3xl font-bold text-ink tracking-tight">Upload Images</h2>
      </div>

      <div className="space-y-6">
        {/* Dropzone at the top - the file picker */}
        <UploadDropZone onFilesSelected={handleFilesSelected} />

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