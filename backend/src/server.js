
import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { generateDataset } from "./api/datasetGenerator.js";
import { isObjectInsideContainer } from "./lib/geometry.js";
import { loadImage } from "canvas";
import { ReadDump } from "./lib/dumpRead.js";
import { readTip } from "./lib/tipRead.js";
import {
    getItems,
    getItemById,
    createItem,
    updateItem,
    deleteItem,
    itemExists,
    getBags,
    getBagByItemId,
    createBag,
    updateBag,
    deleteBag,
    getThreats,
    getThreatByItemId,
    createThreat,
    updateThreat,
    deleteThreat,
    getNonThreatItems,
    getNonThreatItemByItemId,
    createNonThreatItem,
    updateNonThreatItem,
    deleteNonThreatItem,
    getSavedLayouts,
    getSavedLayoutById,
    createSavedLayout,
    updateSavedLayout,
    deleteSavedLayout
} from "./lib/storage.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exportsRoot = path.resolve(__dirname, "../data/exports");
const libraryImagesRoot = path.resolve(__dirname, "../data/library_images");
const collageImagesRoot = path.resolve(__dirname, "../data/collage_images");
const pixelDataRoot = path.resolve(__dirname, "../data/pixel_data");

// Ensure directories exist
await fs.mkdir(exportsRoot, { recursive: true });
await fs.mkdir(libraryImagesRoot, { recursive: true });
await fs.mkdir(collageImagesRoot, { recursive: true });
await fs.mkdir(pixelDataRoot, { recursive: true });

// Serve static files from data directory
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, libraryImagesRoot);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `${uuidv4()}${ext}`;
        cb(null, filename);
    },
});
const upload = multer({ storage: storage });

function safeNowStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

// Helper to extract subcategory from filename (fallback)
function parseFilename(filename) {
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    const parts = nameWithoutExt.split(/[_-]/);
    
    let subcategory = "General";
    
    if (parts.length > 1) {
        subcategory = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
    }
    
    return { subcategory };
}

// ------------------------------
// API endpoints
// ------------------------------
app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "synthetic-xray-backend" });
});

// Endpoint to read dump.pgm file
app.post("/api/read-dump", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, error: "No file uploaded" });
        }
        const filePath = req.file.path;
        const data = ReadDump(filePath);
        
        // Store pixel data
        const pixelDataId = uuidv4();
        const pixelDataFilename = `${pixelDataId}.json`;
        const pixelDataPath = path.join(pixelDataRoot, pixelDataFilename);
        await fs.writeFile(pixelDataPath, JSON.stringify(data), "utf8");
        
        // Save original dump file
        const originalFilePath = path.join(libraryImagesRoot, `${pixelDataId}${path.extname(req.file.originalname)}`);
        await fs.rename(filePath, originalFilePath);
        
        const itemId = path.basename(req.file.originalname, path.extname(req.file.originalname));
        
        // Check if item already exists
        let existingItem = await getItemById(itemId);
        
        const width = data.high[0].length;
        const height = data.high.length;
        
        if (existingItem) {
            // Update existing item
            await updateItem(itemId, {
                pixel_data_path: pixelDataFilename,
                original_file_path: `${pixelDataId}${path.extname(req.file.originalname)}`,
                width,
                height
            });
        } else {
            // Create new item
            const item = await createItem({
                id: itemId,
                filename: req.file.originalname,
                filepath: `${pixelDataId}${path.extname(req.file.originalname)}`,
                category: "bags",
                subcategory: "General",
                name: itemId,
                pixel_value: 42000 + Math.floor(Math.random() * 10000),
                width,
                height,
                pixel_data_path: pixelDataFilename,
                original_file_path: `${pixelDataId}${path.extname(req.file.originalname)}`
            });
            await createBag({
                item_id: item.id,
                valid_region_points: null
            });
        }
        
        res.json({ ok: true, data, pixelDataPath, itemId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: String(error) });
    }
});

// Endpoint to read .tip file
app.post("/api/read-tip", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, error: "No file uploaded" });
        }
        const filePath = req.file.path;
        const data = readTip(filePath);
        
        // Store pixel data
        const pixelDataId = uuidv4();
        const pixelDataFilename = `${pixelDataId}.json`;
        const pixelDataPath = path.join(pixelDataRoot, pixelDataFilename);
        await fs.writeFile(pixelDataPath, JSON.stringify(data), "utf8");
        
        // Save original tip file
        const originalFilePath = path.join(libraryImagesRoot, `${pixelDataId}${path.extname(req.file.originalname)}`);
        await fs.rename(filePath, originalFilePath);
        
        const itemId = path.basename(req.file.originalname, path.extname(req.file.originalname));
        
        // Check if item already exists
        let existingItem = await getItemById(itemId);
        
        const width = data.high_raw[0].length;
        const height = data.high_raw.length;
        
        if (existingItem) {
            // Update existing item
            await updateItem(itemId, {
                pixel_data_path: pixelDataFilename,
                original_file_path: `${pixelDataId}${path.extname(req.file.originalname)}`,
                width,
                height
            });
        } else {
            // Create new item
            const item = await createItem({
                id: itemId,
                filename: req.file.originalname,
                filepath: `${pixelDataId}${path.extname(req.file.originalname)}`,
                category: "threats",
                subcategory: "General",
                name: itemId,
                pixel_value: 10000 + Math.floor(Math.random() * 10000),
                width,
                height,
                pixel_data_path: pixelDataFilename,
                original_file_path: `${pixelDataId}${path.extname(req.file.originalname)}`
            });
            await createThreat({
                item_id: item.id,
                threat_type: null,
                severity: null
            });
            await createNonThreatItem({
                item_id: item.id,
                subcategory_slug: "general"
            });
        }
        
        res.json({ ok: true, data, pixelDataPath, itemId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: String(error) });
    }
});

// Endpoint to get pixel data by item ID
app.get("/api/item/:id/pixel-data", async (req, res) => {
    try {
        const item = await getItemById(req.params.id);
        if (!item) {
            return res.status(404).json({ ok: false, error: "Item not found" });
        }
        
        // Look for pixel data file
        const possibleFilenames = [
            `${item.name}.json`,
            `${item.id}.json`
        ];
        
        for (const filename of possibleFilenames) {
            const pixelDataPath = path.join(pixelDataRoot, filename);
            try {
                const data = await fs.readFile(pixelDataPath, "utf8");
                return res.json({ ok: true, data: JSON.parse(data) });
            } catch {
                // Continue to next possible filename
            }
        }
        
        res.status(404).json({ ok: false, error: "Pixel data not found" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: String(error) });
    }
});

app.post("/api/export", async (req, res) => {
    try {
        const payload = req.body ?? {};
        const exportId = `synth-${safeNowStamp()}`;
        const outDir = path.join(exportsRoot, exportId);
        await fs.mkdir(outDir, { recursive: true });

        const bagObj = payload.objects?.find(obj => obj.library === "bag");
        const threatObj = payload.objects?.find(obj => obj.library === "threat");

        let threatStatus = "clean";
        let placementValidity = "valid";

        if (threatObj) {
            threatStatus = "threat_present";
            if (bagObj) {
                const isInside = isObjectInsideContainer(threatObj, bagObj);
                placementValidity = isInside ? "valid" : "out_of_bounds";
            } else {
                placementValidity = "out_of_bounds";
            }
        }

        const metadata = {
            exportId,
            createdAt: new Date().toISOString(),
            prototype: payload.prototype ?? "synthetic-xray",
            threat_status: threatStatus,
            placement_validity: placementValidity,
            
            annotationSchema: {
                type: payload.annotationSchema ?? "per-object-segmentation",
                description: "Per-object annotations with bounding box/segmentation polygon, plus valid region for the bag",
                levels: ["bag", "object"]
            },

            bag: bagObj ? {
                object: bagObj,
                validPlacementRegion: payload.validRegionPolygon ?? [],
            } : null,

            objects: (payload.objects ?? []).map(obj => ({
                ...obj,
                isThreat: obj.library === "threat",
                segmentation: obj.segmentation ?? null,
            })),

            annotationCount: Array.isArray(payload.annotations) ? payload.annotations.length : 0,
            active: payload.active ?? null,
            annotations: payload.annotations ?? [],
            validRegionPolygon: payload.validRegionPolygon ?? [],
        };

        await fs.writeFile(path.join(outDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

        const nonBagNonThreatCount = metadata.objects.filter(obj => obj.library !== "bag" && obj.library !== "threat").length;
        
        const summaryText = [
            `Export ID: ${exportId}`,
            `Created At: ${metadata.createdAt}`,
            `Prototype: ${metadata.prototype}`,
            `Annotation Schema: ${metadata.annotationSchema.type}`,
            `Objects: ${metadata.objects.length} total`,
            `  - Bag: ${bagObj ? bagObj.name : 'n/a'}`,
            `  - Threat: ${threatObj ? threatObj.name : 'n/a'}`,
            `  - Other objects: ${nonBagNonThreatCount}`,
            `Valid Region: ${metadata.bag?.validPlacementRegion?.length > 0 ? 'Yes' : 'No'}`,
            `Threat Status: ${metadata.threat_status}`,
            `Placement Validity: ${metadata.placement_validity}`,
        ].join("\n");
        await fs.writeFile(path.join(outDir, "summary.txt"), summaryText, "utf8");

        // Call generateDataset to render the single custom composite PNG and JSON label
        const saveImages = payload.saveImages !== false;
        await generateDataset(payload, exportId, outDir, saveImages);

        res.json({
            ok: true,
            message: "Synthesis export saved to disk.",
            exportId,
            outputDir: outDir,
            files: [
                "metadata.json",
                "summary.txt",
                ...(saveImages ? ["images/" + exportId + ".png"] : []),
                "labels/" + exportId + ".json",
            ],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: "Failed to save export.", error: String(error) });
    }
});

// Batch dataset generation endpoint (from CollagePage)
app.post("/api/dataset/generate", async (req, res) => {
    try {
        const payload = req.body ?? {};
        const datasetId = `dataset-${safeNowStamp()}`;
        // Save generated collages in data/collage_images/ folder
        const outDir = path.join(collageImagesRoot, datasetId);
        await fs.mkdir(outDir, { recursive: true });

        const saveImages = payload.saveImages !== false;
        const result = await generateDataset(payload, datasetId, outDir, saveImages);

        res.json({
            ok: true,
            message: "Dataset generated successfully.",
            datasetId,
            outputDir: outDir,
            files: result.files,
            manifest: result.manifest
        });
    } catch (error) {
        console.error("Dataset generation error:", error);
        res.status(500).json({ ok: false, message: "Failed to generate dataset.", error: String(error) });
    }
});

// Helper to normalize category name into exactly three main categories
function normalizeCategory(cat) {
    const normalized = (cat || "").toLowerCase();
    if (normalized.includes("bag")) return "bags";
    if (normalized.includes("threat") || normalized.includes("electronic") || normalized === "electronics") return "threats";
    return "non-threats";
}

// Get all items organized by category and subcategory
app.get("/api/items/categorized", async (_req, res) => {
  try {
    const items = await getItems();
    const categorized = {};
    
    for (const item of items) {
      const normalizedCategory = normalizeCategory(item.category);
      if (!categorized[normalizedCategory]) {
        categorized[normalizedCategory] = {};
      }
      const subcat = item.subcategory || "General";
      if (!categorized[normalizedCategory][subcat]) {
        categorized[normalizedCategory][subcat] = [];
      }
      
      if (item.category === "bags") {
        const bagData = await getBagByItemId(item.id);
        if (bagData) {
          item.valid_region_points = bagData.valid_region_points?.simplifiedPoints || bagData.valid_region_points?.points || bagData.valid_region_points;
          item.validRegionData = bagData.valid_region_points;
        }
      }
      
      categorized[normalizedCategory][subcat].push(item);
    }
    
    res.json({ ok: true, categorized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Saved layouts endpoints
app.get('/api/saved-layouts', async (_req, res) => {
    try {
        const layouts = await getSavedLayouts();
        res.json({ ok: true, layouts });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.post('/api/saved-layouts', async (req, res) => {
    const { name, filepath, layout_json } = req.body;
    if (!name || !layout_json) return res.status(400).json({ ok: false, error: 'Missing name or layout_json' });
    try {
        const layout = await createSavedLayout({ name, filepath, layout_json });
        res.json({ ok: true, layout });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.get('/api/saved-layouts/:id', async (req, res) => {
    try {
        const layout = await getSavedLayoutById(req.params.id);
        if (!layout) return res.status(404).json({ ok: false, error: 'Not found' });
        res.json({ ok: true, layout });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.delete('/api/saved-layouts/:id', async (req, res) => {
    try {
        await deleteSavedLayout(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Upload endpoint
app.post("/api/upload", upload.array("images"), async (req, res) => {
    try {
        const { folderName, description = "" } = req.body;
        const files = req.files;
        // Optional metadata: JSON string or object keyed by original filename
        let metadataByName = {};
        if (req.body.metadata) {
            try {
                const parsed = typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata;
                if (Array.isArray(parsed)) {
                    for (const m of parsed) {
                        if (m.originalname) metadataByName[m.originalname] = m;
                    }
                } else if (parsed && typeof parsed === 'object') {
                    // If object keyed by filename
                    metadataByName = parsed;
                }
            } catch (err) {
                console.warn('Warning: failed to parse upload metadata', err);
            }
        }

        const errors = [];
        const processed = [];

        for (const file of files) {
            // Extract ID from filename without extension
            const itemId = path.basename(file.originalname, path.extname(file.originalname));
            
            // Check if item already exists
            if (await itemExists(itemId)) {
                errors.push({ filename: file.originalname, message: `Item ${itemId} already exists in library` });
                // Clean up the uploaded file since we won't use it
                try {
                    await fs.unlink(path.join(libraryImagesRoot, file.filename));
                } catch (unlinkErr) {
                    console.warn("Could not delete unused file", unlinkErr);
                }
                continue;
            }

            // Classify by filename prefix only
    const filename = file.originalname.toLowerCase();
    let category, subcategory, pixel_value;

    if (filename.startsWith("bag")) {
      category = "bags";
      pixel_value = 42000 + Math.floor(Math.random() * 10000);
    } else if (filename.startsWith("threat")) {
      category = "threats";
      pixel_value = 10000 + Math.floor(Math.random() * 10000);
    } else {
      category = "non-threats";
      pixel_value = 32767;
    }
    const parsed = parseFilename(file.originalname);
    subcategory = parsed.subcategory;
    const name = path.basename(file.originalname, path.extname(file.originalname));

    // If metadata provided for this file, allow overrides and extra data
    const fileMeta = metadataByName[file.originalname] || {};
    if (fileMeta.category) {
      category = fileMeta.category;
    }
    if (fileMeta.subcategory) subcategory = fileMeta.subcategory;
            
            // Detect actual image dimensions from the saved file
            let width = 512;
            let height = 512;
            try {
                const savedFilePath = path.join(libraryImagesRoot, file.filename);
                const loadedImg = await loadImage(savedFilePath);
                width = loadedImg.width;
                height = loadedImg.height;
            } catch (dimErr) {
                console.warn("Warning: could not detect image dimensions for", file.filename, dimErr);
            }

            // Create item with our new ID
            const item = await createItem({
                id: itemId,
                filename: file.originalname,
                filepath: file.filename,
                category,
                subcategory,
                name,
                pixel_value,
                width,
                height,
                polygon_json: fileMeta.polygon_json || null,
                mask_path: fileMeta.mask_path || null
            });

            if (category === "bags") {
                let vr = null;
                if (fileMeta.valid_region_points) {
                    // Normalize valid region data to only points/simplifiedPoints
                    const data = fileMeta.valid_region_points;
                    if (data && typeof data === 'object') {
                        vr = {
                            points: data.points || data.simplifiedPoints || [],
                            simplifiedPoints: data.simplifiedPoints || data.points || []
                        };
                    } else if (Array.isArray(data)) {
                        vr = {
                            points: data,
                            simplifiedPoints: data
                        };
                    }
                }
                await createBag({
                    item_id: item.id,
                    valid_region_points: vr
                });
            } else if (category === "threats") {
                await createThreat({
                    item_id: item.id,
                    threat_type: fileMeta.threat_type || null,
                    severity: fileMeta.severity || null
                });
                // Also add to threat_items for backward compatibility
                await createNonThreatItem({
                    item_id: item.id,
                    subcategory_slug: subcategory.toLowerCase().replace(/\s+/g, "-")
                });
            } else {
                // All other categories are treated as non-threats
                const subSlug = subcategory ? String(subcategory).toLowerCase().replace(/\s+/g, "-") : null;
                await createNonThreatItem({
                    item_id: item.id,
                    subcategory_slug: subSlug
                });
            }

            processed.push(itemId);
        }

        res.json({ 
            ok: true, 
            message: errors.length > 0 ? "Some files processed, some had errors" : "Files uploaded successfully!", 
            itemsProcessed: processed.length,
            errors 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Update item metadata
app.put("/api/items/:id", async (req, res) => {
  try {
    const { category, subcategory } = req.body;
    if (!category || !subcategory) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const item = await updateItem(req.params.id, { category, subcategory });
    if (!item) {
      return res.status(404).json({ ok: false, error: "Item not found" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Delete an individual item
app.delete("/api/items/:id", async (req, res) => {
    try {
        const item = await getItemById(req.params.id);
        if (item) {
            try {
                await fs.unlink(path.join(libraryImagesRoot, item.filepath));
            } catch (err) {
                console.error("Error deleting file:", err);
            }
        }
        await deleteItem(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Update bag valid region (only supports points and simplifiedPoints)
app.put("/api/items/:id/valid-region", async (req, res) => {
    try {
        const { points, simplifiedPoints } = req.body;
        // Store just points and simplifiedPoints
        const dataToStore = {
            points,
            simplifiedPoints
        };
        await updateBag(req.params.id, { valid_region_points: dataToStore });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Delete bag valid region (set to null)
app.delete("/api/items/:id/valid-region", async (req, res) => {
    try {
        await updateBag(req.params.id, { valid_region_points: null });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Get item details (including valid region for bags)
app.get("/api/items/:id", async (req, res) => {
  try {
    const item = await getItemById(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: "Item not found" });
    }
    
    if (item.category === "bags") {
      const bagData = await getBagByItemId(item.id);
      if (bagData) {
        item.validRegionPoints = bagData.valid_region_points?.simplifiedPoints || bagData.valid_region_points?.points || bagData.valid_region_points;
        item.validRegionData = bagData.valid_region_points;
      }
    }
    
    res.json({ ok: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;

app.listen(port, () => {
    console.log(`[backend] listening on http://localhost:${port}`);
});

export default app;
