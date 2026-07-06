
import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { generateValidRegion } from "./lib/autoValidRegion.js";
import { renderSceneAsync } from "./lib/renderCanvas.js";
import Jimp from "jimp";
import WorkerPool from "./lib/workerPool.js";
import {
    getItems,
    getItemById,
    createItem,
    updateItem,
    deleteItem,
    itemExists,
    getBagByItemId,
    createBag,
    updateBag,
    createThreat,
    createNonThreatItem,
    getSavedLayouts,
    getSavedLayoutById,
    createSavedLayout,
    updateSavedLayout,
    deleteSavedLayout,
    getCustomSubcategories,
    addCustomSubcategory,
    removeCustomSubcategory
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

// Multer setup for file uploads (use actual filenames, no UUID)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, libraryImagesRoot);
    },
    filename: (req, file, cb) => {
        // Start with original filename; multer will save with this name
        // Duplicates are handled in the upload handler
        cb(null, file.originalname);
    },
});
const upload = multer({ storage: storage });

// Multer setup for raw file uploads (memory storage for streaming)
const rawUpload = multer({ storage: multer.memoryStorage() });

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

// Root endpoint - API info
app.get("/", (_req, res) => {
  res.json({
    name: "Synthetic X-Ray Generation System API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "GET /api/items/categorized",
      upload: "POST /api/upload",
      processRaw: "POST /api/process-raw-files",
      items: "GET /api/items/:id",
      savedLayouts: "GET /api/saved-layouts",
      customSubcategories: "GET /api/custom-subcategories"
    }
  });
});

// Helper functions for raw file processing
function deriveItemId(filename) {
    const dotIndex = filename.indexOf(".");
    if (dotIndex === -1) return filename;
    return filename.slice(0, dotIndex);
}

function classifyFileType(filename) {
    if (filename.endsWith(".dump.pgm")) return "dump";
    if (filename.endsWith(".tip")) return "tip";
    return null;
}

// Endpoint to process raw files (.dump.pgm and .tip) with worker pool
// Streams NDJSON results back to client as files are processed
app.post("/api/process-raw-files", rawUpload.array("rawFiles"), async (req, res) => {
    // Set NDJSON headers immediately before any async work
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.status(200).flushHeaders();

    try {
        // 1. Read existing items once for duplicate detection
        const items = await getItems();
        const existingIds = new Set(items.map(i => i.id));

        // 2. Process each file: derive ID, classify type, check duplicates
        const nonDuplicates = [];
        let duplicateCount = 0;

        const files = req.files || [];
        console.log(`[process-raw-files] Received ${files.length} files`);
        for (const file of files) {
            const itemId = deriveItemId(file.originalname);
            const fileType = classifyFileType(file.originalname);
            if (!fileType) {
                // Skip files that are neither .dump.pgm nor .tip
                console.log(`[process-raw-files] Skipping unrecognized file: ${file.originalname}`);
                continue;
            }

            if (existingIds.has(itemId)) {
                duplicateCount++;
                console.log(`[process-raw-files] Duplicate skipped: ${itemId}`);
            } else {
                nonDuplicates.push({ file, itemId, fileType });
                console.log(`[process-raw-files] Queued: ${itemId} (${fileType})`);
            }
        }
        console.log(`[process-raw-files] Summary: ${nonDuplicates.length} to process, ${duplicateCount} duplicates`);

        // If no non-duplicate files, send complete line immediately
        if (nonDuplicates.length === 0) {
            res.write(JSON.stringify({
                status: "complete",
                total: 0,
                processed: 0,
                duplicates: duplicateCount,
                failed: 0,
            }) + "\n");
            res.end();
            return;
        }

        // 3. Save file buffers to temp files and dispatch to worker pool
        const pool = new WorkerPool(4);
        let processedCount = 0;
        let failedCount = 0;
        const tempDir = path.resolve(__dirname, "../data/temp");
        await fs.mkdir(tempDir, { recursive: true });

        for (const { file, itemId, fileType } of nonDuplicates) {
            // Write buffer to temp file
            const tempPath = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
            await fs.writeFile(tempPath, file.buffer);

            pool.addTask(
                {
                    filePath: tempPath,
                    itemId,
                    fileType,
                    pixelDataDir: pixelDataRoot,
                    libraryImagesDir: libraryImagesRoot,
                },
                (result) => {
                    // Write NDJSON line immediately — flush to stream
                    const line = JSON.stringify(result);
                    res.write(line + "\n");
                    console.log(`[process-raw-files] NDJSON sent: ${line}`);

                    if (result.status === "done") {
                        processedCount++;
                        console.log(`[process-raw-files] Done: ${result.id} (${result.fileType}) ${result.width}x${result.height}`);
                    }
                    if (result.status === "error") {
                        failedCount++;
                        console.log(`[process-raw-files] Error: ${result.id} — ${result.reason}`);
                    }

                    // Clean up temp file asynchronously
                    fs.unlink(tempPath).catch(() => {});
                }
            );
        }

        // 4. Wait for all tasks to complete
        console.log(`[process-raw-files] Waiting for ${nonDuplicates.length} tasks to complete...`);
        await pool.drain();
        console.log(`[process-raw-files] All tasks done. Processed: ${processedCount}, Failed: ${failedCount}`);

        // 5. Write the complete summary line
        const summary = {
            status: "complete",
            total: nonDuplicates.length,
            processed: processedCount,
            duplicates: duplicateCount,
            failed: failedCount,
        };
        const summaryLine = JSON.stringify(summary);
        res.write(summaryLine + "\n");
        console.log(`[process-raw-files] Summary sent: ${summaryLine}`);
        res.end();

    } catch (err) {
        console.error("process-raw-files error:", err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: err.message });
        } else {
            // Stream already started, try to end gracefully
            try {
                res.end();
            } catch (_) {}
        }
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

// Filtered/paginated saved layouts endpoint
app.get('/api/saved-layouts/filtered', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
      
      // New filter parameters for subcategories
      const bagSubcategories = req.query.bagSubcategories ? String(req.query.bagSubcategories).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const threatSubcategories = req.query.threatSubcategories ? String(req.query.threatSubcategories).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const tags = req.query.tags ? String(req.query.tags).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const filterLogic = req.query.filterLogic ? String(req.query.filterLogic).toLowerCase() : 'or';

      const allLayouts = await getSavedLayouts();

      // Helper to extract objects from either new or legacy structure
      function extractObjects(layout) {
        const obj = layout.layout_json?.objects;
        if (!obj) return [];
        // New structure: { bag: {...}, threats: [...], non-threats: [...] }
        if (obj.bag || obj.threats || obj['non-threats']) {
          const result = [];
          if (obj.bag) result.push({ ...obj.bag, library: 'bag' });
          if (Array.isArray(obj.threats)) {
            obj.threats.forEach(t => result.push({ ...t, library: 'threat' }));
          }
          if (Array.isArray(obj['non-threats'])) {
            obj['non-threats'].forEach(n => result.push({ ...n, library: 'non-threat' }));
          }
          return result;
        }
        // Legacy flat array structure
        if (Array.isArray(obj)) return obj;
        return [];
      }

      // Filter layouts based on criteria
      const filtered = allLayouts.filter((layout) => {
        try {
          const objects = extractObjects(layout);
          if (!objects.length) return false;

          // Extract bag and threat objects
          const bagObjs = objects.filter(o => (o.library || '').toLowerCase().includes('bag'));
          const threatObjs = objects.filter(o => (o.library || '').toLowerCase().includes('threat'));
          
          // Get subcategories from objects (use subcategory field if available, otherwise extract from library)
          const layoutBagSubcategories = bagObjs.map(o => {
            // First try the subcategory field (Option A: stored in layout)
            if (o.subcategory) {
              // Normalize to slug format (replace spaces with hyphens) to match frontend
              return o.subcategory.toLowerCase().replace(/\s+/g, '-');
            }
            // Fallback: extract from library field (e.g., "bag-backpack" -> "backpack")
            const lib = (o.library || '').toLowerCase();
            if (lib.includes('bag')) {
              const parts = lib.split('-');
              if (parts.length > 1) return parts[1];
            }
            return 'general';
          });
          
          const layoutThreatSubcategories = threatObjs.map(o => {
            // First try the subcategory field (Option A: stored in layout)
            if (o.subcategory) {
              // Normalize to slug format (replace spaces with hyphens) to match frontend
              return o.subcategory.toLowerCase().replace(/\s+/g, '-');
            }
            // Fallback: extract from library field
            const lib = (o.library || '').toLowerCase();
            if (lib.includes('threat')) {
              const parts = lib.split('-');
              if (parts.length > 1) return parts[1];
            }
            return 'general';
          });

          // If no filters selected, include all layouts
          if (bagSubcategories.length === 0 && threatSubcategories.length === 0 && tags.length === 0) {
            return true;
          }

          // Bags always use OR logic (each layout has only one bag)
          const bagMatch = bagSubcategories.length === 0 || 
                          bagSubcategories.some(sub => layoutBagSubcategories.includes(sub));
          
          // Threats use the selected filter logic
          let threatMatch = true;
          if (threatSubcategories.length > 0) {
            if (filterLogic === 'or') {
              // OR: Layout has ANY of the selected threats
              threatMatch = threatSubcategories.some(sub => layoutThreatSubcategories.includes(sub));
            } else if (filterLogic === 'and') {
              // AND: Layout has ALL of the selected threats
              threatMatch = threatSubcategories.every(sub => layoutThreatSubcategories.includes(sub));
            }
          }

          // Tags filter - OR logic (layout has ANY of the selected tags)
          const layoutBagTags = bagObjs.length > 0 ? (bagObjs[0].tags || []) : [];
          const tagMatch = tags.length === 0 || tags.some(tag => layoutBagTags.includes(tag));
          
          // Match if bag matches AND threat matches AND tag matches
          return bagMatch && threatMatch && tagMatch;
        } catch {
          return false;
        }
      });

        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * limit;
        const pagedLayouts = filtered.slice(start, start + limit);

        res.json({
            ok: true,
            layouts: pagedLayouts,
            pagination: {
                page: safePage,
                limit,
                total,
                totalPages,
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.post('/api/saved-layouts', async (req, res) => {
    const { id, name, filepath, layout_json } = req.body;
    if (!name || !layout_json) return res.status(400).json({ ok: false, error: 'Missing name or layout_json' });
    try {
        const layout = await createSavedLayout({ id, name, filepath, layout_json });
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

// Custom subcategories endpoints
app.get('/api/custom-subcategories', async (req, res) => {
    try {
        const customSubs = await getCustomSubcategories();
        res.json({ ok: true, customSubcategories: customSubs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.post('/api/custom-subcategories', async (req, res) => {
    try {
        const { category, name } = req.body;
        if (!category || !name) {
            return res.status(400).json({ ok: false, error: 'Missing category or name' });
        }
        
        const result = await addCustomSubcategory(category, name);
        if (!result.success) {
            return res.status(400).json({ ok: false, error: result.error });
        }
        
        res.json({ ok: true, subcategory: result.subcategory });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.delete('/api/custom-subcategories/:category/:slug', async (req, res) => {
    try {
        const { category, slug } = req.params;
        await removeCustomSubcategory(category, slug);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Upload endpoint
app.post("/api/upload", upload.array("images"), async (req, res) => {
    try {
        const files = req.files || [];
        // Optional metadata: JSON string or object keyed by original filename
        let metadataArray = [];
        if (req.body.metadata) {
            try {
                const parsed = typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata;
                if (Array.isArray(parsed)) {
                    metadataArray = parsed;
                }
            } catch (err) {
                console.warn('Warning: failed to parse upload metadata', err);
            }
        }

        const errors = [];
        const processed = [];
        const processedIds = new Set(); // Track which metadata entries were processed

        for (const file of files) {
            // Extract ID from filename without extension
            const itemId = path.basename(file.originalname, path.extname(file.originalname));
            
            // Find metadata for this file
            const fileMeta = metadataArray.find(m => m.originalname === file.originalname) || {};

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

            if (fileMeta.category) {
                category = fileMeta.category;
            }
            if (fileMeta.subcategory) subcategory = fileMeta.subcategory;
            const tags = fileMeta.tags || [];
            
            // Detect actual image dimensions from the saved file
            let width = 512;
            let height = 512;
            try {
                const savedFilePath = path.join(libraryImagesRoot, file.filename);
                const loadedImg = await Jimp.read(savedFilePath);
                width = loadedImg.bitmap.width;
                height = loadedImg.bitmap.height;
            } catch (dimErr) {
                console.warn("Warning: could not detect image dimensions for", file.filename, dimErr);
            }

            // Create item with actual filename (no UUID)
            const item = await createItem({
                id: itemId,
                filename: file.originalname,
                filepath: file.filename, // This is the actual filename, not a UUID
                category,
                subcategory,
                name,
                pixel_value,
                width,
                height,
                polygon_json: fileMeta.polygon_json || null,
                mask_path: fileMeta.mask_path || null,
                tags: tags.length > 0 ? tags : null
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
            processedIds.add(file.originalname);
        }

        // Process pre-processed metadata items that were NOT in req.files
        // (i.e., items already processed by /api/process-raw-files)
        for (const m of metadataArray) {
            if (m.preProcessed === true && !processedIds.has(m.originalname)) {
                try {
                    const metaItemId = m.itemId || m.originalname;
                    const category = m.category || "non-threats";
                    const subcategory = m.subcategory || "General";

                    // Create item with pre-generated filepath — file already exists on disk
                    const item = await createItem({
                        id: metaItemId,
                        filename: metaItemId,
                        filepath: m.preGeneratedFilepath,
                        category,
                        subcategory,
                        name: metaItemId,
                        pixel_value: category === "bags" ? 42000 + Math.floor(Math.random() * 10000) : 32767,
                        width: m.width || 512,
                        height: m.height || 512,
                        pixel_data_path: m.pixelDataFilename || null,
                        tags: m.tags && m.tags.length > 0 ? m.tags : null
                    });

                    // Create sub-table records based on category
                    if (category === "bags") {
                        await createBag({
                            item_id: item.id,
                            valid_region_points: m.valid_region_points || null
                        });
                    } else if (category === "threats") {
                        await createThreat({
                            item_id: item.id,
                            threat_type: null,
                            severity: null
                        });
                        await createNonThreatItem({
                            item_id: item.id,
                            subcategory_slug: subcategory.toLowerCase().replace(/\s+/g, "-")
                        });
                    } else {
                        await createNonThreatItem({
                            item_id: item.id,
                            subcategory_slug: subcategory.toLowerCase().replace(/\s+/g, "-")
                        });
                    }

                    processed.push(metaItemId);
                } catch (err) {
                    console.error("Error processing preProcessed metadata:", m.originalname, err);
                    errors.push({ filename: m.originalname, message: String(err) });
                }
            }
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

// Auto-generate valid region from raw pixel data (for pre-upload staged items)
app.post("/api/auto-valid-region", async (req, res) => {
    try {
        const { itemId, pixelDataPath } = req.body;
        
        if (!itemId || !pixelDataPath) {
            return res.status(400).json({ ok: false, error: "Missing itemId or pixelDataPath" });
        }

        const fullPath = path.join(pixelDataRoot, pixelDataPath);
        
        // Check if pixel data file exists
        try {
            await fs.access(fullPath);
        } catch {
            return res.status(404).json({ ok: false, error: `Pixel data file not found: ${pixelDataPath}` });
        }

        console.log(`[auto-valid-region] Processing staged item: ${itemId} from ${fullPath}`);
        
        const result = await generateValidRegion(fullPath);
        
        console.log(`[auto-valid-region] Success: ${itemId} - ${result.points.length} points (${result.width}x${result.height}, ${result.pixelCount} pixels)`);

        res.json({
            ok: true,
            message: `Valid region auto-generated with ${result.points.length} points`,
            data: {
                points: result.points,
                width: result.width,
                height: result.height,
                pixelCount: result.pixelCount
            }
        });
    } catch (error) {
        console.error(`[auto-valid-region] Error:`, error);
        res.status(500).json({ ok: false, error: String(error) });
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

// Render and save a collage combination as a PNG image
app.post("/api/render-and-save-collage", async (req, res) => {
    try {
        const { objects, name } = req.body;
        if (!objects || !Array.isArray(objects) || objects.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or invalid objects array" });
        }
        if (!name) {
            return res.status(400).json({ ok: false, error: "Missing name" });
        }

        // Sanitize the filename - use the synthesized ID directly (already unique)
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
        const filename = `${safeName}.png`;
        const outputPath = path.join(collageImagesRoot, filename);

        console.log(`[render-and-save-collage] Rendering scene "${name}" → ${filename}`);

        // Render the scene to a PNG buffer
        const pngBuffer = await renderSceneAsync(objects, 800, 600);

        // Write to disk
        await fs.writeFile(outputPath, pngBuffer);

        console.log(`[render-and-save-collage] Saved: ${filename} (${pngBuffer.length} bytes)`);

        res.json({
            ok: true,
            filename,
            url: `/data/collage_images/${filename}`,
        });
    } catch (err) {
        console.error("[render-and-save-collage] Error:", err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Render a preview image from a saved layout using real pixel data (I1*I2/65535)
app.post('/api/render-preview', async (req, res) => {
    try {
        const { objects } = req.body;
        if (!objects) return res.status(400).json({ ok: false, error: 'Missing objects' });

        // Load all items to look up pixel_data_path by id
        const allItems = await getItems();
        const itemMap = new Map(allItems.map(i => [i.id, i]));

        // Flatten objects into renderScene format
        const flatObjects = [];
        let bagWidth = 800;
        let bagHeight = 600;

        if (objects.bag) {
            const b = objects.bag;
            bagWidth = b.size?.width || 800;
            bagHeight = b.size?.height || 600;
            const item = itemMap.get(b.id);
            flatObjects.push({
                id: b.id,
                filepath: b.filepath,
                pixel_data_path: item?.pixel_data_path || null,
                originalPixelValue: b.originalPixelValue,
                transform: {
                    x: b.center?.x || 0,
                    y: b.center?.y || 0,
                    width: b.size?.width || 0,
                    height: b.size?.height || 0,
                    rotation: 0,
                },
                layer: b.layer || 0,
            });
        }

        const addObjects = (list, library) => {
            if (!Array.isArray(list)) return;
            for (const obj of list) {
                const item = itemMap.get(obj.id);
                flatObjects.push({
                    id: obj.id,
                    filepath: obj.filepath,
                    pixel_data_path: item?.pixel_data_path || null,
                    originalPixelValue: obj.originalPixelValue,
                    transform: {
                        x: obj.center?.x || 0,
                        y: obj.center?.y || 0,
                        width: obj.size?.width || 0,
                        height: obj.size?.height || 0,
                        rotation: obj.rotation || 0,
                    },
                    layer: obj.layer || 0,
                });
            }
        };

        addObjects(objects.threats, 'threat');
        addObjects(objects['non-threats'], 'non-threat');

        if (flatObjects.length === 0) {
            return res.status(400).json({ ok: false, error: 'No objects to render' });
        }

        // Render using the bag's dimensions as canvas size
        const pngBuffer = await renderSceneAsync(flatObjects, bagWidth, bagHeight);

        res.set('Content-Type', 'image/png');
        res.send(pngBuffer);
    } catch (err) {
        console.error('[render-preview] Error:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;

app.listen(port, () => {
    console.log(`[backend] listening on http://localhost:${port}`);
});

export default app;
