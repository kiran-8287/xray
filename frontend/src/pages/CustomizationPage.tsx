import React, { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { 
  ZoomIn, ZoomOut, Maximize2, Sliders, ShieldAlert, ShieldCheck
} from "lucide-react";
import type { StencilKind } from "../stencils/types";
import type { SceneObject } from "../types/customization";
import type { Item } from "../types/library";
import { 
  isObjectInsideContainer, 
  getRandomPositionInContainer, 
  getTransformedValidRegion 
} from "../lib/customizationHelpers";
import { getRectCorners } from "../lib/geometry";
import ScannedBagsSidebar from "../components/customization/ScannedBagsSidebar";
import WorkspaceToolbar from "../components/customization/WorkspaceToolbar";
import CanvasArea from "../components/customization/CanvasArea";
import { getCategoryConfig, mergeCategorizedItems, getStencilKind, normalizeCategoryName } from "../config/categories";

const CANVAS_W = 800;
const CANVAS_H = 600;

export default function CustomizationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<SceneObject[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showValidRegion, setShowValidRegion] = useState(true);
  const [exportState, setExportState] = useState<{ status: "idle" | "saving" | "success" | "error"; message: string }>({ status: "idle", message: "" });
  const canvasDivRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeLibrary, setActiveLibrary] = useState<string | null>(null);
  const [hasBag, setHasBag] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [lastSavedTime, setLastSavedTime] = useState<number>(0);
  const [categorizedList, setCategorizedList] = useState<any>(null);
  const hasInitialized = useRef(false);

  // Fetch all scanned bags from DB on mount
  useEffect(() => {
    fetch("http://localhost:8080/api/items/categorized")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setCategorizedList(mergeCategorizedItems(data.categorized));
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
    const storageKey = `xray_workspace_${bagId}_${threatId}_${otherIds}`;
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

    buildAndSetObjects(categorizedList, searchParams, setObjects, setHistory, setHistoryIndex);
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

  // Shared builder extracted so the Randomize button can call it again
  function buildAndSetObjects(catList: any, params: URLSearchParams, setObj: typeof setObjects, setHist: typeof setHistory, setHIdx: typeof setHistoryIndex) {
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
        bagOutline = typeof bagItem.valid_region_points === "string"
          ? JSON.parse(bagItem.valid_region_points)
          : bagItem.valid_region_points;
      }
      if (!bagOutline && bagItem.polygon_json) {
        bagOutline = typeof bagItem.polygon_json === "string"
          ? JSON.parse(bagItem.polygon_json)
          : bagItem.polygon_json;
      }

      bagObject = {
        id: "initial-bag",
        name: bagItem.name,
        library: getStencilKind(bagItem.category),
        originalPixelValue: bagItem.pixel_value,
        currentPixelValue: bagItem.pixel_value,
        oldPixelValue: null,
        stencilId: "suitcase",
        filepath: bagItem.filepath,
        polygonOutline: bagOutline,
        transform: {
          x: CANVAS_W / 2,
          y: CANVAS_H / 2,
          width: CANVAS_W * 0.7,
          height: CANVAS_H * 0.7,
          rotation: 0,
        },
        initialWidth: CANVAS_W * 0.7,
        initialHeight: CANVAS_H * 0.7,
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
      const w = item.width ? Math.round(item.width * 0.5) : 80;
      const h = item.height ? Math.round(item.height * 0.5) : 80;
      let pos;
      if (bagObject) {
        pos = getRandomPositionInContainer(w, h, bagObject, itemOutline);
      } else {
        const padding = 50;
        pos = { x: padding + Math.random() * (CANVAS_W - 2 * padding), y: padding + Math.random() * (CANVAS_H - 2 * padding), rotation: Math.random() * 360 };
      }
      newObjects.push({
        id: `random-object-${i}`,
        name: item.name,
        library: getStencilKind(item.category),
        originalPixelValue: item.pixel_value,
        currentPixelValue: item.pixel_value,
        oldPixelValue: null,
        stencilId: "tshirt",
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
      const w = threatItem.width ? Math.round(threatItem.width * 0.5) : 120;
      const h = threatItem.height ? Math.round(threatItem.height * 0.5) : 60;
      let pos;
      if (bagObject) {
        pos = getRandomPositionInContainer(w, h, bagObject, threatOutline);
      } else {
        const padding = 50;
        pos = { x: padding + Math.random() * (CANVAS_W - 2 * padding), y: padding + Math.random() * (CANVAS_H - 2 * padding), rotation: Math.random() * 360 };
      }
      newObjects.push({
        id: "initial-threat",
        name: threatItem.name,
        library: getStencilKind(threatItem.category),
        originalPixelValue: threatItem.pixel_value,
        currentPixelValue: threatItem.pixel_value,
        oldPixelValue: null,
        stencilId: "gun",
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
    let width = item.width ? Math.round(item.width * 0.5) : 100;
    let height = item.height ? Math.round(item.height * 0.5) : 100;

    let itemOutline = null;
    if (item.polygon_json) {
      itemOutline = typeof item.polygon_json === "string"
        ? JSON.parse(item.polygon_json)
        : item.polygon_json;
    }

    const bagObject = objects.find((obj) => obj.library === "bag");
    let pos;
    if (bagObject && item.category !== "bags") {
      pos = getRandomPositionInContainer(width, height, bagObject, itemOutline);
    } else {
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
      originalPixelValue: item.pixel_value,
      currentPixelValue: item.pixel_value,
      oldPixelValue: null,
      stencilId: "tshirt",
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

  const handleBringToFront = () => {
    if (!selectedObjectId) return;
    const maxLayer = objects.length - 1;
    const newObjects = objects.map((obj) =>
      obj.id === selectedObjectId ? { ...obj, layer: maxLayer + 1 } : obj
    );
    pushHistory(newObjects);
    setObjects(newObjects);
  };

  const handleSendToBack = () => {
    if (!selectedObjectId) return;
    const newObjects = objects.map((obj) =>
      obj.id === selectedObjectId ? { ...obj, layer: -1 } : obj
    );
    pushHistory(newObjects);
    setObjects(newObjects);
  };

  const handleMoveLayerUp = () => {
    if (!selectedObjectId) return;
    const selectedObj = objects.find((o) => o.id === selectedObjectId);
    if (!selectedObj) return;
    const newObjects = objects.map((obj) => {
      if (obj.id === selectedObjectId) return { ...obj, layer: obj.layer + 1 };
      if (obj.layer === selectedObj.layer + 1) return { ...obj, layer: obj.layer - 1 };
      return obj;
    });
    pushHistory(newObjects);
    setObjects(newObjects);
  };

  const handleMoveLayerDown = () => {
    if (!selectedObjectId) return;
    const selectedObj = objects.find((o) => o.id === selectedObjectId);
    if (!selectedObj) return;
    const newObjects = objects.map((obj) => {
      if (obj.id === selectedObjectId) return { ...obj, layer: obj.layer - 1 };
      if (obj.layer === selectedObj.layer - 1) return { ...obj, layer: obj.layer + 1 };
      return obj;
    });
    pushHistory(newObjects);
    setObjects(newObjects);
  };

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

      const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI) + 90;

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
  };

  const handleExport = async () => {
    setExportState({ status: "saving", message: "Saving layout..." });
    try {
      const bagObject = objects.find(o => o.library === "bag");
      const validRegionPolygon = bagObject ? getTransformedValidRegion(bagObject) : [];

      const objectsWithSegmentation = objects.map((obj) => {
        const corners = getRectCorners(
          { x: obj.transform.x, y: obj.transform.y },
          { width: obj.transform.width, height: obj.transform.height },
          obj.transform.rotation
        );
        return {
          id: obj.id,
          name: obj.name,
          library: obj.library,
          filepath: obj.filepath,
          transform: { ...obj.transform },
          originalPixelValue: obj.originalPixelValue,
          currentPixelValue: obj.currentPixelValue,
          oldPixelValue: obj.oldPixelValue,
          polygonOutline: obj.polygonOutline,
          segmentation: corners,
        };
      });

      const layout_json = {
        objects: objectsWithSegmentation,
        validRegionPolygon,
        createdAt: new Date().toISOString(),
      };

      const response = await fetch("http://localhost:8080/api/saved-layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Workspace ${new Date().toISOString()}`,
          filepath: null,
          layout_json,
        }),
      });

      if (!response.ok) {
        throw new Error("Save failed");
      }

      const data = await response.json();
      setExportState({ status: "success", message: `Layout saved: ${data.layout.id}` });
      setLastSavedTime(Date.now());
      
      setTimeout(() => {
        setExportState({ status: "idle", message: "" });
      }, 3000);
    } catch (error) {
      console.error("Export error:", error);
      setExportState({ status: "error", message: "Failed to save layout. Make sure backend is running." });
      
      setTimeout(() => {
        setExportState({ status: "idle", message: "" });
      }, 3000);
    }
  };

  const bagObject = objects.find(o => o.library === "bag");
  const outOfBoundsObjects = objects.filter(
    obj => bagObject && obj.library === "threat" && !isObjectInsideContainer(obj, bagObject)
  );

  // Threat validation states
  const hasThreat = objects.some(o => o.library === "threat");
  const threatObj = objects.find(o => o.library === "threat");
  const isThreatInside = bagObject && threatObj ? isObjectInsideContainer(threatObj, bagObject) : false;

  let scanStatus: "clean" | "threat_valid" | "threat_invalid" = "clean";
  if (hasThreat) {
    scanStatus = isThreatInside ? "threat_valid" : "threat_invalid";
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] bg-surface overflow-hidden animate-fade-in text-sm">
      <WorkspaceToolbar
        bagObjectName={bagObject ? bagObject.name : ""}
        undoDisabled={historyIndex <= 0}
        redoDisabled={historyIndex >= history.length - 1}
        selectedObjectId={selectedObjectId}
        showValidRegion={showValidRegion}
        exportSaving={exportState.status === "saving"}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        setShowValidRegion={setShowValidRegion}
        handleSendToBack={handleSendToBack}
        handleMoveLayerDown={handleMoveLayerDown}
        handleMoveLayerUp={handleMoveLayerUp}
        handleBringToFront={handleBringToFront}
        handleDeleteSelected={handleDeleteSelected}
        handleExport={handleExport}
        handleRandomize={handleRandomize}
      />

      {/* Scan Security Status Banner */}
      <div className={`px-4 py-2 border-b flex items-center justify-between text-xs font-semibold select-none z-10 flex-shrink-0 ${
        scanStatus === "clean" 
          ? "bg-emerald-50 border-emerald-100 text-emerald-800 animate-fade-in"
          : scanStatus === "threat_valid"
          ? "bg-amber-50 border-amber-100 text-amber-800 animate-fade-in"
          : "bg-rose-50 border-rose-200 text-rose-800 animate-pulse"
      }`}>
        <div className="flex items-center gap-2">
          {scanStatus === "clean" && (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>SCAN RESULT: CLEAN (No Threat Objects Detected)</span>
            </>
          )}
          {scanStatus === "threat_valid" && (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>SCAN WARNING: THREAT PRESENT & SECURED (Threat is inside valid container region)</span>
            </>
          )}
          {scanStatus === "threat_invalid" && (
            <>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span>SECURITY ALERT: THREAT OUT OF BOUNDS (Threat is outside valid container region)</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase">
          <span>Status:</span>
          <span className={`px-2 py-0.5 rounded-full text-white font-bold ${
            scanStatus === "clean"
              ? "bg-emerald-600"
              : scanStatus === "threat_valid"
              ? "bg-amber-600"
              : "bg-rose-600"
          }`}>
            {scanStatus === "clean" ? "Clean" : scanStatus === "threat_valid" ? "Threat Present (Valid)" : "Threat Out of Bounds (Invalid)"}
          </span>
        </div>
      </div>

      {exportState.status !== "idle" && (
        <div className={`absolute top-28 right-4 z-50 px-4 py-2.5 rounded-xl shadow-panel border flex items-center gap-2 animate-slide-up ${
          exportState.status === "success" 
            ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
            : "bg-rose-50 border-rose-200 text-rose-800"
        }`}>
          {exportState.status === "success" ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          <span className="font-semibold text-xs">{exportState.message}</span>
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
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Name</span>
                        <span className="text-xs font-semibold text-ink max-w-[100px] truncate">{selectedObj.name}</span>
                      </div>
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Category</span>
                        <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-md border ${config.bg} ${config.text} ${config.border}`}>
                          {selectedObj.library}
                        </span>
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
                      <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Synthesized</span>
                        <span className="font-mono text-accent-sky text-xs font-semibold">{selectedObj.currentPixelValue}</span>
                      </div>
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
