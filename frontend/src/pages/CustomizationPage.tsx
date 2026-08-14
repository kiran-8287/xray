import React, { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  ZoomIn, ZoomOut, Maximize2, Sliders, ShieldAlert, ShieldCheck, Loader2, X, AlertCircle
} from "lucide-react";
import type { SceneObject } from "../types/customization";
import type { Item } from "../types/library";
import { 
  isObjectInsideContainer, 
  getRandomPositionInContainer, 
  getTransformedValidRegion 
} from "../lib/customizationHelpers";
import { getRectCorners } from "../lib/geometry";
import { loadMultipleImageDimensions } from "../lib/imageSizeLoader";
import { computeObjectStats, type ObjectPixelStats } from "../lib/xrayRenderer";
import { API_BASE_URL } from "../config/api";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { normalizeCategoryName, getCategoryConfig, normalizeCategorizedItems } from "../config/categories";
import { GenerationService } from "../lib/generationService";
import { attachSegmentationMasks, resolveItemOutline } from "../lib/segmentationMasks";
import ScannedBagsSidebar from "../components/customization/ScannedBagsSidebar";
import WorkspaceToolbar from "../components/customization/WorkspaceToolbar";
import CanvasArea from "../components/customization/CanvasArea";

function getStencilKind(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes("bag")) return "bag";
  if (normalized.includes("tray")) return "tray";
  if (normalized.includes("threat") || normalized.includes("prohibited")) return "threat";
  if (normalized.includes("cloth")) return "clothes";
  if (normalized.includes("electronics")) return "electronics";
  if (normalized.includes("food") || normalized.includes("drink")) return "food";
  if (normalized.includes("stationery") || normalized.includes("stationary") || normalized.includes("office")) return "stationary";
  if (normalized.includes("lag")) return "lag";
  return "stationary";
}

function getObjectSubcategory(obj: SceneObject, categorizedList: any): string | undefined {
  if (obj.subcategory) return obj.subcategory;
  if (!categorizedList) return undefined;

  const allItems: Item[] = [];
  Object.values(categorizedList).forEach((subcats: any) => {
    Object.values(subcats).forEach((items: any) => {
      if (Array.isArray(items)) {
        allItems.push(...items);
      }
    });
  });

  const matched = allItems.find((item) => item.filepath === obj.filepath || item.name === obj.name);
  return matched?.subcategory;
}

const CANVAS_W = 800;
const CANVAS_H = 600;

const toastStyles = `
  @keyframes slide-down {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-slide-down { animation: slide-down 0.2s ease-out; }
`;

function getItemDisplaySize(item: Item): { width: number; height: number } {
  const width = Number.isFinite(item.width) ? Math.round(item.width as number) : 0;
  const height = Number.isFinite(item.height) ? Math.round(item.height as number) : 0;

  if (width > 0 && height > 0) {
    return { width, height };
  }

  const fallback = 120;
  return { width: fallback, height: fallback };
}

export default function CustomizationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<SceneObject[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showValidRegion, setShowValidRegion] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [outOfBoundsNotification, setOutOfBoundsNotification] = useState<{ show: boolean; count: number }>({ show: false, count: 0 });
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "success" | "error"; message: string }>({ status: "idle", message: "" });
  
  const canvasDivRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const rotationStartAngleRef = useRef(0);
  const rotationStartRotationRef = useRef(0);
  const [activeLibrary, setActiveLibrary] = useState<string | null>(null);
  const [hasBag, setHasBag] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [lastSavedTime, setLastSavedTime] = useState<number>(0);
  const [categorizedList, setCategorizedList] = useState<any>(null);
  const [pixelStats, setPixelStats] = useState<Map<string, ObjectPixelStats>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const hasInitialized = useRef(false);
  const fetchInProgressRef = useRef(false);
  
  // Unsaved changes tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const lastSavedObjectsRef = useRef<SceneObject[] | null>(null);

  const [toasts, setToasts] = useState<{ id: string; type: 'success' | 'error' | 'info'; message: string }[]>([]);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  useEffect(() => {
    (async () => {
      // Guard against concurrent fetches that pile up requests
      if (fetchInProgressRef.current) {
        return;
      }
      fetchInProgressRef.current = true;
      try {
        const BATCH_SIZE = 500;
        const firstRes = await fetchWithTimeout(`${API_BASE_URL}/api/items/categorized?page=1&limit=${BATCH_SIZE}`, undefined, 30000, 3, 1000, [429]);
        const firstData = await firstRes.json();
        if (!firstData.ok) {
          setLoadError(firstData.error || "Failed to load library items.");
          return;
        }

        const totalPages = firstData.pagination?.totalPages || 1;
        
        // Fetch pages in batches to avoid overwhelming the server with 100+ concurrent requests
        const CONCURRENT_LIMIT = 5; // Max 5 concurrent requests
        const mergedCategorized: any = {};
        
        // Process first page immediately
        const batchCategorized = normalizeCategorizedItems(firstData.categorized);
        for (const [category, subcats] of Object.entries(batchCategorized)) {
          if (!mergedCategorized[category]) mergedCategorized[category] = {};
          for (const [subcat, items] of Object.entries(subcats as Record<string, any[]>)) {
            if (!mergedCategorized[category][subcat]) mergedCategorized[category][subcat] = [];
            mergedCategorized[category][subcat].push(...items);
          }
        }

        // Fetch remaining pages in batches
        const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        for (let i = 0; i < remainingPages.length; i += CONCURRENT_LIMIT) {
          const batch = remainingPages.slice(i, i + CONCURRENT_LIMIT);
          const pageFetches = batch.map(page => fetchWithTimeout(`${API_BASE_URL}/api/items/categorized?page=${page}&limit=${BATCH_SIZE}`, undefined, 30000, 3, 1000, [429]).then(res => res.json()));
          const batchResponses = await Promise.all(pageFetches);

          for (const data of batchResponses) {
            if (!data.ok) continue;
            const batchCategorized = normalizeCategorizedItems(data.categorized);
            for (const [category, subcats] of Object.entries(batchCategorized)) {
              if (!mergedCategorized[category]) mergedCategorized[category] = {};
              for (const [subcat, items] of Object.entries(subcats as Record<string, any[]>)) {
                if (!mergedCategorized[category][subcat]) mergedCategorized[category][subcat] = [];
                mergedCategorized[category][subcat].push(...items);
              }
            }
          }
        }

        setCategorizedList(mergedCategorized);
        setLoadError(null);
      } catch (err: any) {
        console.error("Error loading scanned bags in workspace:", err);
        setLoadError("Cannot connect to backend. Please verify the server is running.");
      } finally {
        fetchInProgressRef.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    if (!categorizedList) return;
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const bagId = searchParams.get("bagId") || "";
    const threatIdsStr = searchParams.get("threatIds") || "";
    const otherIds = searchParams.get("otherIds") || "";
    const precomputedId = searchParams.get("precomputed") || "";

    if (precomputedId) {
      const storageKey = `xray_workspace_precomputed_${precomputedId}`;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved && saved !== "undefined" && saved !== "null") {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setObjects(parsed);
            setHistory([parsed]);
            setHistoryIndex(0);
            sessionStorage.removeItem(storageKey);
            return;
          }
        }
      } catch (err) {
        console.error("Error loading pre-computed workspace:", err);
      }
    }

    const storageKey = `xray_workspace_${bagId}_${threatIdsStr}_${otherIds}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setObjects(parsed);
          setHistory([parsed]);
          setHistoryIndex(0);
          return;
        }
      }
    } catch (err) {
      console.error("Error loading saved workspace:", err);
    }

    const allItems: Item[] = [];
    Object.values(categorizedList).forEach((subcats: any) => {
      Object.values(subcats).forEach((items: any) => {
        if (Array.isArray(items)) allItems.push(...items);
      });
    });

    const allFilepaths = allItems.map(item => item.filepath).filter(Boolean) as string[];
    loadMultipleImageDimensions(allFilepaths).then(imageDimensions => {
      buildAndSetObjects(categorizedList, searchParams, setObjects, setHistory, setHistoryIndex, imageDimensions);
    }).catch(err => {
      console.error("Error loading image dimensions:", err);
      buildAndSetObjects(categorizedList, searchParams, setObjects, setHistory, setHistoryIndex, new Map());
    });
  }, [categorizedList]);

  useEffect(() => {
    if (!hasInitialized.current || objects.length === 0) return;
    const bagId = searchParams.get("bagId") || "";
    const threatIds = searchParams.get("threatIds") || searchParams.get("threatId") || "";
    const otherIds = searchParams.get("otherIds") || "";
    const storageKey = `xray_workspace_${bagId}_${threatIds}_${otherIds}`;
    localStorage.setItem(storageKey, JSON.stringify(objects));
  }, [objects, searchParams]);

  async function buildAndSetObjects(
    catList: any, 
    params: URLSearchParams, 
    setObj: typeof setObjects, 
    setHist: typeof setHistory, 
    setHIdx: typeof setHistoryIndex,
    imageDimensions: Map<string, { width: number; height: number }> = new Map()
  ) {
    const bagId = params.get("bagId");
    const threatIdsStr = params.get("threatIds") || "";
    const threatIds = threatIdsStr ? threatIdsStr.split(",").filter(Boolean) : [];
    const otherIdsStr = params.get("otherIds");
    const otherIds = otherIdsStr ? otherIdsStr.split(",").filter(Boolean) : [];
    const hasQueryParams = params.has("bagId") || params.has("threatIds") || params.has("threatId") || params.has("otherIds");

    const allItems: Item[] = [];
    Object.values(catList).forEach((subcats: any) => {
      Object.values(subcats).forEach((items: any) => {
        if (Array.isArray(items)) allItems.push(...items);
      });
    });

    // Attach segmentation masks to threats/non-threats BEFORE placement so random
    // placement + out-of-bounds checks use the tight mask footprint (-> axis-aligned
    // box) instead of the original image rectangle.
    try {
      await attachSegmentationMasks(allItems.filter((it) => normalizeCategoryName(it.category) !== "bags"));
    } catch (err) {
      console.warn("Could not attach segmentation masks:", err);
    }

    const normCat = (c: string) => normalizeCategoryName(c);
    const isBag = (item: Item) => normCat(item.category) === "bags";
    const isThreat = (item: Item) => normCat(item.category) === "threats";
    const isOther = (item: Item) => !isBag(item) && !isThreat(item);

    let newObjects: SceneObject[] = [];
    let layer = 0;
    let bagObject: SceneObject | null = null;

    const allBags = allItems.filter(isBag);
    const bagItem = allBags.find((b) => b.id === bagId) || (hasQueryParams ? null : allBags[0]);

    if (bagItem) {
      let bagOutline = null;
      if (bagItem.valid_region_points) {
        const raw = typeof bagItem.valid_region_points === "string" ? JSON.parse(bagItem.valid_region_points) : bagItem.valid_region_points;
        if (Array.isArray(raw)) {
          bagOutline = raw;
        } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          if (raw.simplifiedPoints && Array.isArray(raw.simplifiedPoints)) bagOutline = raw.simplifiedPoints;
          else if (raw.points && Array.isArray(raw.points)) bagOutline = raw.points;
          else if (raw.shapes && Array.isArray(raw.shapes)) {
            const positiveShape = raw.shapes.find((s: any) => s.isPositive !== false && s.points?.length >= 3);
            if (positiveShape) bagOutline = positiveShape.points;
            else if (raw.shapes.length > 0 && raw.shapes[0].points) bagOutline = raw.shapes[0].points;
          }
        }
      }
      if (!bagOutline && bagItem.polygon_json) {
        bagOutline = typeof bagItem.polygon_json === "string" ? JSON.parse(bagItem.polygon_json) : bagItem.polygon_json;
      }

      const naturalDims = imageDimensions.get(bagItem.filepath);
      const bagWidth = naturalDims?.width && naturalDims.width > 0 ? naturalDims.width : getItemDisplaySize(bagItem).width;
      const bagHeight = naturalDims?.height && naturalDims.height > 0 ? naturalDims.height : getItemDisplaySize(bagItem).height;

      bagObject = {
        id: "initial-bag",
        name: bagItem.name || bagItem.id,
        library: getStencilKind(bagItem.category),
        subcategory: bagItem.subcategory,
        originalPixelValue: bagItem.pixel_value,
        currentPixelValue: bagItem.pixel_value,
        stencilId: "bag",
        filepath: bagItem.filepath,
        polygonOutline: bagOutline,
        transform: { x: bagWidth / 2, y: bagHeight / 2, width: bagWidth, height: bagHeight, rotation: 0 },
        initialWidth: bagWidth,
        initialHeight: bagHeight,
        layer: layer++,
      };
      newObjects.push(bagObject);
    }

    const allOthers = allItems.filter(isOther);
    const matchedOthers = otherIds.map((id) => allOthers.find((item) => item.id === id)).filter(Boolean) as Item[];
    const itemsToPlace = hasQueryParams ? matchedOthers : (matchedOthers.length > 0 ? matchedOthers : allOthers.slice(0, 2));

    itemsToPlace.forEach((item, i) => {
      let itemOutline = resolveItemOutline(item);
      const naturalDims = imageDimensions.get(item.filepath);
      const w = naturalDims?.width && naturalDims.width > 0 ? naturalDims.width : getItemDisplaySize(item).width;
      const h = naturalDims?.height && naturalDims.height > 0 ? naturalDims.height : getItemDisplaySize(item).height;
      let pos = null as { x: number; y: number; rotation?: number } | null;
      if (bagObject) pos = getRandomPositionInContainer(w, h, bagObject, itemOutline);
      if (!pos) pos = { x: 50 + Math.random() * (CANVAS_W - 100), y: 50 + Math.random() * (CANVAS_H - 100), rotation: Math.random() * 360 };
      newObjects.push({
        id: `random-object-${i}`,
        name: item.name || item.id,
        library: getStencilKind(item.category),
        subcategory: item.subcategory,
        originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        stencilId: "item",
        filepath: item.filepath,
        polygonOutline: itemOutline,
        transform: { x: pos.x, y: pos.y, width: w, height: h, rotation: pos.rotation ?? Math.random() * 360 },
        initialWidth: w,
        initialHeight: h,
        layer: layer++,
      });
    });

    const allThreats = allItems.filter(isThreat);
    const matchedThreats = threatIds.map((id) => allThreats.find((t) => t.id === id)).filter(Boolean) as Item[];

    matchedThreats.forEach((threatItem, i) => {
      let threatOutline = resolveItemOutline(threatItem);
      const naturalDims = imageDimensions.get(threatItem.filepath);
      const w = naturalDims?.width && naturalDims.width > 0 ? naturalDims.width : getItemDisplaySize(threatItem).width;
      const h = naturalDims?.height && naturalDims.height > 0 ? naturalDims.height : getItemDisplaySize(threatItem).height;
      let pos = null as { x: number; y: number; rotation?: number } | null;
      if (bagObject) pos = getRandomPositionInContainer(w, h, bagObject, threatOutline);
      if (!pos) pos = { x: 50 + Math.random() * (CANVAS_W - 100), y: 50 + Math.random() * (CANVAS_H - 100), rotation: Math.random() * 360 };
      newObjects.push({
        id: `initial-threat-${i}`,
        name: threatItem.name || threatItem.id,
        library: getStencilKind(threatItem.category),
        subcategory: threatItem.subcategory,
        originalPixelValue: threatItem.pixel_value,
        currentPixelValue: threatItem.pixel_value,
        stencilId: "threat",
        filepath: threatItem.filepath,
        polygonOutline: threatOutline,
        transform: { x: pos.x, y: pos.y, width: w, height: h, rotation: pos.rotation ?? Math.random() * 360 },
        initialWidth: w,
        initialHeight: h,
        layer: layer++,
      });
    });

    if (newObjects.length > 0) {
      setObj(newObjects);
      setHist([newObjects]);
      setHIdx(0);
    }
  }

  const handleRandomize = () => {
    if (!categorizedList) return;
    hasInitialized.current = false;
    const bagId = searchParams.get("bagId") || "";
    const threatIds = searchParams.get("threatIds") || searchParams.get("threatId") || "";
    const otherIds = searchParams.get("otherIds") || "";
    const storageKey = `xray_workspace_${bagId}_${threatIds}_${otherIds}`;
    localStorage.removeItem(storageKey);
    buildAndSetObjects(categorizedList, searchParams, setObjects, setHistory, setHistoryIndex);
    hasInitialized.current = true;
  };

  useEffect(() => {
    setHasBag(objects.some((obj) => obj.library === "bag"));
  }, [objects]);

  const pushHistory = (newObjects: SceneObject[]) => {
    const updatedHistory = history.slice(0, historyIndex + 1);
    updatedHistory.push([...newObjects]);
    setHistory(updatedHistory);
    setHistoryIndex(updatedHistory.length - 1);
  };

  const handleAddObject = async (item: Item) => {
    // Allow the same library item to be placed multiple times (repetitions are
    // useful for generating diversity, e.g. a bag with 2 earphones vs 1 earphone
    // + 1 book). Each placement gets a unique instance id so React keys and
    // selection stay correct; `itemId` always points back to the library item.
    const instanceId = `${item.id}__${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    // Attach the segmentation mask (if not already present) so this object is
    // placed with the tight mask footprint (-> axis-aligned box).
    if (item.category !== "bags") {
      try {
        await attachSegmentationMasks([item]);
      } catch (err) {
        console.warn("Could not attach segmentation mask:", err);
      }
    }

    let width = item.width || 100;
    let height = item.height || 100;
    let itemOutline = resolveItemOutline(item);

    const bagObject = objects.find((obj) => obj.library === "bag");
    let pos = null as { x: number; y: number; rotation?: number } | null;
    if (bagObject && item.category !== "bags") pos = getRandomPositionInContainer(width, height, bagObject, itemOutline);
    if (!pos) pos = { x: 50 + Math.random() * (CANVAS_W - 100), y: 50 + Math.random() * (CANVAS_H - 100), rotation: Math.random() * 360 };

    const newObject: SceneObject = {
      id: instanceId,
      itemId: item.id,
      name: item.name || item.id,
      library: getStencilKind(item.category),
      subcategory: item.subcategory,
      originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        stencilId: "item",
      filepath: item.filepath,
      polygonOutline: itemOutline,
      transform: { x: pos.x, y: pos.y, width, height, rotation: pos.rotation ?? Math.random() * 360 },
      initialWidth: width,
      initialHeight: height,
      layer: objects.length,
    };

    const newObjects = [...objects, newObject];
    pushHistory(newObjects);
    setObjects(newObjects);
    setSelectedObjectId(newObject.id);
    setActiveLibrary(null);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setObjects([...history[historyIndex - 1]]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setObjects([...history[historyIndex + 1]]);
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedObjectId) return;
    const newObjects = objects.filter((obj) => obj.id !== selectedObjectId);
    pushHistory(newObjects);
    setObjects(newObjects);
    setSelectedObjectId(null);
  };

  const handleMouseDown = (e: React.MouseEvent, obj: SceneObject) => {
    e.stopPropagation();
    if (obj.library === "bag") return;
    setSelectedObjectId(obj.id);
    setIsDragging(true);
    setDragStart({ x: e.clientX - obj.transform.x, y: e.clientY - obj.transform.y });
  };

  const handleRotationMouseDown = (e: React.MouseEvent, obj: SceneObject) => {
    e.stopPropagation();
    if (obj.library === "bag") return;
    setSelectedObjectId(obj.id);
    if (!canvasDivRef.current) return;
    const rect = canvasDivRef.current.getBoundingClientRect();
    // Use the same coordinate space as handleMouseMove: canvas coordinates
    // (center is already in canvas space; convert the client mouse pos by /zoom).
    const centerX = obj.transform.x;
    const centerY = obj.transform.y;
    const mouseX = (e.clientX - rect.left) / zoom;
    const mouseY = (e.clientY - rect.top) / zoom;
    rotationStartAngleRef.current = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
    rotationStartRotationRef.current = obj.transform.rotation;
    setIsRotating(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && selectedObjectId) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      setObjects(objects.map((obj) => obj.id === selectedObjectId ? { ...obj, transform: { ...obj.transform, x: newX, y: newY } } : obj));
    } else if (isRotating && selectedObjectId) {
      const selectedObj = objects.find((o) => o.id === selectedObjectId);
      if (!selectedObj || !canvasDivRef.current) return;
      const rect = canvasDivRef.current.getBoundingClientRect();
      const centerX = selectedObj.transform.x;
      const centerY = selectedObj.transform.y;
      const mouseX = (e.clientX - rect.left) / zoom;
      const mouseY = (e.clientY - rect.top) / zoom;
      const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
      const deltaAngle = currentAngle - rotationStartAngleRef.current;
      let angle = rotationStartRotationRef.current + deltaAngle;
      // Normalize so it never accumulates past 360° (487° === 127° visually,
      // but keeps the displayed value in the expected 0–360 range).
      angle = ((angle % 360) + 360) % 360;
      setObjects(objects.map((obj) => obj.id === selectedObjectId ? { ...obj, transform: { ...obj.transform, rotation: Math.round(angle) } } : obj));
    }
  };

  const handleMouseUp = () => {
    if (isDragging || isRotating) pushHistory(objects);
    setIsDragging(false);
    setIsRotating(false);
    computeStats();
  };

  const computeStats = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, 800, 600);
    const stats = computeObjectStats(objects, imageData);
    setPixelStats(new Map(stats));
  };

  const handleAutoSave = async () => {
    const bagObjectNow = objects.find(o => o.library === "bag");
    const outOfBoundsNow = objects.filter(obj => bagObjectNow && obj.library !== "bag" && !isObjectInsideContainer(obj, bagObjectNow));
    if (outOfBoundsNow.length > 0) {
      setSaveState({ status: "error", message: `Cannot save: ${outOfBoundsNow.length} object(s) out of bounds.` });
      setTimeout(() => setSaveState({ status: "idle", message: "" }), 3000);
      return;
    }
    const nonBagObjects = objects.filter(o => o.library !== "bag");
    if (nonBagObjects.length === 0) {
      setSaveState({ status: "error", message: "Cannot save: bag must contain at least one threat or non-threat." });
      setTimeout(() => setSaveState({ status: "idle", message: "" }), 3000);
      return;
    }

    setSaveState({ status: "saving", message: "Saving..." });
    try {
      const threatNames = objects.filter(o => o.library === "threat").map(o => o.name || o.id);
      const otherNames = objects.filter(o => o.library !== "bag" && o.library !== "threat").map(o => o.name || o.id);
      const allObjects = [...threatNames, ...otherNames];
      const annotation = `${bagObjectNow?.name || "Workspace"}${allObjects.length > 0 ? ` containing ${allObjects.join(", ")}` : ""}`;

      const bagObject = objects.find(o => o.library === "bag");
      const validRegionPolygon = bagObject ? getTransformedValidRegion(bagObject) : [];
      let bagTopLeft = { x: 0, y: 0 };
      if (bagObject) {
        const bagCorners = getRectCorners({ x: bagObject.transform.x || 0, y: bagObject.transform.y || 0 }, { width: bagObject.transform.width || 0, height: bagObject.transform.height || 0 }, bagObject.transform.rotation || 0);
        bagTopLeft = bagCorners[0];
      }

      let bagTags: string[] = [];
      if (bagObject?.id) {
        try {
          const itemResponse = await fetch(`${API_BASE_URL}/api/items/${encodeURIComponent(bagObject.id)}`);
          if (itemResponse.ok) {
            const itemData = await itemResponse.json();
            if (itemData.item?.tags && Array.isArray(itemData.item.tags)) bagTags = itemData.item.tags;
          }
        } catch (err) {
          console.warn("Failed to fetch bag tags:", err);
        }
      }

      const bagObj = bagObject ? {
        id: bagObject.id,
        subcategory: bagObject.subcategory ? bagObject.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
        filepath: bagObject.filepath,
        center: { x: bagObject.transform.x, y: bagObject.transform.y },
        size: { width: bagObject.transform.width, height: bagObject.transform.height },
        originalPixelValue: bagObject.originalPixelValue,
        currentPixelValue: bagObject.currentPixelValue,
        polygonOutline: bagObject.polygonOutline,
        validRegionPolygon,
        layer: bagObject.layer,
        tags: bagTags.length > 0 ? bagTags : undefined,
      } : null;

      const threats = objects.filter(o => o.library === "threat").map(obj => ({
        // Use the original library item id (itemId) so the backend can resolve
        // pixel data / masks even when the same item is placed multiple times.
        id: obj.itemId || obj.id,
        subcategory: obj.subcategory ? obj.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
        filepath: obj.filepath,
        center: { x: obj.transform.x, y: obj.transform.y },
        size: { width: obj.transform.width, height: obj.transform.height },
        rotation: obj.transform.rotation,
        originalPixelValue: obj.originalPixelValue,
        currentPixelValue: obj.currentPixelValue,
        layer: obj.layer,
      }));

      const nonThreats = objects.filter(o => o.library !== "bag" && o.library !== "threat").map(obj => ({
        // Use the original library item id (itemId) so the backend can resolve
        // pixel data / masks even when the same item is placed multiple times.
        id: obj.itemId || obj.id,
        subcategory: obj.subcategory ? obj.subcategory.toLowerCase().replace(/\s+/g, '-') : undefined,
        filepath: obj.filepath,
        center: { x: obj.transform.x, y: obj.transform.y },
        size: { width: obj.transform.width, height: obj.transform.height },
        rotation: obj.transform.rotation,
        originalPixelValue: obj.originalPixelValue,
        currentPixelValue: obj.currentPixelValue,
        layer: obj.layer,
      }));

      const layout_json = {
        threat_count: threats.length,
        non_threat_count: nonThreats.length,
        objects: { bag: bagObj, threats, "non-threats": nonThreats },
        createdAt: new Date().toISOString(),
      };

      const precomputedId = searchParams.get("precomputed") || "";
      setSaveState({ status: "success", message: `Changes saved to collage!` });
      setLastSavedTime(Date.now());
      
      // Update the last saved reference
      lastSavedObjectsRef.current = objects;
      setHasUnsavedChanges(false);
      
      const bagId = searchParams.get("bagId") || "";
      const threatIds = searchParams.get("threatIds") || searchParams.get("threatId") || "";
      const otherIds = searchParams.get("otherIds") || "";
      const storageKey = `xray_workspace_${bagId}_${threatIds}_${otherIds}`;
      localStorage.setItem(storageKey, JSON.stringify(objects));
      
      if (precomputedId) {
        try {
          GenerationService.updateCombination(precomputedId, objects);
        } catch (err) {
          console.error("Error updating collage combinations:", err);
        }
      }
      
      setTimeout(() => setSaveState({ status: "idle", message: "" }), 3000);
    } catch (error) {
      console.error("Save error:", error);
      setSaveState({ status: "error", message: "Failed to save. Make sure backend is running." });
      setTimeout(() => setSaveState({ status: "idle", message: "" }), 3000);
    }
  };

  const bagObject = objects.find(o => o.library === "bag");
  const outOfBoundsObjects = objects.filter(obj => bagObject && obj.library !== "bag" && !isObjectInsideContainer(obj, bagObject));

  useEffect(() => {
    computeStats();
  }, [selectedObjectId, objects]);

  useEffect(() => {
    const bagObjectNow = objects.find(o => o.library === "bag");
    const outOfBoundsNow = objects.filter(obj => bagObjectNow && obj.library !== "bag" && !isObjectInsideContainer(obj, bagObjectNow));
    if (outOfBoundsNow.length > 0) {
      setOutOfBoundsNotification({ show: true, count: outOfBoundsNow.length });
      const timer = setTimeout(() => setOutOfBoundsNotification({ show: false, count: 0 }), 5000);
      return () => clearTimeout(timer);
    } else {
      setOutOfBoundsNotification({ show: false, count: 0 });
    }
  }, [objects]);

  // Track unsaved changes
  useEffect(() => {
    if (objects.length === 0) {
      setHasUnsavedChanges(false);
      return;
    }
    
    // If we haven't saved yet, any changes are unsaved
    if (!lastSavedObjectsRef.current) {
      setHasUnsavedChanges(true);
      return;
    }
    
    // Compare current objects with last saved state
    const hasChanges = JSON.stringify(objects) !== JSON.stringify(lastSavedObjectsRef.current);
    setHasUnsavedChanges(hasChanges);
  }, [objects]);

  // Initialize lastSavedObjectsRef when objects are first loaded
  useEffect(() => {
    if (objects.length > 0 && !lastSavedObjectsRef.current) {
      lastSavedObjectsRef.current = objects;
    }
  }, [objects]);

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedModal(true);
    } else {
      navigate(-1);
    }
  };

  const handleDiscardChanges = () => {
    setShowUnsavedModal(false);
    setHasUnsavedChanges(false);
    lastSavedObjectsRef.current = null;
    navigate(-1);
  };

  const handleContinueEditing = () => {
    setShowUnsavedModal(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] bg-surface overflow-hidden animate-fade-in text-sm">
      <WorkspaceToolbar
        bagObjectName={bagObject ? bagObject.name : ""}
        undoDisabled={historyIndex <= 0}
        redoDisabled={historyIndex >= history.length - 1}
        selectedObjectId={selectedObjectId}
        showValidRegion={showValidRegion}
        showGrid={showGrid}
        outOfBoundsCount={outOfBoundsObjects.length}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        setShowValidRegion={setShowValidRegion}
        setShowGrid={setShowGrid}
        handleDeleteSelected={handleDeleteSelected}
        handleRandomize={handleRandomize}
        handleSave={handleAutoSave}
        hasUnsavedChanges={hasUnsavedChanges}
        handleBack={handleBack}
      />

      {/* Unsaved Changes Modal */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleContinueEditing} />
          <div className="relative z-[10000] w-full max-w-md bg-white rounded-2xl shadow-lg border border-border p-6">
            <h3 className="text-base font-semibold text-ink mb-2 font-heading">Unsaved Changes</h3>
            <p className="text-sm text-muted mb-5">
              You have unsaved changes to this bag. If you leave now, your edits will be lost.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleDiscardChanges}
                className="w-full px-4 py-2.5 rounded-xl bg-rose-600 text-white font-semibold text-sm hover:shadow-btn-hover transition-all"
              >
                Discard & Leave
              </button>
              <button
                onClick={handleContinueEditing}
                className="w-full px-4 py-2.5 rounded-xl bg-panel border border-border text-ink font-semibold text-sm hover:bg-surface transition-all"
              >
                Continue Editing
              </button>
            </div>
          </div>
        </div>
      )}

      {saveState.status !== "idle" && (
        <div className={`absolute top-28 right-4 z-50 px-4 py-2.5 rounded-xl shadow-panel border flex items-center gap-2 animate-slide-up ${
          saveState.status === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
            : saveState.status === "error" ? "bg-rose-50 border-rose-200 text-rose-800"
            : "bg-blue-50 border-blue-200 text-blue-800"
        }`}>
          {saveState.status === "success" ? <ShieldCheck size={16} /> : saveState.status === "error" ? <ShieldAlert size={16} /> : <Loader2 size={16} className="animate-spin" />}
          <span className="font-semibold text-xs">{saveState.message}</span>
        </div>
      )}

      {loadError && (
        <div className="absolute top-28 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-panel border border-rose-200 bg-rose-50 text-rose-800 flex items-center gap-3 animate-slide-up">
          <ShieldAlert size={18} className="shrink-0" />
          <span className="font-semibold text-xs">{loadError}</span>
          <button onClick={() => setLoadError(null)} className="ml-2 text-rose-600 hover:text-rose-800" title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        <ScannedBagsSidebar
          activeLibrary={activeLibrary}
          setActiveLibrary={setActiveLibrary}
          hasBag={hasBag}
          handleAddObject={handleAddObject}
          categorizedList={categorizedList}
          sidebarSearch={sidebarSearch}
          setSidebarSearch={setSidebarSearch}
          canvasObjects={objects}
          selectedObjectId={selectedObjectId}
          onSelectCanvasObject={(id) => {
            if (id && objects.find(o => o.id === id && o.library === "bag")) return;
            setSelectedObjectId(id);
          }}
          onRemoveCanvasObject={(id) => {
            const newObjects = objects.filter(o => o.id !== id);
            pushHistory(newObjects);
            setObjects(newObjects);
            if (selectedObjectId === id) setSelectedObjectId(null);
          }}
        />

        <CanvasArea
          canvasDivRef={canvasDivRef}
          zoom={zoom}
          objects={objects}
          selectedObjectId={selectedObjectId}
          showValidRegion={showValidRegion}
          showGrid={showGrid}
          handleMouseDown={handleMouseDown}
          handleRotationMouseDown={handleRotationMouseDown}
          handleMouseMove={handleMouseMove}
          handleMouseUp={handleMouseUp}
        />

        <div className="absolute bottom-12 right-60 flex gap-1 z-10 shadow-card">
          <button onClick={() => setZoom(prev => Math.min(2, prev + 0.1))} className="w-7 h-7 bg-panel/90 border border-border rounded-md flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-panel transition-colors" title="Zoom In">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setZoom(prev => Math.max(0.5, prev - 0.1))} className="w-7 h-7 bg-panel/90 border border-border rounded-md flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-panel transition-colors" title="Zoom Out">
            <ZoomOut size={14} />
          </button>
          <button onClick={() => setZoom(1)} className="w-7 h-7 bg-panel/90 border border-border rounded-md flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-panel transition-colors" title="Reset Zoom">
            <Maximize2 size={14} />
          </button>
        </div>

        <aside className="w-64 border-l border-border bg-nav flex flex-col overflow-y-auto flex-shrink-0">
          <div className="px-4 py-3 border-b border-border bg-panel flex items-center gap-2">
            <Sliders size={14} className="text-accent" />
            <h3 className="font-semibold text-ink text-xs uppercase tracking-wider">Properties</h3>
          </div>

          {selectedObjectId ? (
            (() => {
              const selectedObj = objects.find((o) => o.id === selectedObjectId);
              if (!selectedObj) return null;
              const isValid = bagObject && selectedObj.library !== "bag" ? isObjectInsideContainer(selectedObj, bagObject) : true;
              const config = getCategoryConfig(selectedObj.library);

              return (
                <div className="p-3 space-y-4">
                  {selectedObj.library !== "bag" && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Placement Validity</span>
                      {isValid ? (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between text-emerald-800">
                          <span className="text-xs font-bold uppercase tracking-wider">Valid</span>
                          <ShieldCheck size={14} className="text-emerald-600" />
                        </div>
                      ) : (
                        <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-center justify-between text-rose-800">
                          <span className="text-xs font-bold uppercase tracking-wider">Out of Bounds</span>
                          <ShieldAlert size={14} className="text-rose-600" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Object Info</span>
                    <div className="space-y-1.5">
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 space-y-1">
                        <span className="text-[11px] text-muted uppercase tracking-wider block">Name</span>
                        <span className="text-xs font-semibold text-ink max-w-[100px] truncate">{selectedObj.name || selectedObj.id}</span>
                      </div>
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Category</span>
                        <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-md border ${config.bg} ${config.text} ${config.border}`}>
                          {selectedObj.library}
                        </span>
                      </div>
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 space-y-1">
                        <span className="text-[11px] text-muted uppercase tracking-wider block">Subcategory</span>
                        <span className="text-xs font-semibold text-ink max-w-[100px] truncate">{getObjectSubcategory(selectedObj, categorizedList) || "General"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Transform</span>
                    <div className="space-y-1.5">
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Position X</span>
                        {selectedObj.library !== "bag" ? (
                          <input type="number" value={Math.round(selectedObj.transform.x)} onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setObjects(objects.map((o) => o.id === selectedObjectId ? { ...o, transform: { ...o.transform, x: val } } : o));
                          }} onBlur={() => pushHistory(objects)} className="w-20 bg-surface border border-border rounded px-1.5 py-0.5 text-right font-mono text-xs text-ink focus:outline-none focus:border-accent" />
                        ) : <span className="font-mono text-muted text-xs">{Math.round(selectedObj.transform.x)} px</span>}
                      </div>
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Position Y</span>
                        {selectedObj.library !== "bag" ? (
                          <input type="number" value={Math.round(selectedObj.transform.y)} onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setObjects(objects.map((o) => o.id === selectedObjectId ? { ...o, transform: { ...o.transform, y: val } } : o));
                          }} onBlur={() => pushHistory(objects)} className="w-20 bg-surface border border-border rounded px-1.5 py-0.5 text-right font-mono text-xs text-ink focus:outline-none focus:border-accent" />
                        ) : <span className="font-mono text-muted text-xs">{Math.round(selectedObj.transform.y)} px</span>}
                      </div>
                      {selectedObj.library !== "bag" && (
                        <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                          <span className="text-[11px] text-muted uppercase tracking-wider">Rotation</span>
                          <input type="number" value={Math.round(selectedObj.transform.rotation)} onChange={(e) => {
                            let val = parseInt(e.target.value) || 0;
                            // Normalize to 0–360 so out-of-range values (e.g. 487) can't be stored.
                            val = ((val % 360) + 360) % 360;
                            setObjects(objects.map((o) => o.id === selectedObjectId ? { ...o, transform: { ...o.transform, rotation: val } } : o));
                          }} onBlur={() => pushHistory(objects)} className="w-20 bg-surface border border-border rounded px-1.5 py-0.5 text-right font-mono text-xs text-ink focus:outline-none focus:border-accent" />
                        </div>
                      )}
                      {selectedObj.library === "bag" && (
                        <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                          <span className="text-[11px] text-muted uppercase tracking-wider">Rotation</span>
                          <span className="font-mono text-muted text-xs">Fixed (0°)</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex-1 flex flex-col p-4 space-y-4">
              {outOfBoundsObjects.length > 0 ? (
                <div className="space-y-2">
                  <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider flex items-center gap-1">
                    <ShieldAlert size={12} /> Out of Bounds ({outOfBoundsObjects.length})
                  </span>
                  <div className="space-y-1">
                    {outOfBoundsObjects.map((obj) => (
                      <div key={obj.id} onClick={() => setSelectedObjectId(obj.id)} className="bg-rose-50 border border-rose-100 rounded-lg p-2 text-rose-800 text-xs font-medium cursor-pointer hover:bg-rose-100/50 transition-colors">
                        {obj.name || obj.id}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                bagObject && objects.length > 1 && (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-emerald-800 text-xs flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-emerald-600 flex-shrink-0" />
                    <span>All scanned bags are in the valid container region</span>
                  </div>
                )
              )}
              <div className="text-center py-12 text-xs text-muted leading-relaxed">
                Select any scanned bag in the canvas to view or edit transform properties and pixel info.
              </div>
            </div>
          )}
        </aside>

        {toasts.length > 0 && (
          <>
            <style>{toastStyles}</style>
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
              {toasts.map(t => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium animate-slide-down"
                  style={{
                    backgroundColor: t.type === 'success' ? '#ECFDF5' : t.type === 'error' ? '#FEF2F2' : '#EFF4FF',
                    borderColor: t.type === 'success' ? '#6EE7B7' : t.type === 'error' ? '#FCA5A5' : '#BFDBFE',
                    color: t.type === 'success' ? '#065F46' : t.type === 'error' ? '#991B1B' : '#1E40AF'
                  }}
                >
                  {t.type === 'success' && <ShieldCheck size={16} />}
                  {t.type === 'error' && <ShieldAlert size={16} />}
                  {t.type === 'info' && <AlertCircle size={16} />}
                  {t.message}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}