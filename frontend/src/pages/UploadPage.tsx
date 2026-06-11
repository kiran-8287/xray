import React, { useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import UploadConfigPanel from "../components/upload/UploadConfigPanel";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [folderName, setFolderName] = useState("My Upload");

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleUpload = async () => {
    setUploading(true);
    setUploadStatus("idle");
    try {
      const formData = new FormData();
      formData.append("folderName", folderName);
      files.forEach((file) => {
        formData.append("images", file);
      });

      const res = await fetch("http://localhost:8080/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.ok) {
        setUploadStatus("success");
        // Clear files on success after small delay
        setTimeout(() => {
          setFiles([]);
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

  return (
    <div className="max-w-5xl mx-auto py-10 px-6 animate-fade-in">
      {/* Hero Header */}
      <div className="border-l-4 border-accent pl-4 mb-8">
        <h2 className="text-3xl font-bold text-ink tracking-tight">Upload Images</h2>
      </div>

      {/* Two-column layout above the fold */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Config + Dropzone */}
        <div className="lg:col-span-7 space-y-6">
          <UploadConfigPanel
            folderName={folderName}
            setFolderName={setFolderName}
          />
          <UploadDropZone onFilesSelected={handleFilesSelected} />
        </div>

        {/* Right Column: File Queue */}
        <div className="lg:col-span-5 space-y-4">
          <UploadFileQueue
            files={files}
            setFiles={setFiles}
            uploading={uploading}
            handleUpload={handleUpload}
          />
        </div>
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
