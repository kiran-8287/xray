import React from "react";
import { Info } from "lucide-react";

interface UploadConfigPanelProps {
  folderName: string;
  setFolderName: (val: string) => void;
}

export default function UploadConfigPanel({
  folderName,
  setFolderName,
}: UploadConfigPanelProps) {
  return (
    <div className="bg-panel rounded-2xl border border-border p-6 shadow-card space-y-5">
      {/* Session Input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Session Name
          </label>
          <div className="group relative cursor-pointer" title="Name of the session folder to group uploads">
            <Info size={14} className="text-muted hover:text-ink transition-colors" />
          </div>
        </div>
        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          className="w-full bg-panel border border-border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all shadow-card"
          placeholder="Enter upload session name..."
        />
      </div>
    </div>
  );
}
