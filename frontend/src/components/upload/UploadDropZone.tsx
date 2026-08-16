import React, { useState } from "react";
import { Upload as UploadIcon, AlertTriangle, X } from "lucide-react";

interface UploadDropZoneProps {
  onFilesSelected: (files: File[]) => void;
}

export default function UploadDropZone({ onFilesSelected }: UploadDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<"files" | "folder" | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      let files = Array.from(e.target.files);
      // If it's a folder upload, filter out unsupported files since we can't rely on the OS `accept` attribute
      if (e.target.id === "folderInput") {
        files = files.filter(f => isSupportedFile(f.name));
      }
      if (files.length > 0) {
        onFilesSelected(files);
      }
    }
  };

  const readEntries = (reader: any): Promise<any[]> =>
    new Promise((resolve, reject) => {
      const entries: any[] = [];
      const readBatch = () => {
        reader.readEntries(
          (results: any[]) => {
            if (!results.length) {
              resolve(entries);
            } else {
              entries.push(...results);
              readBatch();
            }
          },
          reject
        );
      };
      readBatch();
    });

  const isSupportedFile = (name: string): boolean => {
    const lower = name.toLowerCase();
    return (
      lower.endsWith(".dump.pgm") ||
      lower.endsWith(".pgm") ||
      lower.endsWith(".tip") ||
      lower.endsWith(".dump") ||
      lower.endsWith(".npz") ||
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg")
    );
  };

  const traverseEntry = async (entry: any): Promise<File[]> => {
    if (!entry) {
      return [];
    }

    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        entry.file((file: File) => {
          // Only include supported file types when traversing folders
          if (isSupportedFile(file.name)) {
            resolve([file]);
          } else {
            resolve([]);
          }
        }, reject);
      });
    }

    if (entry.isDirectory) {
      const reader = entry.createReader();
      const nestedEntries = await readEntries(reader);
      const nestedFiles = await Promise.all(nestedEntries.map(traverseEntry));
      return nestedFiles.flat();
    }

    return [];
  };

  const collectFilesFromDataTransfer = async (items: DataTransferItemList): Promise<File[]> => {
    const entries = Array.from(items)
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length === 0) {
      return [];
    }

    const files = await Promise.all(entries.map(traverseEntry));
    return files.flat();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const filesFromItems = await collectFilesFromDataTransfer(e.dataTransfer.items);
    if (filesFromItems.length > 0) {
      onFilesSelected(filesFromItems);
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => isSupportedFile(f.name));
      if (files.length > 0) {
        onFilesSelected(files);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const triggerFilePicker = () => {
    document.getElementById("fileInput")?.click();
    setShowConfirm(false);
    setPendingAction(null);
  };

  const triggerFolderPicker = () => {
    document.getElementById("folderInput")?.click();
    setShowConfirm(false);
    setPendingAction(null);
  };

  const handleConfirmAction = () => {
    if (pendingAction === "files") {
      triggerFilePicker();
    } else if (pendingAction === "folder") {
      triggerFolderPicker();
    }
  };

  const handleCancelAction = () => {
    setShowConfirm(false);
    setPendingAction(null);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`max-w-5xl mx-auto bg-panel border-2 border-dashed rounded-2xl p-14 text-center shadow-card transition-all duration-200 group ${
        isDragOver
          ? "border-accent-sky bg-accent-sky/5 scale-[1.01]"
          : "border-border hover:border-accent hover:bg-accent/4 hover:shadow-card-hover"
      }`}
    >
      <input
        id="fileInput"
        type="file"
        accept=".pgm,.tip,.dump,.npz,.png,.jpg,.jpeg"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        id="folderInput"
        type="file"
        multiple
        // @ts-ignore webkitdirectory
        webkitdirectory="true"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="w-12 h-12 mx-auto mb-4 bg-accent/10 rounded-xl flex items-center justify-center text-accent/70 group-hover:text-accent group-hover:bg-accent/15 transition-colors">
        <UploadIcon className="w-6 h-6" />
      </div>
      <p className="text-sm font-semibold text-ink mt-2 font-heading">
        Drag & drop folders or files here, or use the buttons below
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => { setPendingAction("files"); setShowConfirm(true); }}
          className="inline-flex items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-ink bg-white/90 hover:bg-accent/5 transition"
        >
          Upload files
        </button>
        <button
          type="button"
          onClick={() => { setPendingAction("folder"); setShowConfirm(true); }}
          className="inline-flex items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-ink bg-white/90 hover:bg-accent/5 transition"
        >
          Upload folder
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCancelAction} />
          <div className="relative z-[100000] w-full max-w-md bg-white rounded-2xl shadow-2xl border border-border p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-900/40 border border-amber-700/50 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-ink font-heading">
                  {pendingAction === "folder" ? "Upload folder" : "Upload files"}
                </h3>
                <p className="text-sm text-muted mt-1 leading-relaxed">
                  {pendingAction === "folder"
                    ? "You are about to select a folder to upload. Only supported file types (.pgm, .tip, .dump, .npz, .png, .jpg, .jpeg) will be processed. Do you want to continue?"
                    : "You are about to select files to upload. Only supported file types (.pgm, .tip, .dump, .npz, .png, .jpg, .jpeg) will be processed. Do you want to continue?"}
                </p>
              </div>
              <button
                onClick={handleCancelAction}
                className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-colors shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <button
                onClick={handleCancelAction}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-ink hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
