import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Filter, Plus, ShieldAlert, ShieldCheck, Database, Loader2, CheckCircle2, XCircle } from "lucide-react";
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
    if (state?.selectedBags && state.selectedBags.length > 0) {
      const bags = state.selectedBags;
      const threats = state.selectedThreats || [];
      const others = state.selectedOthers || [];
      const density = state.densityPreset || "filled";
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
      // Fallback: fetch from API if direct navigation
      fetch("http://localhost:8080/api/items/categorized")
        .then((res) => res.json())
        .then((data) => {
          if (data.ok) {
            const bagsList = Object.values(data.categorized.bags || {}).flat() as Item[];
            const threatsList = Object.values(data.categorized.threats || {}).flat() as Item[];
            const othersList = [
              ...Object.values(data.categorized.clothes || {}).flat(),
              ...Object.values(data.categorized.electronics || {}).flat(),
              ...Object.values(data.categorized.food || {}).flat(),
            ] as Item[];

            const combos: Combination[] = [];
            bagsList.slice(0, 3).forEach((bag) => {
              combos.push({
                id: `${bag.id}-clean`,
                bag,
                others: othersList.slice(0, 3),
              });
              if (threatsList.length > 0) {
                combos.push({
                  id: `${bag.id}-${threatsList[0].id}`,
                  bag,
                  threat: threatsList[0],
                  others: othersList.slice(0, 2),
                });
              }
            });
            setCombinations(combos);
          }
        })
        .catch((err) => console.error("Error fetching categorized fallback items:", err));
    }
  }, [state]);

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 animate-fade-in text-sm">
      {/* Header Row */}
      <div className="flex items-end justify-between mb-8 border-l-4 border-accent pl-4">
        <div>
          <h2 className="text-3xl font-bold text-ink tracking-tight">Synthetic X-Ray Combinations</h2>
          <p className="text-sm text-muted mt-1">
            Click on any pre-generated combination to open it in the customization workspace!
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-sm font-medium text-muted bg-panel hover:bg-surface hover:text-ink border border-border hover:border-muted/50 rounded-xl transition-all flex items-center gap-1.5 shadow-card">
            <Filter size={15} />
            Filter
          </button>
          <button
            onClick={handleExportDataset}
            disabled={exportState.status === "generating" || combinations.length === 0}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-500 shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportState.status === "generating" ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Database size={15} />
            )}
            Export Dataset
          </button>
          <button
            onClick={() => navigate("/library")}
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm"
          >
            <Plus size={15} />
            New Collage
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
    </div>
  );
}
