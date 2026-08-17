import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import archiver from "archiver";
import { generateValidRegion, generateValidRegionBatch, BATCH_FILES_PER_PROCESS } from "./lib/autoValidRegion.js";
import { renderSceneAsync } from "./lib/renderCanvas.js";
import Jimp from "jimp";
import sharp from "sharp";
import WorkerPool from "./lib/workerPool.js";
import pino from 'pino';
import { createWriteStream, mkdirSync } from 'node:fs';
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
    createSavedLayoutsBatch,
    updateSavedLayout,
    deleteSavedLayout,
    getCustomSubcategories,
    addCustomSubcategory,
    removeCustomSubcategory,
    getItemsPaginated
} from "./lib/storage.js";
import { PipelineTimer, PIPELINE_STAGES, generateOperationId } from "./lib/instrumentation.js";
import { initializeSystemConfig, getWorkerCount, checkMemoryAvailability } from "./lib/systemInfo.js";
import { Semaphore, chunked, withSemaphore } from "./lib/concurrency.js";
import { enqueue as enqueueDiskWrite, getDiskWriteQueueStatus, drain as drainDiskQueue } from './lib/diskWriteQueue.js';
import { publicApiRateLimiter, strictRateLimiter } from './lib/rateLimiter.js';
import { getExportsPath, setExportsPath, hasConfiguredExportsPath } from './lib/userConfig.js';
import {
  analyzeImport,
  runImport,
  scanPixelDir,
  scanJsonDir,
} from './lib/importService.js';
import {
  validateClientOutputPath,
  validateCombinationsArray,
  isPathWithinAllowedRoots,
} from './lib/pathValidation.js';
import { validateFileMagicNumber, validateFileSize as checkFileSize } from './lib/fileValidation.js';
import { validateLayoutJson, validatePlainObject, validateObjectArray } from './lib/jsonValidation.js';
import { auditLog } from './lib/auditLog.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// Structured logger - set to warn to reduce terminal noise
const logger = pino({ 
  level: config.logLevel === 'info' ? 'warn' : config.logLevel
});

// In-memory cancellation flags for long-running bulk export (Save All / Save Selected) jobs.
// Keyed by a client-generated jobId so a Stop Saving request can abort a running export
// at the next layout boundary.
const exportCancellations = new Map();

// In-memory progress store for load-page export jobs (keyed by the client jobId).
// Updated per combination so the frontend can render a live progress bar while the
// backend renders/writes the high+low PNGs.
const exportProgressStore = new Map();

// In-memory cancellation flags for long-running import (Save Historic Data) jobs.
const importCancellations = new Map();

// Prometheus metrics
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 });

// In Docker the only host-visible folder is the bind-mounted /app/data (see
// docker-compose.yml). Any custom export path OUTSIDE it lives in the container's
// ephemeral overlay filesystem: the write silently succeeds but the files never
// show up on the host and are lost when the container is recreated. We detect that
// case so we can warn the user instead of letting them "lose" their exports.
const CONTAINER_DATA_MOUNT = process.env.DATA_MOUNT_PATH || '/app/data';

// True when the backend is running inside a container (Docker sets /.dockerenv).
async function isContainerized() {
  try {
    await fs.access('/.dockerenv');
    return true;
  } catch {
    return false;
  }
}

// Prove a directory is actually writable by writing + deleting a tiny probe file.
// A plain recursive mkdir is a silent no-op on an already-existing directory even
// when it is read-only, so this is the only reliable way to fail fast.
async function probeWritableDir(dir) {
  const probe = path.join(dir, `.xray-write-probe-${process.pid}-${Date.now()}.tmp`);
  try {
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.unlink(probe);
    return { ok: true };
  } catch (err) {
    const code = err && err.code ? err.code : String(err);
    const message = err && err.message ? err.message : String(err);
    try { await fs.unlink(probe); } catch (_) { /* ignore */ }
    return { ok: false, code, message };
  }
}

// Human-friendly explanation for an unwritable export destination, tuned to the
// current environment so the user actually knows how to fix it.
function writableErrorText(result, insideContainer) {
  const code = result.code || 'ERR';
  if (code === 'EACCES' || code === 'EPERM') {
    if (insideContainer) {
      return `The export folder exists but the container's server user cannot write to it (${code}). Pick a folder under ${CONTAINER_DATA_MOUNT}/… (the only folder that is writable and visible on the host), or map an extra bind-mount for your chosen folder in docker-compose.yml.`;
    }
    return `The export folder exists but is not writable by the server user (${code}). Choose a folder the server process can write to, or fix the folder's permissions.`;
  }
  return `Could not write a test file into the export folder (${code}). Pick a different, writable folder.`;
}

// In Docker, a path outside the bind-mounted /app/data lives on the container's
// ephemeral overlay filesystem: writes succeed but files never appear on the host
// and are lost when the container is recreated. Returns an error message if the
// path is unusable, or null if it is safe to use.
async function containerPathError(resolvedPath) {
  if (!(await isContainerized())) return null;
  const mountedRoot = path.resolve(CONTAINER_DATA_MOUNT);
  if (!resolvedPath.startsWith(mountedRoot)) {
    return `This folder (${resolvedPath}) is inside the container but is NOT mapped to your host machine, so files saved here would only exist inside the container and would be lost when the container is recreated. Choose a path under ${mountedRoot}/… (which maps to your host's backend/data folder), or add a bind-mount for this folder in docker-compose.yml.`;
  }
  return null;
}

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

// ---- Structured monitoring / request tracing middleware ----
//
// Writes newline-delimited JSON entries to <dataDir>/monitoring.log.
// Every request produces TWO events (consumed by the Streamlit dashboard):
//   { type: "request_started", ... }  → logged synchronously when the request begins
//   { type: "request_finished", ... } → logged on res.finish (when the last byte is written)
//
// Fields written on BOTH events (so the dashboard can still show rich data on in-flight rows):
//   - timestamp / startedAt / requestId / method / path / route
//   - page_hint         (best-effort SPA page name from Referer path or x-spa-page header)
//   - rss_mb / heap_mb  (Node.js memory snapshot at the time the event is emitted)
//   - in_flight         (exact instantaneous concurrent-in-flight count after ++ or --)
//
// request_finished additionally carries: status, duration_ms, duration_s, content_length

// Ensure data directory exists before creating log stream
await fs.mkdir(config.dataDir, { recursive: true });

const LOG_PATH = path.join(config.dataDir, 'monitoring.log');

// IMPORTANT: monitoring.log must NEVER be cleared or deleted.
// These logs are used for presentations and historical analysis.
// The 'a' flag ensures we only append, never truncate or overwrite.
let logStream = createWriteStream(LOG_PATH, { flags: 'a' });
let inFlightCounter = 0;

// ---- Monitoring log rotation & retention ----
// monitoring.log is append-only and grows forever unless managed. We rotate it
// once it exceeds LOG_MAX_SIZE_MB (the active file is renamed, never truncated),
// and purge rotated files that are older than LOG_RETENTION_DAYS. This gives the
// archive/purge behaviour asked for in production while keeping the active file
// (and any in-progress writes) safe.
const LOG_MAX_BYTES = Math.max(1, config.logMaxSizeMb || 100) * 1024 * 1024;
const LOG_RETENTION_MS = Math.max(1, config.logRetentionDays || 14) * 24 * 60 * 60 * 1000;

// Matches rotated filenames produced by this module: monitoring.log.<YYYY-MM-DD_HH-mm-ss>
const ROTATED_LOG_PATTERN = /^monitoring\.log\.\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

async function rotateMonitoringLogIfNeeded() {
  try {
    const stat = await fs.stat(LOG_PATH);
    if (stat.size < LOG_MAX_BYTES) return false;
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-'); // YYYY-MM-DD_HH-mm-ss
    const rotated = `${LOG_PATH}.${stamp}`;
    logStream.end();
    await fs.rename(LOG_PATH, rotated);
    logStream = createWriteStream(LOG_PATH, { flags: 'a' });
    logger.warn({ rotated }, 'Monitoring log rotated');
    return true;
  } catch (err) {
    console.warn('[monitoring] Log rotation failed:', err && err.message ? err.message : err);
    return false;
  }
}

async function purgeOldMonitoringLogs() {
  let removed = 0;
  try {
    const files = await fs.readdir(config.dataDir);
    const now = Date.now();
    for (const name of files) {
      if (!ROTATED_LOG_PATTERN.test(name)) continue;
      const full = path.join(config.dataDir, name);
      try {
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs > LOG_RETENTION_MS) {
          await fs.unlink(full);
          removed++;
        }
      } catch (_err) { /* ignore per-file errors */ }
    }
  } catch (err) {
    console.warn('[monitoring] Log purge failed:', err && err.message ? err.message : err);
  }
  if (removed > 0) logger.warn({ removed }, 'Purged old monitoring log files');
  return removed;
}

// Purge stale rotated logs on startup, then every 10 minutes rotate (if needed)
// and purge. Unref'd so it never keeps the process alive on its own.
void purgeOldMonitoringLogs();
setInterval(() => {
  void rotateMonitoringLogIfNeeded().then(purgeOldMonitoringLogs);
}, 10 * 60 * 1000).unref?.();

function classifyPageHint(req) {
    const explicit = req.headers['x-spa-page'];
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
        return explicit.trim().slice(0, 80);
    }
    const referer = req.headers['referer'] || '';
    try {
        const pathname = referer.startsWith('http') ? new URL(referer).pathname : referer;
        const p = (pathname || '').toLowerCase();
        if (!p || p === '/' || p === '/home') return 'upload';
        if (p.startsWith('/upload')) return 'upload';
        if (p.startsWith('/library')) return 'library';
        if (p.startsWith('/collage') || p.startsWith('/generate')) return 'collage';
        if (p.startsWith('/load')) return 'load';
        if (p.startsWith('/benchmark') || p.startsWith('/bench')) return 'benchmark';
        if (p.startsWith('/settings')) return 'settings';
        if (p.startsWith('/analysis')) return 'analysis';
        // strip leading / and first slug only
        const first = p.split('/').filter(Boolean)[0];
        return first || 'unknown';
    } catch {
        return 'unknown';
    }
}

function memorySnapshot() {
    try {
        const mem = process.memoryUsage();
        return {
            rss_mb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
            heap_total_mb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
            heap_used_mb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
            external_mb: Number((mem.external / (1024 * 1024)).toFixed(2)),
        };
    } catch {
        return { rss_mb: 0, heap_total_mb: 0, heap_used_mb: 0, external_mb: 0 };
    }
}

function shouldMonitorRequest(req, res) {
    if (req.path.startsWith('/data/')) return false;
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|npz|json)$/i.test(req.path)) {
        // /api/*.json endpoints are business logic; only skip truly-static path suffixes
        if (req.path.startsWith('/api/')) return true;
        return false;
    }
    if (res && res.statusCode === 304) return false;
    if (req.path === '/favicon.ico') return false;
    return true;
}

app.use((req, res, next) => {
    if (!shouldMonitorRequest(req, null)) {
        next();
        return;
    }

    const start = process.hrtime.bigint();
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const routeTemplate = req.route && req.route.path ? req.route.path : req.path;
    const page_hint = classifyPageHint(req);

    inFlightCounter += 1;
    const inFlightAtStart = inFlightCounter;
    const mem0 = memorySnapshot();

    const startEntry = {
        type: 'request_started',
        timestamp: startedAt,
        startedAt,
        requestId,
        method: req.method,
        path: req.path,
        route: routeTemplate,
        page_hint,
        referer: req.headers['referer'] || '',
        user_agent: req.get('user-agent') || '',
        content_length: Number(req.headers['content-length'] || 0) || 0,
        in_flight: inFlightAtStart,
        ...mem0,
    };
    // Only log to monitoring.log file, not to console (reduces terminal noise)
    try {
        logStream.write(`${JSON.stringify(startEntry)}\n`);
    } catch {
        /* swallow: logger must never break request flow */
    }

    function finishHandler() {
        res.removeListener('finish', finishHandler);
        res.removeListener('close', finishHandler);

        const durationNs = Number(process.hrtime.bigint() - start);
        const durationSec = durationNs / 1e9;
        const durationMs = Number((durationSec * 1000).toFixed(3));
        const endAt = new Date().toISOString();
        const routeTemplateNow = req.route && req.route.path ? req.route.path : req.path;
        const inFlightAtEnd = Math.max(0, inFlightCounter - 1);
        inFlightCounter = inFlightAtEnd;
        const mem1 = memorySnapshot();

        try {
            httpRequestDuration
                .labels(req.method, routeTemplateNow, String(res.statusCode))
                .observe(durationSec);
        } catch {
            /* ignore metric labeling errors */
        }

        if (!shouldMonitorRequest(req, res)) return;

        const finishEntry = {
            type: 'request_finished',
            timestamp: endAt,
            startedAt,
            finishedAt: endAt,
            requestId,
            method: req.method,
            path: req.path,
            route: routeTemplateNow,
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 400,
            duration_s: Number(durationSec.toFixed(6)),
            duration_ms: durationMs,
            page_hint,
            referer: req.headers['referer'] || '',
            user_agent: req.get('user-agent') || '',
            content_length: Number(res.getHeader('content-length') || 0) || 0,
            in_flight: inFlightAtEnd,
            ...mem1,
        };
        try {
            logStream.write(`${JSON.stringify(finishEntry)}\n`);
        } catch {
            /* ignore */
        }
    }

    res.on('finish', finishHandler);
    res.on('close', finishHandler);
    next();
});

// Expose the in-flight counter + log path on /metrics alongside Prometheus text,
// so external scrapers can also read the instantaneous value.
app.get('/metrics/live', (_req, res) => {
    const mem = memorySnapshot();
    res.json({
        in_flight_requests: inFlightCounter,
        monitoring_log: LOG_PATH,
        memory_mb: mem,
        server_time_utc: new Date().toISOString(),
    });
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
    loadLayoutsDir,
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
await fs.mkdir(loadLayoutsDir, { recursive: true });
await fs.mkdir(tempDir, { recursive: true });
await fs.mkdir(path.join(tempDir, 'raw-uploads'), { recursive: true });

// Ensure exports subdirectories exist
const { exportsHighRoot, exportsLowRoot, exportsAnnotationsRoot } = config;
await fs.mkdir(exportsHighRoot, { recursive: true });
await fs.mkdir(exportsLowRoot, { recursive: true });
await fs.mkdir(exportsAnnotationsRoot, { recursive: true });

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
app.use('/data/exports', express.static(exportsRoot));
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

// Helper: resolve pixel_data_path for an item, with disk-based fallback.
// Catalog field `pixel_data_path` may be NULL for historical/upload-flow reasons
// (e.g. standard upload createItem at ~L1007 never populated it). We fall back
// to the convention `highenergy/<sanitizedItemId>.npz` and verify the file exists.
// Also accepts the legacy camelCase `pixelDataFilename` for robustness.
async function resolvePixelDataPath(itemId, catalogPixelDataPath) {
    let pathToCheck = catalogPixelDataPath;
    if (!pathToCheck) {
        // Defensive: if the item was stored with the legacy camelCase field,
        // resolvePixelDataPath would otherwise miss it and return null.
        const item = await getItemById(itemId);
        if (item) {
            pathToCheck = item.pixelDataFilename || null;
        }
    }
    if (pathToCheck) {
        const r = safeJoin(pixelDataRoot, pathToCheck);
        if (r.safe) {
            try { await fs.access(r.fullPath); return pathToCheck; } catch {}
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

// Multer setup for raw file uploads (disk storage to avoid loading huge files into RAM)
const rawUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(tempDir, 'raw-uploads')),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`),
  }),
  limits: {
    files: 5000,
    fileSize: 1024 * 1024 * 1024, // 1 GB per file ceiling
  },
});

// Multer setup for import (Save Historic Data) uploads.
// Files are staged flat under data/temp/import/<runId>/<kind>/ where <kind> is
// pixel/highenergy, pixel/lowenergy or json — chosen from the field name so the
// energy-level is preserved without needing directory upload support on the client.
const importStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const runId = String((req.body && req.body.runId) || `r_${Date.now()}`);
        const kind =
            file.fieldname === 'pixelFiles' ? 'pixel/highenergy'
            : file.fieldname === 'pixelFilesLow' ? 'pixel/lowenergy'
            : file.fieldname === 'jsonFiles' ? 'json'
            : 'other';
        const dir = path.join(tempDir, 'import', runId, kind);
        try {
            mkdirSync(dir, { recursive: true });
        } catch { /* ignore */ }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const safe = sanitizeFilename(file.originalname) || `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.bin`;
        cb(null, safe);
    },
});
const uploadImport = multer({
    storage: importStorage,
    limits: {
        fileSize: 4 * 1024 * 1024 * 1024, // 4GB per file ceiling (npz are small, but stay generous)
        files: 200000,
    },
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
      health: "GET /api/health",
      items: "GET /api/items/:id",
      savedLayouts: "GET /api/saved-layouts",
      customSubcategories: "GET /api/custom-subcategories"
    }
  });
});

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", timestamp: new Date().toISOString() });
});

// Rate limiter status endpoint (for monitoring)
app.get('/api/rate-limit-status', (req, res) => {
  try {
    const stats = publicApiRateLimiter.getStats();
    res.json({
      ok: true,
      rateLimiter: {
        trackedIPs: stats.trackedIPs,
        concurrentConnections: stats.concurrentConnections,
        limits: {
          windowMs: 1000,
          maxRequestsPerSecond: 20,
          maxConcurrentPerIP: 10
        }
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
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

// Clean up temp files older than 4 hours (runs on server startup and periodically)
async function cleanupOldTempFiles() {
  try {
    await fs.mkdir(tempDir, { recursive: true });
    const now = Date.now();
    const maxAge = 4 * 60 * 60 * 1000; // 4 hours
    let cleaned = 0;

    // Clean tempDir
    const tempFiles = await fs.readdir(tempDir);
    for (const file of tempFiles) {
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

    // Clean orphaned .tmp files in dataDir (from writeJSONFileAtomic operations)
    const dataFiles = await fs.readdir(config.dataDir);
    for (const file of dataFiles) {
      if (!file.endsWith(".tmp")) continue;
      const filePath = path.join(config.dataDir, file);
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

// Run cleanup every 30 minutes to prune temp files older than 4 hours
setInterval(() => {
  void cleanupOldTempFiles();
}, 30 * 60 * 1000).unref?.();

// Initialize system configuration (detect CPU cores, etc.)
await initializeSystemConfig();

// System Hardware Information & Dynamic Worker Config Endpoint - rate limited
app.get("/api/system/info", publicApiRateLimiter.middleware(), async (_req, res) => {
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
    if (lower.endsWith(".npz")) return "npz";
    return null;
}

// Endpoint to process raw files (.dump.pgm, .tip) and extract .npz pixel data with worker pool
app.post("/api/process-raw-files", strictRateLimiter.middleware(), requireAuth, rawUpload.array("rawFiles"), async (req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.status(200).flushHeaders();

    const operationId = generateOperationId();
    const timer = new PipelineTimer(operationId, 'process_raw_files');
    
    try {
        // Stage 1: Upload Receipt
        timer.startStage(PIPELINE_STAGES.UPLOAD_RECEIPT);
        const files = req.files || [];
        logger.info({ operationId, fileCount: files.length, totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0) }, 'upload_receipt');
        timer.endStage(PIPELINE_STAGES.UPLOAD_RECEIPT, { fileCount: files.length });
        
        // Stage 2: Validation
        timer.startStage(PIPELINE_STAGES.VALIDATION);

        const items = await getItems();
        const existingIds = new Set(items.map(i => i.id));

        const nonDuplicates = [];
        let duplicateCount = 0;
        const duplicateFilenames = [];

        logger.debug({ operationId, fileCount: files.length }, 'Received files from multer');
        const skippedFiles = [];
        for (const file of files) {
            const itemId = deriveItemId(file.originalname);
            const fileType = classifyFileType(file.originalname);
            if (!fileType) {
                logger.debug({ operationId, filename: file.originalname }, 'Skipped file: unrecognized extension');
                skippedFiles.push({ filename: file.originalname, reason: "Unrecognized file extension (expected .dump.pgm, .tip, or .npz)" });
                try { await fs.unlink(file.path); } catch {}
                continue;
            }

            // Validate file magic number matches expected type
            const ext = path.extname(file.originalname).toLowerCase();
            const magicCheck = await validateFileMagicNumber(file.path, ext);
            if (!magicCheck.ok) {
                logger.debug({ operationId, filename: file.originalname, reason: magicCheck.error }, 'Skipped file: magic number mismatch');
                skippedFiles.push({ filename: file.originalname, reason: `Invalid file content: ${magicCheck.error}` });
                try { await fs.unlink(file.path); } catch {}
                continue;
            }

            if (existingIds.has(itemId)) {
                logger.debug({ operationId, itemId }, 'Duplicate file');
                duplicateCount++;
                duplicateFilenames.push(file.originalname);
            } else {
                nonDuplicates.push({ file, itemId, fileType });
            }
        }
        logger.debug({ operationId, valid: nonDuplicates.length, duplicates: duplicateCount, skipped: skippedFiles.length }, 'Validation complete');

        // ✅ Clear large objects after validation to free memory
        existingIds.clear();
        items.length = 0;

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

        for (const dupFilename of duplicateFilenames) {
            res.write(JSON.stringify({
                status: "duplicate",
                filename: dupFilename,
                itemId: deriveItemId(dupFilename),
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

        // Files are streamed to disk by multer's diskStorage.
        // We copy them to the app's temp directory with unique names so the workers can process them.
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

        const originalFilenameByItemId = new Map();
        for (const f of files) {
          const itId = deriveItemId(f.originalname);
          originalFilenameByItemId.set(itId, f.originalname);
        }
        
        for (const { file, itemId, fileType } of nonDuplicates) {
            const tempPath = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
            await fs.copyFile(file.path, tempPath);

            pool.addTask(
                {
                    filePath: tempPath,
                    itemId,
                    fileType,
                    pixelDataDir: pixelDataRoot,
                    libraryImagesDir: libraryImagesRoot,
                },
                async (rawResult) => {
                    const originalName = originalFilenameByItemId.get(rawResult.id) || (rawResult.id || "unknown");
                    let result = { ...rawResult, filename: originalName };
                    if (result.status === "error") {
                        let reason = result.reason;
                        if (!reason || typeof reason !== "string") {
                            reason = "Unknown processing error (worker returned no details)";
                        }
                        reason = reason.replace(/\s+/g, " ").trim();
                        if (reason.length > 300) reason = reason.slice(0, 300) + "...";
                        result.reason = reason;
                    }
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
        pool.destroy();

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
        const errorMessage = err?.message || String(err);
        const errorStack = err?.stack || '';
        
        // Always log the full error for debugging
        logger.error({ operationId, error: errorMessage, stack: errorStack }, 'process_raw_files_pipeline_error');
        console.error(`[process-raw-files] operationId=${operationId} error=${errorMessage}`);
        if (errorStack) {
            console.error(`[process-raw-files] stack=${errorStack.split('\n').slice(0, 5).join('\n')}`);
        }
        
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: errorMessage });
        } else {
            // Headers already sent as 200, but we can still send error details in the stream
            try {
                res.write(JSON.stringify({
                    status: "error",
                    reason: `Pipeline error: ${errorMessage}`,
                    operationId,
                    isFatal: true,
                }) + "\n");
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
// Rate limited to prevent abuse (max 20 requests/second, max 10 concurrent per IP)
app.get("/api/items/categorized", publicApiRateLimiter.middleware(), async (req, res) => {
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

// Get all item IDs for fast existence checking
app.get('/api/items/ids', publicApiRateLimiter.middleware(), async (req, res) => {
  try {
    const items = await getItems();
    const ids = items.map(i => i.id);
    res.json({ ok: true, ids });
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

// User configuration endpoints for export path settings.
// Each page/destination has its OWN independent folder ("scope"): load, saved,
// collage. Changing one never changes the others.
app.get('/api/user-config/exports-path', async (_req, res) => {
  try {
    const scopes = ['load', 'saved', 'collage'];
    const paths = {};
    const configured = {};
    for (const scope of scopes) {
      paths[scope] = await getExportsPath(scope);
      configured[scope] = await hasConfiguredExportsPath(scope);
    }
    // `platform` tells the UI which path convention (Windows drive vs POSIX /) to
    // expect, so the client can show the right format instructions.
    const insideContainer = await isContainerized();
    res.json({ 
      ok: true, 
      paths, 
      configured, 
      platform: process.platform, 
      isContainerized: insideContainer, 
      dataMountPath: insideContainer ? CONTAINER_DATA_MOUNT : null 
    });
  } catch (err) {
    console.error('[user-config/exports-path] Error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post('/api/user-config/exports-path', requireAuth, async (req, res) => {
  try {
    const { scope, exportsPath } = req.body || {};
    const requestedScope = typeof scope === 'string' && ['load', 'saved', 'collage'].includes(scope.trim().toLowerCase())
      ? scope.trim().toLowerCase()
      : 'saved';

    if (typeof exportsPath !== 'string') {
      return res.status(400).json({ ok: false, error: 'exportsPath is required and must be a string' });
    }

    // Empty string (or whitespace-only) resets that scope to its default folder.
    if (exportsPath.trim() === '') {
      const userConfig = await setExportsPath(requestedScope, null);
      const key = requestedScope === 'load' ? 'loadExportsPath' : requestedScope === 'collage' ? 'collageExportsPath' : 'savedExportsPath';
      return res.json({ ok: true, scope: requestedScope, exportsPath: userConfig[key] });
    }

    const trimmed = exportsPath.trim().replace(/[\\/]+$/, '');

    // Reject directory traversal.
    if (trimmed.split(/[\\/]+/).includes('..')) {
      return res.status(400).json({ ok: false, error: 'Invalid path — directory traversal ("..") is not allowed.' });
    }

    // Only absolute paths are accepted so the destination is never ambiguous.
    if (!path.isAbsolute(trimmed)) {
      const hint = process.platform === 'win32'
        ? 'On Windows use an absolute path like C:\\XrayExports or C:/XrayExports (drive letter required).'
        : 'On Linux/macOS use an absolute path like /home/you/XrayExports (must start with /).';
      return res.status(400).json({ ok: false, error: `Not an absolute path. ${hint}` });
    }

    const resolvedPath = path.resolve(trimmed);

    // Create the expected subfolders up front so mistakes surface now.
    try {
      if (requestedScope === 'collage') {
        await fs.mkdir(path.join(resolvedPath, 'collage_images', 'high'), { recursive: true });
        await fs.mkdir(path.join(resolvedPath, 'collage_images', 'low'), { recursive: true });
      } else if (requestedScope === 'load') {
        // Load-page saves keep high- and low-resolution images together in the
        // same folder (named "<id> high.png" / "<id> low.png"), so no subfolders.
        await fs.mkdir(resolvedPath, { recursive: true });
      } else {
        await fs.mkdir(path.join(resolvedPath, 'high'), { recursive: true });
        await fs.mkdir(path.join(resolvedPath, 'low'), { recursive: true });
        await fs.mkdir(path.join(resolvedPath, 'annotations'), { recursive: true });
      }
    } catch (err) {
      console.error('[user-config/exports-path] Failed to create folder:', err);
      const code = err && err.code ? err.code : String(err);
      let message = `Could not create the export folder. Check that the drive exists and is writable. (${code})`;
      if (code === 'EACCES' || code === 'EPERM') {
        message += ' The container runs as a non-root user (the uid/gid from PUID/PGID — default 1000). If this is a bind-mounted host folder, make sure the host directory is writable by that user, or choose a path under /app/data (which is automatically fixed on startup).';
      }
      return res.status(400).json({ ok: false, error: message });
    }

    // Prove the destination is actually writable BEFORE accepting it. Otherwise a
    // read-only folder (or a host-only path inside Docker) is accepted fine and
    // then silently "exports 0 files" later with no error.
    const probe = await probeWritableDir(resolvedPath);
    if (!probe.ok) {
      console.error('[user-config/exports-path] Destination is not writable:', probe.message);
      const insideContainer = await isContainerized();
      return res.status(400).json({ ok: false, error: writableErrorText(probe, insideContainer) });
    }

    // In Docker, REJECT the chosen path when it is outside the only host-visible
    // mount. The folder would be created and written inside the container's
    // ephemeral overlay filesystem — the files would never appear on the host and
    // would be silently lost when the container is recreated. A warning alone is
    // not enough: the frontend reports "saved" and the user believes their exports
    // are on disk when they are actually in a throwaway container layer.
    if (await isContainerized()) {
      const mountedRoot = path.resolve(CONTAINER_DATA_MOUNT);
      if (!resolvedPath.startsWith(mountedRoot)) {
        console.error(`[user-config/exports-path] Rejected path outside container data mount: ${resolvedPath}`);
        return res.status(400).json({
          ok: false,
          error: `This folder (${resolvedPath}) is inside the container but is NOT mapped to your host machine, so files saved here would only exist inside the container and would be lost when the container is recreated. Choose a path under ${mountedRoot}/… (which maps to your host's backend/data folder), or add a bind-mount for this folder in docker-compose.yml.`,
        });
      }
    }

    const userConfig = await setExportsPath(requestedScope, resolvedPath);
    const key = requestedScope === 'load' ? 'loadExportsPath' : requestedScope === 'collage' ? 'collageExportsPath' : 'savedExportsPath';
    res.json({ ok: true, scope: requestedScope, exportsPath: userConfig[key] });
  } catch (err) {
    console.error('[user-config/exports-path] Error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/user-config/has-exports-path', async (req, res) => {
  try {
    const scope = typeof req.query.scope === 'string' && ['load', 'saved', 'collage'].includes(req.query.scope.trim().toLowerCase())
      ? req.query.scope.trim().toLowerCase()
      : 'saved';
    const configured = await hasConfiguredExportsPath(scope);
    res.json({ ok: true, scope, configured });
  } catch (err) {
    console.error('[user-config/has-exports-path] Error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================================
// Import / "Save Historic Data" endpoints
// ============================================================================

// Analyze uploaded pixel data + annotation/catalog folder and
// return a pre-flight report: duplicates, missing objects, unclassified files.
// Streams NDJSON progress lines for real-time UI feedback.
app.post('/api/import/analyze', requireAuth, uploadImport.any(), async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const high = files.filter((f) => f.fieldname === 'pixelFiles');
    const low = files.filter((f) => f.fieldname === 'pixelFilesLow');
    const json = files.filter((f) => f.fieldname === 'jsonFiles');
    
    let pixelFiles = [
      ...high.map((f) => ({ baseName: path.basename(f.filename, path.extname(f.filename)), energy: 'highenergy', absPath: f.path, originalName: f.originalname })),
      ...low.map((f) => ({ baseName: path.basename(f.filename, path.extname(f.filename)), energy: 'lowenergy', absPath: f.path, originalName: f.originalname })),
    ];
    let jsonFiles = json.map((f) => ({ filename: f.originalname, absPath: f.path }));

    const body = req.body || {};
    const runId = body.runId;

    // If no files uploaded but runId provided, scan temp directory for already-uploaded files
    if (pixelFiles.length === 0 && jsonFiles.length === 0 && runId) {
      const stagedDir = path.join(tempDir, 'import', String(runId));
      try {
        const pixelDir = path.join(stagedDir, 'highenergy'); // Default to highenergy
        pixelFiles = await scanPixelDir(pixelDir);
        jsonFiles = await scanJsonDir(path.join(stagedDir, 'json'));
      } catch (err) {
        console.error('[import/analyze] Error scanning staged dir:', err);
      }
    }

    if (pixelFiles.length === 0 && jsonFiles.length === 0) {
      res.write(JSON.stringify({ stage: 'error', message: 'No pixel data or JSON files provided. Upload files first or provide a runId.' }) + '\n');
      res.end();
      return;
    }

    res.write(JSON.stringify({ stage: 'start', message: 'Starting analysis…', runId: runId || null }) + '\n');

    const report = await analyzeImport({
      pixelFiles,
      jsonFiles,
      progress: (o) => {
        try { 
          const line = JSON.stringify(o) + '\n';
          res.write(line);
          // Force flush to prevent buffering multiple lines together
          res.flush?.();
        } catch { /* client gone */ }
      },
    });

    res.write(JSON.stringify({ stage: 'done', message: 'Analysis complete', report }) + '\n');
    res.end();
  } catch (err) {
    console.error('[import/analyze] Error:', err);
    try {
      res.write(JSON.stringify({ stage: 'error', message: String(err) }) + '\n');
      res.end();
    } catch { /* response already ended */ }
  }
});

// Execute the import. Streams NDJSON progress lines; cancellable via jobId.
app.post('/api/import/run', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  let runId = null;
  let stagedDir = null;
  try {
    const body = req.body || {};
    runId = String(body.runId || `run_${Date.now()}`);
    const cancelState = { cancelled: false };
    importCancellations.set(runId, cancelState);

    stagedDir = path.join(tempDir, 'import', String(body.stagedId || runId));
    res.write(JSON.stringify({ stage: 'start', message: 'Reading staged upload…' }) + '\n');
    const pixelFiles = await scanPixelDir(stagedDir);
    const jsonFiles = await scanJsonDir(path.join(stagedDir, 'json'));

    const options = (body.options && typeof body.options === 'object') ? body.options : {};
    await runImport({
      pixelFiles,
      jsonFiles,
      options: { ...options, cancelState },
      progress: (o) => {
        try { 
          const line = JSON.stringify(o) + '\n';
          res.write(line);
          // Force flush to prevent buffering multiple lines together
          res.flush?.();
        } catch { /* client gone */ }
      },
    });

    res.write(JSON.stringify({ stage: 'done', message: 'Import complete' }) + '\n');
    res.end();
  } catch (err) {
    console.error('[import/run] Error:', err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    
    // Log detailed error for debugging
    console.error('[import/run] Full error details:', {
      message: errorMessage,
      stack: errorStack,
      runId,
      stagedDir,
    });
    
    try {
      // Send detailed error to frontend
      res.write(JSON.stringify({ 
        stage: 'error', 
        message: `Import failed: ${errorMessage}`,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
        runId 
      }) + '\n');
      res.end();
    } catch { /* response already ended */ }
  } finally {
    if (runId) importCancellations.delete(runId);
    if (stagedDir) {
      try { await fs.rm(stagedDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
});

// Cancel a running import job (checked between import stages).
app.post('/api/import/cancel', requireAuth, async (req, res) => {
  try {
    const { jobId } = req.body || {};
    if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
      return res.status(400).json({ ok: false, error: 'Missing jobId' });
    }
    const state = importCancellations.get(jobId.trim());
    if (state) state.cancelled = true;
    else importCancellations.set(jobId.trim(), { cancelled: true });
    res.json({ ok: true, cancelled: true });
  } catch (err) {
    console.error('[import/cancel] Error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Saved layouts endpoints - rate limited to prevent abuse
app.get('/api/saved-layouts', publicApiRateLimiter.middleware(), async (_req, res) => {
    try {
        const layouts = await getSavedLayouts();
        res.json({ ok: true, layouts });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.get('/api/saved-layouts/ids', publicApiRateLimiter.middleware(), async (_req, res) => {
    try {
        const layouts = await getSavedLayouts();
        const ids = layouts.map((l) => l.id).filter(Boolean);
        res.json({ ok: true, ids });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.get('/api/saved-layouts/filtered', publicApiRateLimiter.middleware(), async (req, res) => {
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

app.post('/api/saved-layouts', auditLog('create_saved_layout'), requireAuth, async (req, res) => {
    const { id, name, filepath, layout_json } = req.body;
    if (!name || !layout_json) return res.status(400).json({ ok: false, error: 'Missing name or layout_json' });
    
    // Validate layout_json structure
    const layoutValidation = validateLayoutJson(layout_json);
    if (!layoutValidation.ok) {
        return res.status(400).json({ ok: false, error: layoutValidation.error });
    }
    const sanitizedLayoutJson = layoutValidation.sanitized;
    
    try {
        // Attach segmentation masks (outer boundary polygon points) to each threat
        // so they are persisted with the saved annotation. Skip silently if a
        // threat has no resolvable pixel data.
        await attachThreatSegmentationMasks([sanitizedLayoutJson.objects]);

        const layout = await createSavedLayout({ id, name, filepath, layout_json: sanitizedLayoutJson });
        res.json({ ok: true, layout });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.post('/api/saved-layouts/batch', auditLog('batch_create_saved_layouts'), requireAuth, async (req, res) => {
    const { layouts } = req.body;
    if (!Array.isArray(layouts)) {
        return res.status(400).json({ ok: false, error: 'layouts must be an array' });
    }
    if (layouts.length === 0) {
        return res.json({ ok: true, saved: 0, savedLayouts: [] });
    }
    const normalized = [];
    for (let i = 0; i < layouts.length; i++) {
        const raw = layouts[i];
        if (!raw || typeof raw !== 'object') {
            return res.status(400).json({ ok: false, error: `Entry at index ${i} is not a valid object` });
        }
        const name = raw.name;
        const layout_json = raw.layout_json;
        if (!name || !layout_json) {
            return res.status(400).json({ ok: false, error: `Entry at index ${i} is missing name or layout_json` });
        }
        const layoutValidation = validateLayoutJson(layout_json);
        if (!layoutValidation.ok) {
            return res.status(400).json({ ok: false, error: `Entry ${i}: ${layoutValidation.error}` });
        }
        normalized.push({
            id: raw.id,
            name,
            filepath: raw.filepath ?? null,
            layout_json: layoutValidation.sanitized,
        });
    }
    try {
        // Attach segmentation masks (outer boundary polygon points) to every
        // threat across the whole batch in ONE batched pixel-generation call,
        // then persist. Masks are saved with the annotations only (no UI change).
        await attachThreatSegmentationMasks(normalized.map((n) => n.layout_json.objects));

        const saved = await createSavedLayoutsBatch(normalized);
        res.json({ ok: true, saved: saved.length, savedLayouts: saved });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err), saved: 0 });
    }
});

// ---- Batch-bulk save endpoint (MUST be registered before /:id route) ----

// POST /api/saved-layouts/batch-bulk
// Enqueue a batch of generated layouts for sequential disk write with pacing.
// Responds immediately with queue status (non-blocking).
app.post('/api/saved-layouts/batch-bulk', auditLog('batch_bulk_save_layouts'), requireAuth, async (req, res) => {
    try {
        const { layouts } = req.body;
        if (!Array.isArray(layouts) || layouts.length === 0) {
            return res.status(400).json({ ok: false, error: 'layouts array is required' });
        }

        // Validate each layout has minimum required fields
        for (let i = 0; i < layouts.length; i++) {
            const layout = layouts[i];
            if (!layout.name || !layout.layout_json) {
                return res.status(400).json({ ok: false, error: `Entry at index ${i} is missing name or layout_json` });
            }
            const layoutValidation = validateLayoutJson(layout.layout_json);
            if (!layoutValidation.ok) {
                return res.status(400).json({ ok: false, error: `Entry at index ${i}: ${layoutValidation.error}` });
            }
            layouts[i] = { ...layout, layout_json: layoutValidation.sanitized };
            // Stamp an ID and timestamp if missing
            if (!layouts[i].id) {
                layouts[i].id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            }
            if (!layouts[i].created_at) {
                layouts[i].created_at = new Date().toISOString();
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

// Check data integrity of saved layouts (MUST be before /:id route)
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

// Export saved layout images as a JSON summary and write PNG files to exports folder.
// This route must be registered before /api/saved-layouts/:id so /export is not swallowed.
// Supports optional ?jobId= query param so the client can cancel a running bulk
// export (Save All / Save Selected) via POST /api/saved-layouts/export/cancel.
async function handleSavedLayoutsExport(req, res) {
    const jobId = typeof req.query.jobId === 'string' && req.query.jobId.trim()
        ? req.query.jobId.trim()
        : null;
    // saveMode: 'individual' = save images + per-layout JSON only (no batch annotations.json)
    //           'selected' (default) = save images + batch annotations.json partition
    //           'all' = always save images + batch annotations.json partitions
    const saveMode = typeof req.query.saveMode === 'string' && req.query.saveMode.trim()
        ? req.query.saveMode.trim().toLowerCase()
        : 'selected';
    const includeImages = typeof req.query.includeImages === 'string'
        ? req.query.includeImages.trim().toLowerCase() !== 'false'
        : true;
    const scope = typeof req.query.scope === 'string' && ['load', 'saved', 'collage'].includes(req.query.scope.trim().toLowerCase())
        ? req.query.scope.trim().toLowerCase()
        : 'saved';

    let cancelled = false;

    try {
        const layoutIds = req.query.ids;
        let targetLayouts = [];

        if (layoutIds && typeof layoutIds === 'string') {
            const ids = layoutIds.split(',').map(id => id.trim()).filter(Boolean);
            const allLayouts = await getSavedLayouts();
            targetLayouts = allLayouts.filter(l => ids.includes(l.id));
        } else {
            targetLayouts = await getSavedLayouts();
        }

        if (!jobId || exportCancellations.has(jobId)) {
            cancelled = exportCancellations.has(jobId);
        }

        const userExportsRoot = await getExportsPath(scope);
        const exportsRoot = path.resolve(userExportsRoot);
        const exportsHighRoot = path.join(exportsRoot, 'high');
        const exportsLowRoot = path.join(exportsRoot, 'low');
        const exportsAnnotationsRoot = path.join(exportsRoot, 'annotations');

        const containerErr = await containerPathError(exportsRoot);
        if (containerErr) {
            console.error(`[saved-layouts/export] Rejected container-only export path: ${exportsRoot}`);
            if (!res.headersSent) {
                return res.status(400).json({ ok: false, error: `The export folder is not usable: ${containerErr}` });
            }
        }

        await fs.mkdir(exportsHighRoot, { recursive: true });
        await fs.mkdir(exportsLowRoot, { recursive: true });
        await fs.mkdir(exportsAnnotationsRoot, { recursive: true });

        const wrProbe = await probeWritableDir(exportsRoot);
        if (!wrProbe.ok) {
            console.error('[saved-layouts/export] Destination not writable:', wrProbe.message);
            const insideContainer = await isContainerized();
            if (!res.headersSent) {
                return res.status(400).json({ ok: false, error: `The export folder is not writable: ${writableErrorText(wrProbe, insideContainer)}` });
            }
        }

        const exported = [];
        const savedPaths = { high: [], low: [], annotations: [] };
        const annotationRecords = [];
        const ANNOTATION_PARTITION_CAP = 5000;

        if (targetLayouts.length === 0) {
            return res.json({
                ok: true,
                message: 'No layouts to export',
                exported: [],
                savedPaths,
                cancelled
            });
        }

        if (jobId) {
            exportProgressStore.set(jobId, { done: 0, total: targetLayouts.length });
        }

        // Save All always rewrites the canonical full export in annotations_1.json.
        // Save Selected must NOT overwrite that; instead it starts at the next free
        // partition number so the subset becomes annotations_2.json, ... and the
        // prior full export is preserved.
        let annotationPartitionNum = 1;
        if (saveMode === 'selected') {
            try {
                const existingFiles = await fs.readdir(exportsAnnotationsRoot);
                const existingPartitionNums = existingFiles
                    .filter(name => /^annotations_\d+\.json$/.test(name))
                    .map(name => {
                        const match = name.match(/^annotations_(\d+)\.json$/);
                        return match ? parseInt(match[1], 10) : null;
                    })
                    .filter((num) => num !== null);

                if (existingPartitionNums.length > 0) {
                    annotationPartitionNum = Math.max(...existingPartitionNums) + 1;
                }
            } catch (err) {
                console.warn('[export] Failed to scan existing annotation partitions:', err);
            }
        }

        try {
            await attachThreatSegmentationMasks(targetLayouts.map((l) => l.layout_json?.objects).filter(Boolean));
        } catch (err) {
            console.warn('[export] Segmentation mask batch failed:', err.message || err);
        }

        let currentAnnotationPartition = [];
        const annotationPartitions = [];

        for (let idx = 0; idx < targetLayouts.length; idx++) {
            const layout = targetLayouts[idx];
            if (jobId && exportCancellations.has(jobId)) {
                cancelled = true;
                break;
            }
            if (jobId) {
                exportProgressStore.set(jobId, { done: idx, total: targetLayouts.length });
            }
            try {
                const objects = layout.layout_json?.objects || {};
                const flatObjects = [];

                if (objects.bag) {
                    flatObjects.push({
                        id: objects.bag.id,
                        filepath: objects.bag.filepath,
                        pixel_data_path: objects.bag.pixel_data_path,
                        transform: {
                            x: objects.bag.center?.x || 0,
                            y: objects.bag.center?.y || 0,
                            width: objects.bag.size?.width || 800,
                            height: objects.bag.size?.height || 600,
                            rotation: 0,
                        },
                        layer: objects.bag.layer || 0,
                    });
                }

                if (Array.isArray(objects.threats)) {
                    for (const obj of objects.threats) {
                        flatObjects.push({
                            id: obj.id,
                            filepath: obj.filepath,
                            pixel_data_path: obj.pixel_data_path,
                            transform: {
                                x: obj.center?.x || 0,
                                y: obj.center?.y || 0,
                                width: obj.size?.width || 100,
                                height: obj.size?.height || 100,
                                rotation: obj.rotation || 0,
                            },
                            layer: obj.layer || 1,
                        });
                    }
                }

                if (Array.isArray(objects['non-threats'])) {
                    for (const obj of objects['non-threats']) {
                        flatObjects.push({
                            id: obj.id,
                            filepath: obj.filepath,
                            pixel_data_path: obj.pixel_data_path,
                            transform: {
                                x: obj.center?.x || 0,
                                y: obj.center?.y || 0,
                                width: obj.size?.width || 100,
                                height: obj.size?.height || 100,
                                rotation: obj.rotation || 0,
                            },
                            layer: obj.layer || 2,
                        });
                    }
                }

                if (flatObjects.length > 0) {
                    const safeLayoutId = String(layout.id || 'layout').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'layout';
                    const baseName = `SB_${safeLayoutId}`;

                    let highEnergyPath = null;
                    let lowEnergyPath = null;
                    let highEnergyFilename = null;
                    let lowEnergyFilename = null;
                    let annotationPath = null;

                    if (includeImages) {
                        const highEnergyObjects = await enrichObjectsWithPixelData(flatObjects);
                        const lowEnergyObjects = await enrichObjectsWithPixelData(flatObjects);
                        for (const obj of lowEnergyObjects) {
                            if (obj.pixel_data_path) {
                                obj.pixel_data_path = obj.pixel_data_path.replace(/^highenergy[\\/]/, 'lowenergy/');
                            }
                        }

                        const highPngBuffer = await renderSceneAsync(highEnergyObjects, 800, 600, 'highenergy');
                        const highExportPath = path.join(exportsHighRoot, `${baseName}_high.png`);
                        await fs.writeFile(highExportPath, highPngBuffer);
                        savedPaths.high.push(highExportPath);

                        const lowPngBuffer = await renderSceneAsync(lowEnergyObjects, 800, 600, 'lowenergy');
                        const lowExportPath = path.join(exportsLowRoot, `${baseName}_low.png`);
                        await fs.writeFile(lowExportPath, lowPngBuffer);
                        savedPaths.low.push(lowExportPath);

                        highEnergyPath = highExportPath;
                        lowEnergyPath = lowExportPath;
                        highEnergyFilename = `${baseName}_high.png`;
                        lowEnergyFilename = `${baseName}_low.png`;
                    }

                    const annotation = {
                        layoutId: layout.id,
                        layoutName: layout.name,
                        createdAt: layout.created_at || null,
                        exportedAt: new Date().toISOString(),
                        highEnergyImage: highEnergyFilename,
                        lowEnergyImage: lowEnergyFilename,
                        objects: layout.layout_json?.objects || null
                    };
                    // Per-layout annotation file — only created in 'individual' mode.
                    // 'selected' and 'all' both write a single batched annotations partition
                    // so repeated exports do not overwrite each other.
                    const isBulkMode = saveMode === 'selected' || saveMode === 'all';
                    const shouldCreateIndividualFile = saveMode === 'individual';
                    const shouldCreateBatchAnnotations = isBulkMode;

                    if (shouldCreateIndividualFile) {
                        annotationPath = path.join(exportsAnnotationsRoot, `${baseName}.json`);
                        await fs.writeFile(annotationPath, JSON.stringify(annotation, null, 2));
                        savedPaths.annotations.push(annotationPath);
                    }
                    annotationRecords.push(annotation);

                    if (shouldCreateBatchAnnotations) {
                        currentAnnotationPartition.push(annotation);
                        if (currentAnnotationPartition.length >= ANNOTATION_PARTITION_CAP) {
                            const partPath = path.join(exportsAnnotationsRoot, `annotations_${annotationPartitionNum}.json`);
                            await fs.writeFile(partPath, JSON.stringify(currentAnnotationPartition, null, 2));
                            annotationPartitions.push(partPath);
                            savedPaths.annotations.push(partPath);
                            annotationPartitionNum++;
                            currentAnnotationPartition = [];
                        }
                    }

                    exported.push({
                        layoutId: layout.id,
                        layoutName: layout.name,
                        highEnergyPath,
                        lowEnergyPath,
                        highEnergyFilename,
                        lowEnergyFilename,
                        annotationPath
                    });
                }
            } catch (err) {
                console.error(`[export] Failed to render layout ${layout.id}:`, err);
                exported.push({
                    layoutId: layout.id,
                    layoutName: layout.name,
                    error: err.message
                });
            }
            if (jobId) {
                exportProgressStore.set(jobId, { done: idx + 1, total: targetLayouts.length });
            }
        }

        if (currentAnnotationPartition.length > 0) {
            try {
                const partPath = path.join(exportsAnnotationsRoot, `annotations_${annotationPartitionNum}.json`);
                await fs.writeFile(partPath, JSON.stringify(currentAnnotationPartition, null, 2));
                annotationPartitions.push(partPath);
                savedPaths.annotations.push(partPath);
            } catch (err) {
                console.warn('[export] Failed to write annotation partition:', err);
            }
        }

        res.json({
            ok: true,
            message: `Exported ${exported.length} layout(s)`,
            exported,
            savedPaths,
            cancelled,
            summary: {
                total: targetLayouts.length,
                success: exported.filter(e => !e.error).length,
                failed: exported.filter(e => e.error).length,
                fileCount: {
                    high: savedPaths.high.length,
                    low: savedPaths.low.length,
                    annotations: savedPaths.annotations.length,
                    annotationPartitions: annotationPartitions.length
                }
            }
        });
    } catch (err) {
        console.error('[export] Error:', err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: String(err) });
        } else {
            res.end();
        }
    } finally {
        if (jobId) {
            exportCancellations.delete(jobId);
            exportProgressStore.delete(jobId);
        }
    }
}

app.get('/api/saved-layouts/export', strictRateLimiter.middleware(), requireAuth, async (req, res) => {
    await handleSavedLayoutsExport(req, res);
});

app.post('/api/saved-layouts/export', strictRateLimiter.middleware(), requireAuth, async (req, res) => {
    await handleSavedLayoutsExport(req, res);
});

// Live progress for a running saved-layouts export job (Save All / Save Selected),
// polled by the frontend so the progress bar advances while images are rendered/written.
// Registered before /api/saved-layouts/:id so it is not swallowed by the param route.
app.get('/api/saved-layouts/export/progress', async (req, res) => {
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId.trim() : '';
    const progress = jobId ? exportProgressStore.get(jobId) : null;
    if (!progress) {
        return res.json({ ok: true, found: false, done: null, total: null });
    }
    res.json({ ok: true, found: true, done: progress.done, total: progress.total });
});

// Cancel a running bulk export (Save All / Save Selected) job.
// The running /api/saved-layouts/export handler checks this flag between layouts
// and stops as soon as it reaches the next layout boundary.
app.post('/api/saved-layouts/export/cancel', requireAuth, async (req, res) => {
    try {
        const { jobId } = req.body || {};
        if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
            return res.status(400).json({ ok: false, error: 'Missing jobId' });
        }

        exportCancellations.set(jobId.trim(), true);
        console.log(`[export] Cancellation requested for job ${jobId.trim()}`);
        res.json({ ok: true, cancelled: true });
    } catch (err) {
        console.error('[export/cancel] Error:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Export annotation combinations as high+low resolution images
app.post('/api/load/export-combinations', strictRateLimiter.middleware(), requireAuth, async (req, res) => {
    // Use the client-provided jobId so the frontend can poll progress and cancel.
    const jobId = typeof req.query.jobId === 'string' && req.query.jobId.trim()
        ? req.query.jobId.trim()
        : `load_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let cancelled = false;

    try {
        const { combinations, outputPath, includeImages = true } = req.body || {};
        
        if (!Array.isArray(combinations) || combinations.length === 0) {
            return res.status(400).json({ ok: false, error: 'No combinations provided' });
        }

        const combinationValidation = validateCombinationsArray(combinations, 10000);
        if (!combinationValidation.ok) {
            return res.status(400).json({ ok: false, error: combinationValidation.error });
        }

        exportProgressStore.set(jobId, { done: 0, total: combinations.length });

        // Load-page images are saved together in ONE folder (no high/ low/ subfolders).
        const userExportsRoot = await getExportsPath('load');
        const exportsRoot = path.resolve(userExportsRoot);

        await fs.mkdir(exportsRoot, { recursive: true });

        // Fail fast if the destination is read-only / not writable, instead of
        // rendering every combination and then reporting "0 exported" with no error.
        const wrProbe = await probeWritableDir(exportsRoot);
        if (!wrProbe.ok) {
          console.error('[export-combinations] Destination not writable:', wrProbe.message);
          const insideContainer = await isContainerized();
          if (!res.headersSent) {
            return res.status(400).json({ ok: false, error: `The export folder is not writable: ${writableErrorText(wrProbe, insideContainer)}` });
          }
        }

        const exported = [];
        const savedPaths = { high: [], low: [] };

        for (let i = 0; i < combinations.length; i++) {
            if (exportCancellations.has(jobId)) { cancelled = true; break; }

            // Publish per-combination progress so the frontend progress bar advances live.
            exportProgressStore.set(jobId, { done: i, total: combinations.length });

            const combo = combinations[i];
            const objects = combo.objects || {};
            const flatObjects = [];
            
            if (objects.bag) {
                flatObjects.push({ ...objects.bag, transform: { x: objects.bag.center?.x || 0, y: objects.bag.center?.y || 0, width: objects.bag.size?.width || 800, height: objects.bag.size?.height || 600, rotation: 0 }, layer: objects.bag.layer || 0 });
            }
            if (Array.isArray(objects.threats)) {
                for (const t of objects.threats) {
                    flatObjects.push({ ...t, transform: { x: t.center?.x || 0, y: t.center?.y || 0, width: t.size?.width || 120, height: t.size?.height || 60, rotation: t.rotation || 0 }, layer: t.layer || 1 });
                }
            }
            if (Array.isArray(objects['non-threats'])) {
                for (const nt of objects['non-threats']) {
                    flatObjects.push({ ...nt, transform: { x: nt.center?.x || 0, y: nt.center?.y || 0, width: nt.size?.width || 80, height: nt.size?.height || 80, rotation: nt.rotation || 0 }, layer: nt.layer || 1 });
                }
            }

            if (flatObjects.length === 0) {
                exported.push({ layoutId: combo.layoutId, layoutName: combo.layoutName, error: 'No valid objects' });
                continue;
            }

            try {
                const enrichedObjects = await enrichObjectsWithPixelData(flatObjects);
                const highEnergyObjects = enrichedObjects;
                const lowEnergyObjects = enrichedObjects.map(obj => {
                    if (obj.pixel_data_path) {
                        return { ...obj, pixel_data_path: obj.pixel_data_path.replace(/^highenergy[\\/]/, "lowenergy/") };
                    }
                    return obj;
                });

                const [highPngBuffer, lowPngBuffer] = await Promise.all([
                    renderSceneAsync(highEnergyObjects, 800, 600, "highenergy"),
                    renderSceneAsync(lowEnergyObjects, 800, 600, "lowenergy")
                ]);

                // Name files from the layout ID with a resolution suffix (e.g.
                // "abc high.png" / "abc low.png"). Both copies live side-by-side
                // in the same load-layouts folder.
                const baseName = (combo.layoutId || combo.layoutName || `combo_${i}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
                const highFilename = `${baseName} high.png`;
                const lowFilename = `${baseName} low.png`;

                const highEnergyPath = path.join(exportsRoot, highFilename);
                const lowEnergyPath = path.join(exportsRoot, lowFilename);

                await fs.writeFile(highEnergyPath, highPngBuffer);
                await fs.writeFile(lowEnergyPath, lowPngBuffer);

                savedPaths.high.push(highEnergyPath);
                savedPaths.low.push(lowEnergyPath);

                exported.push({
                    layoutId: combo.layoutId, layoutName: combo.layoutName,
                    highEnergyPath, lowEnergyPath, highEnergyFilename: highFilename, lowEnergyFilename: lowFilename,
                });
            } catch (err) {
                console.error(`[export] Failed: ${combo.layoutId}:`, err);
                exported.push({ layoutId: combo.layoutId, layoutName: combo.layoutName, error: err.message });
            }

            exportProgressStore.set(jobId, { done: i + 1, total: combinations.length });
        }

        res.json({
            ok: true, message: `Exported ${exported.length} combination(s)`,
            exported, savedPaths, cancelled,
            summary: { total: combinations.length, success: exported.filter(e => !e.error).length, failed: exported.filter(e => e.error).length, fileCount: { high: savedPaths.high.length, low: savedPaths.low.length } }
        });
    } catch (err) {
        console.error('[export-combinations] Error:', err);
        if (!res.headersSent) { res.status(500).json({ ok: false, error: String(err) }); }
        else { try { res.end(); } catch (_) {} }
    } finally {
        if (jobId) { exportCancellations.delete(jobId); }
        if (jobId) { exportProgressStore.delete(jobId); }
    }
});

app.post('/api/load/export-combinations/cancel', requireAuth, async (req, res) => {
    try {
        const { jobId } = req.body || {};
        if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
            return res.status(400).json({ ok: false, error: 'Missing jobId' });
        }
        exportCancellations.set(jobId.trim(), true);
        res.json({ ok: true, cancelled: true });
    } catch (err) {
        console.error('[export-combinations/cancel] Error:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Live progress for a running load-page export job (polled by the frontend so the
// progress bar advances while images are being rendered/written).
app.get('/api/load/export-combinations/progress', async (req, res) => {
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId.trim() : '';
    const progress = jobId ? exportProgressStore.get(jobId) : null;
    if (!progress) {
        return res.json({ ok: true, found: false, done: null, total: null });
    }
    res.json({ ok: true, found: true, done: progress.done, total: progress.total });
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

app.delete('/api/saved-layouts/:id', auditLog('delete_saved_layout'), requireAuth, async (req, res) => {
    try {
        await deleteSavedLayout(req.params.id);
        // Also remove the collage images (high + low) belonging ONLY to this
        // layout, if they exist. Other layouts' images are never touched.
        await deleteCollageImagesForLayout(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Batch delete saved layouts (more efficient than multiple individual requests).
// Also removes the collage image files (high + low) belonging ONLY to the
// deleted layouts — other layouts' images are never touched.
app.post('/api/saved-layouts/batch-delete', auditLog('batch_delete_saved_layouts'), requireAuth, async (req, res) => {
    try {
        const { ids } = req.body;
        
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ ok: false, error: 'ids array is required and must not be empty' });
        }
        
        if (ids.length > 1000) {
            return res.status(400).json({ ok: false, error: 'Maximum 1000 layouts can be deleted at once' });
        }
        
        const results = [];
        let successCount = 0;
        let failCount = 0;
        
        // Delete layouts sequentially to avoid overwhelming the storage layer
        for (const id of ids) {
            try {
                await deleteSavedLayout(id);
                // Remove ONLY this layout's collage images (high + low) if they exist.
                await deleteCollageImagesForLayout(id);
                results.push({ id, success: true });
                successCount++;
            } catch (err) {
                console.error(`[batch-delete] Failed to delete layout ${id}:`, err);
                results.push({ id, success: false, error: String(err) });
                failCount++;
            }
        }
        
        res.json({
            ok: true,
            successCount,
            failCount,
            results
        });
    } catch (err) {
        console.error('[batch-delete] Error:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Custom subcategories endpoints - rate limited to prevent abuse
app.get('/api/custom-subcategories', publicApiRateLimiter.middleware(), async (req, res) => {
    try {
        const customSubs = await getCustomSubcategories();
        res.json({ ok: true, customSubcategories: customSubs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.post('/api/custom-subcategories', auditLog('add_custom_subcategory'), requireAuth, async (req, res) => {
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

app.delete('/api/custom-subcategories/:category/:slug', auditLog('remove_custom_subcategory'), requireAuth, async (req, res) => {
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

app.post("/api/upload", strictRateLimiter.middleware(), requireAuth, uploadWithLimits.array("images", config.maxFilesPerUpload), async (req, res) => {
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

        // Validate file sizes and magic numbers
        const fileValidationErrors = [];
        const validFiles = [];
        for (const file of files) {
            const sizeCheck = checkFileSize(file.size, config.maxFileSize);
            if (!sizeCheck.ok) {
                fileValidationErrors.push({ filename: file.originalname, message: sizeCheck.error });
                try {
                    await fs.unlink(file.path);
                } catch {}
                continue;
            }

            const ext = path.extname(file.originalname).toLowerCase();
            const magicCheck = await validateFileMagicNumber(file.path, ext);
            if (!magicCheck.ok) {
                fileValidationErrors.push({ filename: file.originalname, message: magicCheck.error });
                try {
                    await fs.unlink(file.path);
                } catch {}
                continue;
            }

            validFiles.push(file);
        }
        
        timer.endStage(PIPELINE_STAGES.VALIDATION, { 
            metadataItems: metadataArray.length,
            validFiles: validFiles.length,
            invalidFiles: fileValidationErrors.length
        });

        // Stage 3: File Processing (per-file)
        timer.startStage(PIPELINE_STAGES.FILE_PREPROCESSING);
        
        const errors = [];
        const processed = [];
        const processedIds = new Set();
        const fileProcessingStart = process.hrtime.bigint();

        for (const file of validFiles) {
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
                const name = deriveItemId(file.originalname);

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
            message: errors.length > 0 || fileValidationErrors.length > 0 ? "Some files processed, some had errors" : "Files uploaded successfully!",
            itemsProcessed: processed.length,
            fileValidationErrors,
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

// Delete the collage / export image files (high + low) and annotation files
// for a saved layout id, if they exist. Only the files belonging to the deleted
// layout are removed — never the whole directory. Checks:
//   - default collage_images root
//   - user-configured collage export path (getExportsPath('collage'))
//   - default saved exports root
//   - user-configured saved export path (getExportsPath('saved'))
// and matches:
//   - direct collage filename ({id}.png)
//   - saved-layout export filenames (SB_{id}_high.png / SB_{id}_low.png)
//   - individual annotation file (SB_{id}.json)
//   - batch annotation entries (annotations_*.json arrays filtered by layoutId)
async function deleteCollageImagesForLayout(layoutId) {
  if (!layoutId || typeof layoutId !== 'string') return;
  const safeId = String(layoutId).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  if (!safeId) return;

  const roots = [];

  // Default collage image roots (backend/data/collage_images/high|low).
  try {
    roots.push(path.join(collageHighRoot));
    roots.push(path.join(collageLowRoot));
  } catch { /* ignore */ }

  // User-configured collage export root (custom path chosen in the UI).
  try {
    const collageRoot = await getExportsPath('collage');
    roots.push(path.join(collageRoot, 'high'));
    roots.push(path.join(collageRoot, 'low'));
  } catch { /* ignore */ }

  // Saved layout export roots (backend/data/exports/high|low or user-configured saved path).
  let savedAnnotationsRoot = null;
  try {
    const savedRoot = await getExportsPath('saved');
    roots.push(path.join(savedRoot, 'high'));
    roots.push(path.join(savedRoot, 'low'));
    savedAnnotationsRoot = path.join(savedRoot, 'annotations');
  } catch { /* ignore */ }

  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);

    // Direct collage render: {id}.png
    const directPath = path.join(root, `${safeId}.png`);
    try {
      await fs.unlink(directPath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`[delete-layout] Failed to remove image ${directPath}: ${err.message}`);
      }
    }

    // Saved-layout export: SB_{id}_high.png and SB_{id}_low.png
    const baseName = `SB_${safeId}`;
    const highPath = path.join(root, `${baseName}_high.png`);
    try {
      await fs.unlink(highPath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`[delete-layout] Failed to remove image ${highPath}: ${err.message}`);
      }
    }

    const lowPath = path.join(root, `${baseName}_low.png`);
    try {
      await fs.unlink(lowPath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`[delete-layout] Failed to remove image ${lowPath}: ${err.message}`);
      }
    }
  }

  // Delete individual annotation file and purge entries from batch annotation files.
  if (savedAnnotationsRoot) {
    // Individual annotation: SB_{id}.json
    const individualAnnotationPath = path.join(savedAnnotationsRoot, `${safeId}.json`);
    try {
      await fs.unlink(individualAnnotationPath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`[delete-layout] Failed to remove annotation ${individualAnnotationPath}: ${err.message}`);
      }
    }

    // Batch annotations: annotations_*.json — remove entries for this layoutId.
    try {
      const files = await fs.readdir(savedAnnotationsRoot);
      const batchFiles = files.filter(name => /^annotations_\d+\.json$/.test(name));
      for (const file of batchFiles) {
        const fullPath = path.join(savedAnnotationsRoot, file);
        try {
          const raw = await fs.readFile(fullPath, 'utf8');
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) continue;
          const next = arr.filter(entry => entry && entry.layoutId !== layoutId);
          if (next.length === 0) {
            await fs.unlink(fullPath);
          } else {
            await fs.writeFile(fullPath, JSON.stringify(next, null, 2));
          }
        } catch (err) {
          console.warn(`[delete-layout] Failed to update batch annotation ${fullPath}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`[delete-layout] Failed to scan annotations root ${savedAnnotationsRoot}: ${err.message}`);
    }
  }
}

// Delete an individual item
app.delete("/api/items/:id", auditLog('delete_item'), requireAuth, async (req, res) => {
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
app.post("/api/items/bulk-delete", auditLog('bulk_delete_items'), requireAuth, async (req, res) => {
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

async function deleteTempFilesForItem(itemId) {
    const safeItemId = sanitizeFilename(itemId);
    const errors = [];

    const targets = [
        { path: safeJoin(libraryImagesRoot, `${safeItemId}.png`), label: 'image' },
        { path: safeJoin(pixelDataRoot, path.join('highenergy', `${safeItemId}.npz`)), label: 'high energy pixel data' },
        { path: safeJoin(pixelDataRoot, path.join('lowenergy', `${safeItemId}.npz`)), label: 'low energy pixel data' },
    ];

    for (const target of targets) {
        if (!target.path.safe) continue;
        try {
            const stat = await fs.stat(target.path.fullPath);
            if (!stat.isFile()) continue;
            await fs.unlink(target.path.fullPath);
        } catch (err) {
            if (err && err.code !== 'ENOENT' && err.code !== 'EPERM') {
                errors.push(`Failed to delete ${target.label}: ${err}`);
            }
        }
    }

    return errors;
}

// Delete temporary files for pre-processed items (before they're uploaded to library)
app.delete("/api/temp-files/:itemId", requireAuth, async (req, res) => {
    try {
        const { itemId } = req.params;
        const errors = await deleteTempFilesForItem(itemId);

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

app.post('/api/temp-files/batch-delete', requireAuth, async (req, res) => {
    try {
        let itemIds = [];
        if (Array.isArray(req.body?.itemIds)) {
            itemIds = req.body.itemIds;
        } else if (typeof req.body === 'string') {
            try {
                const parsed = JSON.parse(req.body);
                if (Array.isArray(parsed?.itemIds)) {
                    itemIds = parsed.itemIds;
                }
            } catch {}
        }
        if (itemIds.length === 0) {
            return res.status(400).json({ ok: false, error: 'itemIds array is required' });
        }

        const errors = [];
        for (const itemId of itemIds) {
            if (typeof itemId !== 'string' || !itemId.trim()) continue;
            const itemErrors = await deleteTempFilesForItem(itemId);
            errors.push(...itemErrors.map(err => `${itemId}: ${err}`));
        }

        if (errors.length > 0) {
            console.error('Errors during batch temp file cleanup:', errors);
            return res.status(500).json({ ok: false, error: errors.join(', ') });
        }

        res.json({ ok: true, deletedCount: itemIds.filter(Boolean).length, message: 'Temporary files deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Auto-generate valid region from raw pixel data (for pre-upload staged items)
app.get("/api/auto-valid-region", (req, res) => {
    res.status(405).json({ ok: false, error: "Method Not Allowed: use POST /api/auto-valid-region" });
});
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

// Batch auto-generate valid regions for multiple items.
//
// MEMORY BEHAVIOUR (critical):
//   The per-item API spawned one Python-per-file, which imports scipy + cv2
//   (~300–500 MB commit per child). For 50 files that's 15–25 GB of commit
//   demand and reliably blew past Windows' commit-charge limit, causing the
//   upstream raw-file pipeline to fail with "Unable to allocate 1.29 MiB".
//
// Strategy now:
//   1. Validate paths / existence first (no child processes needed).
//   2. For the remaining items, batch BATCH_FILES_PER_PROCESS into a single
//      python --batch invocation, amortising scipy + cv2 import cost across
//      ~20 files with one child.
//   3. Run those child batches through a global Semaphore with concurrency
//      sized by the same getWorkerCount() logic as the upload pipeline, so
//      total commit across upload + auto-valid-region stays bounded.
app.post("/api/auto-valid-region-batch", requireAuth, async (req, res) => {
    const operationId = generateOperationId();
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or empty items array" });
        }

        if (items.length > 50) {
            return res.status(400).json({ ok: false, error: "Maximum 50 items per batch request" });
        }

        // Step 1 — path validation + file existence (synchronous, no Python)
        const prechecks = items.map((item) => {
            const { itemId, pixelDataPath } = item;

            if (!itemId || !pixelDataPath) {
                return {
                    itemId,
                    ok: false,
                    error: "Missing itemId or pixelDataPath",
                    _skip: true,
                };
            }

            const validation = validatePathComponent(pixelDataPath);
            if (!validation.valid) {
                return {
                    itemId,
                    ok: false,
                    error: `Invalid pixelDataPath: ${validation.error}`,
                    _skip: true,
                };
            }

            const safePathResult = safeJoin(pixelDataRoot, validation.cleaned);
            if (!safePathResult.safe) {
                return {
                    itemId,
                    ok: false,
                    error: `Invalid pixel data path: ${safePathResult.error}`,
                    _skip: true,
                };
            }

            return {
                itemId,
                ok: null, // undecided until file check + python
                fullPath: safePathResult.fullPath,
                _skip: false,
            };
        });

        // Existence check — any missing file errors immediately (no point spawning python)
        const finalPrechecks = await Promise.all(
            prechecks.map(async (pc) => {
                if (pc._skip) return pc;
                try {
                    await fs.access(pc.fullPath);
                    return pc;
                } catch {
                    return {
                        itemId: pc.itemId,
                        ok: false,
                        error: `Pixel data file not found: ${items.find(i => i.itemId === pc.itemId)?.pixelDataPath ?? pc.fullPath}`,
                        _skip: true,
                    };
                }
            })
        );

        // Step 2 — chunk work that actually needs a Python run
        const todoTasks = finalPrechecks
            .filter((pc) => !pc._skip)
            .map((pc) => ({ itemId: pc.itemId, npzPath: pc.fullPath }));

        // Rough sizing: max 3 concurrent Python child batches for auto-valid-
        // region regardless of what getWorkerCount returns, since each child
        // is scipy+cv2 heavy (commit expensive).
        const suggestedWorkers = Math.min(
            Math.max(1, await getWorkerCount('auto-valid-region', 3)),
            3
        );
        const concurrency = Math.min(suggestedWorkers, todoTasks.length || 1);
        logger.info(
            { operationId, items: items.length, todo: todoTasks.length, concurrency, batchSize: BATCH_FILES_PER_PROCESS },
            'auto_valid_region_batch_started'
        );

        const taskChunks = chunked(todoTasks, BATCH_FILES_PER_PROCESS);

        // Step 3 — run each Python batch under the semaphore. Use the raw
        // semaphore (not withSemaphore) because each Promise represents a
        // chunk returning many results, not one item's result.
        const pythonSemaphore = new Semaphore(concurrency);
        const chunkResults = await Promise.allSettled(
            taskChunks.map((chunk) =>
                pythonSemaphore.run(() => generateValidRegionBatch(chunk))
            )
        );

        // Step 4 — flatten all per-chunk result arrays into a map by itemId
        const resultById = new Map();
        for (const settled of chunkResults) {
            if (settled.status === 'rejected') {
                // Entire python batch crashed — tag each chunk item with the error
                continue;
            }
            for (const r of settled.value) {
                if (r && r.itemId) {
                    resultById.set(r.itemId, r);
                }
            }
        }

        // Step 5 — assemble final response in original input order
        const processedResults = finalPrechecks.map((pc, idx) => {
            if (pc.ok === false) {
                // Precheck already failed
                return {
                    itemId: pc.itemId,
                    ok: false,
                    error: pc.error,
                };
            }

            const resObj = resultById.get(pc.itemId);
            if (!resObj) {
                // Didn't come back from Python at all (e.g. the whole chunk's
                // process crashed before emitting NDJSON lines for it)
                return {
                    itemId: pc.itemId,
                    ok: false,
                    error: "auto-valid-region batch worker did not return a result for this item",
                };
            }
            if (!resObj.ok) {
                return {
                    itemId: pc.itemId,
                    ok: false,
                    error: resObj.error,
                };
            }
            return {
                itemId: pc.itemId,
                ok: true,
                data: resObj.data,
            };
        });

        const succeeded = processedResults.filter((r) => r.ok).length;
        const failed = processedResults.length - succeeded;

        logger.info(
            { operationId, succeeded, failed, items: items.length },
            'auto_valid_region_batch_complete'
        );

        res.json({
            ok: true,
            message: `Batch processing complete: ${succeeded} succeeded, ${failed} failed`,
            results: processedResults,
            summary: {
                total: items.length,
                succeeded,
                failed,
            },
        });
    } catch (error) {
        console.error(`[auto-valid-region-batch] Error:`, error);
        res.status(500).json({ ok: false, error: String(error) });
    }
});

// Return cached/computed segmentation masks (normalized [0,1] polygon over each
// item's own width/height) for the given threat/non-threat item ids.
// Used so the frontend can attach masks *before* generating/placing objects (so
// random placement + out-of-bounds checks in the Customization page use the mask,
// i.e. a tight axis-aligned box) instead of only computing them at save time.
// Masks are cached in-process per item id so repeat requests are cheap.
const segmentationMaskCache = new Map(); // itemId -> points[]
async function getSegmentationMasksByIds(itemIds) {
    const allItems = await getItems();
    const itemMap = new Map(allItems.map((i) => [i.id, i]));

    // Resolve pixel-data paths only for ids we don't already have.
    const wanted = itemIds.filter((id) => id && !segmentationMaskCache.has(id));
    const byId = new Map(); // itemId -> { itemId, npzPath } | null (unresolvable)
    for (const id of wanted) {
        if (!id || byId.has(id)) continue;
        const item = itemMap.get(id);
        const relPath = await resolvePixelDataPath(id, item?.pixel_data_path || item?.pixelDataFilename || null);
        if (!relPath) {
            byId.set(id, null);
        } else {
            const joined = safeJoin(pixelDataRoot, relPath);
            if (!joined.safe || !(await fileExists(joined.fullPath))) {
                byId.set(id, null);
            } else {
                byId.set(id, { itemId: id, npzPath: joined.fullPath });
            }
        }
    }

    const tasks = [];
    for (const entry of byId.values()) {
        if (entry) tasks.push(entry);
    }
    if (tasks.length > 0) {
        const chunks = [];
        for (let i = 0; i < tasks.length; i += BATCH_FILES_PER_PROCESS) {
            chunks.push(tasks.slice(i, i + BATCH_FILES_PER_PROCESS));
        }
        for (const chunk of chunks) {
            let results = [];
            try {
                results = await generateValidRegionBatch(chunk);
            } catch (err) {
                console.warn(`[segmentation-masks] batch failed: ${err.message || err}`);
                results = [];
            }
            for (const r of results) {
                if (r && r.ok && Array.isArray(r.data?.points) && r.data.points.length >= 3) {
                    segmentationMaskCache.set(r.itemId, r.data.points);
                }
            }
        }
    }

    const masks = {};
    for (const id of itemIds) {
        const pts = segmentationMaskCache.get(id);
        if (pts) masks[id] = pts;
    }
    return masks;
}

// GET /api/items/segmentation-masks?ids=id1,id2,... — batch-compute masks for
// threat/non-threat items so the frontend can use them for placement.
app.get("/api/items/segmentation-masks", publicApiRateLimiter.middleware(), async (req, res) => {
    try {
        const raw = typeof req.query.ids === "string" ? req.query.ids : "";
        const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0) {
            return res.json({ ok: true, masks: {} });
        }
        const masks = await getSegmentationMasksByIds(ids);
        res.json({ ok: true, masks });
    } catch (err) {
        console.error("[segmentation-masks] Error:", err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// Update bag valid region (only supports points and simplifiedPoints)
app.put("/api/items/:id/valid-region", auditLog('update_valid_region'), requireAuth, async (req, res) => {
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
app.delete("/api/items/:id/valid-region", auditLog('delete_valid_region'), requireAuth, async (req, res) => {
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
                        if (parsed.status === 'error') {
                            reject(new Error(parsed.reason));
                        } else if (Array.isArray(parsed)) {
                            // ── Streaming format ──
                            // read_npz.py streams the raw pixel array on the
                            // last line: [[row0],[row1],...]
                            let width = 0;
                            let height = parsed.length;
                            try {
                                const meta = JSON.parse(lines[0]);
                                if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
                                    width = meta.width || (parsed[0] ? parsed[0].length : 0);
                                    height = meta.height || height;
                                }
                            } catch {
                                // fall through with dimensions derived from array
                            }
                            if (width === 0 && parsed[0]) width = parsed[0].length;
                            resolve({ pixel_data: parsed, width, height });
                        } else {
                            // ── Legacy object format (older scripts) ──
                            resolve(parsed);
                        }
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

// Helper: generate segmentation masks (outermost boundary polygon of non-white
// pixels, i.e. pixel value < 65535) for the THREAT objects across one or more
// layout objects, reusing the exact same valid-region mask generation pipeline
// that auto-assigns bag masks. The resulting polygon points are normalized to
// [0,1] and attached in place as `segmentationMask` on each threat.
//
// All threats across the provided layouts are batched into a SINGLE
// generateValidRegionBatch call (and identical item ids are generated once), so
// collage "Save Annotations" pages of ~100 combos stay efficient. No new
// dependencies and nothing is shown in the UI — masks are saved only.
async function attachThreatSegmentationMasks(layoutObjectsList) {
    const layoutObjects = Array.isArray(layoutObjectsList) ? layoutObjectsList : [];
    const allItems = await getItems();
    const itemMap = new Map(allItems.map((i) => [i.id, i]));

    // Collect every threat reference, deduping mask work by item id.
    const byId = new Map(); // itemId -> { itemId, npzPath } | null (unresolvable)
    const refs = []; // { itemId, threat }
    for (const objects of layoutObjects) {
        const threats = Array.isArray(objects?.threats) ? objects.threats : [];
        for (const t of threats) {
            if (!t || t.id == null) continue;
            // Reuse an existing mask so already-annotated threats are never recomputed.
            if (Array.isArray(t.segmentationMask) && t.segmentationMask.length >= 3) {
                continue;
            }
            if (!byId.has(t.id)) {
                const item = itemMap.get(t.id);
                const relPath = await resolvePixelDataPath(t.id, item?.pixel_data_path || item?.pixelDataFilename || null);
                if (!relPath) {
                    byId.set(t.id, null);
                } else {
                    const joined = safeJoin(pixelDataRoot, relPath);
                    if (!joined.safe || !(await fileExists(joined.fullPath))) {
                        byId.set(t.id, null);
                    } else {
                        byId.set(t.id, { itemId: t.id, npzPath: joined.fullPath });
                    }
                }
            }
            refs.push({ itemId: t.id, threat: t });
        }
    }

    // Gather the tasks we actually need to compute (deduped by item id).
    const tasks = [];
    for (const entry of byId.values()) {
        if (entry) tasks.push(entry);
    }
    // Bound the work each python child does to BATCH_FILES_PER_PROCESS files so a
    // very large Save All (thousands of layouts) never floods a single interpreter.
    const maskById = new Map();
    if (tasks.length > 0) {
        const chunks = [];
        for (let i = 0; i < tasks.length; i += BATCH_FILES_PER_PROCESS) {
            chunks.push(tasks.slice(i, i + BATCH_FILES_PER_PROCESS));
        }
        for (const chunk of chunks) {
            let results = [];
            try {
                results = await generateValidRegionBatch(chunk);
            } catch (err) {
                console.warn(`[saved-layouts] Segmentation mask batch failed: ${err.message || err}`);
                results = [];
            }
            for (const r of results) {
                if (r && r.ok && Array.isArray(r.data?.points) && r.data.points.length >= 3) {
                    maskById.set(r.itemId, r.data.points);
                } else if (r && !r.ok) {
                    console.warn(`[saved-layouts] Segmentation mask skipped for ${r.itemId}: ${r.error || 'unknown'}`);
                }
            }
        }
    }

    // Attach the computed mask points to each threat in place (existing masks, if
    // any, were already kept intact during collection).
    for (const ref of refs) {
        const mask = maskById.get(ref.itemId);
        if (mask && Array.isArray(mask)) ref.threat.segmentationMask = mask;
    }
}

// Tiny helper: true when the file exists at the given path.
async function fileExists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

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
app.post("/api/render-and-save-collage", strictRateLimiter.middleware(), requireAuth, async (req, res) => {
    try {
        const { objects, name, energyType = "highenergy" } = req.body;
        if (!objects || !Array.isArray(objects) || objects.length === 0) {
            return res.status(400).json({ ok: false, error: "Missing or invalid objects array" });
        }
        if (!name) {
            return res.status(400).json({ ok: false, error: "Missing name" });
        }

        // Use the user-configured collage exports path (or fall back to default)
        const collageRoot = await getExportsPath('collage');
        const collageHighRoot = path.join(collageRoot, 'high');
        const collageLowRoot = path.join(collageRoot, 'low');
        
        await fs.mkdir(collageHighRoot, { recursive: true });
        await fs.mkdir(collageLowRoot, { recursive: true });

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
app.post("/api/render-and-save-collage-both", strictRateLimiter.middleware(), requireAuth, async (req, res) => {
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
            const collageRoot = await getExportsPath('collage');
            const result = validateClientOutputPath(outputPath, collageRoot, collageRoot);
            if (!result.safe) {
                return res.status(400).json({ ok: false, error: result.error });
            }
            highEnergyDir = path.join(result.resolvedRoot, 'high');
            lowEnergyDir = path.join(result.resolvedRoot, 'low');
            await fs.mkdir(highEnergyDir, { recursive: true });
            await fs.mkdir(lowEnergyDir, { recursive: true });
        } else {
            // Use the user-configured collage exports path (or fall back to default)
            const collageRoot = await getExportsPath('collage');
            highEnergyDir = path.join(collageRoot, 'high');
            lowEnergyDir = path.join(collageRoot, 'low');
            
            await fs.mkdir(highEnergyDir, { recursive: true });
            await fs.mkdir(lowEnergyDir, { recursive: true });
        }

        // Enrich objects separately for each energy type to ensure correct pixel data paths
        const highEnergyObjects = await enrichObjectsWithPixelData(objects);
        const lowEnergyObjects = await enrichObjectsWithPixelData(objects);
        
        // Update low energy objects to use lowenergy paths
        for (const obj of lowEnergyObjects) {
            if (obj.pixel_data_path) {
                obj.pixel_data_path = obj.pixel_data_path.replace(/^highenergy[\\/]/, "lowenergy/");
            }
        }

        const highPngBuffer = await renderSceneAsync(highEnergyObjects, 800, 600, "highenergy");
        const highPath = path.join(highEnergyDir, filename);
        const lowPngBuffer = await renderSceneAsync(lowEnergyObjects, 800, 600, "lowenergy");
        const lowPath = path.join(lowEnergyDir, filename);

        try {
          await fs.writeFile(highPath, highPngBuffer);
          await fs.writeFile(lowPath, lowPngBuffer);
        } catch (err) {
          try { await fs.unlink(highPath); } catch { /* ignore cleanup errors */ }
          try { await fs.unlink(lowPath); } catch { /* ignore cleanup errors */ }
          throw err;
        }

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

// Regenerate collage images from layout JSON (for portability - no need to carry image files)
// Returns base64-encoded PNG images that can be used directly in the frontend
app.post("/api/regenerate-collage-images", strictRateLimiter.middleware(), requireAuth, async (req, res) => {
    try {
        const { layout_json, layoutId, saveToDisk = false, outputPath } = req.body;

        // Support both direct layout_json and layoutId lookup
        let objects;
        let layoutName;

        if (layout_json?.objects) {
            objects = layout_json.objects;
            layoutName = layout_json.name || 'regenerated';
        } else if (layoutId) {
            // Fetch layout from database
            const layout = await getSavedLayoutById(layoutId);
            if (!layout) {
                return res.status(404).json({ ok: false, error: "Layout not found" });
            }
            objects = layout.layout_json?.objects;
            layoutName = layout.name || 'regenerated';
        } else {
            return res.status(400).json({ ok: false, error: "Missing layout_json or layoutId" });
        }

        if (!objects) {
            return res.status(400).json({ ok: false, error: "No objects found in layout" });
        }

        // Flatten objects array (bag, threats, non-threats)
        const flatObjects = [];
        if (objects.bag) {
            flatObjects.push({
                ...objects.bag,
                transform: {
                    x: objects.bag.center?.x || 0,
                    y: objects.bag.center?.y || 0,
                    width: objects.bag.size?.width || 800,
                    height: objects.bag.size?.height || 600,
                    rotation: 0,
                },
                layer: objects.bag.layer || 0,
            });
        }
        if (Array.isArray(objects.threats)) {
            for (const t of objects.threats) {
                flatObjects.push({
                    ...t,
                    transform: {
                        x: t.center?.x || 0,
                        y: t.center?.y || 0,
                        width: t.size?.width || 120,
                        height: t.size?.height || 60,
                        rotation: t.rotation || 0,
                    },
                    layer: t.layer || 1,
                });
            }
        }
        if (Array.isArray(objects['non-threats'])) {
            for (const nt of objects['non-threats']) {
                flatObjects.push({
                    ...nt,
                    transform: {
                        x: nt.center?.x || 0,
                        y: nt.center?.y || 0,
                        width: nt.size?.width || 80,
                        height: nt.size?.height || 80,
                        rotation: nt.rotation || 0,
                    },
                    layer: nt.layer || 1,
                });
            }
        }

        if (flatObjects.length === 0) {
            return res.status(400).json({ ok: false, error: "No valid objects to render" });
        }

        // Enrich objects with pixel data paths
        const enrichedObjects = await enrichObjectsWithPixelData(flatObjects);

        // Prepare energy-specific object sets
        const highEnergyObjects = enrichedObjects;
        const lowEnergyObjects = enrichedObjects.map(obj => {
            if (obj.pixel_data_path) {
                return {
                    ...obj,
                    pixel_data_path: obj.pixel_data_path.replace(/^highenergy[\\/]/, "lowenergy/")
                };
            }
            return obj;
        });

        // Render both energy types
        const [highPngBuffer, lowPngBuffer] = await Promise.all([
            renderSceneAsync(highEnergyObjects, 800, 600, "highenergy"),
            renderSceneAsync(lowEnergyObjects, 800, 600, "lowenergy")
        ]);

        // Convert to base64 for easy transport
        const highBase64 = highPngBuffer.toString('base64');
        const lowBase64 = lowPngBuffer.toString('base64');

        const response = {
            ok: true,
            layoutName,
            high_image: `data:image/png;base64,${highBase64}`,
            low_image: `data:image/png;base64,${lowBase64}`,
        };

        // Optionally save to disk
        if (saveToDisk) {
            const safeName = layoutName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
            const filename = `${safeName}.png`;

            let highEnergyDir, lowEnergyDir;

            if (outputPath && typeof outputPath === 'string') {
                const result = validateClientOutputPath(outputPath, collageImagesRoot, collageImagesRoot);
                if (!result.safe) {
                    return res.status(400).json({ ok: false, error: result.error });
                }
                highEnergyDir = path.join(result.resolvedRoot, 'high');
                lowEnergyDir = path.join(result.resolvedRoot, 'low');

                await fs.mkdir(highEnergyDir, { recursive: true });
                await fs.mkdir(lowEnergyDir, { recursive: true });
            } else {
                highEnergyDir = collageHighRoot;
                lowEnergyDir = collageLowRoot;
            }

            await fs.writeFile(path.join(highEnergyDir, filename), highPngBuffer);
            await fs.writeFile(path.join(lowEnergyDir, filename), lowPngBuffer);

            response.savedTo = {
                filename,
                high_path: path.join(highEnergyDir, filename),
                low_path: path.join(lowEnergyDir, filename),
            };
        }

        res.json(response);
    } catch (err) {
        console.error("[regenerate-collage-images] Error:", err);
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
app.post('/api/render-preview', strictRateLimiter.middleware(), requireAuth, async (req, res) => {
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
    server.timeout = 1800000;          // 30 minutes — bulk Save All (1000s of layouts) exceeds 5 min
    server.requestTimeout = 1800000;   // 30 minutes
}

export default app;
