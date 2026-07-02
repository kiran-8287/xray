import React, { useState } from "react";
import { X, Plus } from "lucide-react";

interface AddSubcategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string) => Promise<void>;
  categoryName: string;
}

export default function AddSubcategoryModal({ isOpen, onClose, onAdd, categoryName }: AddSubcategoryModalProps) {
  const [subcategoryName, setSubcategoryName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!subcategoryName.trim()) {
      setError("Subcategory name is required");
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      await onAdd(subcategoryName.trim());
      setSubcategoryName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add subcategory");
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    setSubcategoryName("");
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-panel border border-border rounded-2xl shadow-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Plus size={16} className="text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-ink">Add New Subcategory</h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-muted">
            Adding subcategory to: <span className="font-semibold text-ink">{categoryName}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Subcategory Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={subcategoryName}
                onChange={(e) => {
                  setSubcategoryName(e.target.value);
                  setError(null);
                }}
                placeholder="e.g., Travel Backpack, Leather Bag"
                className="w-full px-3 py-2 border border-border rounded-xl bg-white text-sm text-ink placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                autoFocus
                disabled={isAdding}
              />
              {error && (
                <p className="mt-1.5 text-xs text-rose-600">{error}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-5">
            <button
              type="button"
              onClick={handleClose}
              disabled={isAdding}
              className="px-4 py-2 rounded-xl border border-border bg-white text-sm font-medium text-ink hover:bg-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isAdding || !subcategoryName.trim()}
              className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isAdding ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Add Subcategory
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}