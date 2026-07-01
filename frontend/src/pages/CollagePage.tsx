import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Grid3X3, ChevronLeft, ChevronRight, X, FolderOpen } from "lucide-react";
import { IoMdPhotos } from "react-icons/io";
import { API_BASE_URL } from "../config/api";
import type { Item } from "../types/library";
import type { CombinatorialResult, FailureLog } from "../types/customization";
import SyntheticPreview from "../components/collage/SyntheticPreview";
import { getRectCorners, getTransformedPolygon } from "../lib/geometry";

const ITEMS_PER_PAGE = 50;

export default function CollagePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as
    | { selectedBags?: Item[]; selectedThreats?: Item[]; selectedOthers?: Item[]; densityPreset?: "empty" | "few" | "filled" }
    | undefined;

  // shelf-storage: restore previous state from sessionStorage/localStorage
  // when no fresh locationState is present, with backend fallback for stale item refs
  useEffect(() => {
    if (locationState && locationState.selectedBags && locationState.selectedBags.length > 0) {
      return; // fresh navigation from Library — handled by the locationState effect below
    }

    const restoredCombos: any[] = [];
    const restoredFailures: any[] = [];
    const restoredBags: any[] = [];
    const restoredThreats: any[] = [];
    const restoredOthers: any[] = [];
    let restoreError: string | null = null;

    const readJSON = (raw: string | null) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };

    try {
      restoredCombos.push(...(readJSON(sessionStorage.getItem("collageCombinations")) || []));
      restoredFailures.push(...(readJSON(sessionStorage.getItem("collageFailures")) || []));
      restoredBags.push(...(readJSON(localStorage.getItem("selectedBags")) || []));
      restoredThreats.push(...(readJSON(localStorage.getItem("selectedThreats")) || []));
      restoredOthers.push(...(readJSON(localStorage.getItem("selectedOthers")) || []));
    } catch (err) {
      console.error("[CollagePage] error reading storage:", err);
      restoreError = String(err);
    }

    if (
      restoredCombos.length === 0 && restoredFailures.length === 0 &&
      restoredBags.length === 0 && restoredThreats.length === 0 && restoredOthers.length === 0
    ) return;

    const applyRestore = (fb: any[] | null, ft: any[] | null, fo: any[] | null) => {
      const bags = fb || restoredBags;
      const threats = ft || restoredThreats;
      const others = fo || restoredOthers;
      setCombinations(restoredCombos);
      setFailures(restoredFailures);
      setSelectedBags(bags); setSelectedThreats(threats); setSelectedOthers(others);
      if (restoreError) console.warn("[CollagePage] " + restoreError);
      try {
        sessionStorage.setItem("collageCombinations", JSON.stringify(restoredCombos));
        sessionStorage.setItem("collageFailures", JSON.stringify(restoredFailures));
        localStorage.setItem("selectedBags", JSON.stringify(bags));
        localStorage.setItem("selectedThreats", JSON.stringify(threats));
        localStorage.setItem("selectedOthers", JSON.stringify(others));
      } catch (e) {
        console.error("[CollagePage] error re-saving after restore:", e);
      }
    };

    // Detects stale item refs (e.g. hard refresh cleared localStorage but sessionStorage kept combos).
    // Rebuilds item arrays by fetching items from the backend matching combo item ids.
    const comboItemIds = new Set();
    restoredCombos.forEach(c => {
      comboItemIds.add(c.bag.id);
      if (c.threat) comboItemIds.add(c.threat.id);
      c.others.forEach((o: any) => comboItemIds.add(o.id));
    });

    if (restoredCombos.length > 0 && comboItemIds.size > 0 &&
        restoredBags.length === 0 && restoredThreats.length === 0 && restoredOthers.length === 0) {
      (async () => {
        try {
          const res = await fetch(API_BASE_URL + "/api/items/categorized");
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          const cat = data.categorized || data;
          const matchedBags: any[] = [], matchedThreats: any[] = [], matchedOthers: any[] = [];
          for (const subcats of Object.values(cat as Record<string, any>)) {
            for (const items of Object.values(subcats as Record<string, any>)) {
              for (const item of items as any[]) {
                if (!comboItemIds.has(item.id)) continue;
                const cl = (item.category || "").toLowerCase();
                if (cl.includes("bag")) matchedBags.push(item);
                else if (cl.includes("threat")) matchedThreats.push(item);
                else matchedOthers.push(item);
              }
            }
          }
          applyRestore(matchedBags, matchedThreats, matchedOthers);
        } catch (e) {
          console.error("[CollagePage] fetch fresh items failed:", e);
          applyRestore(null, null, null);
        }
      })();
      return;
    }

    applyRestore(null, null, null);
  }, []);

  // Selections from library
  const [selectedBags, setSelectedBags] = useState<Item[]>([]);
  const [selectedThreats, setSelectedThreats] = useState<Item[]>([]);
  const [selectedOthers, setSelectedOthers] = useState<Item[]>([]);

  const [combinations, setCombinations] = useState<CombinatorialResult[]>([]);
  const [failures, setFailures] = useState<FailureLog[]>([]);

  const [currentPage, setCurrentPage] = useState(0);

  const [bulkSaveState, setBulkSaveState] = useState<{
    status: "idle" | "saving" | "success" | "error";
    message: string;
    savedCount: number;
  }>({ status: "idle", message: "", savedCount: 0 });

  // Whenever new data arrives via location state, persist it
  useEffect(() => {
    if (!locationState || !locationState.selectedBags || locationState.selectedBags.length === 0) {
      return;
    }

    const { selectedBags: bags, selectedThreats: threats, selectedOthers: others, combinations: preCombinations, failures: preFailures } = locationState as any;

    setSelectedBags(bags);
    setSelectedThreats(threats || []);
    setSelectedOthers(others || []);
    setCombinations(preCombinations && preCombinations.length > 0 ? preCombinations : []);
    setFailures(preFailures && preFailures.length > 0 ? preFailures : []);

    // Persist to localStorage
    try {
      localStorage.setItem("selectedBags", JSON.stringify(bags));
      localStorage.setItem("selectedThreats", JSON.stringify(threats || []));
      localStorage.setItem("selectedOthers", JSON.stringify(others || []));
    } catch (err) {
      console.error("Error saving collage state to localStorage:", err);
    }
  }, [locationState]);

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

  const handleOpenCombination = (comb: CombinatorialResult) => {
    // Store the pre-computed objects in sessionStorage so CustomizationPage can load them
    const storageKey = `xray_workspace_precomputed_${comb.id}`;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(comb.objects));
    } catch (err) {
      console.error("Error saving precomputed objects:", err);
    }

    const queryParams = new URLSearchParams();
    queryParams.set("bagId", comb.bag.id);
    if (comb.threat) queryParams.set("threatId", comb.threat.id);
    if (comb.others.length > 0) {
      queryParams.set("otherIds", comb.others.map((o) => o.id).join(","));
    }
    // Add flag to indicate we have pre-computed objects
    queryParams.set("precomputed", comb.id);

    navigate(`/customize?${queryParams.toString()}`);
  };

  const handleBulkSave = async () => {
    setBulkSaveState({ status: "saving", message: "Saving all workspaces...", savedCount: 0 });
    let savedCount = 0;
    let failedCount = 0;
    
    try {
      for (const comb of combinations) {
        // Generate auto-annotation from workspace contents
        const threatNames = comb.threat ? [comb.threat.name] : [];
        const otherNames = comb.others.map(o => o.name);
        const allObjects = [...threatNames, ...otherNames];
        const annotation = `${comb.bag.name}${allObjects.length > 0 ? ` containing ${allObjects.join(", ")}` : ""}`;
        
        // Find the bag's top-left corner (first corner of its rectangle)
        const bagObject = comb.objects.find((o: any) => o.library === "bag");
        let bagTopLeft: { x: number; y: number } = { x: 0, y: 0 };
        let validRegionPolygon: any[] = [];
        
        if (bagObject) {
          const bagCorners = getRectCorners(
            { x: bagObject.transform.x, y: bagObject.transform.y },
            { width: bagObject.transform.width, height: bagObject.transform.height },
            bagObject.transform.rotation
          );
          bagTopLeft = bagCorners[0];
          
          // Get valid region
          try {
            // Check if we can get the valid region from the bag
            if (bagObject.polygonOutline) {
              validRegionPolygon = getTransformedPolygon(
                { x: bagObject.transform.x, y: bagObject.transform.y },
                { width: bagObject.transform.width, height: bagObject.transform.height },
                bagObject.transform.rotation,
                bagObject.polygonOutline
              );
            }
          } catch (e) {
            console.error("Error getting valid region:", e);
          }
        }
        
        // Prepare objects with all details
        const objectsWithDetails = comb.objects.map((obj: any) => {
          const corners = getRectCorners(
            { x: obj.transform.x, y: obj.transform.y },
            { width: obj.transform.width, height: obj.transform.height },
            obj.transform.rotation
          );
          
          // Transform coordinates relative to bag's top-left corner
          const relativeCorners = corners.map((c: any) => ({
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
            // Original center coordinates (absolute)
            center: { x: obj.transform.x, y: obj.transform.y },
            // Center coordinates relative to bag's top-left
            relativeCenter,
            // Original dimensions
            size: { width: obj.transform.width, height: obj.transform.height },
            // Rotation
            rotation: obj.transform.rotation,
            // 4 corner coordinates (absolute)
            corners,
            // 4 corner coordinates (relative to bag's top-left)
            relativeCorners,
            originalPixelValue: obj.originalPixelValue,
            currentPixelValue: obj.currentPixelValue,
            oldPixelValue: obj.oldPixelValue,
            polygonOutline: obj.polygonOutline,
            layer: obj.layer,
          };
        });
        
        // Transform valid region relative to bag's top-left
        const relativeValidRegion = validRegionPolygon.map((p: any) => ({
          x: p.x - bagTopLeft.x,
          y: p.y - bagTopLeft.y
        }));

        const layout_json = {
          name: annotation,
          // Bag top-left corner (origin for relative coordinates)
          bagOrigin: bagTopLeft,
          // Bag information
          bag: bagObject ? {
            id: bagObject.id,
            name: bagObject.name,
            filepath: bagObject.filepath,
            size: { width: bagObject.transform.width, height: bagObject.transform.height },
          } : null,
          // All objects
          objects: objectsWithDetails,
          // Valid region (absolute coordinates)
          validRegionPolygon,
          // Valid region (relative to bag's top-left)
          relativeValidRegion,
          createdAt: new Date().toISOString(),
        };
        
        const response = await fetch("http://localhost:8080/api/saved-layouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: comb.id,
            name: annotation,
            filepath: null,
            layout_json,
          }),
        });

        if (response.ok) {
          savedCount++;
          setBulkSaveState(prev => ({
            ...prev,
            message: `Saving workspaces... (${savedCount}/${combinations.length})`,
            savedCount
          }));
        } else {
          failedCount++;
        }
      }
      
      setBulkSaveState({
        status: "success",
        message: `Successfully saved ${savedCount} workspace${savedCount !== 1 ? "s" : ""}!${failedCount > 0 ? ` (${failedCount} failed)` : ""}`,
        savedCount
      });
      
      // Reset collage state after successful bulk save
      setCombinations([]);
      setFailures([]);
      setSelectedBags([]);
      setSelectedThreats([]);
      setSelectedOthers([]);
      setCurrentPage(0);
      
      // Clear persisted storage
      try {
        sessionStorage.removeItem("collageCombinations");
        sessionStorage.removeItem("collageFailures");
        localStorage.removeItem("selectedBags");
        localStorage.removeItem("selectedThreats");
        localStorage.removeItem("selectedOthers");
      } catch (e) {
        console.error("Error clearing storage after bulk save:", e);
      }
    } catch (err) {
      console.error(err);
      setBulkSaveState({
        status: "error",
        message: "Failed to bulk save workspaces. Please verify backend is running.",
        savedCount
      });
    }
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(combinations.length / ITEMS_PER_PAGE));
  const paginatedCombinations = combinations.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 animate-fade-in text-sm">
      {/* Header Row */}
      <div className="flex items-end justify-between mb-8 border-l-4 border-accent pl-4">
        <div>
          <h2 className="text-3xl font-bold text-ink tracking-tight">Collage Generator</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleBulkSave}
            disabled={bulkSaveState.status === "saving" || combinations.length === 0}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-500 shadow-btn flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Bulk Save All Workspaces"
          >
            {bulkSaveState.status === "saving" ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <FolderOpen size={15} />
            )}
          </button>
        </div>
      </div>

      {/* Bulk Save Status Banner */}
      {bulkSaveState.status !== "idle" && (
        <div className={`mb-6 p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 ${
          bulkSaveState.status === "saving"
            ? "bg-blue-50 border-blue-200 text-blue-800 animate-pulse"
            : bulkSaveState.status === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-rose-50 border-rose-200 text-rose-800"
        }`}>
          <div className="flex items-center gap-3">
            {bulkSaveState.status === "saving" && (
              <Loader2 className="animate-spin text-blue-600" size={24} />
            )}
            {bulkSaveState.status === "success" && (
              <CheckCircle2 className="text-emerald-600" size={24} />
            )}
            {bulkSaveState.status === "error" && (
              <XCircle className="text-rose-600" size={24} />
            )}
            <div>
              <p className="font-semibold text-sm">{bulkSaveState.message}</p>
            </div>
          </div>
          {bulkSaveState.status !== "saving" && (
            <button
              onClick={() => setBulkSaveState({ status: "idle", message: "", savedCount: 0 })}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {combinations.length === 0 && failures.length === 0 ? (
        <div className="text-center py-32 px-12 bg-panel rounded-2xl border border-border shadow-card">
          <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-5 border-2 border-border">
            <Grid3X3 size={34} className="text-muted/30" />
          </div>
          <h3 className="text-xl font-bold text-ink mb-2">No scanned bags selected</h3>
          <p className="text-base text-muted mb-8 max-w-md mx-auto leading-relaxed">
            Please go to the Library page and select bags and objects to generate combinations.
          </p>
          <button
            onClick={() => navigate("/library")}
            className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn text-base inline-flex items-center gap-2 cursor-pointer"
          >
            <IoMdPhotos />
            Go to Library
          </button>
        </div>
      ) : (
        <>
          {/* Summary bar with logs toggle */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-muted">
              {combinations.length > 0 && (
                <p>
                  {selectedBags.length} bag{selectedBags.length !== 1 ? "s" : ""}, {selectedThreats.length} threat{selectedThreats.length !== 1 ? "s" : ""}, {selectedOthers.length} non-threat{selectedOthers.length !== 1 ? "s" : ""} selected
                </p>
              )}
              <p>
                {combinations.length > 0
                  ? `Showing ${currentPage * ITEMS_PER_PAGE + 1}–${Math.min((currentPage + 1) * ITEMS_PER_PAGE, combinations.length)} of ${combinations.length} combinations`
                  : "0 combinations generated"}
              </p>
            </div>
          </div>


          {/* Combination Grid */}
          {combinations.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {paginatedCombinations.map((comb) => (
                  <button
                    key={comb.id}
                    onClick={() => handleOpenCombination(comb)}
                    className="bg-panel rounded-2xl border border-border p-4 shadow-card cursor-pointer overflow-hidden group text-left w-full"
                  >
                    <SyntheticPreview
                      objects={comb.objects}
                      bagName={comb.bag.name}
                      threatName={comb.threat?.name}
                      othersCount={comb.others.length}
                    />
                  </button>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-2 rounded-xl border border-border bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={16} className="text-muted" />
                  </button>
                  
                  {Array.from({ length: totalPages }, (_, i) => i).map((page) => {
                    const showPage = page === 0 || page === totalPages - 1 || 
                      Math.abs(page - currentPage) <= 1;
                    const showEllipsis = page === currentPage - 2 || page === currentPage + 2;
                    
                    if (!showPage && !showEllipsis) return null;
                    if (!showPage && showEllipsis) {
                      return <span key={page} className="text-muted text-xs px-1">...</span>;
                    }
                    
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-[36px] h-9 rounded-xl text-sm font-medium ${
                          page === currentPage
                            ? "bg-accent text-white shadow-btn"
                            : "border border-border bg-panel text-muted"
                        }`}
                      >
                        {page + 1}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="p-2 rounded-xl border border-border bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={16} className="text-muted" />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}