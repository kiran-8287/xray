import React, { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { 
  ZoomIn, ZoomOut, Maximize2, Sliders, ShieldAlert, ShieldCheck, Loader2
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
import { normalizeCategoryName, getCategoryConfig, normalizeCategorizedItems } from "../config/categories";
import ScannedBagsSidebar from "../components/customization/ScannedBagsSidebar";
import WorkspaceToolbar from "../components/customization/WorkspaceToolbar";
import CanvasArea from "../components/customization/CanvasArea";

// Use centralized category normalization and config

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
  return "stationary"; // fallback
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "success" | "error"; message: string }>({ status: "idle", message: "" });
  const [showBackNavigationModal, setShowBackNavigationModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [lastSavedObjects, setLastSavedObjects] = useState<string | null>(null);
  
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
  const hasInitialized = useRef(false);

  // Fetch all scanned bags from DB on mount
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/items/categorized`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setCategorizedList(normalizeCategorizedItems(data.categorized));
        }
      })
      .catch((err) => console.error("Error loading scanned bags in workspace:", err));
  }, []);

  // Initialize objects from URL query params — runs only ONCE after data loads
  useEffect(() => {
    if (!categorizedList) return;
    if (hasInitialized.current) return; // Prevent re-randomizing on HMR / state updates
    hasInitialized.current = true;

    const bagId = searchParams.get("bagId") || "";
    const threatId = searchParams.get("threatId") || "";
    const otherIds = searchParams.get("otherIds") || "";
    const precomputedId = searchParams.get("precomputed") || "";

    // 1. Check if we have pre-computed objects from combination generator
    if (precomputedId) {
      const storageKey = `xray_workspace_precomputed_${precomputedId}`;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setObjects(parsed);
            setHistory([parsed]);
            setHistoryIndex(0);
            // Initialize lastSavedObjectsRef with loaded objects (they're already "saved")
            setLastSavedObjects(JSON.stringify(parsed));
            setHasUnsavedChanges(false);
            // Clean up the session storage
            sessionStorage.removeItem(storageKey);
            return;
          }
        }
      } catch (err) {
        console.error("Error loading pre-computed workspace:", err);
      }
    }

    // 2. Check localStorage for previously saved workspace
    const storageKey = `xray_workspace_${bagId}_${threatId}_${otherIds}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setObjects(parsed);
          setHistory([parsed]);
          setHistoryIndex(0);
          // Initialize lastSavedObjectsRef with loaded objects (they're already "saved")
            setLastSavedObjects(JSON.stringify(parsed));
            setHasUnsavedChanges(false);
            return;
        }
      }
    } catch (err) {
      console.error("Error loading saved workspace:", err);
    }

    // 3. Fall back to random generation - load natural dimensions first
    const allItems: Item[] = [];
    Object.values(categorizedList).forEach((subcats: any) => {
      Object.values(subcats).forEach((items: any) => {
        if (Array.isArray(items)) {
          allItems.push(...items);
        }
      });
    });

    const allFilepaths = allItems.map(item => item.filepath).filter(Boolean) as string[];
    
    loadMultipleImageDimensions(allFilepaths).then(imageDimensions => {
      buildAndSetObjects(categorizedList, searchParams, setObjects, setHistory, setHistoryIndex, imageDimensions);
    }).catch(err => {
      console.error("Error loading image dimensions:", err);
      // Fall back to database dimensions if image loading fails
      buildAndSetObjects(categorizedList, searchParams, setObjects, setHistory, setHistoryIndex, new Map());
    });
  }, [categorizedList]);

  // Save workspace layout to localStorage on changes (so page refresh doesn't lose it)
  useEffect(() => {
    if (!hasInitialized.current || objects.length === 0) return;
    const bagId = searchParams.get("bagId") || "";
    const threatId = searchParams.get("threatId") || "";
    const otherIds = searchParams.get("otherIds") || "";
    const storageKey = `xray_workspace_${bagId}_${threatId}_${otherIds}`;
    localStorage.setItem(storageKey, JSON.stringify(objects));
  }, [objects, searchParams]);

  // Track unsaved changes by comparing with last saved state
  useEffect(() => {
    if (!hasInitialized.current || objects.length === 0) return;
    
    const currentObjectsStr = JSON.stringify(objects);
    const hasChanges = lastSavedObjects !== currentObjectsStr;
    setHasUnsavedChanges(hasChanges);
  }, [objects]);

  // Shared builder extracted so the Randomize button can call it again
  function buildAndSetObjects(
    catList: any, 
    params: URLSearchParams, 
    setObj: typeof setObjects, 
    setHist: typeof setHistory, 
    setHIdx: typeof setHistoryIndex,
    imageDimensions: Map<string, { width: number; height: number }> = new Map()
  ) {
    const bagId = params.get("bagId");
    const threatId = params.get("threatId");
    const otherIdsStr = params.get("otherIds");
    const otherIds = otherIdsStr ? otherIdsStr.split(",").filter(Boolean) : [];
    const hasQueryParams = params.has("bagId") || params.has("threatId") || params.has("otherIds");

    // Flatten all items across all categories and subcategories
    const allItems: Item[] = [];
    Object.values(catList).forEach((subcats: any) => {
      Object.values(subcats).forEach((items: any) => {
        if (Array.isArray(items)) {
          allItems.push(...items);
        }
      });
    });

    const normCat = (c: string) => normalizeCategoryName(c);
    const isBag = (item: Item) => normCat(item.category) === "bags";
    const isThreat = (item: Item) => normCat(item.category) === "threats";
    const isOther = (item: Item) => !isBag(item) && !isThreat(item);

    let newObjects: SceneObject[] = [];
    let layer = 0;
    let bagObject: SceneObject | null = null;

    // 1. Locate the bag
    const allBags = allItems.filter(isBag);
    const bagItem = allBags.find((b) => b.id === bagId) || (hasQueryParams ? null : allBags[0]);

    if (bagItem) {
      let bagOutline = null;
      if (bagItem.valid_region_points) {
        const raw = typeof bagItem.valid_region_points === "string"
          ? JSON.parse(bagItem.valid_region_points)
          : bagItem.valid_region_points;
        // Extract points from both formats:
        // 1. Direct array of points: [{x,y}, {x,y}, ...]
        // 2. Simplified format: { points: [...], simplifiedPoints: [...] }
        // 3. Legacy shapes format: { shapes: [...], simplifiedPoints: [{x,y}, ...] }
        if (Array.isArray(raw)) {
          bagOutline = raw;
        } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          if (raw.simplifiedPoints && Array.isArray(raw.simplifiedPoints)) {
            bagOutline = raw.simplifiedPoints;
          } else if (raw.points && Array.isArray(raw.points)) {
            bagOutline = raw.points;
          } else if (raw.shapes && Array.isArray(raw.shapes)) {
            // Try to extract from first positive polygon shape
            const positiveShape = raw.shapes.find((s: any) => s.isPositive !== false && s.points?.length >= 3);
            if (positiveShape) {
              bagOutline = positiveShape.points;
            } else if (raw.shapes.length > 0 && raw.shapes[0].points) {
              bagOutline = raw.shapes[0].points;
            }
          }
        }
      }
      if (!bagOutline && bagItem.polygon_json) {
        bagOutline = typeof bagItem.polygon_json === "string"
          ? JSON.parse(bagItem.polygon_json)
          : bagItem.polygon_json;
      }

      // Use the bag's natural image dimensions so the image renders 1:1
      // and the valid region polygon maps correctly without any scaling.
      // This preserves every pixel and keeps the valid region in sync
      // across the editor and customization canvas.
      const naturalDims = imageDimensions.get(bagItem.filepath);
      const bagWidth = naturalDims?.width && naturalDims.width > 0 ? naturalDims.width : getItemDisplaySize(bagItem).width;
      const bagHeight = naturalDims?.height && naturalDims.height > 0 ? naturalDims.height : getItemDisplaySize(bagItem).height;

      bagObject = {
        id: "initial-bag",
        name: bagItem.name,
        library: getStencilKind(bagItem.category),
        subcategory: bagItem.subcategory,
        originalPixelValue: bagItem.pixel_value,
        currentPixelValue: bagItem.pixel_value,
        oldPixelValue: null,
        stencilId: "bag",
        filepath: bagItem.filepath,
        polygonOutline: bagOutline,
        transform: {
          x: bagWidth / 2,
          y: bagHeight / 2,
          width: bagWidth,
          height: bagHeight,
          rotation: 0,
        },
        initialWidth: bagWidth,
        initialHeight: bagHeight,
        layer: layer++,
      };
      newObjects.push(bagObject);
    }

    // 2. Locate other items
    const allOthers = allItems.filter(isOther);
    const matchedOthers = otherIds
      .map((id) => allOthers.find((item) => item.id === id))
      .filter(Boolean) as Item[];
    const itemsToPlace = hasQueryParams ? matchedOthers : (matchedOthers.length > 0 ? matchedOthers : allOthers.slice(0, 2));

    itemsToPlace.forEach((item, i) => {
      let itemOutline = null;
      if (item.polygon_json) {
        itemOutline = typeof item.polygon_json === "string"
          ? JSON.parse(item.polygon_json)
          : item.polygon_json;
      }
      // Use natural image dimensions if available, otherwise fall back to database dimensions
      const naturalDims = imageDimensions.get(item.filepath);
      const w = naturalDims?.width && naturalDims.width > 0 ? naturalDims.width : getItemDisplaySize(item).width;
      const h = naturalDims?.height && naturalDims.height > 0 ? naturalDims.height : getItemDisplaySize(item).height;
      let pos = null as { x: number; y: number; rotation?: number } | null;
      if (bagObject) {
        pos = getRandomPositionInContainer(w, h, bagObject, itemOutline);
      }
      if (!pos) {
        const padding = 50;
        pos = { x: padding + Math.random() * (CANVAS_W - 2 * padding), y: padding + Math.random() * (CANVAS_H - 2 * padding), rotation: Math.random() * 360 };
      }
      newObjects.push({
        id: `random-object-${i}`,
        name: item.name,
        library: getStencilKind(item.category),
        subcategory: item.subcategory,
        originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        oldPixelValue: null,
        stencilId: "item",
        filepath: item.filepath,
        polygonOutline: itemOutline,
        transform: { x: pos.x, y: pos.y, width: w, height: h, rotation: pos.rotation ?? Math.random() * 360 },
        initialWidth: w,
        initialHeight: h,
        layer: layer++,
      });
    });

    // 3. Locate threat
    const allThreats = allItems.filter(isThreat);
    const threatItem = allThreats.find((t) => t.id === threatId);

    if (threatItem) {
      let threatOutline = null;
      if (threatItem.polygon_json) {
        threatOutline = typeof threatItem.polygon_json === "string"
          ? JSON.parse(threatItem.polygon_json)
          : threatItem.polygon_json;
      }
      // Use natural image dimensions if available, otherwise fall back to database dimensions
      const naturalDims = imageDimensions.get(threatItem.filepath);
      const w = naturalDims?.width && naturalDims.width > 0 ? naturalDims.width : getItemDisplaySize(threatItem).width;
      const h = naturalDims?.height && naturalDims.height > 0 ? naturalDims.height : getItemDisplaySize(threatItem).height;
      let pos = null as { x: number; y: number; rotation?: number } | null;
      if (bagObject) {
        pos = getRandomPositionInContainer(w, h, bagObject, threatOutline);
      }
      if (!pos) {
        const padding = 50;
        pos = { x: padding + Math.random() * (CANVAS_W - 2 * padding), y: padding + Math.random() * (CANVAS_H - 2 * padding), rotation: Math.random() * 360 };
      }
      newObjects.push({
        id: "initial-threat",
        name: threatItem.name,
        library: getStencilKind(threatItem.category),
        subcategory: threatItem.subcategory,
        originalPixelValue: threatItem.pixel_value,
        currentPixelValue: threatItem.pixel_value,
        oldPixelValue: null,
        stencilId: "threat",
        filepath: threatItem.filepath,
        polygonOutline: threatOutline,
        transform: { x: pos.x, y: pos.y, width: w, height: h, rotation: pos.rotation ?? Math.random() * 360 },
        initialWidth: w,
        initialHeight: h,
        layer: layer++,
      });
    }

    if (newObjects.length > 0) {
      setObj(newObjects);
      setHist([newObjects]);
      setHIdx(0);
    }
  }

  // Randomize button handler — re-randomizes positions of non-bag items
  const handleRandomize = () => {
    if (!categorizedList) return;
    hasInitialized.current = false;
    
    // Clear localStorage for this combination so it doesn't load old positions
    const bagId = searchParams.get("bagId") || "";
    const threatId = searchParams.get("threatId") || "";
    const otherIds = searchParams.get("otherIds") || "";
    const storageKey = `xray_workspace_${bagId}_${threatId}_${otherIds}`;
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

  const handleAddObject = (item: Item) => {
    // Use natural image dimensions if available, otherwise fall back to database dimensions
    const naturalDims = pixelStats.has(item.id) ? null : null; // We'll load fresh
    let width = item.width || 100;
    let height = item.height || 100;

    let itemOutline = null;
    if (item.polygon_json) {
      itemOutline = typeof item.polygon_json === "string"
        ? JSON.parse(item.polygon_json)
        : item.polygon_json;
    }

    const bagObject = objects.find((obj) => obj.library === "bag");
    let pos = null as { x: number; y: number; rotation?: number } | null;
    if (bagObject && item.category !== "bags") {
      pos = getRandomPositionInContainer(width, height, bagObject, itemOutline);
    }
    if (!pos) {
      const padding = 50;
      pos = {
        x: padding + Math.random() * (CANVAS_W - 2 * padding),
        y: padding + Math.random() * (CANVAS_H - 2 * padding),
        rotation: Math.random() * 360,
      };
    }

    const newObject: SceneObject = {
      id: `custom-object-${Date.now()}`,
      name: item.name,
      library: getStencilKind(item.category),
      subcategory: item.subcategory,
      originalPixelValue: item.pixel_value,
      currentPixelValue: item.pixel_value,
      oldPixelValue: null,
      stencilId: "item",
      filepath: item.filepath,
      polygonOutline: itemOutline,
      transform: {
        x: pos.x,
        y: pos.y,
        width,
        height,
        rotation: pos.rotation ?? Math.random() * 360,
      },
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
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setObjects([...history[newIndex]]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setObjects([...history[newIndex]]);
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedObjectId) return;
    const newObjects = objects.filter((obj) => obj.id !== selectedObjectId);
    pushHistory(newObjects);
    setObjects(newObjects);
    setSelectedObjectId(null);
  };

  // Note: layer move controls were removed from the toolbar per request.

  const handleMouseDown = (e: React.MouseEvent, obj: SceneObject) => {
    e.stopPropagation();
    setSelectedObjectId(obj.id);
    if (obj.library !== "bag") {
      setIsDragging(true);
      setDragStart({ x: e.clientX - obj.transform.x, y: e.clientY - obj.transform.y });
    }
  };

  const handleRotationMouseDown = (e: React.MouseEvent, obj: SceneObject) => {
    e.stopPropagation();
    setSelectedObjectId(obj.id);
    if (!canvasDivRef.current) return;

    const rect = canvasDivRef.current.getBoundingClientRect();
    const centerX = obj.transform.x * zoom;
    const centerY = obj.transform.y * zoom;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    rotationStartAngleRef.current = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
    rotationStartRotationRef.current = obj.transform.rotation;
    setIsRotating(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && selectedObjectId) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      const newObjects = objects.map((obj) =>
        obj.id === selectedObjectId
          ? { ...obj, transform: { ...obj.transform, x: newX, y: newY } }
          : obj
      );
      setObjects(newObjects);
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
      const angle = rotationStartRotationRef.current + deltaAngle;

      const newObjects = objects.map((obj) =>
        obj.id === selectedObjectId
          ? { ...obj, transform: { ...obj.transform, rotation: Math.round(angle) } }
          : obj
      );
      setObjects(newObjects);
    }
  };

  const handleMouseUp = () => {
    if (isDragging || isRotating) {
      pushHistory(objects);
    }
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

  // Auto-save function - generates annotation from workspace contents
  const handleAutoSave = async () => {
    // Check for out-of-bounds objects
    const bagObjectNow = objects.find(o => o.library === "bag");
    const outOfBoundsNow = objects.filter(
      obj => bagObjectNow && obj.library !== "bag" && !isObjectInsideContainer(obj, bagObjectNow)
    );

    if (outOfBoundsNow.length > 0) {
      setSaveState({ status: "error", message: `Cannot save: ${outOfBoundsNow.length} object(s) out of bounds.` });
      setTimeout(() => setSaveState({ status: "idle", message: "" }), 3000);
      return;
    }

    setSaveState({ status: "saving", message: "Saving..." });
    try {
      // Generate auto-annotation from workspace contents
      const threatNames = objects.filter(o => o.library === "threat").map(o => o.name);
      const otherNames = objects.filter(o => o.library !== "bag" && o.library !== "threat").map(o => o.name);
      const allObjects = [...threatNames, ...otherNames];
      const annotation = `${bagObjectNow?.name || "Workspace"}${allObjects.length > 0 ? ` containing ${allObjects.join(", ")}` : ""}`;

      const bagObject = objects.find(o => o.library === "bag");
      const validRegionPolygon = bagObject ? getTransformedValidRegion(bagObject) : [];

      // Find the bag's top-left corner
      let bagTopLeft: { x: number; y: number } = { x: 0, y: 0 };
      if (bagObject) {
        const bagCorners = getRectCorners(
          { x: bagObject.transform.x || 0, y: bagObject.transform.y || 0 },
          { width: bagObject.transform.width || 0, height: bagObject.transform.height || 0 },
          bagObject.transform.rotation || 0
        );
        bagTopLeft = bagCorners[0];
      }

      const objectsWithSegmentation = objects.map((obj) => {
        const corners = getRectCorners(
          { x: obj.transform.x, y: obj.transform.y },
          { width: obj.transform.width, height: obj.transform.height },
          obj.transform.rotation
        );
        
        const relativeCorners = corners.map(c => ({
          x: c.x - bagTopLeft.x,
          y: c.y - bagTopLeft.y
        }));
        
        const relativeCenter = {
          x: obj.transform.x - bagTopLeft.x,
          y: obj.transform.y - bagTopLeft.y
        };

        return {
          id: obj.id,
          name: obj.name,
          library: obj.library,
          filepath: obj.filepath,
          center: { x: obj.transform.x, y: obj.transform.y },
          relativeCenter,
          size: { width: obj.transform.width, height: obj.transform.height },
          rotation: obj.transform.rotation,
          corners,
          relativeCorners,
          originalPixelValue: obj.originalPixelValue,
          currentPixelValue: obj.currentPixelValue,
          oldPixelValue: obj.oldPixelValue,
          polygonOutline: obj.polygonOutline,
          layer: obj.layer,
        };
      });

      const relativeValidRegion = validRegionPolygon.map(p => ({
        x: p.x - bagTopLeft.x,
        y: p.y - bagTopLeft.y
      }));

      const layout_json = {
        name: annotation,
        bagOrigin: bagTopLeft,
        bag: bagObject ? {
          id: bagObject.id,
          name: bagObject.name,
          filepath: bagObject.filepath,
          size: { width: bagObject.transform.width, height: bagObject.transform.height },
        } : null,
        objects: objectsWithSegmentation,
        validRegionPolygon,
        relativeValidRegion,
        createdAt: new Date().toISOString(),
      };

      // Use the synthesized SB{YYMMDD}-{ABCDE} ID from the precomputed param
      const precomputedId = searchParams.get("precomputed") || "";

      const response = await fetch(`${API_BASE_URL}/api/saved-layouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: precomputedId || undefined, // Pass the synthesized ID so backend uses it
          name: annotation,
          filepath: null,
          layout_json,
        }),
      });

      if (!response.ok) {
        throw new Error("Save failed");
      }

      const data = await response.json();
      setSaveState({ status: "success", message: `Saved successfully!` });
      setLastSavedTime(Date.now());
      setHasUnsavedChanges(false);
      setLastSavedObjects(JSON.stringify(objects));
      
      // Update localStorage so collage page reflects the changes
      const bagId = searchParams.get("bagId") || "";
      const threatId = searchParams.get("threatId") || "";
      const otherIds = searchParams.get("otherIds") || "";
      const storageKey = `xray_workspace_${bagId}_${threatId}_${otherIds}`;
      localStorage.setItem(storageKey, JSON.stringify(objects));
      
      // Also update the collage combinations in sessionStorage
      // This ensures when user navigates back, the collage page shows updated data
      if (precomputedId) {
        try {
          const collageCombosKey = "collageCombinations";
          const collageCombosStr = sessionStorage.getItem(collageCombosKey);
          if (collageCombosStr) {
            const collageCombos = JSON.parse(collageCombosStr);
            const updatedCombos = collageCombos.map((combo: any) => {
              if (combo.id === precomputedId) {
                return {
                  ...combo,
                  objects: objects,
                  bag: objects.find((o: any) => o.library === "bag") || combo.bag,
                  threat: objects.find((o: any) => o.library === "threat") || combo.threat,
                  others: objects.filter((o: any) => o.library !== "bag" && o.library !== "threat")
                };
              }
              return combo;
            });
            sessionStorage.setItem(collageCombosKey, JSON.stringify(updatedCombos));
          }
        } catch (err) {
          console.error("Error updating collage combinations:", err);
        }
      }
      
      setTimeout(() => {
        setSaveState({ status: "idle", message: "" });
      }, 3000);
    } catch (error) {
      console.error("Save error:", error);
      setSaveState({ status: "error", message: "Failed to save. Make sure backend is running." });
      
      setTimeout(() => {
        setSaveState({ status: "idle", message: "" });
      }, 3000);
    }
  };

  // Handle back navigation with unsaved changes warning
  const handleBackNavigation = () => {
    if (hasUnsavedChanges) {
      setShowBackNavigationModal(true);
      setPendingNavigation(() => () => navigate(-1));
    } else {
      navigate(-1);
    }
  };

  // Intercept browser back/close/refresh using beforeunload event
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  const handleBackNavigationConfirm = async (action: "save" | "discard" | "cancel") => {
    if (action === "save") {
      await handleAutoSave();
      setShowBackNavigationModal(false);
      if (pendingNavigation) {
        pendingNavigation();
        setPendingNavigation(null);
      }
    } else if (action === "discard") {
      setShowBackNavigationModal(false);
      setHasUnsavedChanges(false);
      if (pendingNavigation) {
        pendingNavigation();
        setPendingNavigation(null);
      }
    } else {
      setShowBackNavigationModal(false);
      setPendingNavigation(null);
    }
  };

  const bagObject = objects.find(o => o.library === "bag");
  const outOfBoundsObjects = objects.filter(
    obj => bagObject && obj.library === "threat" && !isObjectInsideContainer(obj, bagObject)
  );

  // Compute stats when selection changes
  useEffect(() => {
    computeStats();
  }, [selectedObjectId, objects]);

  // Track out-of-bounds objects
  useEffect(() => {
    const bagObjectNow = objects.find(o => o.library === "bag");
    const outOfBoundsNow = objects.filter(
      obj => bagObjectNow && obj.library !== "bag" && !isObjectInsideContainer(obj, bagObjectNow)
    );
    
    if (outOfBoundsNow.length > 0) {
      setOutOfBoundsNotification({ show: true, count: outOfBoundsNow.length });
      // Auto-hide after 5 seconds
      const timer = setTimeout(() => {
        setOutOfBoundsNotification({ show: false, count: 0 });
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setOutOfBoundsNotification({ show: false, count: 0 });
    }
  }, [objects]);

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
        handleBack={handleBackNavigation}
      />

      {/* Save Status Notification */}
      {saveState.status !== "idle" && (
        <div className={`absolute top-28 right-4 z-50 px-4 py-2.5 rounded-xl shadow-panel border flex items-center gap-2 animate-slide-up ${
          saveState.status === "success" 
            ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
            : saveState.status === "error"
            ? "bg-rose-50 border-rose-200 text-rose-800"
            : "bg-blue-50 border-blue-200 text-blue-800"
        }`}>
          {saveState.status === "success" ? <ShieldCheck size={16} /> : saveState.status === "error" ? <ShieldAlert size={16} /> : <Loader2 size={16} className="animate-spin" />}
          <span className="font-semibold text-xs">{saveState.message}</span>
        </div>
      )}

      {/* Back Navigation Warning Modal */}
      {showBackNavigationModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative z-[10000] w-full max-w-md bg-white rounded-2xl shadow-lg border border-border p-6">
            <h3 className="text-base font-semibold text-ink mb-2">Unsaved Changes</h3>
            <p className="text-sm text-muted mb-5">
              You have unsaved changes in this workspace. What would you like to do?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => await handleBackNavigationConfirm("save")}
                className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-accent to-accent-sky text-white font-semibold text-sm hover:shadow-btn-hover transition-all"
              >
                Save & Continue
              </button>
              <button
                onClick={() => handleBackNavigationConfirm("discard")}
                className="w-full px-4 py-2.5 rounded-xl bg-panel border border-border text-ink font-semibold text-sm hover:bg-surface transition-all"
              >
                Discard Changes
              </button>
              <button
                onClick={() => handleBackNavigationConfirm("cancel")}
                className="w-full px-4 py-2.5 rounded-xl text-muted font-semibold text-sm hover:text-ink transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main 3-Pane Body */}
      <div className="flex flex-1 overflow-hidden relative">
        <ScannedBagsSidebar
          activeLibrary={activeLibrary}
          setActiveLibrary={setActiveLibrary}
          hasBag={hasBag}
          handleAddObject={handleAddObject}
          categorizedList={categorizedList}
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

        {/* Zoom controls */}
        <div className="absolute bottom-12 right-60 flex gap-1 z-10 shadow-card">
          <button
            onClick={() => setZoom(prev => Math.min(2, prev + 0.1))}
            className="w-7 h-7 bg-panel/90 border border-border rounded-md flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-panel transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setZoom(prev => Math.max(0.5, prev - 0.1))}
            className="w-7 h-7 bg-panel/90 border border-border rounded-md flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-panel transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="w-7 h-7 bg-panel/90 border border-border rounded-md flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-panel transition-colors"
            title="Reset Zoom"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Right Sidebar: Properties list */}
        <aside className="w-56 border-l border-border bg-nav flex flex-col overflow-y-auto flex-shrink-0">
          <div className="px-4 py-3 border-b border-border bg-panel flex items-center gap-2">
            <Sliders size={14} className="text-accent" />
            <h3 className="font-semibold text-ink text-xs uppercase tracking-wider">
              Properties
            </h3>
          </div>

          {selectedObjectId ? (
            (() => {
              const selectedObj = objects.find((o) => o.id === selectedObjectId);
              if (!selectedObj) return null;
              const isValid = bagObject && selectedObj.library !== "bag" 
                ? (selectedObj.library === "threat" ? isObjectInsideContainer(selectedObj, bagObject) : true) 
                : true;
              const config = getCategoryConfig(selectedObj.library);

              return (
                <div className="p-3 space-y-4">
                  {/* Validity Block */}
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

                  {/* Object Info */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Object Info</span>
                    <div className="space-y-1.5">
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 space-y-1">
                        <span className="text-[11px] text-muted uppercase tracking-wider block">Name</span>
                        <span className="text-xs font-semibold text-ink max-w-[100px] truncate">{selectedObj.name}</span>
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

                  {/* Transform properties */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Transform</span>
                    <div className="space-y-1.5">
                      {/* Position X */}
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Position X</span>
                        {selectedObj.library !== "bag" ? (
                          <input
                            type="number"
                            value={Math.round(selectedObj.transform.x)}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              const newObjects = objects.map((o) =>
                                o.id === selectedObjectId
                                  ? { ...o, transform: { ...o.transform, x: val } }
                                  : o
                              );
                              setObjects(newObjects);
                            }}
                            onBlur={() => pushHistory(objects)}
                            className="w-20 bg-surface border border-border rounded px-1.5 py-0.5 text-right font-mono text-xs text-ink focus:outline-none focus:border-accent"
                          />
                        ) : (
                          <span className="font-mono text-muted text-xs">{Math.round(selectedObj.transform.x)} px</span>
                        )}
                      </div>

                      {/* Position Y */}
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Position Y</span>
                        {selectedObj.library !== "bag" ? (
                          <input
                            type="number"
                            value={Math.round(selectedObj.transform.y)}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              const newObjects = objects.map((o) =>
                                o.id === selectedObjectId
                                  ? { ...o, transform: { ...o.transform, y: val } }
                                  : o
                              );
                              setObjects(newObjects);
                            }}
                            onBlur={() => pushHistory(objects)}
                            className="w-20 bg-surface border border-border rounded px-1.5 py-0.5 text-right font-mono text-xs text-ink focus:outline-none focus:border-accent"
                          />
                        ) : (
                          <span className="font-mono text-muted text-xs">{Math.round(selectedObj.transform.y)} px</span>
                        )}
                      </div>

                      {/* Rotation */}
                      {selectedObj.library !== "bag" && (
                        <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                          <span className="text-[11px] text-muted uppercase tracking-wider">Rotation</span>
                          <input
                            type="number"
                            value={Math.round(selectedObj.transform.rotation)}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              const newObjects = objects.map((o) =>
                                o.id === selectedObjectId
                                  ? { ...o, transform: { ...o.transform, rotation: val } }
                                  : o
                              );
                              setObjects(newObjects);
                            }}
                            onBlur={() => pushHistory(objects)}
                            className="w-20 bg-surface border border-border rounded px-1.5 py-0.5 text-right font-mono text-xs text-ink focus:outline-none focus:border-accent"
                          />
                        </div>
                      )}
                      {selectedObj.library === "bag" && (
                        <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                          <span className="text-[11px] text-muted uppercase tracking-wider">Rotation</span>
                          <span className="font-mono text-muted text-xs">Fixed (0°)</span>
                        </div>
                      )}

                      {/* Width/Height and proportional scaling removed. Sizes are fixed by asset dimensions. */}
                    </div>
                  </div>

                  {/* Pixel details */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Grayscale value</span>
                    <div className="space-y-1.5">
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Original</span>
                        <span className="font-mono text-ink text-xs font-semibold">{selectedObj.originalPixelValue}</span>
                      </div>
                      {(() => {
                        const stats = pixelStats.get(selectedObj.id);
                        if (!stats) {
                          return (
                            <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                              <span className="text-[11px] text-muted uppercase tracking-wider">Synthesized</span>
                              <span className="font-mono text-accent-sky text-xs font-semibold">{selectedObj.currentPixelValue}</span>
                            </div>
                          );
                        }
                        return (
                          <div className="bg-panel rounded-xl border border-accent/30 px-3 py-2 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-muted uppercase tracking-wider">Synthesized</span>
                              <span className="font-mono text-accent-sky text-xs font-semibold">{stats.synthesizedMean}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-muted">
                              <span>Range</span>
                              <span className="font-mono">{stats.min} – {stats.max}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex-1 flex flex-col p-4 space-y-4">
              {/* Out-of-bounds warning section */}
              {outOfBoundsObjects.length > 0 ? (
                <div className="space-y-2">
                  <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider flex items-center gap-1">
                    <ShieldAlert size={12} />
                    Out of Bounds ({outOfBoundsObjects.length})
                  </span>
                  <div className="space-y-1">
                    {outOfBoundsObjects.map((obj) => (
                      <div
                        key={obj.id}
                        onClick={() => setSelectedObjectId(obj.id)}
                        className="bg-rose-50 border border-rose-100 rounded-lg p-2 text-rose-800 text-xs font-medium cursor-pointer hover:bg-rose-100/50 transition-colors"
                      >
                        {obj.name}
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
      </div>

      {/* Footer */}
      <footer className="bg-panel border-t border-border px-5 py-2 flex items-center justify-between flex-shrink-0 h-9 z-10 shadow-[0_-1px_3px_rgba(27,35,51,0.04)]">
        <div className="text-xs text-muted">
          {objects.length} object{objects.length !== 1 ? "s" : ""} · {outOfBoundsObjects.length} out-of-bounds · Canvas {CANVAS_W}×{CANVAS_H}
        </div>
        <div className="text-xs text-muted">
          {lastSavedTime > 0 ? `Saved recently (${Math.round((Date.now() - lastSavedTime) / 60000)} min ago)` : "Ready to save"}
        </div>
      </footer>
    </div>
  );
}
