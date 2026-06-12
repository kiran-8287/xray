
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

// Load taxonomy
let taxonomy = [];
try {
  const taxonomyData = await fs.readFile(path.join(__dirname, "../../taxonomy.json"), "utf8");
  taxonomy = JSON.parse(taxonomyData);
} catch (err) {
  console.warn("Warning: taxonomy.json not found, will use filename parsing as fallback");
}

// Create a map from filename to taxonomy item for quick lookup
const filenameToItem = new Map();
for (const category of taxonomy) {
  for (const subcategory of category.subcategories) {
    for (const item of subcategory.items) {
      filenameToItem.set(item.filename.toLowerCase(), {
        ...item,
        displayCategory: category.name,
        displaySubcategory: subcategory.name
      });
    }
  }
}

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

// Get taxonomy
app.get("/api/taxonomy", async (_req, res) => {
  try {
    res.json({ ok: true, taxonomy });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
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

// Helper to normalize category name
function normalizeCategory(cat) {
  const normalized = cat.toLowerCase();
  if (["misc", "sports", "stationery", "lag"].includes(normalized)) {
    return "miscellaneous";
  }
  return normalized;
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

// Get all upload sessions with their items
app.get("/api/sessions", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const sessionsResult = await client.query("SELECT * FROM upload_sessions ORDER BY uploaded_at DESC");
      const sessions = sessionsResult.rows;
      
      for (const session of sessions) {
        const itemsResult = await client.query("SELECT * FROM items WHERE upload_session_id = $1", [session.id]);
        session.items = itemsResult.rows;
      }
      
      res.json({ ok: true, sessions });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Upload endpoint
app.post("/api/upload", upload.array("images"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { folderName, description = "" } = req.body;
    const files = req.files;

    const sessionResult = await client.query(
      "INSERT INTO upload_sessions (folder_name, uploaded_at, item_count) VALUES ($1, NOW(), $2) RETURNING *",
      [folderName, files.length]
    );
    const uploadSession = sessionResult.rows[0];

    for (const file of files) {
      // First try to find item in taxonomy by filename
      const taxonomyItem = filenameToItem.get(file.originalname.toLowerCase());
      
      let category, subcategory, name, pixelValue;
      
      if (taxonomyItem) {
        category = taxonomyItem.category;
        subcategory = taxonomyItem.subcategory;
        name = taxonomyItem.name;
        pixelValue = 32767;
      } else {
        // Fallback to filename parsing
        const filename = file.originalname.toLowerCase();
        if (filename.startsWith("bag")) {
          category = "bags";
          pixelValue = 42000 + Math.floor(Math.random() * 10000);
        } else if (filename.startsWith("threat")) {
          category = "threats";
          pixelValue = 10000 + Math.floor(Math.random() * 10000);
        } else if (filename.startsWith("tray")) {
          category = "trays";
          pixelValue = 50000 + Math.floor(Math.random() * 10000);
        } else if (filename.startsWith("cloth")) {
          category = "clothes";
          pixelValue = 30000 + Math.floor(Math.random() * 15000);
        } else if (filename.startsWith("electronics")) {
          category = "electronics";
          pixelValue = 15000 + Math.floor(Math.random() * 15000);
        } else if (filename.startsWith("food")) {
          category = "food";
          pixelValue = 35000 + Math.floor(Math.random() * 15000);
        } else {
          category = "misc";
          pixelValue = 32767;
        }
        const parsed = parseFilename(file.originalname);
        subcategory = parsed.subcategory;
        name = parsed.name;
      }

      const itemResult = await client.query(
        "INSERT INTO items (filename, filepath, category, subcategory, name, upload_session_id, pixel_value) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
        [file.originalname, file.filename, category, subcategory, name, uploadSession.id, pixelValue]
      );
      const item = itemResult.rows[0];

      if (category === "bags") {
        await client.query("INSERT INTO bags (item_id, valid_region_points) VALUES ($1, NULL)", [item.id]);
      } else if (category === "threats") {
        await client.query("INSERT INTO threats (item_id, threat_type, severity) VALUES ($1, NULL, NULL)", [item.id]);
      } else if (category === "electronics") {
        await client.query("INSERT INTO electronics (item_id, device_type) VALUES ($1, NULL)", [item.id]);
      } else if (category === "clothes") {
        await client.query("INSERT INTO clothes (item_id, garment_type) VALUES ($1, NULL)", [item.id]);
      } else if (category === "trays") {
        await client.query("INSERT INTO trays (item_id, tray_type) VALUES ($1, NULL)", [item.id]);
      }
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      message: "Files uploaded successfully!",
      uploadSessionId: uploadSession.id,
      itemsProcessed: files.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    client.release();
  }
});

// Delete a session
app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const itemsResult = await client.query("SELECT filepath FROM items WHERE upload_session_id = $1", [req.params.id]);
      for (const item of itemsResult.rows) {
        try {
          await fs.unlink(path.join(libraryImagesRoot, item.filepath));
        } catch (err) {
          console.error("Error deleting file:", err);
        }
      }
      await client.query("DELETE FROM upload_sessions WHERE id = $1", [req.params.id]);
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
