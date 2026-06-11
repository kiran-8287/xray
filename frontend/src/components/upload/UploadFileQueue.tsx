import React from "react";
import { Trash2, Upload as UploadIcon } from "lucide-react";
import { LIBRARIES, LIBRARY_PREFIXES } from "../../config/categories";

interface UploadFileQueueProps {
  files: File[];
  setFiles: (files: File[]) => void;
  uploading: boolean;
  handleUpload: () => void;
}

export default function UploadFileQueue({
  files,
  setFiles,
  uploading,
  handleUpload,
}: UploadFileQueueProps) {
  // Helper to get library from filename prefix
  const getLibraryFromFilename = (filename: string): string => {
    const prefix = filename.toLowerCase().split(/[_\-]/)[0];
    return LIBRARY_PREFIXES[prefix] || "Uncategorized";
  };

  const getLibraryColor = (libraryName: string): string => {
    const matched = LIBRARIES.find(
      (lib) =>
        lib.name.toLowerCase() === libraryName.toLowerCase() ||
        (libraryName === "LAG" && lib.slug === "lag")
    );
    return matched ? matched.colorCls : "bg-slate-50 text-slate-700 border-slate-200";
  };

  if (files.length === 0) {
    return (
      <div className="bg-panel rounded-2xl border border-border p-12 shadow-card text-center text-muted text-sm flex flex-col items-center justify-center h-[300px]">
        <UploadIcon className="w-10 h-10 text-muted/30 mb-3" />
        <p className="font-medium">No files selected</p>
        <p className="text-xs text-muted/70 mt-1 max-w-[240px] mx-auto">
          Drag a folder or files into the dropzone to queue them for upload
        </p>
      </div>
    );
  }

  return (
    <div className="bg-panel rounded-2xl border border-border shadow-card overflow-hidden flex flex-col max-h-[460px]">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-nav flex-shrink-0">
        <span className="text-sm font-semibold text-ink">Selected Files</span>
        <span className="bg-surface text-muted text-xs font-mono px-2.5 py-0.5 rounded-full border border-border">
          {files.length}
        </span>
      </div>
      <ul className="divide-y divide-border overflow-y-auto flex-1">
        {files.map((file, idx) => {
          const library = getLibraryFromFilename(file.name);
          const ext = file.name.split(".").pop()?.toUpperCase() || "PNG";
          return (
            <li
              key={idx}
              className="px-5 py-3 flex items-center gap-3 hover:bg-surface transition-colors even:bg-surface/30"
            >
              <div className="w-9 h-9 bg-surface rounded-lg flex items-center justify-center text-xs font-mono font-bold text-muted border border-border flex-shrink-0">
                {ext}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-ink" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <span className={`inline-flex text-xs font-semibold px-2.5 py-0.5 rounded-md border ${getLibraryColor(library)}`}>
                {library}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Action Buttons Row */}
      <div className="px-5 py-3.5 bg-nav border-t border-border flex justify-end gap-3 flex-shrink-0">
        <button
          onClick={() => setFiles([])}
          className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted hover:bg-surface hover:text-ink hover:border-muted/60 transition-all duration-150 flex items-center gap-1.5"
        >
          <Trash2 size={15} />
          Clear All
        </button>
        <button
          onClick={handleUpload}
          disabled={uploading || files.length === 0}
          className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 text-sm"
        >
          {uploading ? "Uploading..." : `Upload ${files.length} Files`}
          {!uploading && <UploadIcon size={15} />}
        </button>
      </div>
    </div>
  );
}
