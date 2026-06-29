import React from "react";
import { 
  Undo2, Redo2, Trash2, RotateCw, Settings, 
  Layers, Layout, Shuffle, Grid, AlertTriangle, Save, ChevronLeft
} from "lucide-react";

interface WorkspaceToolbarProps {
  bagObjectName: string;
  undoDisabled: boolean;
  redoDisabled: boolean;
  selectedObjectId: string | null;
  showValidRegion: boolean;
  showGrid: boolean;
  outOfBoundsCount: number;
  handleUndo: () => void;
  handleRedo: () => void;
  setShowValidRegion: (val: boolean) => void;
  setShowGrid: (val: boolean) => void;
  handleDeleteSelected: () => void;
  handleRandomize: () => void;
  handleSave: () => void;
  hasUnsavedChanges: boolean;
  handleBack: () => void;
}

export default function WorkspaceToolbar({
  bagObjectName,
  undoDisabled,
  redoDisabled,
  selectedObjectId,
  showValidRegion,
  showGrid,
  outOfBoundsCount,
  handleUndo,
  handleRedo,
  setShowValidRegion,
  setShowGrid,
  handleDeleteSelected,
  handleRandomize,
  handleSave,
  hasUnsavedChanges,
  handleBack,
}: WorkspaceToolbarProps) {
  return (
    <div className="bg-panel border-b border-border px-4 py-2 flex items-center gap-1.5 shadow-card relative z-20 h-11 flex-shrink-0 text-sm">
      {/* Back Button */}
      <button
        onClick={handleBack}
        className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-all border-none bg-transparent cursor-pointer"
        title="Back to Collage"
      >
        <ChevronLeft size={16} />
      </button>

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

      {/* Grid Toggle */}
      <button
        onClick={() => setShowGrid(!showGrid)}
        className={`p-1.5 rounded-lg transition-colors border cursor-pointer ${
          showGrid 
            ? "bg-accent/10 border-accent/30 text-accent font-semibold" 
            : "border-transparent text-muted hover:text-ink hover:bg-surface"
        }`}
        title={showGrid ? "Hide Grid" : "Show Grid"}
      >
        <Grid size={16} />
      </button>

      {/* Randomize Button */}
      <button
        onClick={handleRandomize}
        className="p-1.5 rounded-lg text-muted hover:text-accent hover:bg-accent/10 transition-colors border border-transparent hover:border-accent/30 cursor-pointer"
        title="Randomize object positions"
      >
        <Shuffle size={16} />
      </button>

      {/* Out of Bounds Warning - Center */}
      {outOfBoundsCount > 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
            <AlertTriangle size={14} />
            <span className="text-xs font-semibold">
              {outOfBoundsCount} object{outOfBoundsCount > 1 ? "s" : ""} out of valid region!
            </span>
          </div>
        </div>
      )}

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

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover transition-all text-xs"
        title="Save Workspace"
      >
        <Save size={14} />
        Save
        {hasUnsavedChanges && <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
      </button>
    </div>
  );
}