import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Filter, Plus, ShieldAlert, ShieldCheck, Database, Loader2, CheckCircle2, XCircle, Grid3X3, BookOpen } from "lucide-react";
import type { Item } from "../types/library";
import SyntheticPreview from "../components/collage/SyntheticPreview";

type Combination = {
  id: string;
  bag: Item;
  threat?: Item;
  others: Item[];
};

export default function CollagePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as
    | { selectedBags?: Item[]; selectedThreats?: Item[]; selectedOthers?: Item[]; densityPreset?: "empty" | "few" | "filled" }
    | undefined;
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [exportState, setExportState] = useState<{
    status: "idle" | "generating" | "success" | "error";
    message: string;
    datasetId?: string;
    outputDir?: string;
  }>({ status: "idle", message: "" });

  const handleExportDataset = async () => {
    setExportState({ status: "generating", message: "Generating high-resolution PNG scans & YOLO annotations..." });
    try {
      const response = await fetch("http://localhost:8080/api/dataset/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          combinations: combinations.map(c => ({
            id: c.id,
            bag: c.bag,
            threat: c.threat,
            others: c.others
          })),
          resolutionWidth: 800,
          resolutionHeight: 600
        })
      });

      if (!response.ok) {
        throw new Error("Failed to generate dataset");
      }

      const data = await response.json();
      setExportState({
        status: "success",
        message: `Successfully generated ${data.files.length} scans!`,
        datasetId: data.datasetId,
        outputDir: data.outputDir
      });
    } catch (err) {
      console.error(err);
      setExportState({
        status: "error",
        message: "Failed to generate dataset. Please verify backend is running."
      });
    }
  };

  useEffect(() => {
    let bags = state?.selectedBags;
    let threats = state?.selectedThreats || [];
    let others = state?.selectedOthers || [];
    let density = state?.densityPreset || "filled";

    if (!bags || bags.length === 0) {
      try {
        const savedBags = localStorage.getItem("selectedBags");
        const savedThreats = localStorage.getItem("selectedThreats");
        const savedOthers = localStorage.getItem("selectedOthers");
        const savedDensity = localStorage.getItem("densityPreset");
        
        if (savedBags) {
          bags = JSON.parse(savedBags);
          if (savedThreats) threats = JSON.parse(savedThreats);
          if (savedOthers) others = JSON.parse(savedOthers);
          if (savedDensity) density = savedDensity as any;
        }
      } catch (err) {
        console.error("Error reading saved collage state:", err);
      }
    }

    if (bags && bags.length > 0) {
      const combos: Combination[] = [];

      bags.forEach((bag) => {
        // First, combo with just bag and random others
        const cleanOthers = density === "empty" ? [] : (density === "few" ? others.slice(0, 2) : others);
        combos.push({
          id: `${bag.id}-clean`,
          bag,
          others: cleanOthers,
        });

        // Then, bag + each threat + random others
        threats.forEach((threat) => {
          // Client-side validation: if threat exists but bag lacks a valid placement region, skip combo
          const bagHasValidRegion = bag.valid_region_points && (Array.isArray(bag.valid_region_points) ? bag.valid_region_points.length > 0 : true);
          if (!bagHasValidRegion) {
            return; // skip this permutation
          }
          const threatOthers = density === "empty" ? [] : (density === "few" ? others.slice(0, 1) : others);
          combos.push({
            id: `${bag.id}-${threat.id}`,
            bag,
            threat,
            others: threatOthers,
          });
        });
      });

      setCombinations(combos);
    } else {
      setCombinations([]);
    }
  }, [state]);

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 animate-fade-in text-sm">
      {/* Header Row */}
      <div className="flex items-end justify-between mb-8 border-l-4 border-accent pl-4">
        <div>
          <h2 className="text-3xl font-bold text-ink tracking-tight"></h2>
          <p className="text-sm text-muted mt-1">
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-sm font-medium text-muted bg-panel hover:bg-surface hover:text-ink border border-border hover:border-muted/50 rounded-xl transition-all flex items-center gap-1.5 shadow-card" title="Filter">
            <Filter size={15} />
          </button>
          <button
            onClick={handleExportDataset}
            disabled={exportState.status === "generating" || combinations.length === 0}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-500 shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export Dataset"
          >
            {exportState.status === "generating" ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Database size={15} />
            )}
          </button>
          <button
            onClick={() => navigate("/library")}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm"
            title="New Collage"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {/* Export Status Banner */}
      {exportState.status !== "idle" && (
        <div className={`mb-6 p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 ${
          exportState.status === "generating"
            ? "bg-accent/5 border-accent/20 text-accent animate-pulse"
            : exportState.status === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-rose-50 border-rose-200 text-rose-800"
        }`}>
          <div className="flex items-center gap-3">
            {exportState.status === "generating" && (
              <Loader2 className="animate-spin text-accent" size={24} />
            )}
            {exportState.status === "success" && (
              <CheckCircle2 className="text-emerald-600" size={24} />
            )}
            {exportState.status === "error" && (
              <XCircle className="text-rose-600" size={24} />
            )}
            <div>
              <p className="font-semibold text-sm">{exportState.message}</p>
              {exportState.status === "success" && exportState.outputDir && (
                <p className="text-xs text-emerald-600 font-mono mt-1 select-all">
                  Saved at: {exportState.outputDir}
                </p>
              )}
            </div>
          </div>
          {exportState.status !== "generating" && (
            <button
              onClick={() => setExportState({ status: "idle", message: "" })}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {combinations.length === 0 ? (
        <div className="text-center py-24 bg-panel rounded-2xl border border-border shadow-card">
          <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
            <Grid3X3 size={28} className="text-muted/40" />
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">No scanned bags selected</h3>
          <p className="text-sm text-muted mb-6">
            Please go to the Library page and select bags/objects to generate combinations.
          </p>
          <button
            onClick={() => navigate("/library")}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover transition-all text-sm inline-flex items-center gap-1.5 cursor-pointer"
          >
            <BookOpen size={15} />
            Go to Library
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {combinations.map((comb) => {
            const queryParams = new URLSearchParams();
            queryParams.set("bagId", comb.bag.id);
            if (comb.threat) queryParams.set("threatId", comb.threat.id);
            if (comb.others.length > 0) {
              queryParams.set("otherIds", comb.others.map((o) => o.id).join(","));
            }
            
            return (
              <Link
                key={comb.id}
                to={`/customize?${queryParams.toString()}`}
                className="bg-panel rounded-2xl border border-border p-4 shadow-card hover:shadow-card-hover hover:border-accent/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden group"
              >
                <SyntheticPreview bag={comb.bag} threat={comb.threat} others={comb.others} />

                <div className="px-1 pb-1 pt-1.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink leading-tight">
                      {comb.bag.name}
                      {comb.threat && ` + ${comb.threat.name}`}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      {comb.others.length} other item{comb.others.length !== 1 ? "s" : ""}
                    </p>
                  </div>

                  {/* Badges */}
                  {comb.threat ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-0.5 rounded-full">
                      <ShieldAlert size={12} />
                      Threat
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                      <ShieldCheck size={12} />
                      Clean
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
