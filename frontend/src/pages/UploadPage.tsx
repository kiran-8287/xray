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
  const [selectedForMass, setSelectedForMass] = useState<Set<number>>(new Set());
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [duplicateFilenames, setDuplicateFilenames] = useState<string[]>([]);

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    const startIdx = staged.length;
    const newStaged = newFiles.map((f) => ({
      file: f,
      category: "",
      subcategory: "",
      valid_region_points: null,
    }));
    setStaged((prev) => [...prev, ...newStaged]);
    const newIndices = new Set<number>();
    for (let i = startIdx; i < startIdx + newFiles.length; i++) {
      newIndices.add(i);
    }
    setSelectedForMass(newIndices);
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

    setConfirmUpload(true);
  };

  const doUpload = async () => {
    setConfirmUpload(false);
    setUploading(true);
    setUploadStatus("idle");
    setValidationMessage(null);
    setDuplicateFilenames([]);
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
        valid_region_points: s.valid_region_points || null,
      }));
      formData.append("metadata", JSON.stringify(metadata));

      const res = await fetch("http://localhost:8080/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.ok) {
        if (data.duplicates && data.duplicates.length > 0) {
          setDuplicateFilenames(data.duplicates);
          setUploadStatus("error");
        } else if (data.errors && data.errors.length > 0) {
          setUploadStatus("error");
        } else {
          setUploadStatus("success");
          setTimeout(() => {
            clearAll();
          }, 1000);
        }
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

        <div className="bg-panel rounded-2xl border border-border p-8 shadow-card">
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
            <div className="mt-6 py-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface border-2 border-dashed border-border flex items-center justify-center">
                <UploadIcon size={28} className="text-muted/40" />
              </div>
              <p className="text-lg font-semibold text-muted">No files selected</p>
              <p className="text-sm text-muted/60 mt-2 max-w-sm mx-auto leading-relaxed">
                Drag and drop a folder or individual image files into the dropzone above to queue them for upload
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

        {duplicateFilenames.length > 0 && (
          <div className="fixed bottom-24 right-6 z-50 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3 shadow-card animate-slide-up max-w-md">
            <div className="w-5 h-5 bg-amber-500 rounded-full text-white flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={14} />
            </div>
            <div className="text-sm font-medium">
              <p className="mb-1">Already exists in library:</p>
              <ul className="list-disc list-inside text-xs">
                {duplicateFilenames.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
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

      {/* Upload confirmation dialog */}
      {confirmUpload && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-panel border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4" style={{ maxWidth: 440, width: "90%" }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-900/40 border border-amber-700/50 flex items-center justify-center shrink-0">
                <UploadIcon size={18} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">Confirm Upload</h3>
                <p className="text-sm text-muted leading-relaxed">
                  This will upload <strong className="text-ink">{staged.length} file{staged.length !== 1 ? 's' : ''}</strong> to Library. Only proceed if you trust this source.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConfirmUpload(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-ink hover:bg-nav transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doUpload}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:opacity-95 text-white transition-colors"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadStatus === "success" && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center gap-3 shadow-card animate-slide-up">
          <div className="w-5 h-5 bg-emerald-500 rounded-full text-white flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <span className="text-sm font-medium">Upload successful! Go to Collage page to see combinations.</span>
        </div>
      )}

      {uploadStatus === "error" && duplicateFilenames.length === 0 && (
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