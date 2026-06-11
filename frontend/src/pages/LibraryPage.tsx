import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Image } from "lucide-react";
import type { Item, UploadSession, TaxonomyCategory, CategorizedItems } from "../types/library";
import { getCategoryConfig } from "../config/categories";
import ValidRegionEditor from "../components/ValidRegionEditor";
import LibrarySidebar from "../components/library/LibrarySidebar";
import LibraryToolbar from "../components/library/LibraryToolbar";
import ItemCard from "../components/library/ItemCard";
import ItemRow from "../components/library/ItemRow";
import SelectionTray from "../components/library/SelectionTray";
import type { Point } from "../types/geometry";

const findScannedItemId = (filename: string): string | null => {
  const clean = filename.toLowerCase();
  if (clean.includes("backpack")) return "backpack";
  if (clean.includes("duffel")) return "duffel";
  if (clean.includes("suitcase")) return "suitcase";
  if (clean.includes("handbag")) return "handbag";
  if (clean.includes("laptop") && clean.includes("bag")) return "laptopBag";
  if (clean.includes("trolley")) return "trolley";
  
  if (clean.includes("gun")) return "gun";
  if (clean.includes("knife")) return "knife";
  if (clean.includes("generic")) return "generic";
  
  if (clean.includes("tshirt") || clean.includes("t-shirt")) return "tshirt";
  if (clean.includes("jeans")) return "jeans";
  if (clean.includes("sweater")) return "sweater";
  if (clean.includes("coat")) return "coat";
  
  if (clean.includes("laptop")) return "laptop";
  if (clean.includes("phone")) return "phone";
  if (clean.includes("charger")) return "charger";
  if (clean.includes("coil")) return "heatingCoil";
  if (clean.includes("dryer")) return "hairDryer";
  
  if (clean.includes("energy")) return "energyBar";
  if (clean.includes("banana")) return "banana";
  if (clean.includes("bottle") || clean.includes("water")) return "waterBottle";
  
  if (clean.includes("notebook")) return "notebook";
  if (clean.includes("pen")) return "pen";
  if (clean.includes("stapler")) return "stapler";
  
  if (clean.includes("toothpaste")) return "toothpaste";
  if (clean.includes("perfume")) return "perfume";
  if (clean.includes("shampoo")) return "shampoo";

  if (clean.includes("standard") && clean.includes("tray")) return "trayStandard";
  if (clean.includes("metal") && clean.includes("tray")) return "trayMetal";
  
  return null;
};

export default function LibraryPage() {
  const navigate = useNavigate();
  const [categorizedItems, setCategorizedItems] = useState<CategorizedItems>({});
  const [taxonomy, setTaxonomy] = useState<TaxonomyCategory[]>([]);
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("bags");
  const [activeSubcategory, setActiveSubcategory] = useState<string>("all");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["bags"]));
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [densityPreset, setDensityPreset] = useState<"empty" | "few" | "filled">("filled");

  useEffect(() => {
    fetchCategorizedItems();
    fetchTaxonomy();
    fetchSessions();
  }, []);

  const fetchCategorizedItems = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/items/categorized");
      const data = await res.json();
      if (data.ok) {
        // Merge similar categories into one
        const merged = { ...data.categorized };
        const mergeIntoMisc = (catName: string) => {
          if (merged[catName]) {
            if (!merged.miscellaneous) {
              merged.miscellaneous = {};
            }
            for (const subcat of Object.keys(merged[catName])) {
              if (!merged.miscellaneous[subcat]) {
                merged.miscellaneous[subcat] = [];
              }
              merged.miscellaneous[subcat].push(...merged[catName][subcat]);
            }
            delete merged[catName];
          }
        };

        mergeIntoMisc("misc");
        mergeIntoMisc("sports");
        mergeIntoMisc("stationery");
        mergeIntoMisc("lag");

        setCategorizedItems(merged);
        const firstCategory = Object.keys(merged)[0];
        if (firstCategory) {
          setActiveCategory(firstCategory);
        }
      }
    } catch (err) {
      console.error("Failed to fetch categorized items:", err);
    }
  };

  const fetchTaxonomy = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/taxonomy");
      const data = await res.json();
      if (data.ok) {
        setTaxonomy(data.taxonomy);
      }
    } catch (err) {
      console.error("Failed to fetch taxonomy:", err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/sessions");
      const data = await res.json();
      if (data.ok) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  };

  const toggleItemSelection = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const toggleCategoryExpansion = (categoryKey: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryKey)) {
      newExpanded.delete(categoryKey);
    } else {
      newExpanded.add(categoryKey);
    }
    setExpandedCategories(newExpanded);
  };

  const openValidRegionEditor = async (item: Item) => {
    try {
      const res = await fetch(`http://localhost:8080/api/items/${item.id}`);
      const data = await res.json();
      if (data.ok) {
        setEditingItem(data.item);
      }
    } catch (err) {
      console.error("Failed to fetch item:", err);
    }
  };

  const saveValidRegion = async (normalizedPoints: Point[], shapes?: any[]) => {
    if (!editingItem) return;
    try {
      await fetch(`http://localhost:8080/api/items/${editingItem.id}/valid-region`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validRegionPoints: normalizedPoints, shapes }),
      });
      setEditingItem(null);
      fetchCategorizedItems();
    } catch (err) {
      console.error("Failed to save valid region:", err);
    }
  };

  const deleteValidRegion = async () => {
    if (!editingItem) return;
    try {
      await fetch(`http://localhost:8080/api/items/${editingItem.id}/valid-region`, {
        method: "DELETE",
      });
      setEditingItem(null);
      fetchCategorizedItems();
    } catch (err) {
      console.error("Failed to delete valid region:", err);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      await fetch(`http://localhost:8080/api/items/${itemId}`, {
        method: "DELETE",
      });
      fetchCategorizedItems();
      fetchSessions();
      const newSelected = new Set(selectedItems);
      newSelected.delete(itemId);
      setSelectedItems(newSelected);
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  const handleDeleteSubcategory = async (categoryKey: string, subKey: string) => {
    const items = categorizedItems[categoryKey]?.[subKey] || [];
    if (items.length === 0) return;
    if (!confirm(`Are you sure you want to delete all ${items.length} items in this subcategory?`)) return;
    try {
      await Promise.all(
        items.map((item) =>
          fetch(`http://localhost:8080/api/items/${item.id}`, { method: "DELETE" })
        )
      );
      fetchCategorizedItems();
      fetchSessions();
      const newSelected = new Set(selectedItems);
      items.forEach((item) => newSelected.delete(item.id));
      setSelectedItems(newSelected);
    } catch (err) {
      console.error("Failed to delete subcategory items:", err);
    }
  };

  const handleDeleteSession = async (sessionId: string, sessionName: string, itemCount: number) => {
    if (!confirm(`Are you sure you want to delete the upload session "${sessionName}" with ${itemCount} items?`)) return;
    try {
      await fetch(`http://localhost:8080/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      fetchCategorizedItems();
      fetchSessions();
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        const newSelected = new Set(selectedItems);
        session.items.forEach((item) => newSelected.delete(item.id));
        setSelectedItems(newSelected);
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  const handleGenerateCollage = () => {
    const selectedBags: Item[] = [];
    const selectedThreats: Item[] = [];
    const selectedOthers: Item[] = [];
    
    selectedItems.forEach((itemId) => {
      for (const [cat, subcats] of Object.entries(categorizedItems)) {
        for (const [, items] of Object.entries(subcats)) {
          const item = items.find((i) => i.id === itemId);
          if (item) {
            if (cat === "bags") selectedBags.push(item);
            else if (cat === "threats") selectedThreats.push(item);
            else selectedOthers.push(item);
          }
        }
      }
    });

    navigate("/collage", {
      state: {
        selectedBags,
        selectedThreats,
        selectedOthers,
        densityPreset
      }
    });
  };

  const subcategoriesData = categorizedItems[activeCategory] || {};
  let displayedItems: Item[] = [];

  if (activeSubcategory === "all") {
    displayedItems = Object.values(subcategoriesData).flat();
  } else {
    displayedItems = subcategoriesData[activeSubcategory] || [];
  }

  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    displayedItems = displayedItems.filter(
      (item) => item.name.toLowerCase().includes(query) || item.filename.toLowerCase().includes(query)
    );
  }

  const activeCategoryConfig = getCategoryConfig(activeCategory);
  const totalCategoryItemsCount = Object.values(subcategoriesData).flat().length;

  return (
    <div className="flex h-[calc(100vh-56px)] bg-surface overflow-hidden animate-fade-in flex-col">
      <div className="flex flex-1 overflow-hidden">
        <LibrarySidebar
          sessions={sessions}
          categorizedItems={categorizedItems}
          taxonomy={taxonomy}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          activeSubcategory={activeSubcategory}
          setActiveSubcategory={setActiveSubcategory}
          expandedCategories={expandedCategories}
          toggleCategoryExpansion={toggleCategoryExpansion}
          selectedItems={selectedItems}
          setSelectedItems={setSelectedItems}
          handleDeleteSession={handleDeleteSession}
          handleDeleteSubcategory={handleDeleteSubcategory}
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
                <h3 className="text-base font-semibold text-ink mb-1">No scanned bags found</h3>
                <p className="text-sm text-muted">
                  {searchQuery ? "Try refining your search keyword" : "Upload scanned bags to get started"}
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
                    onEditRegion={() => openValidRegionEditor(item)}
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
                        onEditRegion={() => openValidRegionEditor(item)}
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
        densityPreset={densityPreset}
        onChangeDensityPreset={setDensityPreset}
      />

      {editingItem && (
        <ValidRegionEditor
          itemId={editingItem.id}
          imageSrc={`http://localhost:8080/data/library_images/${editingItem.filepath}`}
          initialPoints={editingItem.validRegionData || editingItem.valid_region_points || []}
          onSave={saveValidRegion}
          onCancel={() => setEditingItem(null)}
          onDelete={deleteValidRegion}
        />
      )}
    </div>
  );
}
