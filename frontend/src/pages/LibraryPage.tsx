import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Image, AlertTriangle, CheckCircle2, X, XCircle, Trash2 } from "lucide-react";
import type { Item, CategorizedItems } from "../types/library";
import { LIBRARIES, getCategoryConfig, getLibrarySubcategories, mergeCategorizedItems, normalizeCategoryName } from "../config/categories";
import SimpleLibrarySidebar from "../components/library/SimpleLibrarySidebar";
import LibraryToolbar from "../components/library/LibraryToolbar";
import ItemCard from "../components/library/ItemCard";
import ItemRow from "../components/library/ItemRow";
import SelectionTray from "../components/library/SelectionTray";

type NotificationType = "info" | "success" | "warning" | "error";
type Notification = { id: number; type: NotificationType; message: string };
type ConfirmDialog = { message: string; onConfirm: () => void; onCancel: () => void } | null;

export default function LibraryPage() {
  const navigate = useNavigate();
  const [categorizedItems, setCategorizedItems] = useState<CategorizedItems>({});
  const [selectedItems, setSelectedItems] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("selectedItemIds");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [activeCategory, setActiveCategory] = useState<string>("bags");
  const [activeSubcategory, setActiveSubcategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editDraft, setEditDraft] = useState<{ category: string; subcategory: string; name: string } | null>(null);
  const [isItemSaving, setIsItemSaving] = useState(false);
  const notifCounter = React.useRef(0);

  const showNotification = useCallback((type: NotificationType, message: string, duration = 4000) => {
    const id = ++notifCounter.current;
    setNotifications((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, duration);
  }, []);

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({
        message,
        onConfirm: () => {
          setConfirmDialog(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmDialog(null);
          resolve(false);
        },
      });
    });
  }, []);

  useEffect(() => {
    fetchCategorizedItems();
  }, []);

  useEffect(() => {
    localStorage.setItem("selectedItemIds", JSON.stringify(Array.from(selectedItems)));
  }, [selectedItems]);

  const fetchCategorizedItems = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/items/categorized");
      const data = await res.json();
      if (data.ok) {
        const merged = mergeCategorizedItems(data.categorized);
        setCategorizedItems(merged);
        if (!Object.keys(merged).includes(activeCategory)) {
          setActiveCategory(Object.keys(merged)[0] || "bags");
          setActiveSubcategory("all");
        }
      }
    } catch (err) {
      console.error("Failed to fetch categorized items:", err);
      showNotification("error", "Unable to load library items.");
    }
  };

  const getDisplayItems = (): Item[] => {
    const subcats = categorizedItems[activeCategory] || {};
    const baseItems = activeSubcategory === "all" ? Object.values(subcats).flat() : subcats[activeSubcategory] || [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseItems;
    return baseItems.filter((item) => {
      return [item.name, item.filename, item.category, item.subcategory]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(query));
    });
  };

  const toggleItemSelection = (itemId: string) => {
    setSelectedItems((prevSelected) => {
      const newSelected = new Set(prevSelected);
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
      return newSelected;
    });
  };

  const selectAllCategory = (categoryKey: string) => {
    const items = Object.values(categorizedItems[categoryKey] || {}).flat();
    setSelectedItems((prev) => {
      const next = new Set(prev);
      items.forEach((item) => next.add(item.id));
      return next;
    });
  };

  const selectAllSubcategory = (categoryKey: string, subcategoryKey: string) => {
    const items = categorizedItems[categoryKey]?.[subcategoryKey] || [];
    setSelectedItems((prev) => {
      const next = new Set(prev);
      items.forEach((item) => next.add(item.id));
      return next;
    });
  };

  const deleteCategory = async (categoryKey: string) => {
    const items = Object.values(categorizedItems[categoryKey] || {}).flat();
    const itemCount = items.length;
    if (itemCount === 0) {
      showNotification("info", "This category is empty.");
      return;
    }
    const confirmed = await showConfirm(
      `Are you sure you want to delete all ${itemCount} item(s) in this category? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await Promise.all(
        items.map((item) => fetch(`http://localhost:8080/api/items/${item.id}`, { method: "DELETE" }))
      );
      await fetchCategorizedItems();
      setSelectedItems((prev) => {
        const next = new Set(prev);
        items.forEach((item) => next.delete(item.id));
        return next;
      });
      showNotification("success", `Deleted ${itemCount} item(s) from category.`);
    } catch (err) {
      console.error("Failed to delete category items:", err);
      showNotification("error", "Failed to delete category items. Please try again.");
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const confirmed = await showConfirm("Are you sure you want to delete this item? This action cannot be undone.");
    if (!confirmed) return;

    try {
      await fetch(`http://localhost:8080/api/items/${itemId}`, { method: "DELETE" });
      await fetchCategorizedItems();
      setSelectedItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      showNotification("success", "Item deleted successfully.");
    } catch (err) {
      console.error("Failed to delete item:", err);
      showNotification("error", "Failed to delete item. Please try again.");
    }
  };

  const openItemDetail = (item: Item) => {
    setEditingItem(item);
    setEditDraft({
      category: LIBRARIES.some((lib) => lib.slug === item.category) ? item.category : normalizeCategoryName(item.category),
      subcategory: item.subcategory || "General",
      name: item.name || item.filename,
    });
  };

  const closeItemDetail = () => {
    setEditingItem(null);
    setEditDraft(null);
    setIsItemSaving(false);
  };

  const selectedItemCategorySlug = editDraft
    ? LIBRARIES.some((lib) => lib.slug === editDraft.category)
      ? editDraft.category
      : normalizeCategoryName(editDraft.category)
    : editingItem
    ? LIBRARIES.some((lib) => lib.slug === editingItem.category)
      ? editingItem.category
      : normalizeCategoryName(editingItem.category)
    : activeCategory;

  const selectedCategory = LIBRARIES.find((lib) => lib.slug === selectedItemCategorySlug) || LIBRARIES[0];
  const subcategoryOptions = getLibrarySubcategories(selectedCategory.slug);

  const handleCategoryChange = (categoryValue: string) => {
    setEditDraft((prev) => ({
      ...prev!,
      category: categoryValue,
      subcategory: getLibrarySubcategories(categoryValue)[0]?.name || "General",
    }));
  };

  const handleSubcategoryChange = (subcategoryValue: string) => {
    setEditDraft((prev) => ({ ...prev!, subcategory: subcategoryValue }));
  };

  const handleSaveItemDetails = async () => {
    if (!editingItem || !editDraft) return;
    setIsItemSaving(true);

    try {
      const res = await fetch(`http://localhost:8080/api/items/${editingItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save item details");
      }
      await fetchCategorizedItems();
      showNotification("success", "Item details updated successfully.");
      closeItemDetail();
    } catch (err) {
      console.error("Failed to save item details:", err);
      showNotification("error", "Failed to save item details. Please try again.");
      setIsItemSaving(false);
    }
  };

  const handleGenerateCollage = () => {
    const selectedBags: Item[] = [];
    const selectedThreats: Item[] = [];
    const selectedOthers: Item[] = [];

    selectedItems.forEach((itemId) => {
      for (const subcats of Object.values(categorizedItems)) {
        for (const items of Object.values(subcats as Record<string, Item[]>)) {
          const match = (items as Item[]).find((item) => item.id === itemId);
          if (match) {
            const normalizedCategory = normalizeCategoryName(match.category);
            if (normalizedCategory === "bags") selectedBags.push(match);
            else if (normalizedCategory === "threats") selectedThreats.push(match);
            else selectedOthers.push(match);
            return;
          }
        }
      }
    });

    navigate("/collage", {
      state: { selectedBags, selectedThreats, selectedOthers },
    });
  };

  const subcategoriesData = categorizedItems[activeCategory] || {};
  const displayedItems = getDisplayItems();
  const activeCategoryConfig = getCategoryConfig(activeCategory);
  const totalCategoryItemsCount = Object.values(subcategoriesData).flat().length;

  const notifIcon = (type: NotificationType) => {
    if (type === "success") return <CheckCircle2 size={16} className="text-green-400 shrink-0" />;
    if (type === "error") return <XCircle size={16} className="text-red-400 shrink-0" />;
    if (type === "warning") return <AlertTriangle size={16} className="text-yellow-400 shrink-0" />;
    return <CheckCircle2 size={16} className="text-blue-400 shrink-0" />;
  };

  const notifBg = (type: NotificationType) => {
    if (type === "success") return "bg-green-950/80 border-green-700/60 text-green-200";
    if (type === "error") return "bg-red-950/80 border-red-700/60 text-red-200";
    if (type === "warning") return "bg-yellow-950/80 border-yellow-700/60 text-yellow-200";
    return "bg-blue-950/80 border-blue-700/60 text-blue-200";
  };

  return (
    <div className="flex h-[calc(100vh-56px)] bg-surface overflow-hidden animate-fade-in flex-col">
      <div className="flex flex-1 overflow-hidden">
        <SimpleLibrarySidebar
          categorizedItems={categorizedItems}
          activeCategory={activeCategory}
          setActiveCategory={(category) => {
            setActiveCategory(category);
            setActiveSubcategory("all");
          }}
          activeSubcategory={activeSubcategory}
          setActiveSubcategory={setActiveSubcategory}
          selectedItems={selectedItems}
          setSelectedItems={setSelectedItems}
          onSelectAllCategory={selectAllCategory}
          onSelectAllSubcategory={selectAllSubcategory}
          onDeleteCategory={deleteCategory}
        />
        <main className="flex-1 flex flex-col overflow-hidden">
          <LibraryToolbar
            title={activeCategoryConfig.label}
            itemCount={totalCategoryItemsCount}
            subcategoryCount={Object.keys(subcategoriesData).length}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            viewMode={viewMode}
            setViewMode={setViewMode}
          />

          <div className="flex-1 overflow-y-auto p-5">
            {displayedItems.length === 0 ? (
              <div className="text-center py-24 bg-panel rounded-2xl border border-border shadow-card">
                <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
                  <Image size={28} className="text-muted/40" />
                </div>
                <h3 className="text-base font-semibold text-ink mb-1">No items found</h3>
                <p className="text-sm text-muted">
                  {searchQuery ? "Try refining your search keyword." : "Upload scanned items to get started."}
                </p>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
                {displayedItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    isSelected={selectedItems.has(item.id)}
                    onSelect={() => toggleItemSelection(item.id)}
                    onOpen={() => openItemDetail(item)}
                    onEditRegion={() => {}}
                    onDelete={() => handleDeleteItem(item.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-panel rounded-2xl border border-border shadow-card overflow-hidden">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-nav border-b border-border text-left">
                      <th className="w-12 px-5 py-3"></th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted">Preview</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted">Name</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted">Filename</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted">Subcategory</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayedItems.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        isSelected={selectedItems.has(item.id)}
                        onSelect={() => toggleItemSelection(item.id)}
                        onOpen={() => openItemDetail(item)}
                        onEditRegion={() => {}}
                        onDelete={() => handleDeleteItem(item.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      <SelectionTray
        selectedCount={selectedItems.size}
        onClearSelection={() => setSelectedItems(new Set())}
        onGenerateCollage={handleGenerateCollage}
      />

      {editingItem && editDraft && (
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-6">
          <div className="w-full max-w-3xl rounded-3xl bg-panel border border-border shadow-2xl overflow-hidden">
            <div className="flex flex-col sm:flex-row gap-4 p-5 bg-surface border-b border-border">
              <div className="w-full sm:w-1/3 rounded-3xl overflow-hidden bg-surface border border-border">
                <img
                  src={`http://localhost:8080/data/library_images/${editingItem.filepath}`}
                  alt={editingItem.filename}
                  className="w-full h-64 object-contain bg-white"
                />
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-muted mb-1">Selected item</p>
                  <h2 className="text-xl font-semibold text-ink">{editingItem.filename}</h2>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="text-muted text-xs">Category</span>
                    <select
                      value={selectedCategory.slug}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      className="w-full rounded-2xl border border-border bg-white px-3 py-2 text-sm text-ink"
                    >
                      {LIBRARIES.map((lib) => (
                        <option key={lib.slug} value={lib.slug}>{lib.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-muted text-xs">Subcategory</span>
                    <select
                      value={editDraft.subcategory}
                      onChange={(e) => handleSubcategoryChange(e.target.value)}
                      className="w-full rounded-2xl border border-border bg-white px-3 py-2 text-sm text-ink"
                    >
                      {subcategoryOptions.length > 0 ? (
                        subcategoryOptions.map((sub) => (
                          <option key={sub.slug} value={sub.name}>{sub.name}</option>
                        ))
                      ) : (
                        <option value="General">General</option>
                      )}
                    </select>
                  </label>
                </div>

                <label className="space-y-2 text-sm">
                  <span className="text-muted text-xs">Item name / annotation</span>
                  <textarea
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    className="min-h-[120px] w-full rounded-3xl border border-border bg-white p-3 text-sm text-ink resize-none"
                    placeholder="e.g. Bag containing laptop, phone, knife, and apple"
                  />
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between bg-surface border-t border-border">
              <p className="text-sm text-muted">
                Category and subcategory selected here will update how this item is grouped in the library.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeItemDetail}
                  className="rounded-2xl border border-border bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveItemDetails}
                  disabled={isItemSaving}
                  className="rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-btn transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isItemSaving ? "Saving..." : "Save details"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none" style={{ maxWidth: 520 }}>
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-3 px-5 py-3 rounded-xl border shadow-2xl backdrop-blur-md pointer-events-auto transition-all duration-300 animate-slide-up ${notifBg(n.type)}`}
            style={{ minWidth: 320 }}
          >
            {notifIcon(n.type)}
            <span className="text-sm font-medium leading-snug flex-1">{n.message}</span>
            <button
              onClick={() => setNotifications((prev) => prev.filter((x) => x.id !== n.id))}
              className="ml-1 opacity-60 hover:opacity-100 transition-opacity shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {confirmDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-panel border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4" style={{ maxWidth: 440, width: "90%" }}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-900/40 border border-red-700/50 flex items-center justify-center shrink-0">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">Confirm Action</h3>
                <p className="text-sm text-muted leading-relaxed">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={confirmDialog.onCancel}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-ink hover:bg-nav transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
