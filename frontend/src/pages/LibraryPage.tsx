import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Image, AlertTriangle, CheckCircle2, X, XCircle, Trash2, Loader2 } from "lucide-react";
import type { Item, CategorizedItems } from "../types/library";
import type { CombinatorialResult, FailureLog } from "../types/customization";
import { API_BASE_URL } from "../config/api";
import { getCategoryConfig, normalizeCategoryName, normalizeCategorizedItems, LIBRARIES_UI, getLibrarySubcategories, clearCustomSubcategoriesCache } from "../config/categories";
import AddSubcategoryModal from "../components/common/AddSubcategoryModal";

// Use centralized library definitions
const LIBRARIES = LIBRARIES_UI;

import SimpleLibrarySidebar from "../components/library/SimpleLibrarySidebar";
import LibraryToolbar from "../components/library/LibraryToolbar";
import VirtualizedItemGrid from "../components/library/VirtualizedItemGrid";
import SelectionTray from "../components/library/SelectionTray";
import ValidRegionEditor from "../components/upload/ValidRegionEditor";

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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editDraft, setEditDraft] = useState<{ category: string; subcategory: string } | null>(null);
  const [isItemSaving, setIsItemSaving] = useState(false);
  const [isValidRegionEditorOpen, setIsValidRegionEditorOpen] = useState(false);
  const [editingRegionItem, setEditingRegionItem] = useState<Item | null>(null);
  
  // Add subcategory modal state
  const [isAddSubcategoryModalOpen, setIsAddSubcategoryModalOpen] = useState(false);
  const [addingSubcategoryFor, setAddingSubcategoryFor] = useState<string>("");
  
  const notifCounter = React.useRef(0);
  const hasShownBagsOnlyNotification = React.useRef(false);

  // K-combinations state
  const [kValue, setKValue] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("libraryKValue");
      return saved ? parseInt(saved) : 20;
    } catch { return 20; }
  });

  const threatDistributionPresets: Record<number, Record<number, number>> = {
    1: { 1: 100 },
    2: { 1: 60, 2: 40 },
    3: { 1: 50, 2: 30, 3: 20 },
    4: { 1: 40, 2: 30, 3: 20, 4: 10 },
  };

  const nonThreatDistributionPresets: Record<number, Record<number, number>> = {
    1: { 1: 100 },
    2: { 1: 60, 2: 40 },
    3: { 1: 50, 2: 30, 3: 20 },
    4: { 1: 40, 2: 30, 3: 20, 4: 10 },
  };

  // Compute initial maxThreats first so defaultDist can use it
  const initialMax = (() => {
    try {
      const saved = localStorage.getItem("libraryMaxThreats");
      return saved ? parseInt(saved) : 1;
    } catch { return 1; }
  })();

  const [maxThreats, setMaxThreats] = useState<number>(initialMax);

  const [threatDistribution, setThreatDistribution] = useState<Record<number, number>>(() => {
    try {
      const saved = localStorage.getItem("libraryThreatDistribution");
      return saved ? JSON.parse(saved) : { ...threatDistributionPresets[initialMax] };
    } catch { return { ...threatDistributionPresets[initialMax] }; }
  });

  // Compute initial maxNonThreats
  const initialMaxNonThreats = (() => {
    try {
      const saved = localStorage.getItem("libraryMaxNonThreats");
      return saved ? parseInt(saved) : 1;
    } catch { return 1; }
  })();

  const [maxNonThreats, setMaxNonThreats] = useState<number>(initialMaxNonThreats);

  const [nonThreatDistribution, setNonThreatDistribution] = useState<Record<number, number>>(() => {
    try {
      const saved = localStorage.getItem("libraryNonThreatDistribution");
      return saved ? JSON.parse(saved) : { ...nonThreatDistributionPresets[initialMaxNonThreats] };
    } catch { return { ...nonThreatDistributionPresets[initialMaxNonThreats] }; }
  });

  // State for "include at least one non-threat" checkbox
  const [requireAtLeastOneNonThreat, setRequireAtLeastOneNonThreat] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("libraryRequireAtLeastOneNonThreat");
      return saved ? JSON.parse(saved) : false;
    } catch { return false; }
  });

  // Auto-set distribution preset when maxThreats changes
  useEffect(() => {
    const preset = threatDistributionPresets[maxThreats];
    if (preset) {
      setThreatDistribution({ ...preset });
    }
  }, [maxThreats]);

  // Auto-set distribution preset when maxNonThreats changes
  useEffect(() => {
    const preset = nonThreatDistributionPresets[maxNonThreats];
    if (preset) {
      setNonThreatDistribution({ ...preset });
    }
  }, [maxNonThreats]);

  const [combinations, setCombinations] = useState<CombinatorialResult[]>(() => {
    try {
      const cached = sessionStorage.getItem("collageCombinations");
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [failures, setFailures] = useState<FailureLog[]>(() => {
    try {
      const cached = sessionStorage.getItem("collageFailures");
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const workerRef = useRef<Worker | null>(null);

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

  // Listen for library refresh events from upload page
  useEffect(() => {
    const handleLibraryRefresh = (event: Event) => {
      const customEvent = event as CustomEvent;
      const data = customEvent.detail;
      if (data) {
        const merged = normalizeCategorizedItems(data.categorized || data);
        setCategorizedItems(merged);
        showNotification("success", "Library refreshed with new items!");
      }
    };

    window.addEventListener("libraryRefresh", handleLibraryRefresh);
    return () => window.removeEventListener("libraryRefresh", handleLibraryRefresh);
  }, []);

  useEffect(() => {
    localStorage.setItem("selectedItemIds", JSON.stringify(Array.from(selectedItems)));
  }, [selectedItems]);

  const fetchCategorizedItems = async () => {
    try {
      // Check for recently refreshed data from upload
      const cachedData = sessionStorage.getItem("refreshedCategorizedItems");
      if (cachedData) {
        sessionStorage.removeItem("refreshedCategorizedItems");
        const data = JSON.parse(cachedData);
        const merged = normalizeCategorizedItems(data.categorized || data);
        setCategorizedItems(merged);
        if (!Object.keys(merged).includes(activeCategory)) {
          setActiveCategory(Object.keys(merged)[0] || "bags");
          setActiveSubcategory("all");
        }
        return;
      }

      // Request paginated data - 1000 items per page for smooth virtualization
      const res = await fetch(`${API_BASE_URL}/api/items/categorized?limit=1000`);
      const data = await res.json();
      if (data.ok) {
        const merged = normalizeCategorizedItems(data.categorized);
        setCategorizedItems(merged);
        if (!Object.keys(merged).includes(activeCategory)) {
          setActiveCategory(Object.keys(merged)[0] || "bags");
          setActiveSubcategory("all");
        }
        
        // Show notification if library is large
        const totalItems = data.pagination?.totalItems || 0;
        if (totalItems > 1000) {
          showNotification("info", `Library loaded: ${totalItems} items total. Showing first 1000.`, 6000);
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
        items.map((item) => fetch(`${API_BASE_URL}/api/items/${item.id}`, { method: "DELETE" }))
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

  const deleteSubcategory = async (categoryKey: string, subcategoryKey: string) => {
    const items = categorizedItems[categoryKey]?.[subcategoryKey] || [];
    const itemCount = items.length;
    if (itemCount === 0) {
      showNotification("info", "This subcategory is empty.");
      return;
    }
    const confirmed = await showConfirm(
      `Are you sure you want to delete all ${itemCount} item(s) in "${subcategoryKey}" subcategory? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await Promise.all(
        items.map((item) => fetch(`${API_BASE_URL}/api/items/${item.id}`, { method: "DELETE" }))
      );
      await fetchCategorizedItems();
      setSelectedItems((prev) => {
        const next = new Set(prev);
        items.forEach((item) => next.delete(item.id));
        return next;
      });
      showNotification("success", `Deleted ${itemCount} item(s) from "${subcategoryKey}".`);
    } catch (err) {
      console.error("Failed to delete subcategory items:", err);
      showNotification("error", "Failed to delete subcategory items. Please try again.");
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const confirmed = await showConfirm("Are you sure you want to delete this item? This action cannot be undone.");
    if (!confirmed) return;

    try {
      await fetch(`${API_BASE_URL}/api/items/${itemId}`, { method: "DELETE" });
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

  const handleAddCustomSubcategory = async (name: string): Promise<void> => {
    if (!addingSubcategoryFor) return;
    
    const res = await fetch('/api/custom-subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: addingSubcategoryFor, name }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add subcategory');
    }
    
    // Clear cache to reload subcategories
    clearCustomSubcategoriesCache();
  };

  const openAddSubcategoryModal = (categorySlug: string) => {
    setAddingSubcategoryFor(categorySlug);
    setIsAddSubcategoryModalOpen(true);
  };

  const handleSaveItemDetails = async () => {
    if (!editingItem || !editDraft) return;
    setIsItemSaving(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/items/${editingItem.id}`, {
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

  const handleValidRegionSave = async (points: any[]) => {
    if (!editingRegionItem) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/items/${editingRegionItem.id}/valid-region`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points, simplifiedPoints: points }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save valid region");
      }
      await fetchCategorizedItems();
      showNotification("success", "Valid region saved successfully.");
      setIsValidRegionEditorOpen(false);
      setEditingRegionItem(null);
    } catch (err) {
      console.error("Failed to save valid region:", err);
      showNotification("error", "Failed to save valid region. Please try again.");
    }
  };

  const handleValidRegionDelete = async () => {
    if (!editingRegionItem) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/items/${editingRegionItem.id}/valid-region`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete valid region");
      }
      await fetchCategorizedItems();
      showNotification("success", "Valid region deleted successfully.");
      setIsValidRegionEditorOpen(false);
      setEditingRegionItem(null);
    } catch (err) {
      console.error("Failed to delete valid region:", err);
      showNotification("error", "Failed to delete valid region. Please try again.");
    }
  };

  const handleGenerateCollage = async () => {
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

    let nextCombinations: CombinatorialResult[] = [];
    let nextFailures: FailureLog[] = [];

    if (selectedBags.length > 0) {
      const generated = await handleGenerate();
      if (generated) {
        nextCombinations = generated.results;
        nextFailures = generated.failures;
      }
    }

    // Clear selections after generating collage
    setSelectedItems(new Set());

    navigate("/collage", {
      state: { selectedBags, selectedThreats, selectedOthers, combinations: nextCombinations, failures: nextFailures },
    });
  };

  // K-combinations generation handler with Web Worker
  const handleGenerate = useCallback(async (): Promise<{ results: CombinatorialResult[]; failures: FailureLog[] }> => {
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

    if (selectedBags.length === 0) {
      setGenerationProgress("Select at least one bag before generating combinations.");
      setTimeout(() => setGenerationProgress(""), 3000);
      return { results: [], failures: [] };
    }

    setCombinations([]);
    setFailures([]);
    setIsGenerating(true);
    setGenerationProgress(`Generating ${kValue} combinations...`);

    // Fetch previously-saved layout IDs
    let existingIds: string[] = [];
    try {
      const savedRes = await fetch(`${API_BASE_URL}/api/saved-layouts/ids`);
      if (savedRes.ok) {
        const savedData = await savedRes.json();
        if (savedData.ok && Array.isArray(savedData.ids)) {
          existingIds = savedData.ids;
        }
      }
    } catch (err) {
      console.warn("Could not fetch saved layout IDs, continuing with session-only IDs:", err);
    }

    try {
      // Build threat distribution: only include counts up to maxThreats
      const effectiveThreatDist: Record<number, number> = {};
      for (let i = 1; i <= maxThreats; i++) {
        effectiveThreatDist[i] = threatDistribution[i] ?? 0;
      }
      // Build non-threat distribution: only include counts up to maxNonThreats
      const effectiveNonThreatDist: Record<number, number> = {};
      for (let i = 1; i <= maxNonThreats; i++) {
        effectiveNonThreatDist[i] = nonThreatDistribution[i] ?? 0;
      }

      // Use Web Worker for combination generation
      const worker = new Worker(new URL("../workers/combinationGenerator.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      // Create a promise that resolves when the worker finishes
      const workerPromise = new Promise<{ results: CombinatorialResult[]; failures: FailureLog[] }>((resolve, reject) => {
        worker.onmessage = (event) => {
          const response = event.data;
          
          if (response.type === "progress") {
            setGenerationProgress(response.message || "Generating...");
          } else if (response.type === "result") {
            setCombinations(response.results || []);
            setFailures(response.failures || []);
            setGenerationProgress(response.message || "Generation complete");
            setTimeout(() => setGenerationProgress(""), 3000);
            setIsGenerating(false);
            worker.terminate();
            resolve({ results: response.results || [], failures: response.failures || [] });
          } else if (response.type === "error") {
            console.error("Worker error:", response.error);
            setGenerationProgress("Error generating combinations. Check console for details.");
            setTimeout(() => setGenerationProgress(""), 5000);
            setIsGenerating(false);
            worker.terminate();
            reject(new Error(response.error || "Worker error"));
          }
        };

        worker.onerror = (error) => {
          console.error("Worker error:", error);
          setGenerationProgress("Error generating combinations. Check console for details.");
          setTimeout(() => setGenerationProgress(""), 5000);
          setIsGenerating(false);
          worker.terminate();
          reject(new Error("Worker error"));
        };
      });

      // Send data to worker
      worker.postMessage({
        type: "generate",
        selectedBags,
        selectedThreats,
        selectedOthers,
        kValue,
        threatDistribution: effectiveThreatDist,
        nonThreatDistribution: effectiveNonThreatDist,
        requireAtLeastOneNonThreat,
        existingIds,
      });

      return await workerPromise;
    } catch (err) {
      console.error("Generation error:", err);
      setGenerationProgress("Error generating combinations. Check console for details.");
      setTimeout(() => setGenerationProgress(""), 5000);
      setIsGenerating(false);
      return { results: [], failures: [] };
    }
  }, [selectedItems, categorizedItems, kValue, maxThreats, threatDistribution, maxNonThreats, nonThreatDistribution, requireAtLeastOneNonThreat]);

  // Persist K value
  useEffect(() => {
    localStorage.setItem("libraryKValue", String(kValue));
  }, [kValue]);

  // Persist maxThreats
  useEffect(() => {
    localStorage.setItem("libraryMaxThreats", String(maxThreats));
  }, [maxThreats]);

  // Persist threat distribution
  useEffect(() => {
    localStorage.setItem("libraryThreatDistribution", JSON.stringify(threatDistribution));
  }, [threatDistribution]);

  // Persist maxNonThreats
  useEffect(() => {
    localStorage.setItem("libraryMaxNonThreats", String(maxNonThreats));
  }, [maxNonThreats]);

  // Persist non-threat distribution
  useEffect(() => {
    localStorage.setItem("libraryNonThreatDistribution", JSON.stringify(nonThreatDistribution));
  }, [nonThreatDistribution]);

  // Persist requireAtLeastOneNonThreat
  useEffect(() => {
    localStorage.setItem("libraryRequireAtLeastOneNonThreat", JSON.stringify(requireAtLeastOneNonThreat));
  }, [requireAtLeastOneNonThreat]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Persist combinations and failures to sessionStorage
  useEffect(() => {
    try {
      if (combinations.length > 0) {
        sessionStorage.setItem("collageCombinations", JSON.stringify(combinations));
      }
      if (failures.length > 0) {
        sessionStorage.setItem("collageFailures", JSON.stringify(failures));
      }
    } catch (err) {
      console.error("Error saving to sessionStorage:", err);
    }
  }, [combinations, failures]);

  const subcategoriesData = categorizedItems[activeCategory] || {};
  const displayedItems = getDisplayItems();
  const activeCategoryConfig = getCategoryConfig(activeCategory);
  const totalCategoryItemsCount = Object.values(subcategoriesData).flat().length;

  // Calculate selected non-threat count for conditional UI rendering
  const selectedNonThreatCount = Array.from(selectedItems).filter(itemId => {
    for (const subcats of Object.values(categorizedItems)) {
      for (const items of Object.values(subcats as Record<string, Item[]>)) {
        const match = (items as Item[]).find((item) => item.id === itemId);
        if (match) {
          const normalizedCategory = normalizeCategoryName(match.category);
          if (normalizedCategory !== "bags" && normalizedCategory !== "threats") {
            return true;
          }
          return false;
        }
      }
    }
    return false;
  }).length;

  // Calculate selected threat count for validation
  const selectedThreatCount = Array.from(selectedItems).filter(itemId => {
    for (const subcats of Object.values(categorizedItems)) {
      for (const items of Object.values(subcats as Record<string, Item[]>)) {
        const match = (items as Item[]).find((item) => item.id === itemId);
        if (match) {
          const normalizedCategory = normalizeCategoryName(match.category);
          if (normalizedCategory === "threats") {
            return true;
          }
          return false;
        }
      }
    }
    return false;
  }).length;

  // Calculate selected bag count for validation
  const selectedBagCount = Array.from(selectedItems).filter(itemId => {
    for (const subcats of Object.values(categorizedItems)) {
      for (const items of Object.values(subcats as Record<string, Item[]>)) {
        const match = (items as Item[]).find((item) => item.id === itemId);
        if (match) {
          const normalizedCategory = normalizeCategoryName(match.category);
          if (normalizedCategory === "bags") {
            return true;
          }
          return false;
        }
      }
    }
    return false;
  }).length;

  // Check if selection is incomplete (needs bag + at least one threat)
  const hasIncompleteSelection = selectedItems.size > 0 && (selectedBagCount === 0 || selectedThreatCount === 0);

  const getIncompleteSelectionMessage = () => {
    if (selectedItems.size === 0) return "";
    if (selectedBagCount === 0) return "Please select at least one bag item to generate a collage.";
    if (selectedThreatCount === 0) return "Please select at least one threat item to generate a collage.";
    return "";
  };

  const incompleteSelectionMessage = getIncompleteSelectionMessage();

  // Show notification when selection is incomplete (only once per transition)
  useEffect(() => {
    if (hasIncompleteSelection && !hasShownBagsOnlyNotification.current) {
      hasShownBagsOnlyNotification.current = true;
      showNotification("warning", incompleteSelectionMessage, 4000);
    } else if (!hasIncompleteSelection) {
      hasShownBagsOnlyNotification.current = false;
    }
  }, [hasIncompleteSelection, incompleteSelectionMessage, showNotification]);

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
          onDeleteSubcategory={deleteSubcategory}
        />
        <main className="flex-1 flex flex-col overflow-hidden">
          <LibraryToolbar
            title={activeCategoryConfig.label}
            itemCount={totalCategoryItemsCount}
            subcategoryCount={Object.keys(subcategoriesData).length}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />

          <div className="flex-1 overflow-hidden">
            {displayedItems.length === 0 ? (
              <div className="h-full overflow-y-auto p-5">
                <div className="text-center py-24 bg-panel rounded-2xl border border-border shadow-card">
                  <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
                    <Image size={28} className="text-muted/40" />
                  </div>
                  <h3 className="text-base font-semibold text-ink mb-1">No items found</h3>
                  <p className="text-sm text-muted">
                    {searchQuery ? "Try refining your search keyword." : "Upload scanned items to get started."}
                  </p>
                </div>
              </div>
            ) : (
              <VirtualizedItemGrid
                items={displayedItems}
                selectedItems={selectedItems}
                onSelect={toggleItemSelection}
                onOpen={openItemDetail}
                onEditRegion={(item) => {
                  setEditingRegionItem(item);
                  setIsValidRegionEditorOpen(true);
                }}
                onDelete={handleDeleteItem}
              />
            )}
          </div>
        </main>
      </div>

      <SelectionTray
        selectedCount={selectedItems.size}
        onClearSelection={() => setSelectedItems(new Set())}
        onGenerateCollage={handleGenerateCollage}
        kValue={kValue}
        setKValue={setKValue}
        maxThreats={maxThreats}
        setMaxThreats={setMaxThreats}
        threatDistribution={threatDistribution}
        setThreatDistribution={setThreatDistribution}
        maxNonThreats={maxNonThreats}
        setMaxNonThreats={setMaxNonThreats}
        nonThreatDistribution={nonThreatDistribution}
        setNonThreatDistribution={setNonThreatDistribution}
        selectedNonThreatCount={selectedNonThreatCount}
        requireAtLeastOneNonThreat={requireAtLeastOneNonThreat}
        setRequireAtLeastOneNonThreat={setRequireAtLeastOneNonThreat}
        isGenerating={isGenerating}
        generationProgress={generationProgress}
        onGenerate={handleGenerate}
        hasCombinations={combinations.length > 0}
        hasIncompleteSelection={hasIncompleteSelection}
        incompleteSelectionMessage={incompleteSelectionMessage}
      />

      {/* editingItem modal, notifications, confirmDialog, ValidRegionEditor, AddSubcategoryModal */}
      {editingItem && editDraft && (
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-6">
          <div className="w-full max-w-3xl rounded-3xl bg-panel border border-border shadow-2xl overflow-hidden">
            <div className="flex flex-col sm:flex-row gap-4 p-5 bg-surface border-b border-border">
              <div className="w-full sm:w-1/3 rounded-3xl overflow-hidden bg-surface border border-border">
                <img
                  src={`${API_BASE_URL}/data/library_images/${editingItem.filepath}`}
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
                      onChange={(e) => {
                        if (e.target.value === "__add_new__") {
                          openAddSubcategoryModal(selectedCategory.slug);
                        } else {
                          handleSubcategoryChange(e.target.value);
                        }
                      }}
                      className="w-full rounded-2xl border border-border bg-white px-3 py-2 text-sm text-ink"
                    >
                      {selectedCategory && (
                        <option value="__add_new__" className="text-accent font-medium">+ Add new subcategory</option>
                      )}
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
                  className="rounded-2xl border border-border bg-white px-4 py-2 text-sm font-medium text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveItemDetails}
                  disabled={isItemSaving}
                  className="rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-btn disabled:cursor-not-allowed disabled:opacity-60"
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
              className="ml-1 opacity-60 shrink-0"
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
                className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-ink"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRegionItem && isValidRegionEditorOpen && (
        <ValidRegionEditor
          key={editingRegionItem.id}
          imageSrc={`${API_BASE_URL}/data/library_images/${editingRegionItem.filepath}`}
          initialPoints={editingRegionItem.valid_region_points}
          itemId={editingRegionItem.id}
          onSave={handleValidRegionSave}
          onCancel={() => {
            setIsValidRegionEditorOpen(false);
            setEditingRegionItem(null);
          }}
          onDelete={handleValidRegionDelete}
          requireValidRegion={true}
        />
      )}

      {/* Add Subcategory Modal */}
      <AddSubcategoryModal
        isOpen={isAddSubcategoryModalOpen}
        onClose={() => setIsAddSubcategoryModalOpen(false)}
        onAdd={handleAddCustomSubcategory}
        categoryName={LIBRARIES.find(lib => lib.slug === addingSubcategoryFor)?.name || addingSubcategoryFor}
      />
    </div>
  );
}