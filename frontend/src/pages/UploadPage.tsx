import React, { useState, useEffect, useCallback, useMemo } from "react";
import { CheckCircle2, AlertCircle, Upload as UploadIcon, AlertTriangle, Wand2 } from "lucide-react";
import UploadDropZone from "../components/upload/UploadDropZone";
import UploadFileQueue from "../components/upload/UploadFileQueue";
import { useUploadContext } from "../context/UploadContext";

const LIBRARIES = [
  { slug: "bags", name: "Bags", colorCls: "bg-blue-50 text-blue-700 border-blue-200" },
  { slug: "threats", name: "Threats", colorCls: "bg-rose-50 text-rose-700 border-rose-200" },
  { slug: "non-threats", name: "Non-Threats", colorCls: "bg-gray-50 text-gray-700 border-gray-200" },
];

const SUBCATEGORY_MAP: Record<string, { name: string; slug: string }[]> = {
  bags: [
    { name: "Backpack", slug: "backpack" },
    { name: "Briefcase", slug: "briefcase" },
    { name: "Cabin Bag", slug: "cabin-bag" },
    { name: "Camera Bag", slug: "camera-bag" },
    { name: "Cosmetic Bag", slug: "cosmetic-bag" },
    { name: "Duffel Bag", slug: "duffel-bag" },
    { name: "General", slug: "general" },
    { name: "Gym Bag", slug: "gym-bag" },
    { name: "Handbag", slug: "handbag" },
    { name: "Hiking Backpack", slug: "hiking-backpack" },
    { name: "Laptop Bag", slug: "laptop-bag" },
    { name: "Messenger Bag", slug: "messenger-bag" },
    { name: "Pouch", slug: "pouch" },
    { name: "School Bag", slug: "school-bag" },
    { name: "Shoulder Bag", slug: "shoulder-bag" },
    { name: "Sling Bag", slug: "sling-bag" },
    { name: "Suitcase", slug: "suitcase" },
    { name: "Tote Bag", slug: "tote-bag" },
    { name: "Travel Bag", slug: "travel-bag" },
    { name: "Trolley Bag", slug: "trolley-bag" },
  ],
  threats: [
    { name: "Air Gun", slug: "air-gun" },
    { name: "Ammunition", slug: "ammunition" },
    { name: "Axe", slug: "axe" },
    { name: "Baton", slug: "baton" },
    { name: "Box Cutter", slug: "box-cutter" },
    { name: "Brass Knuckles", slug: "brass-knuckles" },
    { name: "Bullet", slug: "bullet" },
    { name: "Cartridge", slug: "cartridge" },
    { name: "Combat Knife", slug: "combat-knife" },
    { name: "Crowbar", slug: "crowbar" },
    { name: "Dagger", slug: "dagger" },
    { name: "Detonator", slug: "detonator" },
    { name: "Dynamite", slug: "dynamite" },
    { name: "Explosive", slug: "explosive" },
    { name: "Explosive Charge", slug: "explosive-charge" },
    { name: "Firecracker", slug: "firecracker" },
    { name: "Folding Knife", slug: "folding-knife" },
    { name: "General", slug: "general" },
    { name: "Grenade", slug: "grenade" },
    { name: "Gun", slug: "gun" },
    { name: "Hammer", slug: "hammer" },
    { name: "Hand Grenade", slug: "hand-grenade" },
    { name: "Ice Pick", slug: "ice-pick" },
    { name: "IED", slug: "ied" },
    { name: "Kitchen Knife", slug: "kitchen-knife" },
    { name: "Knife", slug: "knife" },
    { name: "Machete", slug: "machete" },
    { name: "Magazine", slug: "magazine" },
    { name: "Nunchaku", slug: "nunchaku" },
    { name: "Pistol", slug: "pistol" },
    { name: "Razor Blade", slug: "razor-blade" },
    { name: "Revolver", slug: "revolver" },
    { name: "Rifle", slug: "rifle" },
    { name: "Scalpel", slug: "scalpel" },
    { name: "Shell", slug: "shell" },
    { name: "Shotgun", slug: "shotgun" },
    { name: "Shuriken", slug: "shuriken" },
    { name: "Submachine Gun", slug: "submachine-gun" },
    { name: "Sword", slug: "sword" },
    { name: "Taser", slug: "taser" },
  ],
  "non-threats": [
    { name: "Accessories", slug: "accessories" },
    { name: "Belt", slug: "belt" },
    { name: "Beverage Can", slug: "beverage-can" },
    { name: "Blanket", slug: "blanket" },
    { name: "Board Game", slug: "board-game" },
    { name: "Books", slug: "books" },
    { name: "Camera", slug: "camera" },
    { name: "Cap", slug: "cap" },
    { name: "Charger", slug: "charger" },
    { name: "Clothes", slug: "clothes" },
    { name: "Deodorant", slug: "deodorant" },
    { name: "Documents", slug: "documents" },
    { name: "Electronics", slug: "electronics" },
    { name: "First Aid Kit", slug: "first-aid-kit" },
    { name: "Food", slug: "food" },
    { name: "Fruits", slug: "fruits" },
    { name: "Gaming Console", slug: "gaming-console" },
    { name: "General", slug: "general" },
    { name: "Gloves", slug: "gloves" },
    { name: "Hard Drive", slug: "hard-drive" },
    { name: "Headphones", slug: "headphones" },
    { name: "ID Card", slug: "id-card" },
    { name: "Jacket", slug: "jacket" },
    { name: "Jewelry", slug: "jewelry" },
    { name: "Keyboard", slug: "keyboard" },
    { name: "Keys", slug: "keys" },
    { name: "Laptop", slug: "laptop" },
    { name: "Lock", slug: "lock" },
    { name: "Luggage Tag", slug: "luggage-tag" },
    { name: "Lunch Box", slug: "lunch-box" },
    { name: "Magazine", slug: "magazine" },
    { name: "Medical Equipment", slug: "medical-equipment" },
    { name: "Medication", slug: "medication" },
    { name: "Mobile Phone", slug: "mobile-phone" },
    { name: "Mouse", slug: "mouse" },
    { name: "Notebook", slug: "notebook" },
    { name: "Perfume", slug: "perfume" },
    { name: "Power Bank", slug: "power-bank" },
    { name: "Purse", slug: "purse" },
    { name: "Scarf", slug: "scarf" },
    { name: "Shampoo", slug: "shampoo" },
    { name: "Shoes", slug: "shoes" },
    { name: "Smartwatch", slug: "smartwatch" },
    { name: "Snacks", slug: "snacks" },
    { name: "Soap", slug: "soap" },
    { name: "Socks", slug: "socks" },
    { name: "Sports Equipment", slug: "sports-equipment" },
    { name: "Stuffed Toy", slug: "stuffed-toy" },
    { name: "Sunglasses", slug: "sunglasses" },
    { name: "Tablet", slug: "tablet" },
    { name: "Toiletries", slug: "toiletries" },
    { name: "Toothbrush", slug: "toothbrush" },
    { name: "Toothpaste", slug: "toothpaste" },
    { name: "Toys", slug: "toys" },
    { name: "Travel Pillow", slug: "travel-pillow" },
    { name: "Umbrella", slug: "umbrella" },
    { name: "USB Drive", slug: "usb-drive" },
    { name: "Wallet", slug: "wallet" },
    { name: "Board Game", slug: "board-game" },
    { name: "Sports Equipment", slug: "sports-equipment" },
  ],
};

function getLibrarySubcategories(librarySlug: string): { name: string; slug: string }[] {
  return SUBCATEGORY_MAP[librarySlug] || SUBCATEGORY_MAP["non-threats"];
}

export default function UploadPage() {
  const { files, setFiles, staged, setStaged, clearAll } = useUploadContext();
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("My Upload");
  const [massCategory, setMassCategory] = useState("");
  const [massSubcategory, setMassSubcategory] = useState("");
  const [selectedForMass, setSelectedForMass] = useState<Set<number>>(new Set());

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    const startIdx = staged.length;
    const newStaged = newFiles.map((f) => ({
      file: f,
      category: "",
      subcategory: "",
      name: f.name,
      valid_region_points: null,
    }));
    setStaged((prev) => [...prev, ...newStaged]);
    const newIndices = new Set<number>();
    for (let i = startIdx; i < startIdx + newFiles.length; i++) {
      newIndices.add(i);
    }
    setSelectedForMass(newIndices);
    setMassCategory("");
    setMassSubcategory("");
  };

  const handleUpload = async () => {
    const missingCategory: string[] = [];
    const missingBagsRegion: string[] = [];

    staged.forEach((s, i) => {
      const sn = `#${i + 1}`;
      if (!s.category || !s.subcategory) {
        missingCategory.push(sn);
      }
      if (s.category === "bags" && !s.valid_region_points) {
        missingBagsRegion.push(sn);
      }
    });

    if (missingCategory.length > 0 || missingBagsRegion.length > 0) {
      const lines: string[] = [];
      if (missingCategory.length > 0) {
        lines.push(`Set category & subcategory for item(s) ${missingCategory.join(", ")}`);
      }
      if (missingBagsRegion.length > 0) {
        lines.push(`Draw valid region for bag item(s) ${missingBagsRegion.join(", ")}`);
      }
      setValidationMessage(lines.join(" | "));
      setTimeout(() => setValidationMessage(null), 5000);
      return;
    }

    setUploading(true);
    setUploadStatus("idle");
    setValidationMessage(null);
    try {
      const formData = new FormData();
      formData.append("folderName", folderName);
      staged.forEach((s) => {
        formData.append("images", s.file);
      });
      const metadata = staged.map((s) => ({
        originalname: s.file.name,
        category: s.category,
        subcategory: s.subcategory,
        name: s.name,
        valid_region_points: s.valid_region_points || null,
      }));
      formData.append("metadata", JSON.stringify(metadata));

      const res = await fetch("http://localhost:8080/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.ok) {
        setUploadStatus("success");
        setTimeout(() => {
          clearAll();
        }, 1000);
      } else {
        setUploadStatus("error");
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("error");
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadStatus("idle");
      }, 3500);
    }
  };

  const massSubcategoryOptions = useMemo(() => {
    if (!massCategory) return [];
    return getLibrarySubcategories(massCategory);
  }, [massCategory]);

  const handleMassApply = () => {
    if (!massCategory) return;
    setStaged((prev) =>
      prev.map((s, idx) => {
        if (!selectedForMass.has(idx)) return s;
        return {
          ...s,
          category: massCategory,
          subcategory: massSubcategory,
        };
      })
    );
    setMassCategory("");
    setMassSubcategory("");
  };

  const toggleSelectAll = () => {
    if (selectedForMass.size === staged.length) {
      setSelectedForMass(new Set());
    } else {
      setSelectedForMass(new Set(staged.map((_, i) => i)));
    }
  };

  const toggleSelect = (idx: number) => {
    setSelectedForMass((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="max-w-7xl mx-auto py-10 px-6 animate-fade-in">
      <div className="border-l-4 border-accent pl-4 mb-8">
        <h2 className="text-3xl font-bold text-ink tracking-tight">Upload Images</h2>
      </div>

      <div className="space-y-6">
        <UploadDropZone onFilesSelected={handleFilesSelected} />

        {staged.length > 0 && (
          <div className="bg-panel rounded-2xl border border-border p-5 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-ink">Mass Assign Category</span>
            </div>

            <div className="mb-3 max-h-40 overflow-y-auto border border-border rounded-lg bg-white">
              <div className="flex items-center gap-2 p-2 border-b border-border bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedForMass.size === staged.length}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
                <span className="text-xs font-medium text-muted">Select All</span>
              </div>
              {staged.map((s, idx) => (
                <label key={idx} className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b border-border last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selectedForMass.has(idx)}
                    onChange={() => toggleSelect(idx)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs text-ink truncate flex-1">#{idx + 1} {s.file.name}</span>
                  {s.category && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">
                      {s.category}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted font-medium">Category</label>
                <select
                  className="w-36 p-2 border border-border rounded-lg text-xs bg-white"
                  value={massCategory}
                  onChange={(e) => {
                    setMassCategory(e.target.value);
                    setMassSubcategory("");
                  }}
                >
                  <option value="">Select category</option>
                  {LIBRARIES.map((cat) => (
                    <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted font-medium">Subcategory</label>
                <select
                  className="w-36 p-2 border border-border rounded-lg text-xs bg-white"
                  value={massSubcategory}
                  onChange={(e) => setMassSubcategory(e.target.value)}
                  disabled={!massCategory}
                >
                  <option value="">None</option>
                  {massSubcategoryOptions.length > 0 ? (
                    massSubcategoryOptions.map((sub: any) => (
                      <option key={sub.slug} value={sub.name}>{sub.name}</option>
                    ))
                  ) : (
                    massCategory ? <option value="General">General</option> : null
                  )}
                </select>
              </div>
              <button
                onClick={handleMassApply}
                disabled={!massCategory || selectedForMass.size === 0}
                className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                Apply to Selected ({selectedForMass.size})
              </button>
            </div>
          </div>
        )}

        <div className="bg-panel rounded-2xl border border-border p-6 shadow-card">
          <button
            onClick={handleUpload}
            disabled={uploading || staged.length === 0}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky transition-all hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              "Uploading..."
            ) : (
              <>
                <UploadIcon size={20} />
                Upload {staged.length > 0 ? `${staged.length} Files` : "Files"}
              </>
            )}
          </button>

          {staged.length === 0 && (
            <div className="mt-4 text-center">
              <p className="text-sm font-medium text-muted">No files selected</p>
              <p className="text-xs text-muted/70 mt-1">
                Drag a folder or files into the dropzone to queue them for upload
              </p>
            </div>
          )}
        </div>

        {validationMessage && (
          <div className="fixed bottom-24 right-6 z-50 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3 shadow-card animate-slide-up max-w-md">
            <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={14} />
            </div>
            <span className="text-sm font-medium">{validationMessage}</span>
          </div>
        )}

        {staged.length > 0 && (
          <UploadFileQueue
            files={files}
            staged={staged}
            setStaged={setStaged}
            setFiles={setFiles}
            uploading={uploading}
            handleUpload={handleUpload}
            selectedForMass={selectedForMass}
            onToggleSelect={toggleSelect}
            onSelectAll={toggleSelectAll}
          />
        )}
      </div>

      {uploadStatus === "success" && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-emerald-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <span className="text-sm font-medium">Upload successful! Go to Collage page to see combinations.</span>
        </div>
      )}

      {uploadStatus === "error" && (
        <div className="fixed bottom-6 right-6 z-50 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-rose-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <AlertCircle size={14} />
          </div>
          <span className="text-sm font-medium">Upload failed. Please try again.</span>
        </div>
      )}
    </div>
  );
}