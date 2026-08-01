import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { generateValidRegion } from "./lib/autoValidRegion.js";
import { renderSceneAsync } from "./lib/renderCanvas.js";
import Jimp from "jimp";
import sharp from "sharp";
import WorkerPool from "./lib/workerPool.js";
import pino from 'pino';
import client from 'prom-client';
import config from './lib/config.js';
import { requireAuth, protectWriteRoutes } from './lib/auth.js';
import { sanitizeFilename, validatePathComponent, safeJoin, safeDeleteFile } from './lib/safePath.js';
import {
    getItems,
    getItemById,
    createItem,
    createItemsBatch,
    getCatalog,
    updateItem,
    deleteItem,
    bulkDeleteItems,
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
    getItemsPaginated
} from "./lib/storage.js";
import { PipelineTimer, PIPELINE_STAGES, generateOperationId } from "./lib/instrumentation.js";
import { initializeSystemConfig, getWorkerCount, checkMemoryAvailability } from "./lib/systemInfo.js";
import { enqueue as enqueueDiskWrite, getDiskWriteQueueStatus, drain as drainDiskQueue } from './lib/diskWriteQueue.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// Structured logger
const logger = pino({ level: config.logLevel });

// Prometheus metrics
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 });

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});

const uploadFileDuration = new client.Histogram({
    name: 'upload_file_processing_seconds',
    help: 'Time spent processing an uploaded file',
    labelNames: ['status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});

// Request timing middleware
app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
        try {
            httpRequestDuration.labels(req.method, req.route && req.route.path ? req.route.path : req.path, String(res.statusCode)).observe(durationSec);
        } catch (e) {
            // ignore metric labeling errors
        }
        // Skip verbose logging for static asset requests and 304 cache revalidations.
        // These dominate the log output when browsing the library (every thumbnail
        // image triggers a request, and browsers re-validate cached resources with 304s).
        const isStaticAsset = req.path.startsWith('/data/') || /\.(png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|npz|json)$/i.test(req.path);
        const isCacheRevalidation = res.statusCode === 304;
        if (!isStaticAsset && !isCacheRevalidation) {
            logger.info({ method: req.method, path: req.path, status: res.statusCode, duration_s: durationSec }, 'request_finished');
        }
    });
    next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use config-based paths instead of hard-coded B:\ drives
const {
    libraryImagesRoot,
    collageImagesRoot,
    collageHighRoot,
    collageLowRoot,
    pixelDataRoot,
    exportsRoot,
    tempDir,
} = config;

import { spawn } from 'node:child_process';

// Ensure directories exist
await fs.mkdir(exportsRoot, { recursive: true });
await fs.mkdir(libraryImagesRoot, { recursive: true });
await fs.mkdir(collageImagesRoot, { recursive: true });
await fs.mkdir(collageHighRoot, { recursive: true });
await fs.mkdir(collageLowRoot, { recursive: true });
await fs.mkdir(pixelDataRoot, { recursive: true });
await fs.mkdir(tempDir, { recursive: true });

// Fallback middleware: if a requested PNG is missing in libraryImagesRoot, generate it on-the-fly from pixel_data if available
app.get('/data/library_images/:filename', async (req, res, next) => {
    const filename = req.params.filename;
    const targetPngPath = path.join(libraryImagesRoot, filename);
    try {
        await fs.access(targetPngPath);
        return next();
    } catch {
        const itemId = path.basename(filename, path.extname(filename));
        const npzPath = path.join(pixelDataRoot, 'highenergy', `${itemId}.npz`);
        try {
            await fs.access(npzPath);
            const scriptPath = path.join(__dirname, 'lib', 'generate_png.py');
            await new Promise((resolve, reject) => {
                const proc = spawn('python', [scriptPath, '--npz-path', npzPath, '--png-path', targetPngPath]);
                proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('PNG generation failed')));
                proc.on('error', reject);
            });
            return next();
        } catch {
            return next();
        }
    }
});

// Serve static files — map frontend URL paths to actual disk locations
app.use('/data/library_images', express.static(libraryImagesRoot));
app.use('/data/collage_images', express.static(collageImagesRoot));
app.use('/data/pixel_data', express.static(pixelDataRoot));
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

// Helper: resolve pixel_data_path for an item, with disk-based fallback.
// Catalog field `pixel_data_path` may be NULL for historical/upload-flow reasons
// (e.g. standard upload createItem at ~L1007 never populated it). We fall back
// to the convention `highenergy/<sanitizedItemId>.npz` and verify the file exists.
async function resolvePixelDataPath(itemId, catalogPixelDataPath) {
    if (catalogPixelDataPath) {
        const r = safeJoin(pixelDataRoot, catalogPixelDataPath);
        if (r.safe) {
            try { await fs.access(r.fullPath); return catalogPixelDataPath; } catch {}
        }
    }
    if (!itemId) return null;
    const safeId = sanitizeFilename(itemId);
    const relativePath = path.join('highenergy', `${safeId}.npz`);
    const r = safeJoin(pixelDataRoot, relativePath);
    if (!r.safe) return null;
    try { await fs.access(r.fullPath); return relativePath; } catch { return null; }
}

// Multer setup for file uploads (use actual filenames, no UUID)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, libraryImagesRoot);
    },
    filename: (req, file, cb) => {
        // Sanitize the original filename to prevent path traversal
        const safeName = sanitizeFilename(file.originalname);
        cb(null, safeName);
    },
});
const upload = multer({ storage: storage });

// Multer setup for raw file uploads (memory storage for streaming)
const rawUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    files: 5000,
  }
});

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

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
    try {
        res.setHeader('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    } catch (err) {
        logger.error({ err: err.message }, 'Failed to collect metrics');
        res.status(500).end(err.message);
    }
});

// Clean up temp files older than 1 hour (runs on server startup and can be called periodically)
async function cleanupOldTempFiles() {
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

// Initialize system configuration (detect CPU cores, etc.)
await initializeSystemConfig();

// System Hardware Information & Dynamic Worker Config Endpoint
app.get("/api/system/info", async (_req, res) => {
    try {
        const config = await initializeSystemConfig();
        res.json({
            ok: true,
            cpuCount: config.cpuCount,
            cpuModel: config.cpuModel,
            optimalWorkerCount: config.optimalWorkerCount,
            detectedAt: config.detectedAt
        });
    } catch (err) {
        logger.error({ err: err.message }, 'Failed to fetch system info');
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Pre-upload Memory Availability Check Endpoint
app.post("/api/system/memory-check", (req, res) => {
    try {
        const fileCount = Number(req.body?.fileCount || 0);
        const estimatedMemoryMB = Math.max(20, Math.ceil((fileCount / 100) * 15));
        const memoryCheck = checkMemoryAvailability(estimatedMemoryMB);
        res.json({
            ok: memoryCheck.canProceed,
            estimatedMemoryMB,
            memoryCheck
        });
    } catch (err) {
        logger.error({ err: err.message }, 'Failed to perform memory check');
        res.status(500).json({ ok: false, error: err.message });
    }
});
function deriveItemId(filename) {
    const dotIndex = filename.indexOf(".");
    if (dotIndex === -1) return filename;
    return filename.slice(0, dotIndex);
}

function classifyFileType(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".dump.pgm") || lower.endsWith(".pgm") || lower.endsWith(".dump")) return "dump";
    if (lower.endsWith(".tip")) return "tip";
    return null;
}

// Endpoint to process raw files (.dump.pgm and .tip) with worker pool
app.post("/api/process-raw-files", requireAuth, rawUpload.array("rawFiles"), async (req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.status(200).flushHeaders();

    const operationId = generateOperationId();
    const timer = new PipelineTimer(operationId, 'process_raw_files');
    
    try {
        // Stage 1: Upload Receipt
        timer.startStage(PIPELINE_STAGES.UPLOAD_RECEIPT);
        const files = req.files || [];
        logger.info({ operationId, fileCount: files.length, totalSize: files.reduce((sum, f) => sum + f.buffer.length, 0) }, 'upload_receipt');
        timer.endStage(PIPELINE_STAGES.UPLOAD_RECEIPT, { fileCount: files.length });
        
        // Stage 2: Validation
        timer.startStage(PIPELINE_STAGES.VALIDATION);
        
        const items = await getItems();
        const existingIds = new Set(items.map(i => i.id));

        const nonDuplicates = [];
        let duplicateCount = 0;

        console.log(`[process-raw-files] Received ${files.length} files from multer`);
        const skippedFiles = [];
        for (const file of files) {
            const itemId = deriveItemId(file.originalname);
            const fileType = classifyFileType(file.originalname);
            if (!fileType) {
                console.log(`[process-raw-files] Skipped ${file.originalname}: unrecognized extension`);
                skippedFiles.push({ filename: file.originalname, reason: "Unrecognized file extension (expected .dump.pgm or .tip)" });
                continue;
            }

            if (existingIds.has(itemId)) {
                console.log(`[process-raw-files] Duplicate: ${itemId}`);
                duplicateCount++;
            } else {
                nonDuplicates.push({ file, itemId, fileType });
            }
        }
        console.log(`[process-raw-files] Non-duplicates: ${nonDuplicates.length}, Duplicates: ${duplicateCount}, Skipped: ${skippedFiles.length}`);
        
        timer.endStage(PIPELINE_STAGES.VALIDATION, { 
            valid: nonDuplicates.length, 
            duplicates: duplicateCount, 
            skipped: skippedFiles.length 
        });

        for (const skipped of skippedFiles) {
            res.write(JSON.stringify({
                status: "skipped",
                filename: skipped.filename,
                reason: skipped.reason,
            }) + "\n");
        }

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

        // Stage 3: File Preprocessing
        timer.startStage(PIPELINE_STAGES.FILE_PREPROCESSING);
        
        // Files are already loaded into memory by multer's memoryStorage.
        // The workers process files one at a time via temp files on disk, so overhead is minimal.
        // Only account for additional processing overhead, not file sizes (already allocated).
        const workerCount = await getWorkerCount('upload', 10);
        // Estimate memory dynamically based on batch size (~0.05MB per file, min 2MB)
        const estimatedMemoryMB = Math.max(2, Math.ceil(nonDuplicates.length * 0.05));
        const memoryCheck = checkMemoryAvailability(estimatedMemoryMB);
        logger.info({ operationId, workerCount, memoryCheck }, 'memory_check');
        
        if (!memoryCheck.canProceed) {
            timer.endStage(PIPELINE_STAGES.FILE_PREPROCESSING, { 
                tempFilesCreated: 0,
                duration_s: 0,
                memoryCheck 
            });
            
            res.write(JSON.stringify({
                status: "error",
                reason: memoryCheck.recommendation,
                memory: memoryCheck
            }) + "\n");
            res.end();
            return;
        }
        
        const pool = new WorkerPool(workerCount);
        let processedCount = 0;
        let failedCount = 0;
        await fs.mkdir(tempDir, { recursive: true });
        
        const preprocessingStart = process.hrtime.bigint();
        
        for (const { file, itemId, fileType } of nonDuplicates) {
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
                    const line = JSON.stringify(result);
                    res.write(line + "\n");

                    if (result.status === "done") {
                        processedCount++;
                    }
                    if (result.status === "error") {
                        failedCount++;
                    }

                    fs.unlink(tempPath).catch(() => {});
                }
            );
        }
        
        const preprocessingDuration = Number(process.hrtime.bigint() - preprocessingStart) / 1e9;
        timer.endStage(PIPELINE_STAGES.FILE_PREPROCESSING, { 
            tempFilesCreated: nonDuplicates.length,
            duration_s: preprocessingDuration 
        });

        // Stage 4: Worker Dispatch
        timer.startStage(PIPELINE_STAGES.WORKER_DISPATCH);
        const workerDispatchStart = process.hrtime.bigint();
        
        await pool.drain();
        
        const workerDispatchDuration = Number(process.hrtime.bigint() - workerDispatchStart) / 1e9;
        timer.endStage(PIPELINE_STAGES.WORKER_DISPATCH, { 
            workerCount,
            batchSize: 1,
            duration_s: workerDispatchDuration 
        });

        // Stage 5: Persistence
        timer.startStage(PIPELINE_STAGES.PERSISTENCE);
        
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
        
        timer.endStage(PIPELINE_STAGES.PERSISTENCE, { 
            itemsProcessed: processedCount,
            itemsFailed: failedCount 
        });

        const pipelineSummary = timer.complete({
            totalFiles: files.length,
            validFiles: nonDuplicates.length,
            duplicateFiles: duplicateCount,
            skippedFiles: skippedFiles.length,
            processedFiles: processedCount,
            failedFiles: failedCount
        });
        
        logger.info(pipelineSummary, 'pipeline_summary');

    } catch (err) {
        timer.logError('pipeline_error', err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: err.message });
        } else {
            try {
                res.end();
            } catch (_) {}
        }
    }
});

// Helper to normalize category name into exactly three main categories
function normalizeCategory(cat) {
    const normalized = (cat || "").toLowerCase().trim();
    if (/^non[- ]?threat/.test(normalized)) return "non-threats";
    if (normalized.includes("bag")) return "bags";
    if (normalized.includes("threat") || normalized.includes("electronic") || normalized === "electronics") return "threats";
    return "non-threats";
}

// Get all items organized by category and subcategory (with pagination)
app.get("/api/items/categorized", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const categoryFilter = req.query.category || null;
    
    const { items: paginatedItems, pagination } = await getItemsPaginated(page, limit);
    
    const categorized = {};
    const categoryCounts = {};
    
    for (const item of paginatedItems) {
      const normalizedCategory = normalizeCategory(item.category);
      
      categoryCounts[normalizedCategory] = (categoryCounts[normalizedCategory] || 0) + 1;
      
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
          ...categoryCounts
        }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Batch item persistence endpoint for 50-item page saves into category partitions
app.post('/api/items/batch-save', requireAuth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items array is required' });
    }

    const savedItems = await createItemsBatch(items);
    res.json({
      ok: true,
      savedCount: savedItems.length,
      items: savedItems,
    });
  } catch (err) {
    console.error('[batch-save] Error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Storage catalog index metadata endpoint
app.get('/api/storage/catalog', async (_req, res) => {
  try {
    const catalog = await getCatalog();
    res.json({ ok: true, catalog });
  } catch (err) {
    console.error('[storage/catalog] Error:', err);
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

app.get('/api/saved-layouts/filtered', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
      
      const bagSubcategories = req.query.bagSubcategories ? String(req.query.bagSubcategories).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const threatSubcategories = req.query.threatSubcategories ? String(req.query.threatSubcategories).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const tags = req.query.tags ? String(req.query.tags).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const filterLogic = req.query.filterLogic ? String(req.query.filterLogic).toLowerCase() : 'or';

      const allLayouts = await getSavedLayouts();

      function extractObjects(layout) {
        const obj = layout.layout_json?.objects;
        if (!obj) return [];
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
        if (Array.isArray(obj)) return obj;
        return [];
      }

      const filtered = allLayouts.filter((layout) => {
        try {
          const objects = extractObjects(layout);
          if (!objects.length) return false;

           const bagObjs = objects.filter(o => (o.library || '').toLowerCase().includes('bag'));
           const threatObjs = objects.filter(o => {
             const lib = (o.library || '').toLowerCase();
             return lib.includes('threat') && !lib.includes('non-threat');
           });
           
           const layoutBagSubcategories = bagObjs.map(o => {
             if (o.subcategory) {
               return o.subcategory.toLowerCase().replace(/\s+/g, '-');
             }
             const lib = (o.library || '').toLowerCase();
             if (lib.includes('bag')) {
               const parts = lib.split('-');
               if (parts.length > 1) return parts[1];
             }
             return 'general';
           });
           
           const layoutThreatSubcategories = threatObjs.map(o => {
             if (o.subcategory) {
               return o.subcategory.toLowerCase().replace(/\s+/g, '-');
             }
             const lib = (o.library || '').toLowerCase();
             if (lib.includes('threat') && !lib.includes('non-threat')) {
               const parts = lib.split('-');
               if (parts.length > 1) return parts[1];
             }
             return 'general';
           });

          if (bagSubcategories.length === 0 && threatSubcategories.length === 0 && tags.length === 0) {
            return true;
          }

          const bagMatch = bagSubcategories.length === 0 || 
                          bagSubcategories.some(sub => layoutBagSubcategories.includes(sub));
          
          let threatMatch = true;
          if (threatSubcategories.length > 0) {
            if (filterLogic === 'or') {
              threatMatch = threatSubcategories.some(sub => layoutThreatSubcategories.includes(sub));
            } else if (filterLogic === 'and') {
              threatMatch = threatSubcategories.every(sub => layoutThreatSubcategories.includes(sub));
            }
          }

          const layoutBagTags = bagObjs.length > 0 ? (bagObjs[0].tags || []) : [];
          let tagMatch = true;
          if (tags.length > 0) {
            if (filterLogic === 'or') {
              tagMatch = tags.some(tag => layoutBagTags.includes(tag));
            } else if (filterLogic === 'and') {
              tagMatch = tags.every(tag => layoutBagTags.includes(tag));
            }
          }
          
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

app.post('/api/saved-layouts', requireAuth, async (req, res) => {
    const { id, name, filepath, layout_json } = req.body;
    if (!name || !layout_json) return res.status(400).json({ ok: false, error: 'Missing name or layout_json' });
    
    // Validate layout_json structure
    try {
        if (!layout_json.objects || typeof layout_json.objects !== 'object') {
            return res.status(400).json({ ok: false, error: 'Invalid layout_json: missing or invalid objects field' });
        }
        
        const obj = layout_json.objects;
        if (!obj.bag && !obj.threats && !obj['non-threats']) {
            return res.status(400).json({ ok: false, error: 'Invalid layout_json: objects must contain at least one of bag, threats, or non-threats' });
        }
        
        if (obj.threats && !Array.isArray(obj.threats)) {
            return res.status(400).json({ ok: false, error: 'Invalid layout_json: threats must be an array' });
        }
        
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

// ---- Batch-bulk save endpoint (MUST be registered before /:id route) ----

// POST /api/saved-layouts/batch-bulk
// Enqueue a batch of generated layouts for sequential disk write with pacing.
// Responds immediately with queue status (non-blocking).
app.post('/api/saved-layouts/batch-bulk', requireAuth, async (req, res) => {
    try {
        const { layouts } = req.body;
        if (!Array.isArray(layouts) || layouts.length === 0) {
            return res.status(400).json({ ok: false, error: 'layouts array is required' });
        }

        // Validate each layout has minimum required fields
        for (const layout of layouts) {
            if (!layout.name || !layout.layout_json) {
                return res.status(400).json({ ok: false, error: 'Each layout must have name and layout_json' });
            }
            if (!layout.layout_json.objects) {
                return res.status(400).json({ ok: false, error: 'Each layout_json must have an objects field' });
            }
            // Stamp an ID and timestamp if missing
            if (!layout.id) {
                layout.id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            }
            if (!layout.created_at) {
                layout.created_at = new Date().toISOString();
            }
        }

        const status = enqueueDiskWrite(layouts);
        res.json({
            ok: true,
            queued: layouts.length,
            queueDepth: status.depth,
            totalQueued: status.totalQueued,
        });
    } catch (err) {
        console.error('[batch-bulk] Enqueue error:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// GET /api/saved-layouts/batch-bulk/status
// Poll current queue depth, in-flight state, and totals.
app.get('/api/saved-layouts/batch-bulk/status', (_req, res) => {
    try {
        res.json({ ok: true, status: getDiskWriteQueueStatus() });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// POST /api/saved-layouts/batch-bulk/drain
// Wait for all pending batch writes to finish before returning.
// Used by manual bulk-save to avoid double-write conflicts.
app.post('/api/saved-layouts/batch-bulk/drain', requireAuth, async (_req, res) => {
    try {
        await drainDiskQueue();
        res.json({ ok: true, status: getDiskWriteQueueStatus() });
    } catch (err) {
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

app.delete('/api/saved-layouts/:id', requireAuth, async (req, res) => {
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

app.post('/api/custom-subcategories', requireAuth, async (req, res) => {
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

app.delete('/api/custom-subcategories/:category/:slug', requireAuth, async (req, res) => {
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
const uploadWithLimits = multer({
  storage: storage,
  limits: {
    fieldNameSize: 10000000,
    fieldSize: 100000000,
    fields: 10000,
    fileSize: config.maxFileSize,
    files: config.maxFilesPerUpload,
  }
});

app.post("/api/upload", requireAuth, uploadWithLimits.array("images", config.maxFilesPerUpload), async (req, res) => {
  req.setTimeout(config.uploadTimeoutMs, () => {
    if (!res.headersSent) {
      res.status(408).json({ ok: false, error: "Upload timeout. Please try again with a smaller batch." });
    }
  });
  
  const operationId = generateOperationId();
  const timer = new PipelineTimer(operationId, 'upload');
  
  try {
        // Stage 1: Upload Receipt
        timer.startStage(PIPELINE_STAGES.UPLOAD_RECEIPT);
        const files = req.files || [];
        logger.info({ operationId, fileCount: files.length }, 'upload_receipt');
        timer.endStage(PIPELINE_STAGES.UPLOAD_RECEIPT, { fileCount: files.length });
        
        // Stage 2: Validation
        timer.startStage(PIPELINE_STAGES.VALIDATION);
        
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
        
        timer.endStage(PIPELINE_STAGES.VALIDATION, { 
            metadataItems: metadataArray.length 
        });

        // Stage 3: File Processing (per-file)
        timer.startStage(PIPELINE_STAGES.FILE_PREPROCESSING);
        
        const errors = [];
        const processed = [];
        const processedIds = new Set();
        const fileProcessingStart = process.hrtime.bigint();

        for (const file of files) {
            const fileStart = process.hrtime.bigint();
            const itemId = path.basename(file.originalname, path.extname(file.originalname));
            
            const fileMeta = metadataArray.find(m => m.originalname === file.originalname) || {};

            try {
                if (await itemExists(itemId)) {
                    errors.push({ filename: file.originalname, message: `Item ${itemId} already exists in library` });
                    try {
                        await fs.unlink(path.join(libraryImagesRoot, file.filename));
                    } catch (unlinkErr) {
                        console.warn("Could not delete unused file", unlinkErr);
                    }
                    continue;
                }

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
                
                let width = 512;
                let height = 512;
                try {
                    const savedFilePath = path.join(libraryImagesRoot, file.filename);
                    const meta = await sharp(savedFilePath).metadata();
                    if (meta && meta.width && meta.height) {
                        width = meta.width;
                        height = meta.height;
                    } else {
                        const loadedImg = await Jimp.read(savedFilePath);
                        width = loadedImg.bitmap.width;
                        height = loadedImg.bitmap.height;
                    }
                } catch (dimErr) {
                    try {
                        const savedFilePath = path.join(libraryImagesRoot, file.filename);
                        const loadedImg = await Jimp.read(savedFilePath);
                        width = loadedImg.bitmap.width;
                        height = loadedImg.bitmap.height;
                    } catch (e) {
                        // Default to 512x512 fallback
                    }
                }

                const item = await createItem({
                    id: itemId,
                    filename: file.originalname,
                    filepath: file.filename,
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
                    await createNonThreatItem({
                        item_id: item.id,
                        subcategory_slug: subcategory.toLowerCase().replace(/\s+/g, "-")
                    });
                } else {
                    const subSlug = subcategory ? String(subcategory).toLowerCase().replace(/\s+/g, "-") : null;
                    await createNonThreatItem({
                        item_id: item.id,
                        subcategory_slug: subSlug
                    });
                }

                processed.push(itemId);
                processedIds.add(file.originalname);
                try {
                    const fileDuration = Number(process.hrtime.bigint() - fileStart) / 1e9;
                    uploadFileDuration.labels('success').observe(fileDuration);
                    logger.info({ filename: file.originalname, itemId, duration_s: fileDuration }, 'file_processed');
                } catch (e) {
                    // ignore metric/log errors
                }
            } catch (fileErr) {
                console.error(`Error processing file ${file.originalname}:`, fileErr);
                errors.push({ filename: file.originalname, message: String(fileErr) });
                try {
                    const fileDuration = Number(process.hrtime.bigint() - fileStart) / 1e9;
                    uploadFileDuration.labels('error').observe(fileDuration);
                    logger.warn({ filename: file.originalname, error: String(fileErr), duration_s: fileDuration }, 'file_processing_failed');
                } catch (e) {
                    // ignore
                }
                try {
                    await fs.unlink(path.join(libraryImagesRoot, file.filename));
                } catch (unlinkErr) {
                    console.warn("Could not delete failed upload file", unlinkErr);
                }
            }
        }

        // Process pre-processed metadata items that were NOT in req.files
        for (const m of metadataArray) {
            if (m.preProcessed === true && !processedIds.has(m.originalname)) {
                try {
                    const metaItemId = m.itemId || m.originalname;
                    const category = m.category || "non-threats";
                    const subcategory = m.subcategory || "General";

                    // Validate preGeneratedFilepath to prevent path traversal
                    let safeFilepath = m.preGeneratedFilepath;
                    if (safeFilepath) {
                        const validation = validatePathComponent(safeFilepath);
                        if (!validation.valid) {
                            errors.push({ filename: m.originalname, message: `Invalid filepath: ${validation.error}` });
                            continue;
                        }
                        safeFilepath = validation.cleaned;
                    }

                    const item = await createItem({
                        id: metaItemId,
                        filename: metaItemId,
                        filepath: safeFilepath,
                        category,
                        subcategory,
                        name: metaItemId,
                        width: m.width || 512,
                        height: m.height || 512,
                        pixel_data_path: m.pixelDataFilename || null,
                        tags: m.tags && m.tags.length > 0 ? m.tags : null
                    });

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

        // Stage 4: Persistence
        timer.startStage(PIPELINE_STAGES.PERSISTENCE);
        
        res.json({ 
            ok: true, 
            message: errors.length > 0 ? "Some files processed, some had errors" : "Files uploaded successfully!", 
            itemsProcessed: processed.length,
            errors
        });
        
        const fileProcessingDuration = Number(process.hrtime.bigint() - fileProcessingStart) / 1e9;
        timer.endStage(PIPELINE_STAGES.PERSISTENCE, { 
            itemsProcessed: processed.length,
            itemsFailed: errors.length,
            duration_s: fileProcessingDuration 
        });

        const pipelineSummary = timer.complete({
            totalFiles: files.length,
            processedFiles: processed.length,
            failedFiles: errors.length,
            metadataItems: metadataArray.length
        });
        
        logger.info(pipelineSummary, 'pipeline_summary');
    } catch (err) {
        timer.logError('upload_pipeline_error', err);
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Update item metadata
app.put("/api/items/:id", requireAuth, async (req, res) => {
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
app.delete("/api/items/:id", requireAuth, async (req, res) => {
    try {
        const item = await getItemById(req.params.id);
        if (item) {
            // Use safe path resolution for file deletion
            const safeResult = safeJoin(libraryImagesRoot, item.filepath || '');
            if (safeResult.safe) {
                try {
                    await fs.unlink(safeResult.fullPath);
                } catch (err) {
                    console.error("Error deleting file:", err);
                }
            } else {
                console.warn("Skipping unsafe file deletion path:", item.filepath);
            }
        }
        await deleteItem(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Bulk delete items (single request, efficient O(partitions) instead of O(N) endpoints)
app.post("/api/items/bulk-delete", requireAuth, async (req, res) => {
    try {
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.slice(0, 50000) : [];
        if (ids.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing 'ids' array in request body" });
        }
        // 1) Fetch all items once to get filepaths (single catalog scan via storage)
        const { deleted, items: deletedItems } = await bulkDeleteItems(ids);
        // 2) Delete files
        let fileErrors = 0;
        for (const item of deletedItems) {
            if (item && item.filepath) {
                const safeResult = safeJoin(libraryImagesRoot, item.filepath);
                if (safeResult.safe) {
                    try {
                        await fs.unlink(safeResult.fullPath);
                    } catch (err) {
                        if (err && err.code !== 'ENOENT') {
                            fileErrors++;
                        }
                    }
                }
            }
            // Also clean up pixel-data files if present
            if (item && item.id) {
                const safeId = sanitizeFilename(item.id);
                for (const energy of ['highenergy', 'lowenergy']) {
                    const r = safeJoin(pixelDataRoot, energy, `${safeId}.npz`);
                    if (r.safe) {
                        try { await fs.unlink(r.fullPath); } catch (err) {
                            if (err && err.code !== 'ENOENT') { /* ignore */ }
                        }
                    }
                }
            }
        }
        res.json({ ok: true, deletedCount: deleted.length, requestedCount: ids.length, fileErrors });
    } catch (err) {
        console.error("bulkDelete error:", err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Delete temporary files for pre-processed items (before they're uploaded to library)
app.delete("/api/temp-files/:itemId", requireAuth, async (req, res) => {
    try {
        const { itemId } = req.params;
        const safeItemId = sanitizeFilename(itemId);
        const errors = [];
        
        // Use safe path resolution for all file operations
        const imageResult = safeJoin(libraryImagesRoot, `${safeItemId}.png`);
        if (imageResult.safe) {
            try {
                await fs.unlink(imageResult.fullPath);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    errors.push(`Failed to delete image: ${err}`);
                }
            }
        }
        
        const highEnergyResult = safeJoin(pixelDataRoot, 'highenergy', `${safeItemId}.npz`);
        if (highEnergyResult.safe) {
            try {
                await fs.unlink(highEnergyResult.fullPath);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    errors.push(`Failed to delete high energy pixel data: ${err}`);
                }
            }
        }
        
        const lowEnergyResult = safeJoin(pixelDataRoot, 'lowenergy', `${safeItemId}.npz`);
        if (lowEnergyResult.safe) {
            try {
                await fs.unlink(lowEnergyResult.fullPath);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    errors.push(`Failed to delete low energy pixel data: ${err}`);
                }
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
app.post("/api/auto-valid-region", requireAuth, async (req, res) => {
    try {
        const { itemId, pixelDataPath } = req.body;
        
        if (!itemId || !pixelDataPath) {
            return res.status(400).json({ ok: false, error: "Missing itemId or pixelDataPath" });
        }

        // Validate pixelDataPath to prevent path traversal
        const validation = validatePathComponent(pixelDataPath);
        if (!validation.valid) {
            return res.status(400).json({ ok: false, error: `Invalid pixelDataPath: ${validation.error}` });
        }

        const safePathResult = safeJoin(pixelDataRoot, validation.cleaned);
        if (!safePathResult.safe) {
            return res.status(400).json({ ok: false, error: `Invalid pixel data path: ${safePathResult.error}` });
        }

        const fullPath = safePathResult.fullPath;
        
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
app.post("/api/auto-valid-region-batch", requireAuth, async (req, res) => {
    try {
        const { items } = req.body;
        
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or empty items array" });
        }

        if (items.length > 50) {
            return res.status(400).json({ ok: false, error: "Maximum 50 items per batch request" });
        }

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

                // Validate pixelDataPath
                const validation = validatePathComponent(pixelDataPath);
                if (!validation.valid) {
                    return {
                        itemId,
                        ok: false,
                        error: `Invalid pixelDataPath: ${validation.error}`
                    };
                }

                const safePathResult = safeJoin(pixelDataRoot, validation.cleaned);
                if (!safePathResult.safe) {
                    return {
                        itemId,
                        ok: false,
                        error: `Invalid pixel data path: ${safePathResult.error}`
                    };
                }

                const fullPath = safePathResult.fullPath;
                
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
app.put("/api/items/:id/valid-region", requireAuth, async (req, res) => {
    try {
        const { points, simplifiedPoints } = req.body;
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
app.delete("/api/items/:id/valid-region", requireAuth, async (req, res) => {
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
        let pixelDataFilename = await resolvePixelDataPath(item.id, item.pixel_data_path);

        if (!pixelDataFilename) {
            return res.status(404).json({ ok: false, error: "No pixel data path for this item" });
        }

        // Validate pixelDataFilename to prevent path traversal
        const validation = validatePathComponent(pixelDataFilename);
        if (!validation.valid) {
            return res.status(400).json({ ok: false, error: `Invalid pixel data path: ${validation.error}` });
        }

        // If low energy requested, replace the folder prefix
        if (energyType === "lowenergy") {
            pixelDataFilename = pixelDataFilename.replace(/^highenergy[\\/]/, "lowenergy/");
        }

        const safePathResult = safeJoin(pixelDataRoot, pixelDataFilename);
        if (!safePathResult.safe) {
            return res.status(400).json({ ok: false, error: `Invalid pixel data path: ${safePathResult.error}` });
        }

        const fullPath = safePathResult.fullPath;
        try {
            await fs.access(fullPath);
        } catch {
            return res.status(404).json({ ok: false, error: `Pixel data file not found: ${pixelDataFilename}` });
        }

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
  const resolved = [];
  for (const obj of objects) {
    const item = itemMap.get(obj.id);
    const resolvedPath = await resolvePixelDataPath(obj.id, item?.pixel_data_path || null);
    if (resolvedPath) {
      resolved.push({ ...obj, pixel_data_path: resolvedPath });
    } else {
      resolved.push(obj);
    }
  }
  return resolved;
}

// Render and save a collage combination as a PNG image
app.post("/api/render-and-save-collage", requireAuth, async (req, res) => {
    try {
        const { objects, name, energyType = "highenergy" } = req.body;
        if (!objects || !Array.isArray(objects) || objects.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or invalid objects array" });
        }
        if (!name) {
            return res.status(400).json({ ok: false, error: "Missing name" });
        }

        const energyDir = energyType === "lowenergy" ? collageLowRoot : collageHighRoot;

        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
        const filename = `${safeName}.png`;
        const outputPath = path.join(energyDir, filename);

        const enrichedObjects = await enrichObjectsWithPixelData(objects);

        const pngBuffer = await renderSceneAsync(enrichedObjects, 800, 600, energyType);

        await fs.writeFile(outputPath, pngBuffer);

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
app.post("/api/render-and-save-collage-both", requireAuth, async (req, res) => {
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

        let highEnergyDir, lowEnergyDir;
        
        if (outputPath && typeof outputPath === 'string') {
            // Sanitize output path to prevent traversal
            const sanitizedPath = outputPath.trim().replace(/[<>"|?*]/g, '_').replace(/\/$|\\$/, '');
            
            // Prevent directory traversal
            if (sanitizedPath.includes('..')) {
                return res.status(400).json({ ok: false, error: "Invalid output path. Directory traversal is not allowed." });
            }
            
            const resolvedProjectRoot = path.resolve(__dirname, '..');
            
            if (!path.isAbsolute(sanitizedPath)) {
                const customCollageRoot = path.resolve(resolvedProjectRoot, 'data', sanitizedPath, 'collage_images');
                highEnergyDir = path.resolve(customCollageRoot, 'high');
                lowEnergyDir = path.resolve(customCollageRoot, 'low');
            } else {
                const customCollageRoot = path.resolve(sanitizedPath, 'collage_images');
                highEnergyDir = path.resolve(customCollageRoot, 'high');
                lowEnergyDir = path.resolve(customCollageRoot, 'low');
            }
            
            await fs.mkdir(highEnergyDir, { recursive: true });
            await fs.mkdir(lowEnergyDir, { recursive: true });
        } else {
            highEnergyDir = collageHighRoot;
            lowEnergyDir = collageLowRoot;
        }

        const enrichedObjects = await enrichObjectsWithPixelData(objects);

        const highPngBuffer = await renderSceneAsync(enrichedObjects, 800, 600, "highenergy");
        await fs.writeFile(path.join(highEnergyDir, filename), highPngBuffer);

        const lowPngBuffer = await renderSceneAsync(enrichedObjects, 800, 600, "lowenergy");
        await fs.writeFile(path.join(lowEnergyDir, filename), lowPngBuffer);

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
        } else {
          const pixelDataPath = await resolvePixelDataPath(obj.id, item.pixel_data_path);
          if (!pixelDataPath) {
            issues.push({
              objectId: obj.id,
              objectLibrary: obj.library,
              issue: 'no_pixel_data',
              message: `Item ${obj.id} has no pixel data`
            });
          } else {
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
app.post('/api/render-preview', requireAuth, async (req, res) => {
    try {
        const { objects } = req.body;
        if (!objects) return res.status(400).json({ ok: false, error: 'Missing objects' });

        const allItems = await getItems();
        const itemMap = new Map(allItems.map(i => [i.id, i]));

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
            const pixelDataPath = await resolvePixelDataPath(b.id, item?.pixel_data_path || null);
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

        const addObjects = async (list, library) => {
            if (!Array.isArray(list)) return;
            for (const obj of list) {
                const item = itemMap.get(obj.id);
                const pixelDataPath = await resolvePixelDataPath(obj.id, item?.pixel_data_path || null);
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

        await addObjects(objects.threats, 'threat');
        await addObjects(objects['non-threats'], 'non-threat');

        if (flatObjects.length === 0) {
            return res.status(400).json({ ok: false, error: 'No objects to render' });
        }

        const renderWarnings = [];
        
        const objectsWithData = flatObjects.filter(o => o.pixel_data_path);
        const objectsWithNoDataSource = missingPixelDataObjs.filter(id => !id.includes("falls back to PNG"));
        if (objectsWithData.length === 0 && objectsWithNoDataSource.length > 0) {
            renderWarnings.push('No pixel data files (.npz) found for any objects. Preview may not render correctly.');
        }

        const pngBuffer = await renderSceneAsync(flatObjects, bagWidth, bagHeight, undefined, renderWarnings);

        const isBlank = pngBuffer.length < 500;
        
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
  
  if (res.headersSent) {
    return next(err);
  }
  
  res.status(500).json({ 
    ok: false, 
    error: err.message || String(err),
    ...(config.nodeEnv === 'development' && { stack: err.stack })
  });
});

// 404 handler - also return JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

const port = config.port;

if (config.nodeEnv !== 'test') {
    const server = app.listen(port, () => {
        logger.info({ port }, 'server_started');
    });

    // Increase connection handling for high-concurrency stress tests
    server.maxConnections = 1000;
    server.keepAliveTimeout = 120000; // 2 minutes
    server.headersTimeout = 125000;   // Slightly above keepAliveTimeout
    server.timeout = 300000;          // 5 minutes
    server.requestTimeout = 300000;   // 5 minutes
}

export default app;
