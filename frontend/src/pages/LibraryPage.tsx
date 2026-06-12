import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Image } from "lucide-react";
import type { Item, UploadSession, TaxonomyCategory, CategorizedItems } from "../types/library";
import { getCategoryConfig, mergeCategorizedItems, normalizeCategoryName } from "../config/categories";
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
  const [selectedItems, setSelectedItems] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("selectedItemIds");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("bags");
  const [activeSubcategory, setActiveSubcategory] = useState<string>("all");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["bags"]));
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [densityPreset, setDensityPreset] = useState<"empty" | "few" | "filled">((() => {
    try {
      const saved = localStorage.getItem("densityPreset");
      return (saved as any) || "filled";
    } catch {
      return "filled";
    }
  })());

  useEffect(() => {
    fetchCategorizedItems();
    fetchTaxonomy();
    fetchSessions();
  }, []);

  // Helper to categorize session items in the frontend
  function getCategorizedSessionItems(items: Item[]): Record<string, Record<string, Item[]>> {
    const categorized: any = {};
    for (const item of items) {
      const cat = item.category || "misc";
      const normalized = normalizeCategoryName(cat);
      if (!categorized[normalized]) {
        categorized[normalized] = {};
      }
      const subcat = item.subcategory || "General";
      if (!categorized[normalized][subcat]) {
        categorized[normalized][subcat] = [];
      }
      categorized[normalized][subcat].push(item);
    }
    return categorized;
  }

  // Set default active session on mount once sessions fetch finishes
  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id);
      setExpandedSessions(new Set([sessions[0].id]));
    }
  }, [sessions]);

  // Save selection states to localStorage for persistence across page refreshes
  useEffect(() => {
    localStorage.setItem("selectedItemIds", JSON.stringify(Array.from(selectedItems)));
    
    const selectedBags: Item[] = [];
    const selectedThreats: Item[] = [];
    const selectedOthers: Item[] = [];
    
    selectedItems.forEach((itemId) => {
      let item = null;
      for (const s of sessions) {
        const found = (s.items || []).find((i) => i.id === itemId);
        if (found) {
          item = found;
          break;
        }
      }
      if (item) {
        const normCat = normalizeCategoryName(item.category);
        if (normCat === "bags") selectedBags.push(item);
        else if (normCat === "threats") selectedThreats.push(item);
        else selectedOthers.push(item);
      }
    });

    localStorage.setItem("selectedBags", JSON.stringify(selectedBags));
    localStorage.setItem("selectedThreats", JSON.stringify(selectedThreats));
    localStorage.setItem("selectedOthers", JSON.stringify(selectedOthers));
  }, [selectedItems, sessions]);

  useEffect(() => {
    localStorage.setItem("densityPreset", densityPreset);
  }, [densityPreset]);

  const fetchCategorizedItems = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/items/categorized");
      const data = await res.json();
      if (data.ok) {
        const merged = mergeCategorizedItems(data.categorized);
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
      setSelectedItems(newSelected);
    } else {
      let item = null;
      for (const s of sessions) {
        const found = (s.items || []).find((i) => i.id === itemId);
        if (found) {
          item = found;
          break;
        }
      }
      
      let isBag = false;
      let hasValidRegion = false;
      let itemName = "";
      
      if (item) {
        itemName = item.name;
        if (normalizeCategoryName(item.category) === "bags") {
          isBag = true;
          if (item.valid_region_points && (Array.isArray(item.valid_region_points) ? item.valid_region_points.length > 0 : true)) {
            hasValidRegion = true;
          }
        }
      }

      if (isBag && !hasValidRegion) {
        alert(`Please draw the valid region for the bag "${itemName}" before selecting it.`);
        return;
      }

      newSelected.add(itemId);
      setSelectedItems(newSelected);
    }
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

  const handleDeleteSubcategory = async (sessionId: string, categoryKey: string, subKey: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    const sessionCategorized = getCategorizedSessionItems(session.items || []);
    const items = sessionCategorized[categoryKey]?.[subKey] || [];
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
      
      if (activeSessionId === sessionId) {
        const remaining = sessions.filter(s => s.id !== sessionId);
        if (remaining.length > 0) {
          setActiveSessionId(remaining[0].id);
        } else {
          setActiveSessionId(null);
        }
      }

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
      let item = null;
      for (const s of sessions) {
        const found = (s.items || []).find((i) => i.id === itemId);
        if (found) {
          item = found;
          break;
        }
      }
      if (item) {
        const normCat = normalizeCategoryName(item.category);
        if (normCat === "bags") selectedBags.push(item);
        else if (normCat === "threats") selectedThreats.push(item);
        else selectedOthers.push(item);
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

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const sessionCategorized = activeSession ? getCategorizedSessionItems(activeSession.items || []) : {};
  const subcategoriesData = sessionCategorized[activeCategory] || {};
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
          taxonomy={taxonomy}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          activeSubcategory={activeSubcategory}
          setActiveSubcategory={setActiveSubcategory}
          expandedSessions={expandedSessions}
          toggleSessionExpansion={(id) => {
            const newExp = new Set(expandedSessions);
            if (newExp.has(id)) newExp.delete(id);
            else newExp.add(id);
            setExpandedSessions(newExp);
          }}
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
