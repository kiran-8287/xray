import React from "react";
import { 
  Undo2, Redo2, Save, Trash2, RotateCw, Settings, 
  Layers, Layout, Shuffle
} from "lucide-react";

interface WorkspaceToolbarProps {
  bagObjectName: string;
  undoDisabled: boolean;
  redoDisabled: boolean;
  selectedObjectId: string | null;
  showValidRegion: boolean;
  exportSaving: boolean;
  handleUndo: () => void;
  handleRedo: () => void;
  setShowValidRegion: (val: boolean) => void;
  handleDeleteSelected: () => void;
  handleExport: () => void;
  handleRandomize: () => void;
}

export default function WorkspaceToolbar({
  bagObjectName,
  undoDisabled,
  redoDisabled,
  selectedObjectId,
  showValidRegion,
  exportSaving,
  handleUndo,
  handleRedo,
  setShowValidRegion,
  handleDeleteSelected,
  handleExport,
  handleRandomize,
}: WorkspaceToolbarProps) {
  return (
    <div className="bg-panel border-b border-border px-4 py-2 flex items-center gap-1.5 shadow-card relative z-20 h-11 flex-shrink-0 text-sm">

      {/* Undo/Redo */}
      <button
        onClick={handleUndo}
        disabled={undoDisabled}
        className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-all disabled:opacity-30 border-none bg-transparent cursor-pointer"
        title="Undo"
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={handleRedo}
        disabled={redoDisabled}
        className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-all disabled:opacity-30 border-none bg-transparent cursor-pointer"
        title="Redo"
      >
        <Redo2 size={16} />
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Valid Region Toggle */}
      <button
        onClick={() => setShowValidRegion(!showValidRegion)}
        className={`p-1.5 rounded-lg transition-colors border cursor-pointer ${
          showValidRegion 
            ? "bg-accent/10 border-accent/30 text-accent font-semibold" 
            : "border-transparent text-muted hover:text-ink hover:bg-surface"
        }`}
        title={showValidRegion ? "Hide Valid Region" : "Show Valid Region"}
      >
        <Layers size={16} />
      </button>

      {/* Randomize Button */}
      <button
        onClick={handleRandomize}
        className="p-1.5 rounded-lg text-muted hover:text-accent hover:bg-accent/10 transition-colors border border-transparent hover:border-accent/30 cursor-pointer"
        title="Randomize object positions"
      >
        <Shuffle size={16} />
      </button>

      {selectedObjectId && (
        <>
          <div className="w-px h-5 bg-border mx-1" />
          {/* Delete button */}
          <button
            onClick={handleDeleteSelected}
            className="p-1.5 rounded-lg text-muted hover:bg-rose-50 hover:text-rose-600 transition-all cursor-pointer"
            title="Delete Selected"
          >
            <Trash2 size={16} />
          </button>
        </>
      )}

      {/* Export Save Button */}
      <button
        onClick={handleExport}
        disabled={exportSaving}
        className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover transition-all text-xs"
      >
        <Save size={14} />
        {exportSaving ? "Saving..." : "Save Workspace"}
      </button>
    </div>
  );
}
