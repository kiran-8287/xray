
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
    removeCustomSubcategory,
    streamItems,
    getItemsPaginated
} from "./lib/storage.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" })); // Increased for large batch uploads with metadata

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exportsRoot = path.resolve(__dirname, "../data/exports");
const libraryImagesRoot = path.resolve(__dirname, "../data/library_images");
const collageImagesRoot = path.resolve(__dirname, "../data/collage_images");
const collageHighRoot = path.resolve(collageImagesRoot, "high");
const collageLowRoot = path.resolve(collageImagesRoot, "low");
const pixelDataRoot = path.resolve(__dirname, "../data/pixel_data");

// Ensure directories exist
await fs.mkdir(exportsRoot, { recursive: true });
await fs.mkdir(libraryImagesRoot, { recursive: true });
await fs.mkdir(collageImagesRoot, { recursive: true });
await fs.mkdir(collageHighRoot, { recursive: true });
await fs.mkdir(collageLowRoot, { recursive: true });
await fs.mkdir(pixelDataRoot, { recursive: true });

// Serve static files from data directory
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

// Note: Thumbnails are no longer generated separately. 
// The frontend uses library_images directly for display.

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

// Clean up temp files older than 1 hour (runs on server startup and can be called periodically)
async function cleanupOldTempFiles() {
  const tempDir = path.resolve(__dirname, "../data/temp");
  try {
    await fs.mkdir(tempDir, { recursive: true });
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    let cleaned = 0;
    for (const file of files) {
      if (!file.endsWith(".tmp")) continue;
      const filePath = path.join(tempDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          cleaned++;
        }
      } catch (err) {
        // Ignore individual file errors
      }
    }
    if (cleaned > 0) {
      console.log(`[temp-cleanup] Cleaned up ${cleaned} old temp files`);
    }
  } catch (err) {
    console.warn("[temp-cleanup] Failed to clean temp files:", err.message);
  }
}

// Run cleanup on startup
await cleanupOldTempFiles();

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
        const skippedFiles = [];
        for (const file of files) {
            const itemId = deriveItemId(file.originalname);
            const fileType = classifyFileType(file.originalname);
            if (!fileType) {
                skippedFiles.push({ filename: file.originalname, reason: "Unrecognized file extension (expected .dump.pgm or .tip)" });
                continue;
            }

            if (existingIds.has(itemId)) {
                duplicateCount++;
            } else {
                nonDuplicates.push({ file, itemId, fileType });
            }
        }

        // Report skipped files immediately
        for (const skipped of skippedFiles) {
            res.write(JSON.stringify({
                status: "skipped",
                filename: skipped.filename,
                reason: skipped.reason,
            }) + "\n");
        }

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
        // Use larger worker pool for large batches (4-8 workers based on file count)
        const workerCount = Math.min(8, Math.max(4, Math.ceil(nonDuplicates.length / 100)));
        const pool = new WorkerPool(workerCount);
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
                async (result) => {
                    // Write NDJSON line immediately — flush to stream
                    const line = JSON.stringify(result);
                    res.write(line + "\n");

                    if (result.status === "done") {
                        processedCount++;
                    }
                    if (result.status === "error") {
                        failedCount++;
                    }

                    // Clean up temp file asynchronously — log warning if cleanup fails
                    fs.unlink(tempPath).catch((cleanupErr) => {
                        console.warn(`[process-raw-files] Failed to delete temp file ${tempPath}:`, cleanupErr.message);
                    });
                }
            );
        }

        // 4. Wait for all tasks to complete
        await pool.drain();

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
        res.end();

    } catch (err) {
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
    const normalized = (cat || "").toLowerCase().trim();
    // Match non-threat first before 'threat' to prevent 'non-threat' matching 'threat'
    if (/^non[- ]?threat/.test(normalized)) return "non-threats";
    if (normalized.includes("bag")) return "bags";
    if (normalized.includes("threat") || normalized.includes("electronic") || normalized === "electronics") return "threats";
    return "non-threats";
}

// Get all items organized by category and subcategory (with pagination)
app.get("/api/items/categorized", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    // Limit to 500 items per request to prevent memory issues
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const categoryFilter = req.query.category || null;
    
    // Use database-level pagination - only load the items we need
    const { items: paginatedItems, pagination } = await getItemsPaginated(page, limit);
    
    // Normalize and categorize items
    const categorized = {};
    const categoryCounts = {};
    
    // Process and categorize items
    for (const item of paginatedItems) {
      const normalizedCategory = normalizeCategory(item.category);
      
      // Count items per category (we'll estimate based on what we have)
      categoryCounts[normalizedCategory] = (categoryCounts[normalizedCategory] || 0) + 1;
      
      // Skip if filtering by category and doesn't match
      if (categoryFilter && normalizedCategory !== categoryFilter) {
        continue;
      }
      
      if (!categorized[normalizedCategory]) {
        categorized[normalizedCategory] = {};
      }
      const subcat = item.subcategory || "General";
      if (!categorized[normalizedCategory][subcat]) {
        categorized[normalizedCategory][subcat] = [];
      }
      
      // Bag data (valid_region_points) is already stored directly on the item
      if (normalizedCategory === "bags" && item.valid_region_points) {
        const vr = item.valid_region_points;
        item.validRegionData = vr;
        item.valid_region_points = vr.simplifiedPoints || vr.points || vr;
      }
      
      categorized[normalizedCategory][subcat].push(item);
    }
    
    res.json({ 
      ok: true, 
      categorized,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        totalItems: pagination.totalItems,
        totalPages: pagination.totalPages,
        totalCategories: Object.keys(categoryCounts).length,
        categoryCounts: {
          // Return estimated counts based on loaded data
          ...categoryCounts
        }
      }
    });
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

// Return only the saved layout IDs (used to continue the synthesized ID sequence)
app.get('/api/saved-layouts/ids', async (_req, res) => {
    try {
        const layouts = await getSavedLayouts();
        const ids = layouts.map((l) => l.id).filter(Boolean);
        res.json({ ok: true, ids });
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
           const threatObjs = objects.filter(o => {
             const lib = (o.library || '').toLowerCase();
             return lib.includes('threat') && !lib.includes('non-threat');
           });
           
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
             if (lib.includes('threat') && !lib.includes('non-threat')) {
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

          // Tags filter - uses the selected filter logic (same as threats)
          const layoutBagTags = bagObjs.length > 0 ? (bagObjs[0].tags || []) : [];
          let tagMatch = true;
          if (tags.length > 0) {
            if (filterLogic === 'or') {
              // OR: Layout has ANY of the selected tags
              tagMatch = tags.some(tag => layoutBagTags.includes(tag));
            } else if (filterLogic === 'and') {
              // AND: Layout has ALL of the selected tags
              tagMatch = tags.every(tag => layoutBagTags.includes(tag));
            }
          }
          
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
    
    // Validate layout_json structure
    try {
        if (!layout_json.objects || typeof layout_json.objects !== 'object') {
            return res.status(400).json({ ok: false, error: 'Invalid layout_json: missing or invalid objects field' });
        }
        
        // Ensure objects has the expected structure
        const obj = layout_json.objects;
        if (!obj.bag && !obj.threats && !obj['non-threats']) {
            return res.status(400).json({ ok: false, error: 'Invalid layout_json: objects must contain at least one of bag, threats, or non-threats' });
        }
        
        // Validate threats is an array if present
        if (obj.threats && !Array.isArray(obj.threats)) {
            return res.status(400).json({ ok: false, error: 'Invalid layout_json: threats must be an array' });
        }
        
        // Validate non-threats is an array if present
        if (obj['non-threats'] && !Array.isArray(obj['non-threats'])) {
            return res.status(400).json({ ok: false, error: 'Invalid layout_json: non-threats must be an array' });
        }
    } catch (err) {
        return res.status(400).json({ ok: false, error: `Invalid layout_json structure: ${err.message}` });
    }
    
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

// Upload endpoint - supports large batches (2k-5k files)
// Create a separate multer instance with increased limits for large uploads
const uploadWithLimits = multer({
  storage: storage,
  limits: {
    fieldNameSize: 10000000,  // 10MB for field names (generous)
    fieldSize: 100000000,     // 100MB for individual fields (metadata can be large)
    fields: 10000,            // Max number of fields
    fileSize: 100000000,      // 100MB per file
    files: 5000               // Max files
  }
});

app.post("/api/upload", uploadWithLimits.array("images", 5000), async (req, res) => {
  // Increase timeout for large uploads (30 minutes)
  req.setTimeout(1800000, () => {
    if (!res.headersSent) {
      res.status(408).json({ ok: false, error: "Upload timeout. Please try again with a smaller batch." });
    }
  });
  
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

            try {
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
                let category, subcategory;

                if (filename.startsWith("bag")) {
                    category = "bags";
                } else if (filename.startsWith("threat")) {
                    category = "threats";
                } else {
                    category = "non-threats";
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
            } catch (fileErr) {
                console.error(`Error processing file ${file.originalname}:`, fileErr);
                errors.push({ filename: file.originalname, message: String(fileErr) });
                // Clean up the uploaded file since processing failed
                try {
                    await fs.unlink(path.join(libraryImagesRoot, file.filename));
                } catch (unlinkErr) {
                    console.warn("Could not delete failed upload file", unlinkErr);
                }
            }
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

// Delete temporary files for pre-processed items (before they're uploaded to library)
app.delete("/api/temp-files/:itemId", async (req, res) => {
    try {
        const { itemId } = req.params;
        const errors = [];
        
        // Delete library image
        const imagePath = path.join(libraryImagesRoot, `${itemId}.png`);
        try {
            await fs.unlink(imagePath);
        } catch (err) {
            // File might not exist, that's okay
            if (err.code !== 'ENOENT') {
                errors.push(`Failed to delete image: ${err}`);
            }
        }
        
        // Delete pixel data files (both high and low energy)
        const highEnergyPath = path.join(pixelDataRoot, "highenergy", `${itemId}.npz`);
        const lowEnergyPath = path.join(pixelDataRoot, "lowenergy", `${itemId}.npz`);
        
        try {
            await fs.unlink(highEnergyPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                errors.push(`Failed to delete high energy pixel data: ${err}`);
            }
        }
        
        try {
            await fs.unlink(lowEnergyPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                errors.push(`Failed to delete low energy pixel data: ${err}`);
            }
        }
        
        if (errors.length > 0) {
            console.error("Errors during temp file cleanup:", errors);
            return res.status(500).json({ ok: false, error: errors.join(", ") });
        }
        
        res.json({ ok: true, message: "Temporary files deleted successfully" });
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

        const result = await generateValidRegion(fullPath);

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

// Batch auto-generate valid regions for multiple items in parallel
app.post("/api/auto-valid-region-batch", async (req, res) => {
    try {
        const { items } = req.body;
        
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or empty items array" });
        }

        if (items.length > 50) {
            return res.status(400).json({ ok: false, error: "Maximum 50 items per batch request" });
        }

        // Process all items in parallel using Promise.all
        const results = await Promise.allSettled(
            items.map(async (item) => {
                const { itemId, pixelDataPath } = item;
                
                if (!itemId || !pixelDataPath) {
                    return {
                        itemId,
                        ok: false,
                        error: "Missing itemId or pixelDataPath"
                    };
                }

                const fullPath = path.join(pixelDataRoot, pixelDataPath);
                
                // Check if pixel data file exists
                try {
                    await fs.access(fullPath);
                } catch {
                    return {
                        itemId,
                        ok: false,
                        error: `Pixel data file not found: ${pixelDataPath}`
                    };
                }

                try {
                    const result = await generateValidRegion(fullPath);
                    return {
                        itemId,
                        ok: true,
                        data: {
                            points: result.points,
                            width: result.width,
                            height: result.height,
                            pixelCount: result.pixelCount
                        }
                    };
                } catch (error) {
                    return {
                        itemId,
                        ok: false,
                        error: error.message || "Failed to generate valid region"
                    };
                }
            })
        );

        // Format results
        const processedResults = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    itemId: items[index].itemId,
                    ok: false,
                    error: result.reason?.message || "Processing failed"
                };
            }
        });

        const succeeded = processedResults.filter(r => r.ok).length;
        const failed = processedResults.filter(r => !r.ok).length;

        res.json({
            ok: true,
            message: `Batch processing complete: ${succeeded} succeeded, ${failed} failed`,
            results: processedResults,
            summary: {
                total: items.length,
                succeeded,
                failed
            }
        });
    } catch (error) {
        console.error(`[auto-valid-region-batch] Error:`, error);
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

// Get pixel data for an item (for frontend rendering with full 16-bit precision)
app.get("/api/items/:id/pixel-data", async (req, res) => {
    try {
        const item = await getItemById(req.params.id);
        if (!item) {
            return res.status(404).json({ ok: false, error: "Item not found" });
        }

        const energyType = req.query.energy || "highenergy";
        let pixelDataFilename = item.pixel_data_path;

        if (!pixelDataFilename) {
            return res.status(404).json({ ok: false, error: "No pixel data path for this item" });
        }

        // If low energy requested, replace the folder prefix
        if (energyType === "lowenergy") {
            pixelDataFilename = pixelDataFilename.replace(/^highenergy[\\/]/, "lowenergy/");
        }

        const fullPath = path.join(pixelDataRoot, pixelDataFilename);
        try {
            await fs.access(fullPath);
        } catch {
            return res.status(404).json({ ok: false, error: `Pixel data file not found: ${pixelDataFilename}` });
        }

        // Read .npz via Python subprocess
        const { spawn } = await import('node:child_process');
        const readNpzScript = path.join(__dirname, 'lib', 'read_npz.py');
        
        const pngBuffer = await new Promise((resolve, reject) => {
            const proc = spawn('python', [readNpzScript, '--npz-path', fullPath], { cwd: __dirname });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('close', (code) => {
                const lines = stdout.trim().split('\n').filter(Boolean);
                const lastLine = lines[lines.length - 1] || '';
                if (code === 0 && lastLine) {
                    try {
                        const parsed = JSON.parse(lastLine);
                        if (parsed.status === 'error') reject(new Error(parsed.reason));
                        else resolve(parsed);
                    } catch { reject(new Error(`Invalid JSON from Python: ${lastLine}`)); }
                } else {
                    reject(new Error(stderr.trim() || lastLine || 'Python process failed'));
                }
            });
            proc.on('error', (err) => reject(new Error(`Failed to start Python: ${err.message}`)));
        });

        res.json({ ok: true, pixel_data: pngBuffer.pixel_data, width: pngBuffer.width, height: pngBuffer.height });
    } catch (err) {
        console.error("[pixel-data] Error:", err);
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
    
    const normalizedCat = normalizeCategory(item.category);
    if (normalizedCat === "bags") {
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

// Helper: inject pixel_data_path into flat objects array from items database
async function enrichObjectsWithPixelData(objects) {
  const allItems = await getItems();
  const itemMap = new Map(allItems.map(i => [i.id, i]));
  return objects.map(obj => {
    const item = itemMap.get(obj.id);
    if (item?.pixel_data_path) {
      return { ...obj, pixel_data_path: item.pixel_data_path };
    }
    return obj;
  });
}

// Render and save a collage combination as a PNG image
app.post("/api/render-and-save-collage", async (req, res) => {
    try {
        const { objects, name, energyType = "highenergy" } = req.body;
        if (!objects || !Array.isArray(objects) || objects.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or invalid objects array" });
        }
        if (!name) {
            return res.status(400).json({ ok: false, error: "Missing name" });
        }

        // Determine output directory based on energy type
        const energyDir = energyType === "lowenergy" ? collageLowRoot : collageHighRoot;

        // Sanitize the filename - use the synthesized ID directly (already unique)
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
        const filename = `${safeName}.png`;
        const outputPath = path.join(energyDir, filename);

        // Rendering scene

        // Enrich objects with pixel_data_path from items database (frontend objects lack this)
        const enrichedObjects = await enrichObjectsWithPixelData(objects);

        // Render the scene to a PNG buffer
        const pngBuffer = await renderSceneAsync(enrichedObjects, 800, 600, energyType);

        // Write to disk
        await fs.writeFile(outputPath, pngBuffer);

        // Saved successfully

        res.json({
            ok: true,
            filename,
            url: `/data/collage_images/${energyType}/${filename}`,
        });
    } catch (err) {
        console.error("[render-and-save-collage] Error:", err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Render and save BOTH high-energy and low-energy collage images at once
app.post("/api/render-and-save-collage-both", async (req, res) => {
    try {
        const { objects, name, outputPath } = req.body;
        if (!objects || !Array.isArray(objects) || objects.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or invalid objects array" });
        }
        if (!name) {
            return res.status(400).json({ ok: false, error: "Missing name" });
        }

        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
        const filename = `${safeName}.png`;

        // Determine output directory
        let highEnergyDir, lowEnergyDir;
        
        if (outputPath && typeof outputPath === 'string') {
            // Sanitize: only strip truly invalid filename characters, NOT colons (valid in Windows drive letters)
            const sanitizedPath = outputPath.trim().replace(/[<>"|?*]/g, '_').replace(/\/$|\\$/, '');
            
            // Prevent directory traversal attacks using resolved normalized path
            const resolvedProjectRoot = path.resolve(__dirname, '..');
            
            // If it's NOT an absolute Windows path (e.g., C:\Users\...), check it stays within project
            if (!path.isAbsolute(sanitizedPath)) {
                // Resolve relative to project's data directory
                const customCollageRoot = path.resolve(resolvedProjectRoot, 'data', sanitizedPath, 'collage_images');
                highEnergyDir = path.resolve(customCollageRoot, 'high');
                lowEnergyDir = path.resolve(customCollageRoot, 'low');
            } else {
                // Absolute Windows path (e.g., C:\Users\saikiran\Desktop) — use directly
                // Check for directory traversal within the absolute path
                if (sanitizedPath.includes('..')) {
                    return res.status(400).json({ ok: false, error: "Invalid output path. Directory traversal is not allowed." });
                }
                const customCollageRoot = path.resolve(sanitizedPath, 'collage_images');
                highEnergyDir = path.resolve(customCollageRoot, 'high');
                lowEnergyDir = path.resolve(customCollageRoot, 'low');
            }
            
            // Ensure directories exist
            await fs.mkdir(highEnergyDir, { recursive: true });
            await fs.mkdir(lowEnergyDir, { recursive: true });
        } else {
            // Use default directories
            highEnergyDir = collageHighRoot;
            lowEnergyDir = collageLowRoot;
        }

        // Rendering both energies

        // Enrich objects with pixel_data_path from items database (frontend objects lack this)
        const enrichedObjects = await enrichObjectsWithPixelData(objects);

        // Render high energy
        const highPngBuffer = await renderSceneAsync(enrichedObjects, 800, 600, "highenergy");
        await fs.writeFile(path.join(highEnergyDir, filename), highPngBuffer);

        // Render low energy
        const lowPngBuffer = await renderSceneAsync(enrichedObjects, 800, 600, "lowenergy");
        await fs.writeFile(path.join(lowEnergyDir, filename), lowPngBuffer);

        // Determine the URL path based on whether custom or default
        let isAbsolutePath = false;
        let customCollageRootForUrl;
        if (outputPath && typeof outputPath === 'string') {
            const sanitizedPath = outputPath.trim().replace(/[<>"|?*]/g, '_').replace(/\/$|\\$/, '');
            isAbsolutePath = path.isAbsolute(sanitizedPath);
            if (!isAbsolutePath) {
                customCollageRootForUrl = `${outputPath.replace(/\\/g, '/')}/collage_images`;
            }
        }

        const urlPathPrefix = isAbsolutePath ? null : (outputPath ? `/data/${customCollageRootForUrl}` : `/data/collage_images`);

        res.json({
            ok: true,
            filename,
            high_url: urlPathPrefix ? `${urlPathPrefix}/high/${filename}` : null,
            low_url: urlPathPrefix ? `${urlPathPrefix}/low/${filename}` : null,
            outputPath: outputPath || 'backend/data/collage_images',
            savedTo: (outputPath && path.isAbsolute(outputPath.trim().replace(/[<>"|?*]/g, '_').replace(/\/$|\\$/, '')))
                ? path.resolve(outputPath.trim().replace(/[<>"|?*]/g, '_').replace(/\/$|\\$/, ''), 'collage_images')
                : undefined
        });
    } catch (err) {
        console.error("[render-and-save-collage-both] Error:", err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Check data integrity of saved layouts (which items/pixel data are missing)
app.get('/api/saved-layouts/integrity', async (_req, res) => {
  try {
    const [layouts, items] = await Promise.all([
      getSavedLayouts(),
      getItems()
    ]);
    
    const itemMap = new Map(items.map(i => [i.id, i]));
    const results = [];
    
    for (const layout of layouts) {
      const issues = [];
      const objects = layout.layout_json?.objects || {};
      const allObjects = [
        objects.bag && { ...objects.bag, library: 'bag' },
        ...(objects.threats || []).map(t => ({ ...t, library: 'threat' })),
        ...(objects['non-threats'] || []).map(n => ({ ...n, library: 'non-threat' }))
      ].filter(Boolean);
      
      for (const obj of allObjects) {
        const item = itemMap.get(obj.id);
        if (!item) {
          issues.push({
            objectId: obj.id,
            objectLibrary: obj.library,
            issue: 'item_deleted',
            message: `Item ${obj.id} not found in library`
          });
        } else if (!item.pixel_data_path) {
          issues.push({
            objectId: obj.id,
            objectLibrary: obj.library,
            issue: 'no_pixel_data',
            message: `Item ${obj.id} has no pixel data`
          });
        } else {
          // Check if pixel data file exists
          const pixelDataPath = item.pixel_data_path;
          const highEnergyPath = path.join(pixelDataRoot, pixelDataPath);
          const lowEnergyPath = path.join(pixelDataRoot, pixelDataPath.replace(/^highenergy[\\/]/, 'lowenergy/'));
          
          try {
            await fs.access(highEnergyPath);
          } catch {
            issues.push({
              objectId: obj.id,
              objectLibrary: obj.library,
              issue: 'pixel_data_missing',
              message: `Pixel data file not found: ${pixelDataPath}`
            });
          }
        }
      }
      
      results.push({
        layoutId: layout.id,
        layoutName: layout.name,
        hasIssues: issues.length > 0,
        issues,
        objectCount: allObjects.length
      });
    }
    
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[integrity] Error:', err);
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
        const missingPixelDataObjs = [];
        const missingImageObjs = [];

        if (objects.bag) {
            const b = objects.bag;
            bagWidth = b.size?.width || 800;
            bagHeight = b.size?.height || 600;
            const item = itemMap.get(b.id);
            const pixelDataPath = item?.pixel_data_path || null;
            if (!pixelDataPath && !b.filepath) {
                missingPixelDataObjs.push(b.id || 'unknown bag');
            } else if (!pixelDataPath) {
                missingPixelDataObjs.push(`${b.id || 'bag'} (no pixel data, falls back to PNG)`);
            }
            flatObjects.push({
                id: b.id,
                filepath: b.filepath,
                pixel_data_path: pixelDataPath,
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
                const pixelDataPath = item?.pixel_data_path || null;
                if (!pixelDataPath && !obj.filepath) {
                    missingPixelDataObjs.push(obj.id || 'unknown');
                } else if (!pixelDataPath) {
                    missingPixelDataObjs.push(`${obj.id || 'unknown'} (no pixel data, falls back to PNG)`);
                }
                flatObjects.push({
                    id: obj.id,
                    filepath: obj.filepath,
                    pixel_data_path: pixelDataPath,
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

        // Collect warnings during rendering
        const renderWarnings = [];
        
        // Check if there are any objects that have pixel_data_path set
        const objectsWithData = flatObjects.filter(o => o.pixel_data_path);
        if (objectsWithData.length === 0 && missingPixelDataObjs.length > 0) {
            renderWarnings.push('No pixel data files (.npz) found for any objects. Preview may not render correctly.');
        }

        // Render using the bag's dimensions as canvas size
        const pngBuffer = await renderSceneAsync(flatObjects, bagWidth, bagHeight, undefined, renderWarnings);

        // Check if ALL objects were skipped (density buffer is all zeros)
        const isBlank = pngBuffer.length < 500; // Very small buffer = likely blank image
        
        res.json({
            ok: true,
            warnings: renderWarnings,
            isBlank,
            image: pngBuffer.toString('base64'),
        });
    } catch (err) {
        console.error('[render-preview] Error:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Error handling middleware - ensure all errors return JSON
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  console.error('Error stack:', err.stack);
  
  // If headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }
  
  // Always return JSON
  res.status(500).json({ 
    ok: false, 
    error: err.message || String(err),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler - also return JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;

app.listen(port, () => {
    // Server started
});

export default app;
