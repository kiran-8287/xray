import React, { useState } from "react";
import { Upload as UploadIcon } from "lucide-react";

interface UploadDropZoneProps {
  onFilesSelected: (files: File[]) => void;
}

export default function UploadDropZone({ onFilesSelected }: UploadDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(Array.from(e.target.files));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => document.getElementById("fileInput")?.click()}
      className={`bg-panel border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer shadow-card transition-all duration-200 group ${
        isDragOver
          ? "border-accent-sky bg-accent-sky/5 scale-[1.01]"
          : "border-border hover:border-accent hover:bg-accent/4 hover:shadow-card-hover"
      }`}
    >
      <input
        id="fileInput"
        type="file"
        accept="image/*"
        multiple
        // @ts-ignore webkitdirectory
        webkitdirectory=""
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="w-12 h-12 mx-auto mb-4 bg-accent/10 rounded-xl flex items-center justify-center text-accent/70 group-hover:text-accent group-hover:bg-accent/15 transition-colors">
        <UploadIcon className="w-6 h-6" />
      </div>
      <p className="text-sm font-semibold text-ink mt-2">
        Drag & drop folder or files here, or click to browse
      </p>
    </div>
  );
}
