
import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import pg from "pg";
import { generateDataset } from "./api/datasetGenerator.js";
import { isObjectInsideContainer } from "./lib/geometry.js";
import { loadImage } from "canvas";

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exportsRoot = path.resolve(__dirname, "../data/exports");
const libraryImagesRoot = path.resolve(__dirname, "../data/library_images");
const collageImagesRoot = path.resolve(__dirname, "../data/collage_images");

// Ensure directories exist
await fs.mkdir(exportsRoot, { recursive: true });
await fs.mkdir(libraryImagesRoot, { recursive: true });
await fs.mkdir(collageImagesRoot, { recursive: true });

// Serve static files from data directory
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

// PostgreSQL connection
const pool = new pg.Pool({
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "xray_db",
  password: process.env.PGPASSWORD || "SaiKiran2166",
  port: process.env.PGPORT || 5432,
});

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

// Helper to extract name and subcategory from filename (fallback)
function parseFilename(filename) {
  const nameWithoutExt = path.basename(filename, path.extname(filename));
  const parts = nameWithoutExt.split(/[_-]/);
  
  let subcategory = "General";
  let name = nameWithoutExt;
  
  if (parts.length > 1) {
    subcategory = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
    name = parts.slice(2).join(' ') || subcategory;
  }
  
  return { subcategory, name: name.charAt(0).toUpperCase() + name.slice(1) };
}

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    const schema = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
    await client.query(schema);
    await client.query("ALTER TABLE items ADD COLUMN IF NOT EXISTS polygon_json JSONB");
    await client.query("ALTER TABLE items ADD COLUMN IF NOT EXISTS mask_path VARCHAR(255)");
    console.log("Database schema initialized and migrated");

  } catch (err) {
    console.error("Error initializing database schema:", err);
  } finally {
    client.release();
  }
}

// ------------------------------
// API endpoints
// ------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "synthetic-xray-backend" });
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
    await generateDataset(payload, exportId, outDir);

    res.json({
      ok: true,
      message: "Synthesis export saved to disk.",
      exportId,
      outputDir: outDir,
      files: ["metadata.json", "summary.txt", "images/" + exportId + ".png", "labels/" + exportId + ".json"],
    });
  } catch (error) {
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

    const result = await generateDataset(payload, datasetId, outDir);

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
      const client = await pool.connect();
      try {
        const itemsResult = await client.query("SELECT * FROM items ORDER BY created_at DESC");
        const items = itemsResult.rows;
        
        // Organize items into categories and subcategories
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
            const bagResult = await client.query("SELECT valid_region_points FROM bags WHERE item_id = $1", [item.id]);
            const data = bagResult.rows[0]?.valid_region_points;
            // For backward compatibility, pass the simplified points if available
            if (data && typeof data === 'object' && 'simplifiedPoints' in data) {
              item.valid_region_points = data.simplifiedPoints;
              // Store full data in a separate field for future use
              item.validRegionData = data;
            } else {
              item.valid_region_points = data;
            }
          }
          
          categorized[normalizedCategory][subcat].push(item);
        }
        
        res.json({ ok: true, categorized });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

// Saved layouts endpoints
app.get('/api/saved-layouts', async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM saved_layouts ORDER BY created_at DESC');
      res.json({ ok: true, layouts: result.rows });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post('/api/saved-layouts', async (req, res) => {
  const { name, filepath, layout_json } = req.body;
  if (!name || !layout_json) return res.status(400).json({ ok: false, error: 'Missing name or layout_json' });
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('INSERT INTO saved_layouts (name, filepath, layout_json) VALUES ($1,$2,$3) RETURNING *', [name, filepath || null, layout_json]);
      res.json({ ok: true, layout: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/saved-layouts/:id', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM saved_layouts WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
      res.json({ ok: true, layout: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.delete('/api/saved-layouts/:id', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM saved_layouts WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Sessions are removed: items are fetched directly from `items` and related tables

// Upload endpoint
app.post("/api/upload", upload.array("images"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

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

    // No upload sessions: insert items directly into `items` table

    for (const file of files) {
      // Classify by filename prefix only
      const filename = file.originalname.toLowerCase();
      let category, subcategory, name, pixelValue;

      if (filename.startsWith("bag")) {
        category = "bags";
        pixelValue = 42000 + Math.floor(Math.random() * 10000);
      } else if (filename.startsWith("threat")) {
        category = "threats";
        pixelValue = 10000 + Math.floor(Math.random() * 10000);
      } else {
        category = "non-threats";
        pixelValue = 32767;
      }
      const parsed = parseFilename(file.originalname);
      subcategory = parsed.subcategory;
      name = parsed.name;

      // If metadata provided for this file, allow overrides and extra data
      const fileMeta = metadataByName[file.originalname] || {};
      if (fileMeta.category) {
        category = fileMeta.category;
      }
      if (fileMeta.subcategory) subcategory = fileMeta.subcategory;
      if (fileMeta.name) name = fileMeta.name;
      if (fileMeta.valid_region_points) {
        // keep this around for bag-specific inserts
        // use the final category after metadata overrides
      }

      // Detect actual image dimensions from the saved file
      let imgWidth = 512;
      let imgHeight = 512;
      try {
        const savedFilePath = path.join(libraryImagesRoot, file.filename);
        const loadedImg = await loadImage(savedFilePath);
        imgWidth = loadedImg.width;
        imgHeight = loadedImg.height;
      } catch (dimErr) {
        console.warn("Warning: could not detect image dimensions for", file.filename, dimErr);
      }

      const itemResult = await client.query(
        "INSERT INTO items (filename, filepath, category, subcategory, name, pixel_value, width, height) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        [file.originalname, file.filename, category, subcategory, name, pixelValue, imgWidth, imgHeight]
      );
      const item = itemResult.rows[0];

      if (category === "bags") {
        const vr = fileMeta.valid_region_points ? fileMeta.valid_region_points : null;
        await client.query("INSERT INTO bags (item_id, valid_region_points) VALUES ($1, $2)", [item.id, vr]);
      } else if (category === "threats") {
        await client.query("INSERT INTO threats (item_id, threat_type, severity) VALUES ($1, NULL, NULL)", [item.id]);
      } else {
        // All other categories are treated as non-threats
        const subSlug = subcategory ? String(subcategory).toLowerCase().replace(/\s+/g, "-") : null;
        await client.query("INSERT INTO non_threat_items (item_id, subcategory_slug) VALUES ($1, $2)", [item.id, subSlug]);
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, message: "Files uploaded successfully!", itemsProcessed: files.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    client.release();
  }
});

// Session deletion removed; files should be managed individually if needed

// Update item metadata
app.put("/api/items/:id", async (req, res) => {
  try {
    const { category, subcategory, name } = req.body;
    if (!category || !subcategory || !name) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE items SET category = $1, subcategory = $2, name = $3 WHERE id = $4",
        [category, subcategory, name, req.params.id]
      );
      res.json({ ok: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Delete an individual item
app.delete("/api/items/:id", async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const itemResult = await client.query("SELECT filepath FROM items WHERE id = $1", [req.params.id]);
      if (itemResult.rows.length > 0) {
        try {
          await fs.unlink(path.join(libraryImagesRoot, itemResult.rows[0].filepath));
        } catch (err) {
          console.error("Error deleting file:", err);
        }
      }
      await client.query("DELETE FROM items WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Update bag valid region (supports both simple points and complex shapes)
  app.put("/api/items/:id/valid-region", async (req, res) => {
    try {
      const { validRegionPoints, shapes } = req.body;
      const client = await pool.connect();
      try {
        // Store a structured object for maximum flexibility
        const dataToStore = {
          shapes,
          simplifiedPoints: validRegionPoints,
          version: 2
        };
        await client.query("UPDATE bags SET valid_region_points = $1 WHERE item_id = $2", [dataToStore, req.params.id]);
        res.json({ ok: true });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Delete bag valid region (set to null)
  app.delete("/api/items/:id/valid-region", async (req, res) => {
    try {
      const client = await pool.connect();
      try {
        await client.query("UPDATE bags SET valid_region_points = $1 WHERE item_id = $2", [null, req.params.id]);
        res.json({ ok: true });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Get item details (including valid region for bags)
  app.get("/api/items/:id", async (req, res) => {
    try {
      const client = await pool.connect();
      try {
        const itemResult = await client.query("SELECT * FROM items WHERE id = $1", [req.params.id]);
        if (itemResult.rows.length === 0) {
          return res.status(404).json({ ok: false, error: "Item not found" });
        }
        const item = itemResult.rows[0];
        
        if (item.category === "bags") {
          const bagResult = await client.query("SELECT * FROM bags WHERE item_id = $1", [item.id]);
          const data = bagResult.rows[0]?.valid_region_points;
          // For backward compatibility, pass the simplified points if available
          if (data && typeof data === 'object' && 'simplifiedPoints' in data) {
            item.validRegionPoints = data.simplifiedPoints;
            // Also pass full data
            item.validRegionData = data;
          } else {
            item.validRegionPoints = data;
          }
        }
        
        res.json({ ok: true, item });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

const port = process.env.PORT ? Number(process.env.PORT) : 8080;

initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`[backend] listening on http://localhost:${port}`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
});

export default app;
