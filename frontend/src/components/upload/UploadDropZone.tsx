import React, { useState } from "react";
import { Upload as UploadIcon } from "lucide-react";

interface UploadDropZoneProps {
  onFilesSelected: (files: File[]) => void;
}

export default function UploadDropZone({ onFilesSelected }: UploadDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const isSupportedFile = (name: string): boolean => {
    const lower = name.toLowerCase();
    return lower.endsWith(".dump.pgm") || lower.endsWith(".tip") || lower.endsWith(".npz");
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

  const traverseEntry = async (entry: any): Promise<File[]> => {
    if (!entry) {
      return [];
    }

    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        entry.file((file: File) => {
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(f => isSupportedFile(f.name));
      if (files.length > 0) {
        onFilesSelected(files);
      }
    }
  };

  const triggerFilePicker = () => {
    document.getElementById("fileInput")?.click();
  };

  const readDirectoryHandle = async (dirHandle: FileSystemDirectoryHandle): Promise<File[]> => {
    const files: File[] = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file") {
        try {
          const file = await entry.getFile();
          if (isSupportedFile(file.name)) {
            files.push(file);
          }
        } catch {
          // skip unreadable files
        }
      } else if (entry.kind === "directory") {
        const nested = await readDirectoryHandle(entry);
        files.push(...nested);
      }
    }
    return files;
  };

  const triggerFolderPicker = async () => {
    const win = window as Window & typeof globalThis & { showDirectoryPicker?: (options?: { mode?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle> };
    if (win.showDirectoryPicker) {
      try {
        const dirHandle = await win.showDirectoryPicker({ mode: "read", startIn: "desktop" });
        const files = await readDirectoryHandle(dirHandle);
        if (files.length > 0) {
          onFilesSelected(files);
        }
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return;
        }
        console.error("showDirectoryPicker failed, falling back to input:", err);
      }
    }

    const folderInput = document.getElementById("folderInput");
    if (folderInput) {
      folderInput.click();
    }
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
        accept=".dump.pgm,.tip,.npz"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        id="folderInput"
        type="file"
        // @ts-ignore webkitdirectory
        webkitdirectory="true"
        multiple
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
          onClick={triggerFilePicker}
          className="inline-flex items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-ink bg-white/90 hover:bg-accent/5 transition"
        >
          Upload files
        </button>
        <button
          type="button"
          onClick={triggerFolderPicker}
          className="inline-flex items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-ink bg-white/90 hover:bg-accent/5 transition"
        >
          Upload folder
        </button>
      </div>
    </div>
  );
}
