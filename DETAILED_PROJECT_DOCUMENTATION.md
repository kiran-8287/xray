# Synthetic X-Ray Bag Scan Generation System — Complete Project Documentation

---

## Table of Contents

1. [What Are We Building? (High-Level Overview)](#1-what-are-we-building)
2. [Why Does This Project Exist?](#2-why-does-this-project-exist)
3. [Project Structure & Architecture](#3-project-structure--architecture)
4. [Technology Stack & Why We Chose It](#4-technology-stack--why-we-chose-it)
5. [Complete File-by-File Breakdown (Folder by Folder)](#5-complete-file-by-file-breakdown)
6. [Database Schema Deep Dive](#6-database-schema-deep-dive)
7. [The Valid Region System — Full Mathematical Explanation](#7-the-valid-region-system--full-mathematical-explanation)
8. [How Objects Are Made Unique & Inserted (Frontend ↔ Backend ↔ DB)](#8-how-objects-are-made-unique--inserted)
9. [All APIs — Complete Reference](#9-all-apis--complete-reference)
10. [The Beer-Lambert X-Ray Rendering Physics](#10-the-beer-lambert-x-ray-rendering-physics)
11. [End-to-End Walkthrough: Uploading, Drawing, Customizing, Saving](#11-end-to-end-walkthrough)
12. [Data Synthesis Scripts](#12-data-synthesis-scripts)

---

## 1. What Are We Building? (High-Level Overview)

This project is a **Synthetic X-Ray Image Generation System** — a web-based tool that generates realistic simulated X-ray scan images of bags containing various objects (clothing, electronics, food, threats like firearms/knives). These synthetic X-ray scans, complete with bounding box and segmentation annotations, are used to **train machine learning models** (YOLO, custom segmentation networks) for security baggage screening at airports.

### The Core Workflow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│  Upload      │────▶│  Library     │────▶│  Collage         │────▶│ Customization │────▶│  Saved       │
│  Images      │     │  Organize    │     │  Generate Combos │     │  Fine-tune    │     │  Layouts     │
└─────────────┘     └──────────────┘     └─────────────────┘     └──────────────┘     └──────────────┘
     │                    │                      │                      │                     │
     │                    │                      │                      │                     │
  Backend stores      User browses/         System creates        User drags/rotates     Saved to DB as
  files to disk +     selects items for      all permutations     objects on canvas,      JSON layout for
  metadata to DB      combination           (bag × threat ×      Beer-Lambert physics    re-use or batch
                                             others)              renders in real-time    export
```

**In plain English:** A security researcher uploads X-ray images of bags, threats, and non-threat objects into a library. The system automatically generates all possible combinations (which bag + which threat + which other objects), lets the user visually arrange them on a canvas with realistic X-ray physics, and saves the results as annotated training data for ML models.

---

## 2. Why Does This Project Exist?

Airport security X-ray scanners produce grayscale images where different materials absorb X-rays differently. Training AI to detect threats in these images requires large labeled datasets. Collecting real X-ray scans with threats is:
- **Expensive** (requires controlled environments)
- **Limited** (can't scan actual weapons freely)
- **Privacy-sensitive** (real passenger bags)

This system solves the problem by **synthesizing** realistic X-ray composites from individual scanned objects, using the **Beer-Lambert attenuation law** (the actual physics equation that governs X-ray absorption). The result: unlimited training data with perfect ground-truth annotations.

---

## 3. Project Structure & Architecture

```
xray1/                              # Root project directory
├── package.json                    # Root monorepo package (orchestrates frontend + backend)
├── README.md                       # Project readme
├── PROJECT_DOCUMENTATION.md        # Previous documentation
├── implementation_plan.md          # Implementation roadmap
├── taxonomy.json                   # Master taxonomy: all object categories, subcategories, items
├── check-taxonomy.js               # Utility to validate taxonomy.json
├── reorder-taxonomy.js             # Utility to reorder taxonomy.json entries
├── xray_scanner_object_taxonomy.html # Visual HTML taxonomy viewer
├── meeting.txt                     # Meeting notes
│
├── backend/                        # Node.js + Express + PostgreSQL backend
│   ├── package.json
│   ├── src/
│   │   ├── server.js               # Main Express server (760 lines, 18+ API endpoints)
│   │   ├── schema.sql              # PostgreSQL schema (9 tables)
│   │   ├── taxonomy.js             # Full taxonomy reference data (~3270 lines)
│   │   ├── api/
│   │   │   └── datasetGenerator.js # Generates PNG composites + JSON annotations
│   │   └── lib/
│   │       ├── geometry.js         # Server-side geometry (point-in-polygon, transforms)
│   │       └── renderCanvas.js     # Server-side canvas rendering (node-canvas, Beer-Lambert)
│   ├── data/
│   │   ├── library_images/         # Uploaded image files stored here
│   │   ├── exports/                # Single-image export outputs
│   │   ├── collage_images/         # Batch-generated collage outputs
│   │   └── customization_exports/  # Customization page exports
│   ├── designed_images/            # Pre-designed test images (currently empty)
│   └── scripts/                    # Build/seed scripts
│
├── frontend/                       # React + TypeScript + Vite frontend
│   ├── package.json
│   ├── index.html                  # SPA entry point
│   ├── vite.config.ts              # Vite dev server config (port 5174)
│   ├── tsconfig.json               # TypeScript config
│   ├── tailwind.config.js          # Tailwind CSS with custom design tokens
│   ├── postcss.config.js           # PostCSS config
│   ├── eslint.config.js            # ESLint config
│   └── src/
│       ├── main.tsx                # React 18 entry point
│       ├── App.tsx                 # Root component with routing
│       ├── index.css               # Tailwind + custom CSS animations
│       ├── pages/                  # 5 main pages
│       │   ├── UploadPage.tsx      # File upload with valid region editor
│       │   ├── LibraryPage.tsx     # Browse/search/select items
│       │   ├── CollagePage.tsx     # View & export generated combinations
│       │   ├── CustomizationPage.tsx # Interactive canvas editor
│       │   └── SavedPage.tsx       # View saved layouts
│       ├── components/             # Reusable UI components
│       │   ├── upload/             # Upload-related components
│       │   ├── customization/      # Canvas editor components
│       │   ├── library/            # Library browsing components
│       │   ├── collage/            # Collage preview components
│       │   └── ValidRegionEditor.tsx # Shape-drawing editor for valid regions
│       ├── lib/                    # Core logic
│       │   ├── xrayRenderer.ts     # Frontend Beer-Lambert rendering (canvas API)
│       │   ├── geometry.ts         # Geometry utilities (point-in-polygon, transforms)
│       │   ├── customizationHelpers.ts # Object placement + pixel value calculation
│       │   └── api.ts              # API helper functions
│       ├── types/                  # TypeScript type definitions
│       │   ├── customization.ts    # SceneObject type
│       │   ├── geometry.ts         # Point type
│       │   └── library.ts          # Item, Taxonomy types
│       ├── stencils/               # Stencil type system
│       │   └── types.ts            # StencilKind, StencilId types
│       ├── config/                 # Configuration
│       │   └── categories.ts       # Category styles, normalization, mapping
│       └── hooks/                  # Custom React hooks
│
└── data_synthesis/                 # Python scripts for preparing raw X-ray data
    ├── dumpread.py                 # Read .dump files (raw X-ray scanner format)
    ├── extract_tips.py             # Extract threat items from .tip files
    ├── convert_tips_to_png.py      # Convert .tip files to PNG images
    ├── fix_threat_dimensions.py    # Resize threat images to standard dimensions
    ├── check_tip.py                # Validate .tip file format
    ├── bags_easy/                  # Easy bag scan files (.dump, .pgm, .png)
    ├── bags_medium/                # Medium difficulty bag scans
    ├── bags_hard/                  # Hard bag scans
    ├── guns/                       # Gun threat images
    └── knife/                      # Knife threat images
```

### Why This Structure?

**Monorepo with clear separation:** The frontend and backend are separate npm packages within one repository. This allows:
- Independent dependency management
- Clear API boundary between frontend and backend
- Easy deployment (each can be deployed separately)

**Backend stores files on disk, metadata in PostgreSQL:** Images are stored as actual files in `data/library_images/` because they need to be served as static files and processed by the canvas rendering engine. Metadata (category, pixel values, valid regions) lives in PostgreSQL for fast querying.

**Frontend is a SPA with 5 pages matching the workflow:** Each page corresponds to one step in the pipeline, making the user journey intuitive.

---

## 4. Technology Stack & Why We Chose It

### Backend
| Technology | Purpose | Why |
|---|---|---|
| **Node.js + Express** | HTTP server, REST API | Fast prototyping, JavaScript ecosystem, async I/O for file operations |
| **PostgreSQL** | Database | JSONB support for flexible valid region storage, mature, reliable |
| **pg (node-postgres)** | PostgreSQL client | Standard, well-documented Node.js PostgreSQL driver |
| **Multer** | File upload handling | Standard Express middleware for multipart/form-data |
| **node-canvas** | Server-side canvas rendering | Allows running the same Beer-Lambert rendering on the server for batch export |
| **uuid** | Unique ID generation | Every item gets a UUID primary key for global uniqueness |

### Frontend
| Technology | Purpose | Why |
|---|---|---|
| **React 18** | UI framework | Component-based architecture, hooks for state management |
| **TypeScript** | Type safety | Catches errors at compile time, better IDE support |
| **Vite** | Build tool & dev server | Fast HMR, modern bundling, native ESM |
| **Tailwind CSS** | Styling | Utility-first, rapid UI development, consistent design |
| **React Router 7** | Client-side routing | Standard SPA routing between pages |
| **HTML Canvas API** | X-ray rendering | Browser-native, performant pixel manipulation for Beer-Lambert physics |
| **Lucide React** | Icons | Lightweight, consistent icon set |

### Why not Python/Django/Flask?
The frontend rendering happens in the browser using the Canvas API, so JavaScript is the natural choice. The backend also needs to render images for batch export, and `node-canvas` provides that capability. Using one language across the stack reduces cognitive overhead.

### Why PostgreSQL over SQLite/MongoDB?
The valid region data is stored as JSONB (JSON Binary), which PostgreSQL handles natively with efficient indexing. The relational schema (items → bags, items → threats) benefits from foreign key constraints. MongoDB would work too, but PostgreSQL's JSONB gives us the best of both worlds: relational integrity + flexible document storage.

---

## 5. Complete File-by-File Breakdown

### 5.1 Root-Level Files

#### `package.json`
- **Name:** `synthetic-xray-prototype`
- **Purpose:** Monorepo orchestrator. Defines scripts that delegate to frontend/backend:
  - `npm run dev` → starts both frontend and backend concurrently
  - `npm run dev:frontend` → starts Vite dev server on port 5174
  - `npm run dev:backend` → starts Express server on port 8080
  - `npm run build` → builds frontend for production
- **No dependencies** — this is just a script runner

#### `taxonomy.json`
- **Purpose:** Master reference data defining all object categories, subcategories, and individual items
- **Structure:** Array of category objects, each containing subcategories, each containing items with filenames
- **Used by:** Backend loads this at startup to build a `filenameToItem` map for auto-classifying uploaded files

#### `check-taxonomy.js` / `reorder-taxonomy.js`
- **Purpose:** Utility scripts for validating and reordering `taxonomy.json`
- **Usage:** `node check-taxonomy.js` to validate structure, `node reorder-taxonomy.js` to sort entries

#### `xray_scanner_object_taxonomy.html`
- **Purpose:** Visual HTML page that renders the taxonomy as an interactive tree view
- **Usage:** Open in browser to visually inspect the taxonomy hierarchy

---

### 5.2 Backend Files (`backend/`)

#### `backend/package.json`
- **Name:** `synthetic-xray-backend`
- **Type:** `"module"` (ESM imports)
- **Key dependencies:** express, cors, multer, pg, uuid, canvas
- **Key scripts:**
  - `dev` / `start` — runs `src/server.js`
  - `seed` — seeds taxonomy into database
  - `generate-predefined-stencils` — generates 29 SVG stencil files

#### `backend/src/server.js` (760 lines) — THE MAIN SERVER

This is the heart of the backend. Here's what it does:

**Startup Sequence:**
1. Creates Express app with CORS and JSON body parsing (12MB limit for large payloads)
2. Sets up static file serving: `app.use('/data', express.static('data'))` — this is how the frontend accesses uploaded images
3. Loads `taxonomy.json` and builds a `filenameToItem` Map for O(1) filename lookups
4. Connects to PostgreSQL database (`xray_db`)
5. Sets up Multer for file uploads (stores files with UUID filenames to `data/library_images/`)
6. Creates required directories (`exports/`, `library_images/`, `collage_images/`)
7. Initializes database schema by running `schema.sql`
8. Seeds default categories: "bags", "threats", "non-threats"
9. Starts listening on port 8080

**API Endpoints (18+):**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/taxonomy` | GET | Get merged taxonomy (file + DB) |
| `/api/upload` | POST | Upload images with metadata |
| `/api/items/categorized` | GET | Get all items organized by category/subcategory |
| `/api/items/:id` | GET | Get single item details |
| `/api/items/:id` | PUT | Update item metadata |
| `/api/items/:id` | DELETE | Delete an item and its file |
| `/api/items/:id/valid-region` | PUT | Update bag's valid region |
| `/api/items/:id/valid-region` | DELETE | Clear bag's valid region |
| `/api/categories` | POST | Create a new category |
| `/api/subcategories` | POST | Create a new subcategory |
| `/api/subcategories/:cat/:slug` | GET | Get subcategory details |
| `/api/subcategories/:cat/:slug` | PUT | Update subcategory valid region |
| `/api/saved-layouts` | GET | List all saved layouts |
| `/api/saved-layouts` | POST | Save a new layout |
| `/api/saved-layouts/:id` | GET | Get single saved layout |
| `/api/saved-layouts/:id` | DELETE | Delete a saved layout |
| `/api/export` | POST | Export single custom composite |
| `/api/dataset/generate` | POST | Batch generate dataset from combinations |

**Upload Flow in Detail (`POST /api/upload`):**
1. Multer receives files, saves each with a UUID filename to `data/library_images/`
2. For each file, tries to find it in `taxonomy.json` by original filename
3. If not found, uses filename prefix heuristics (starts with "bag" → bags, etc.)
4. Allows metadata overrides from the request body
5. Detects actual image dimensions using `node-canvas` `loadImage()`
6. Inserts row into `items` table with all metadata
7. If category is "bags", also inserts into `bags` table with valid_region_points
8. If category is "threats", inserts into `threats` table
9. Otherwise, inserts into `non_threat_items` table
10. All done within a PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK)

#### `backend/src/schema.sql` (75 lines) — DATABASE SCHEMA

Defines 9 tables:

```sql
-- Core item storage (every uploaded image)
items (
    id UUID PRIMARY KEY,          -- Globally unique identifier
    filename VARCHAR(255),        -- Original filename
    filepath VARCHAR(255),        -- Stored filename (UUID.ext)
    category VARCHAR(50),         -- "bags", "threats", "non-threats"
    subcategory VARCHAR(255),     -- "General", "Laptop Bag", etc.
    name VARCHAR(255),            -- Human-readable name
    pixel_value INTEGER DEFAULT 32767,  -- X-ray attenuation value (0-65535)
    width INTEGER DEFAULT 512,    -- Image width in pixels
    height INTEGER DEFAULT 512,   -- Image height in pixels
    polygon_json JSONB,           -- Polygon outline for the object
    mask_path VARCHAR(255)        -- Path to mask image
)

-- Bag-specific: valid placement region
bags (
    item_id UUID REFERENCES items(id),
    valid_region_points JSONB     -- Normalized polygon points (0-1 range)
)

-- Threat-specific metadata
threats (
    item_id UUID REFERENCES items(id),
    threat_type VARCHAR(100),
    severity VARCHAR(50)
)

-- Category/subcategory taxonomy
categories (slug PK, name, type)
subcategories (slug, category_slug FK, name, valid_region_points JSONB)

-- Canonical bag valid regions per subcategory
bag_subcategory_valid_regions (
    category_slug, subcategory_slug,
    valid_region_points JSONB
)

-- Classification mapping tables
threat_items (item_id PK, subcategory_slug, threat_type, severity)
non_threat_items (item_id PK, subcategory_slug)

-- Saved workspace layouts
saved_layouts (
    id UUID PK,
    name VARCHAR(255),
    filepath VARCHAR(1024),
    layout_json JSONB,            -- Full scene state (objects, transforms, etc.)
    created_at TIMESTAMP
)
```

#### `backend/src/taxonomy.js` (~3270 lines)
- **Purpose:** Massive reference file defining the complete taxonomy of X-ray scannable objects
- **Contains:** 7 top-level categories (bags, trays, clothing, electronics, food, threats, miscellaneous), ~43 subcategories, hundreds of individual items with filenames and pixel values
- **Used by:** Seed scripts to populate the database and taxonomy.json

#### `backend/src/api/datasetGenerator.js` (325 lines) — BATCH GENERATION ENGINE

Handles both single-image export and batch dataset generation:

**Single Export Flow:**
1. Receives scene objects with transforms
2. Calls `renderSceneAsync()` to generate PNG using Beer-Lambert physics
3. Calculates bounding boxes and segmentation polygons for each object
4. Saves PNG to `images/` directory
5. Saves JSON annotation to `labels/` directory with bbox + segmentation data

**Batch Generation Flow:**
1. Receives array of combinations (bag + threat + others)
2. For each combination:
   a. Places bag in center (75% of canvas)
   b. Randomly places threat inside bag's valid region using `getRandomPositionInContainer()`
   c. Randomly places other items inside valid region
   d. Renders composite using Beer-Lambert physics
   e. Generates YOLO-format bounding box annotations
   f. Saves PNG + JSON label file

#### `backend/src/lib/renderCanvas.js` (141 lines) — SERVER-SIDE RENDERING

This is the server-side equivalent of `xrayRenderer.ts`. It uses `node-canvas` (a Node.js implementation of the Canvas API) to render X-ray composites:

1. Creates a white canvas (empty space = no X-ray absorption)
2. For each object (sorted by layer):
   - Loads the image file (PNG or SVG)
   - Draws it on an offscreen canvas with transform (position, rotation, scale)
   - Extracts the alpha channel as a "thickness map"
   - Calculates attenuation coefficient: `mu = -ln(max(1, pixelValue) / 65535)`
   - Accumulates density: `densityBuffer[pixel] += mu * (alpha / 255)`
3. Converts density buffer to grayscale: `intensity = 65535 * e^(-density)`
4. Returns PNG buffer

#### `backend/src/lib/geometry.js`
- **Purpose:** Server-side geometry calculations (mirrors the frontend geometry.ts)
- **Functions:** `isPointInPolygon()`, `getRectCorners()`, `getTransformedPolygon()`, `edgeIntersectsPolygon()`, `getRandomPositionInContainer()`
- **Used by:** `datasetGenerator.js` for placing objects and validating positions

---

### 5.3 Frontend Files (`frontend/src/`)

#### `App.tsx` — ROOT COMPONENT
- Sets up React Router with 5 routes:
  - `/` → UploadPage
  - `/library` → LibraryPage
  - `/collage` → CollagePage
  - `/customize` → CustomizationPage
  - `/saved` → SavedPage
- Renders sticky top navigation bar with icons and HelpMenu

#### `main.tsx`
- Standard React 18 entry point using `createRoot` with StrictMode

#### `index.css`
- Tailwind CSS imports + Inter font
- Custom CSS animations: `slide-up`, `fade-in`, `slide-in-right`

---

### 5.4 Pages (`frontend/src/pages/`)

#### `UploadPage.tsx` (172 lines) — FILE UPLOAD

**State Management:**
- `files: File[]` — raw File objects from the browser
- `staged: StagedItem[]` — files with metadata (category, subcategory, name, valid_region_points)
- `taxonomy: TaxonomyCategory[]` — loaded from backend for subcategory dropdowns
- `uploadStatus: "idle" | "success" | "error"` — toast notification state

**How Upload Works:**
1. User drags files into `UploadDropZone` → `handleFilesSelected()` creates `StagedItem[]` with default category="bags"
2. `UploadFileQueue` displays staged files with Edit/Remove buttons
3. Clicking Edit opens a modal where user can:
   - Change category (bags/threats/non-threats)
   - Change subcategory (fetched from taxonomy)
   - Rename the item
   - **Draw a valid region** (for bags only) using `ValidRegionEditor`
4. Clicking "Upload" sends a `POST /api/upload` with:
   - `FormData` containing all files
   - `metadata` JSON string with per-file category/subcategory/name/valid_region_points

#### `LibraryPage.tsx` (529 lines) — ITEM BROWSER

**Features:**
- Fetches all items from `GET /api/items/categorized`
- Organizes into 3 main tabs: Bags, Threats, Non-Threats
- Subcategory filter within each tab
- Search by name
- Grid/List view toggle
- Multi-select items via checkboxes (persisted to localStorage)
- Selection tray at bottom showing selected items with "Generate Combinations" button
- Individual item editing (change category/subcategory/name)
- Individual item deletion

**Key Flow:**
1. User selects bags, threats, and other items
2. Clicks "Generate Combinations" → navigates to CollagePage with selected items in `location.state`

#### `CollagePage.tsx` (260 lines) — COMBINATION VIEWER & BATCH EXPORT

**How Combinations Are Generated:**
1. Receives `selectedBags`, `selectedThreats`, `selectedOthers` from LibraryPage via `location.state`
2. Creates Cartesian product:
   - For each bag: one "clean" combo (bag + others)
   - For each bag × threat: one combo (bag + threat + others)
3. Client-side validation: skips combos where bag has no valid region but threat exists
4. Density presets: "empty" (no others), "few" (1-2 others), "filled" (all others)

**Export Flow:**
1. User clicks "Generate Dataset"
2. Sends `POST /api/dataset/generate` with all combinations
3. Backend renders each combination as PNG + JSON annotation
4. Results saved to `backend/data/collage_images/dataset-{timestamp}/`

**State Persistence:**
- Combinations stored in `sessionStorage` (survives page navigation)
- Selection stored in `localStorage` (survives browser restart)

#### `CustomizationPage.tsx` (779 lines) — INTERACTIVE CANVAS EDITOR

This is the most complex page. It provides a full visual editor for arranging objects on a canvas.

**State:**
- `objects: SceneObject[]` — all objects on the canvas (bag, threats, others)
- `selectedObjectId` — currently selected object
- `history / historyIndex` — undo/redo stack
- `showValidRegion` — toggle valid region polygon visibility
- `zoom` — canvas zoom level (0.5 to 2.0)
- `activeLibrary` — which sidebar panel is open

**Object Initialization (from URL params):**
1. On mount, fetches all items from `GET /api/items/categorized`
2. Reads `bagId`, `threatId`, `otherIds` from URL search params
3. Checks `localStorage` for previously saved workspace state
4. If no saved state, calls `buildAndSetObjects()`:
   a. Finds the bag item, sets it at canvas center (85% of smallest canvas dimension)
   b. Finds other items, places each at random position inside bag's valid region
   c. Finds threat item, places at random position inside bag's valid region
5. Each object gets a `SceneObject` with: id, name, category, filepath, pixel values, transform (x, y, width, height, rotation), layer order, polygon outline

**Interactive Features:**
- **Drag:** Click and drag non-bag objects to reposition
- **Rotate:** Click rotation handle and drag
- **Layer ordering:** Bring to front, send to back, move up/down
- **Delete:** Remove selected object
- **Undo/Redo:** Full history stack
- **Properties panel:** Shows selected object's position, category, pixel values, validity status
- **Out-of-bounds warnings:** Shows which threats are outside the valid region
- **Export:** Saves layout to database as JSON via `POST /api/saved-layouts`

**Canvas Rendering (via CanvasArea component):**
Uses `xrayRenderer.ts`'s `drawXRayComposite()` which:
1. Creates a Float32Array density buffer (800×600 = 480,000 pixels)
2. For each object (sorted by layer):
   - Draws image on offscreen canvas with transform
   - Extracts alpha channel
   - Calculates attenuation: `mu = -ln(pixelValue / 65535)`
   - Accumulates: `densityBuffer[i] += mu * (alpha / 255)`
3. Converts to grayscale: `intensity = 65535 * e^(-density)`
4. Draws result to visible canvas

#### `SavedPage.tsx`
- Lists all saved layouts from `GET /api/saved-layouts`
- Each layout shows creation time and can be loaded back into the CustomizationPage

---

### 5.5 Components (`frontend/src/components/`)

#### `ValidRegionEditor.tsx` (~2068 lines) — THE SHAPE DRAWING TOOL

This is a full-featured shape editor for drawing valid placement regions on bag images. It's like a mini Photoshop for defining where objects can be placed inside a bag.

**Tools:**
- **Select/Move:** Click to select shapes, drag to move
- **Rectangle:** Click and drag to draw rectangles
- **Circle:** Click and drag to draw circles
- **Polygon:** Click to add points, click near first point to close

**Features:**
- **Positive/Negative shapes:** Shapes can add to (positive) or subtract from (negative) the valid region
- **Layer management:** Reorder shapes, lock/unlock, show/hide
- **Grid snap:** Optional snap-to-grid (10/20/50px)
- **Zoom/Pan:** Ctrl+scroll to zoom, middle-click or space+drag to pan
- **Undo/Redo:** Full history
- **Copy/Paste:** Clipboard support
- **Context menu:** Right-click for shape-specific actions
- **Mask export:** Export the valid region as a black/white PNG mask
- **Opacity control:** Adjust shape transparency

**How Shapes Are Saved:**
When the user clicks Save, the editor:
1. Normalizes all shapes to 0-1 range (divides by canvas dimensions)
2. Extracts a "simplified points" array from the first positive rectangle/polygon
3. Calls `onSave(simplifiedPoints, normalizedShapes)`
4. The parent component stores this as `valid_region_points` in the staged item

**Why normalized (0-1)?** This makes the valid region resolution-independent. The same polygon works whether the bag image is displayed at 200px or 2000px.

#### `upload/UploadDropZone.tsx`
- Drag-and-drop zone that accepts files and folders
- Visual feedback with dashed border and icon

#### `upload/UploadFileQueue.tsx` (220 lines)
- Displays staged files with preview thumbnails
- Edit button opens modal with category/subcategory/name/valid_region fields
- For bags, shows "Edit valid region" button that opens ValidRegionEditor
- Fetches canonical valid region for subcategory when subcategory changes

#### `customization/CanvasArea.tsx`
- Renders the main canvas with X-ray composite
- Handles mouse events for dragging/rotating objects
- Draws valid region polygon overlay (green dashed line)
- Shows selection handles on selected objects

#### `customization/ScannedBagsSidebar.tsx`
- Left sidebar showing all available items from the library
- Organized by category tabs (Bags, Threats, Non-Threats)
- Click to add an item to the canvas

#### `customization/WorkspaceToolbar.tsx`
- Top toolbar with: Undo, Redo, Valid Region toggle, Layer controls, Randomize, Save/Export

#### `library/SimpleLibrarySidebar.tsx`
- Left sidebar for LibraryPage with category/subcategory navigation

#### `library/ItemCard.tsx` / `ItemRow.tsx`
- Grid card / list row display for library items
- Shows thumbnail, name, category badge, pixel value

#### `library/SelectionTray.tsx`
- Bottom tray showing selected items
- Shows counts per category
- "Generate Combinations" button → navigates to CollagePage

#### `library/LibraryToolbar.tsx`
- Search bar, view mode toggle (grid/list), filter controls

#### `collage/SyntheticPreview.tsx`
- Canvas-based preview of a single combination
- Uses `drawXRayComposite()` to render the X-ray in real-time

---

### 5.6 Core Logic (`frontend/src/lib/`)

#### `xrayRenderer.ts` (136 lines) — FRONTEND BEER-LAMBERT RENDERER

This is the most important file for understanding how X-ray composites are rendered.

**Image Caching:**
```typescript
const imgCache = new Map<string, HTMLImageElement>();
```
Images are loaded once and cached. URLs point to `http://localhost:8080/data/library_images/{filepath}`.

**Rendering Algorithm (`drawXRayComposite()`):**
```
1. Fill canvas with white (R=255, G=255, B=255)
   → White = no X-ray absorption (empty space)

2. Sort objects by layer number (lowest first = background first)

3. Create Float32Array densityBuffer[width × height] (all zeros)

4. For each object:
   a. Draw image on offscreen canvas with transform (translate, rotate, scale)
   b. Extract RGBA pixel data
   c. Calculate attenuation coefficient:
      mu = -ln(max(1, pixelValue) / 65535)
      
      Where pixelValue (0-65535) represents how much X-ray the object absorbs:
      - pixelValue = 65535 → mu ≈ 0 (transparent, like air)
      - pixelValue = 1 → mu ≈ 10.9 (very dense, like metal)
      - pixelValue = 32767 → mu ≈ 0.693 (medium, like cloth)
      
   d. For each pixel:
      - Skip if alpha = 0 (transparent)
      - Skip if pixel is near-white (R,G,B ≥ 245) — background noise
      - normalizedThickness = alpha / 255
      - densityBuffer[pixel] += mu × normalizedThickness

5. Convert density buffer to final grayscale image:
   For each pixel:
     intensity = 65535 × e^(-density)
     gray = round((intensity / 65535) × 255)
     
   This is the Beer-Lambert Law: I = I₀ × e^(-μt)
   Where I₀ = 65535 (initial intensity), μ = attenuation coefficient, t = thickness

6. Draw grayscale image to visible canvas
```

#### `geometry.ts` (76 lines) — GEOMETRY UTILITIES

**`isPointInPolygon(point, polygon)` — Ray Casting Algorithm:**
```
For each edge of the polygon:
  Cast a horizontal ray from the point to the right
  Count how many polygon edges it crosses
  If odd → point is inside; if even → point is outside
```

**`getRectCorners(center, size, rotation)` — Rotated Rectangle:**
```
4 corners at (±halfW, ±halfH) in local space
Apply rotation matrix:
  rotX = dx × cos(θ) - dy × sin(θ)
  rotY = dx × sin(θ) + dy × cos(θ)
Translate to center position
```

**`getTransformedPolygon(center, size, rotation, outline)` — Arbitrary Polygon Transform:**
```
For each point in the outline:
  Scale by size: dx = p.x × width, dy = p.y × height
  Rotate by angle
  Translate to center
```

**`lineSegmentsIntersect(p1,p2,p3,p4)` — CCW Method:**
Uses counter-clockwise orientation test to detect segment intersection.

#### `customizationHelpers.ts` (211 lines) — PLACEMENT & PIXEL MATH

**`getTransformedValidRegion(bag)` — Converts stored polygon to canvas coordinates:**
```
1. Take the bag's polygonOutline (normalized 0-1 points)
2. Map each point: x = p.x × displayWidth, y = p.y × displayHeight
3. Apply rotation and translation to get canvas-space coordinates
```

**`isObjectInsideContainer(obj, container)` — Boundary Check:**
```
1. Get the container's valid region (transformed polygon)
2. Get the object's outline (transformed polygon or rotated rectangle)
3. Check: Are ALL object corners inside the valid region?
4. Check: Does ANY object edge cross the valid region boundary?
5. If both pass → object is inside
```

**`getRandomPositionInContainer(width, height, container, polygonOutline)` — Random Placement:**
```
1. Get valid region bounding box (min/max x,y)
2. Try up to 1000 random positions:
   a. Generate random (x, y) within bounding box
   b. Generate random rotation (0-360°)
   c. Check if object at that position is inside container
   d. If yes → return position
   e. Progressive relaxation: after 100 attempts, shrink object by 20%
      after 300 attempts, shrink by 50%, after 600 attempts, use center point
3. Fallback: return centroid of valid region
```

**`calculatePixelValues(objs, threatOnly)` — Overlap Pixel Calculation:**
```
For each object:
  If it overlaps with a lower-layer object:
    newPixelValue = (originalPixelValue × overlappingPixelValue) / 65535
    
This simulates X-ray absorption stacking:
  Two objects in the same spot absorb more X-rays = darker pixel
```

---

### 5.7 Types (`frontend/src/types/`)

#### `customization.ts`
```typescript
type SceneObject = {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  library: StencilKind;          // "bag" | "threat" | "clothes" | etc.
  originalPixelValue: number;    // DB pixel value (0-65535)
  currentPixelValue: number;     // After overlap adjustment
  oldPixelValue: number | null;  // Previous value (for undo)
  stencilId: StencilId;          // Internal stencil reference
  filepath?: string;             // Path in library_images/
  polygonOutline?: Point[];      // Normalized polygon (0-1 range)
  transform: {                   // Canvas-space transform
    x: number;                   // Center X
    y: number;                   // Center Y
    width: number;               // Display width
    height: number;              // Display height
    rotation: number;            // Degrees
  };
  initialWidth?: number;         // Original image width
  initialHeight?: number;        // Original image height
  layer: number;                 // Z-order (lower = behind)
};
```

#### `geometry.ts`
```typescript
type Point = { x: number; y: number };
```

#### `library.ts`
```typescript
type Item = {
  id: string;
  filename: string;
  filepath: string;
  category: string;
  subcategory: string;
  name: string;
  pixel_value: number;
  width: number;
  height: number;
  polygon_json: any;
  valid_region_points?: any;
  mask_path?: string;
};

type TaxonomyCategory = {
  name: string;
  slug: string;
  subcategories: TaxonomySubcategory[];
};

type CategorizedItems = Record<string, Record<string, Item[]>>;
```

---

### 5.8 Configuration (`frontend/src/config/`)

#### `categories.ts` (151 lines)

**`CATEGORY_MAP`:** Maps category slugs to Tailwind CSS class sets for consistent styling:
```
bags → blue theme
threats → rose/red theme  
non-threats → gray theme
clothing → green theme
electronics → violet theme
food → amber theme
```

**`normalizeCategoryName(cat)`:** Normalizes any category string to one of 3 canonical values:
- Contains "bag" → "bags"
- Contains "threat" or "electronic" → "threats"
- Everything else → "non-threats"

This is crucial because uploaded files might have various category names, but the system only works with 3 main categories.

**`LIBRARIES`:** The 3 main library tabs: Bags, Threats, Non-Threats

**`getStencilKind(category)`:** Maps category strings to StencilKind enum values for the type system.

---

## 6. Database Schema Deep Dive

### Entity Relationship Diagram

```
┌──────────────┐
│   categories │
│  (slug PK)   │
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────────┐     ┌─────────────────────────────┐
│  subcategories   │     │ bag_subcategory_valid_regions │
│ (slug, cat_slug) │     │ (canonical valid regions)     │
│ valid_region JSONB│     └─────────────────────────────┘
└──────────────────┘

┌──────────────────┐
│     items        │ ← Core table, every uploaded image
│  (UUID PK)       │
│  filename        │
│  filepath        │ ← Actual file location in library_images/
│  category        │ ← "bags" | "threats" | "non-threats"
│  subcategory     │
│  name            │
│  pixel_value     │ ← X-ray attenuation (0-65535)
│  width, height   │ ← Actual image dimensions
│  polygon_json    │ ← Object outline polygon
│  mask_path       │
└────────┬─────────┘
         │ 1:1 (for bags)
         ▼
┌──────────────────┐
│      bags        │
│  item_id PK FK   │
│  valid_region_   │ ← JSONB: { simplifiedPoints: [...], shapes: [...], version: 2 }
│  points          │
└──────────────────┘

         │ 1:1 (for threats)
         ▼
┌──────────────────┐
│    threats       │
│  item_id PK FK   │
│  threat_type     │
│  severity        │
└──────────────────┘

         │ 1:1 (for non-threats)
         ▼
┌──────────────────────┐
│  non_threat_items    │
│  item_id PK FK       │
│  subcategory_slug    │
└──────────────────────┘

┌──────────────────┐
│  saved_layouts   │
│  (UUID PK)       │
│  name            │
│  layout_json     │ ← Full scene state (objects, transforms, validRegionPolygon)
│  created_at      │
└──────────────────┘
```

### Why 3 Classification Tables?

Items are classified into one of three tables based on category:
- `bags` — Container objects that define valid placement regions
- `threats` — Dangerous objects (guns, knives) that must be placed inside bags
- `non_threat_items` — Everything else (clothing, electronics, food)

This design allows:
1. Efficient querying ("give me all threats" = `SELECT * FROM threats`)
2. Category-specific metadata (bags have valid_region_points, threats have threat_type)
3. Clean foreign key relationships

---

## 7. The Valid Region System — Full Mathematical Explanation

### What Is a Valid Region?

A **valid region** is a polygon that defines where objects can be placed inside a bag. Think of it as a "safe zone" — when generating synthetic X-ray images, threats and other objects must be placed within this region to look realistic (objects don't float outside bags in real X-ray scans).

### How Is It Stored?

**In the Database (PostgreSQL):**

The valid region is stored as JSONB in two places:
1. `bags.valid_region_points` — Per-bag valid region
2. `subcategories.valid_region_points` — Canonical valid region per bag subcategory (reused for all bags of the same type)

The stored structure has two versions:

**Version 1 (simple):** Just an array of normalized points
```json
[
  { "x": 0.1, "y": 0.1 },
  { "x": 0.9, "y": 0.1 },
  { "x": 0.9, "y": 0.9 },
  { "x": 0.1, "y": 0.9 }
]
```

**Version 2 (structured):** Contains both simplified points and full shape data
```json
{
  "version": 2,
  "simplifiedPoints": [
    { "x": 0.1, "y": 0.1 },
    { "x": 0.9, "y": 0.1 },
    { "x": 0.9, "y": 0.9 },
    { "x": 0.1, "y": 0.9 }
  ],
  "shapes": [
    {
      "type": "rectangle",
      "isPositive": true,
      "x": 0.1, "y": 0.1,
      "width": 0.8, "height": 0.8,
      "visible": true,
      "locked": false,
      "label": "Rectangle 1",
      "opacity": 0.35
    }
  ]
}
```

### Why Normalized (0-1) Coordinates?

All valid region coordinates are stored as **normalized values between 0 and 1**, where:
- `x = 0` means the left edge of the image
- `x = 1` means the right edge of the image
- `y = 0` means the top edge of the image
- `y = 1` means the bottom edge of the image

**Why?** Because bag images come in different sizes (512×512, 1024×768, etc.). By normalizing to 0-1, the same valid region polygon works regardless of the actual image dimensions. When rendering, we multiply by the display size:

```
canvas_x = normalized_x × displayWidth
canvas_y = normalized_y × displayHeight
```

### Mathematical Transform Pipeline

When the CustomizationPage needs to use the valid region, here's the complete mathematical pipeline:

**Step 1: Load normalized polygon from database**
```
polygon = [{x: 0.1, y: 0.15}, {x: 0.85, y: 0.15}, {x: 0.85, y: 0.85}, {x: 0.1, y: 0.85}]
```

**Step 2: Map to display coordinates**
The bag is displayed at a certain size on the canvas (e.g., 510×510 pixels centered at 400,300):
```
For each point p in polygon:
  dx = p.x × displayWidth    // e.g., 0.1 × 510 = 51
  dy = p.y × displayHeight   // e.g., 0.15 × 510 = 76.5
```

**Step 3: Apply rotation**
If the bag is rotated by θ degrees:
```
rad = θ × π / 180
rotX = dx × cos(rad) - dy × sin(rad)
rotY = dx × sin(rad) + dy × cos(rad)
```

**Step 4: Translate to canvas position**
```
finalX = bagCenterX + rotX    // e.g., 400 + rotX
finalY = bagCenterY + rotY    // e.g., 300 + rotY
```

### Point-in-Polygon Test (Ray Casting Algorithm)

To check if an object is inside the valid region, we use the **ray casting algorithm**:

```
function isPointInPolygon(point, polygon):
  inside = false
  for each edge (polygon[i], polygon[j]):
    if ((yi > point.y) ≠ (yj > point.y)) AND
       (point.x < (xj - xi) × (point.y - yi) / (yj - yi) + xi):
      inside = !inside
  return inside
```

**How it works:** Cast a horizontal ray from the point to the right. Count how many polygon edges it crosses. Odd = inside, even = outside.

### Object-Inside-Container Validation

To check if an entire object is inside the bag's valid region:

```
1. Get the object's outline polygon (4 corners of its bounding rectangle, transformed with rotation)
2. Get the bag's valid region polygon (transformed with bag's position, size, rotation)
3. CHECK 1: Are ALL corners of the object inside the valid region?
   - For each corner point: isPointInPolygon(corner, validRegion)
4. CHECK 2: Does ANY edge of the object cross the valid region boundary?
   - For each object edge: edgeIntersectsPolygon(edge, validRegion)
5. If both checks pass → object is validly placed
```

### Why Not Just Use a Bounding Box?

The valid region is a **polygon**, not a simple rectangle, because:
1. Real bags aren't perfect rectangles — they have curves, irregular shapes
2. The valid placement area might be L-shaped or have holes
3. The ValidRegionEditor supports rectangles, circles, and arbitrary polygons
4. Using a polygon gives much more realistic object placement

---

## 8. How Objects Are Made Unique & Inserted

### Uniqueness via UUIDs

Every item gets a **UUID v4** as its primary key:
```javascript
// Backend: server.js
const { v4: uuidv4 } = require('uuid');

// During upload:
const filename = `${uuidv4()}${ext}`;  // e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
```

This ensures:
- No filename collisions even with concurrent uploads
- Globally unique identifiers across any database
- No sequential IDs that could leak information

### The Complete Upload Flow (Frontend → Backend → Database)

**Step 1: Frontend — User drags files into UploadDropZone**
```
UploadDropZone.onFilesSelected(files)
  → Creates StagedItem[] with default metadata:
    { file, category: "bags", subcategory: "General", name: filename, valid_region_points: null }
```

**Step 2: Frontend — User edits item (optional)**
```
UploadFileQueue → opens Edit Modal
  → User changes category/subcategory/name
  → User draws valid region (for bags) → ValidRegionEditor → normalized polygon points
  → StagedItem updated with user's choices
```

**Step 3: Frontend — User clicks "Upload"**
```
handleUpload():
  1. Create FormData
  2. Append all files as "images"
  3. Append metadata JSON: [{originalname, category, subcategory, name, valid_region_points}, ...]
  4. POST to http://localhost:8080/api/upload
```

**Step 4: Backend — Receives upload**
```
POST /api/upload:
  1. Multer saves each file to data/library_images/ with UUID filename
  2. Parse metadata JSON from req.body.metadata
  3. BEGIN transaction
  4. For each file:
     a. Look up filename in taxonomy.json → get category/subcategory/pixelValue
     b. If not found, use filename prefix heuristics
     c. Apply metadata overrides (user's choices)
     d. Detect actual image dimensions using node-canvas
     e. INSERT INTO items (filename, filepath, category, subcategory, name, pixel_value, width, height)
     f. If bags: INSERT INTO bags (item_id, valid_region_points)
     g. If threats: INSERT INTO threats (item_id)
     h. Otherwise: INSERT INTO non_threat_items (item_id)
  5. COMMIT transaction
  6. Return { ok: true, itemsProcessed: N }
```

**Step 5: Frontend — Shows success toast**
```
Upload status: "success"
  → "Upload successful! Go to Collage page to see combinations."
  → Clear staged files after 1 second
```

### How the Library Page Loads Items

```
LibraryPage mounts:
  1. GET /api/items/categorized
  2. Backend queries: SELECT * FROM items ORDER BY created_at DESC
  3. For each bag item: also queries bags table for valid_region_points
  4. Organizes into nested object: { bags: { General: [...], "Laptop Bag": [...] }, threats: {...}, ... }
  5. Frontend receives and stores in state
  6. User can browse, filter, search, select items
```

### How Combinations Are Generated

```
LibraryPage → user selects items → clicks "Generate Combinations"
  1. Navigates to CollagePage with { selectedBags, selectedThreats, selectedOthers }
  2. CollagePage creates permutations:
     For each bag:
       - Clean combo: { bag, others: [...] }
       For each threat:
         - Threat combo: { bag, threat, others: [...] }
  3. Each combo gets a unique ID: "{bagId}-clean" or "{bagId}-{threatId}"
  4. Stored in sessionStorage for persistence
```

---

## 9. All APIs — Complete Reference

### Health Check
```
GET /api/health
Response: { ok: true, service: "synthetic-xray-backend" }
```

### Taxonomy
```
GET /api/taxonomy
Response: { ok: true, taxonomy: [{ name, slug, subcategories: [{ name, slug, items }] }] }
```

### Upload
```
POST /api/upload
Content-Type: multipart/form-data
Body:
  - images: File[] (multiple files)
  - folderName: string
  - metadata: JSON string [{ originalname, category, subcategory, name, valid_region_points }]
Response: { ok: true, itemsProcessed: number }
```

### Items
```
GET /api/items/categorized
Response: { ok: true, categorized: { [category]: { [subcategory]: Item[] } } }

GET /api/items/:id
Response: { ok: true, item: Item }

PUT /api/items/:id
Body: { category, subcategory, name }
Response: { ok: true }

DELETE /api/items/:id
Response: { ok: true }
```

### Valid Region
```
PUT /api/items/:id/valid-region
Body: { validRegionPoints: Point[], shapes: Shape[] }
Response: { ok: true }

DELETE /api/items/:id/valid-region
Response: { ok: true }
```

### Categories & Subcategories
```
POST /api/categories
Body: { slug, name, type }
Response: { ok: true }

POST /api/subcategories
Body: { category_slug, slug, name, valid_region_points }
Response: { ok: true }

GET /api/subcategories/:category_slug/:slug
Response: { ok: true, subcategory: { slug, category_slug, name, valid_region_points } }

PUT /api/subcategories/:category_slug/:slug
Body: { valid_region_points }
Response: { ok: true }
```

### Saved Layouts
```
GET /api/saved-layouts
Response: { ok: true, layouts: Layout[] }

POST /api/saved-layouts
Body: { name, filepath?, layout_json }
Response: { ok: true, layout: Layout }

GET /api/saved-layouts/:id
Response: { ok: true, layout: Layout }

DELETE /api/saved-layouts/:id
Response: { ok: true }
```

### Export & Dataset Generation
```
POST /api/export
Body: { objects: SceneObject[], validRegionPolygon: Point[], annotations? }
Response: { ok: true, exportId, outputDir, files: string[] }

POST /api/dataset/generate
Body: { combinations: [{ id, bag, threat, others }], resolutionWidth, resolutionHeight }
Response: { ok: true, datasetId, outputDir, files: [{ image, label }], manifest }
```

---

## 10. The Beer-Lambert X-Ray Rendering Physics

### The Science

X-ray imaging works by passing X-rays through an object. Denser materials absorb more X-rays, appearing darker on the detector. The **Beer-Lambert Law** describes this:

```
I = I₀ × e^(-μt)
```

Where:
- `I₀` = Initial X-ray intensity (we use 65535, the max 16-bit value)
- `μ` = Linear attenuation coefficient (depends on material)
- `t` = Thickness of the material
- `I` = Final intensity after passing through

### How We Implement It

**For each pixel in the composite image:**

1. **Start with white** (I = 65535, meaning no absorption = empty space)

2. **For each object layer (back to front):**
   - The object's pixel value represents its attenuation: `μ = -ln(pixelValue / 65535)`
   - The alpha channel represents thickness: `t = alpha / 255`
   - Accumulate density: `density += μ × t`

3. **Convert accumulated density to intensity:**
   ```
   I = 65535 × e^(-density)
   gray = round((I / 65535) × 255)
   ```

### Example Pixel Values

| Object | Pixel Value | μ (attenuation) | Visual Result |
|--------|-------------|-----------------|---------------|
| Air/Empty | 65535 | 0 | White |
| Cloth | 40000 | 0.49 | Light gray |
| Plastic | 30000 | 0.76 | Medium gray |
| Electronics | 15000 | 1.44 | Dark gray |
| Metal (gun) | 5000 | 2.60 | Very dark |
| Dense metal | 1000 | 4.16 | Nearly black |

### Multi-Layer Stacking

When two objects overlap, their densities add up:
```
Total density = density_object1 + density_object2
Resulting intensity = 65535 × e^(-total_density)
```

This means overlapping objects appear darker than either alone — exactly like real X-ray imaging.

### Frontend vs Backend Rendering

| Aspect | Frontend (xrayRenderer.ts) | Backend (renderCanvas.js) |
|--------|---------------------------|--------------------------|
| Runtime | Browser Canvas API | node-canvas (Node.js) |
| Used for | Real-time preview | Batch export |
| Image source | HTTP URLs | Local filesystem |
| Performance | Interactive (60fps) | One-shot (slower) |
| Physics | Identical | Identical |

Both implementations use the exact same Beer-Lambert algorithm, ensuring WYSIWYG: what you see in the browser is what gets exported.

---

## 11. End-to-End Walkthrough

### Simulating the Full Workflow with designed_images

Although the `backend/designed_images/` folder is currently empty, let's walk through the complete workflow as if we were using pre-designed images (like the bags and threats from `data_synthesis/`):

### Step 1: Upload a Bag Image

**User Action:** Open the Upload page, drag a bag PNG into the dropzone.

**Frontend:**
1. `UploadDropZone` receives the file via `onFilesSelected()`
2. Creates a `StagedItem`: `{ file, category: "bags", subcategory: "General", name: "my_bag.png", valid_region_points: null }`
3. Shows the file in `UploadFileQueue` with a thumbnail preview

**User Action:** Click "Edit" on the staged bag item.

**Frontend:**
1. Opens Edit Modal showing the bag image and metadata fields
2. User selects category "bags", subcategory "Backpack" (or similar)
3. User clicks "Edit valid region" → opens `ValidRegionEditor`

**ValidRegionEditor Flow:**
1. Displays the bag image on a canvas
2. User selects Rectangle tool, draws a rectangle covering the main compartment
3. The rectangle is drawn in pixel coordinates (e.g., x=50, y=40, width=400, height=350 on a 512×512 image)
4. User can add more shapes (circles, polygons) or subtract areas
5. User clicks Save:
   - Shapes are normalized: x=50/512=0.098, y=40/512=0.078, width=400/512=0.781, height=352/512=0.688
   - Simplified points extracted: [{x:0.098, y:0.078}, {x:0.879, y:0.078}, {x:0.879, y:0.766}, {x:0.098, y:0.766}]
   - Both normalized shapes and simplified points saved to staged item

**User Action:** Click "Upload" button.

**Backend Processing:**
1. Multer saves `my_bag.png` as `{uuid}.png` in `data/library_images/`
2. Checks taxonomy.json — if filename matches, uses taxonomy data
3. If not, uses prefix detection: "my_bag" doesn't start with "bag", so falls back to filename parsing
4. Detects image dimensions: 512×512
5. `INSERT INTO items (filename='my_bag.png', filepath='{uuid}.png', category='bags', subcategory='General', pixel_value=42000+random)`
6. `INSERT INTO bags (item_id=NEW_UUID, valid_region_points={"simplifiedPoints":[...], "shapes":[...], "version": 2})`
7. Also upserts into `subcategories` table for future reuse of this valid region
8. Returns `{ ok: true, itemsProcessed: 1 }`

### Step 2: Upload Threat and Non-Threat Images

Same process, but:
- Threat image: category="threats", no valid_region needed, gets inserted into `threats` table
- Clothing image: category="non-threats", gets inserted into `non_threat_items` table

### Step 3: Browse Library

**User navigates to Library page.**

**Frontend calls:** `GET /api/items/categorized`

**Backend:**
1. `SELECT * FROM items ORDER BY created_at DESC`
2. For each bag: `SELECT valid_region_points FROM bags WHERE item_id = ?`
3. Organizes into: `{ bags: { General: [bag1, bag2] }, threats: { General: [threat1] }, "non-threats": { General: [clothing1] } }`

**Frontend:**
1. Displays items in grid/list view
2. User can filter by category/subcategory, search by name
3. User selects: 1 bag, 1 threat, 1 clothing item
4. Selection stored in `localStorage` as `selectedItemIds: [uuid1, uuid2, uuid3]`

### Step 4: Generate Combinations

**User clicks "Generate Combinations" in SelectionTray.**

**Frontend navigates to:** `/collage` with `location.state = { selectedBags: [bag1], selectedThreats: [threat1], selectedOthers: [clothing1] }`

**CollagePage:**
1. Creates combinations:
   - `{ id: "bag1-clean", bag: bag1, others: [clothing1] }` — clean bag with clothing
   - `{ id: "bag1-threat1", bag: bag1, threat: threat1, others: [clothing1] }` — bag with threat + clothing
2. Stores in `sessionStorage` for persistence

**Each combination shows a preview:**
- `SyntheticPreview` component calls `drawXRayComposite()` on a small canvas
- Shows the bag with objects placed inside using Beer-Lambert physics

### Step 5: Customize a Combination

**User clicks "Customize" on a combination.**

**Frontend navigates to:** `/customize?bagId=uuid1&threatId=uuid2&otherIds=uuid3`

**CustomizationPage:**
1. Fetches all items from `GET /api/items/categorized`
2. Finds bag, threat, and other items by ID
3. Creates `SceneObject[]`:
   - Bag: centered at (400, 300), size 510×510, rotation 0, layer 0
   - Clothing: random position inside bag's valid region, random rotation, layer 1
   - Threat: random position inside bag's valid region, random rotation, layer 2
4. Renders on 800×600 canvas using Beer-Lambert physics
5. User can:
   - Drag objects to reposition
   - Rotate objects
   - Add more objects from the sidebar
   - Delete objects
   - Adjust layer ordering
   - Toggle valid region visibility
   - See real-time X-ray preview as they make changes

**Real-time rendering pipeline:**
```
User moves an object → setObjects(newState)
  → CanvasArea re-renders
    → drawXRayComposite(canvas, objects)
      → For each object:
        1. Draw on offscreen canvas with new position
        2. Extract alpha channel
        3. Calculate attenuation from pixel value
        4. Accumulate in density buffer
      → Convert density to grayscale
      → Draw to visible canvas
  → User sees updated X-ray composite in real-time
```

### Step 6: Save the Layout

**User clicks "Save" in WorkspaceToolbar.**

**Frontend:**
1. Computes transformed valid region polygon for the bag
2. Computes segmentation polygons (rotated rectangle corners) for each object
3. Creates `layout_json`:
```json
{
  "objects": [
    {
      "id": "initial-bag",
      "name": "Backpack",
      "library": "bag",
      "transform": { "x": 400, "y": 300, "width": 510, "height": 510, "rotation": 0 },
      "originalPixelValue": 42000,
      "segmentation": [{x:145,y:45}, {x:655,y:45}, {x:655,y:555}, {x:145,y:555}]
    },
    {
      "id": "initial-threat",
      "name": "Handgun",
      "library": "threat",
      "transform": { "x": 350, "y": 280, "width": 120, "height": 60, "rotation": 45 },
      "segmentation": [...]
    }
  ],
  "validRegionPolygon": [{x:145,y:45}, {x:655,y:45}, {x:655,y:555}, {x:145,y:555}],
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```
4. POSTs to `POST /api/saved-layouts`
5. Backend: `INSERT INTO saved_layouts (name, layout_json) VALUES (?, ?)`

### Step 7: Export as Training Data

**User returns to CollagePage and clicks "Generate Dataset".**

**Frontend sends:** `POST /api/dataset/generate` with all combinations

**Backend processes each combination:**
1. Places bag at center (75% of canvas)
2. Randomly places threat inside bag's valid region using `getRandomPositionInContainer()`
3. Randomly places other items inside valid region
4. Renders composite PNG using `renderSceneAsync()` (node-canvas + Beer-Lambert)
5. Calculates annotations:
   - Bounding box: min/max of transformed polygon corners
   - Segmentation polygon: transformed object outline
6. Saves:
   - `images/combo-1.png` — the synthetic X-ray image
   - `labels/combo-1.json` — annotation with bbox + segmentation

**Final output structure:**
```
data/collage_images/dataset-2024-01-15T10-30-00-000Z/
├── images/
│   ├── bag1-clean.png
│   ├── bag1-threat1.png
│   └── ...
└── labels/
    ├── bag1-clean.json
    ├── bag1-threat1.json
    └── ...
```

**Example annotation JSON:**
```json
{
  "image_id": "bag1-threat1",
  "filename": "bag1-threat1.png",
  "width": 800,
  "height": 600,
  "objects": [
    {
      "id": "bag-uuid1",
      "name": "Backpack",
      "category": "bags",
      "pixel_value": 42000,
      "bbox": { "x": 100, "y": 75, "width": 600, "height": 450 },
      "segmentation": [{ "x": 100, "y": 75 }, { "x": 700, "y": 75 }, { "x": 700, "y": 525 }, { "x": 100, "y": 525 }]
    },
    {
      "id": "threat-uuid",
      "name": "Handgun",
      "category": "threats",
      "pixel_value": 8000,
      "bbox": { "x": 300, "y": 250, "width": 120, "height": 60 },
      "segmentation": [{ "x": 300, "y": 250 }, { "x": 420, "y": 250 }, { "x": 420, "y": 310 }, { "x": 300, "y": 310 }]
    }
  ]
}
```

---

## 12. Data Synthesis Scripts

The `data_synthesis/` folder contains Python scripts for preparing raw X-ray scanner data:

### `dumpread.py`
- Reads `.dump` files — raw binary format from X-ray scanners
- Converts to viewable PGM (Portable GrayMap) format

### `extract_tips.py`
- Extracts individual threat items from `.tip` files (threat image packages)

### `convert_tips_to_png.py`
- Converts extracted `.tip` files to standard PNG format for web display

### `fix_threat_dimensions.py`
- Resizes threat images to standard dimensions for consistent rendering

### `check_tip.py`
- Validates the format and integrity of `.tip` files

### Data Folders
- `bags_easy/`, `bags_medium/`, `bags_hard/` — Bag scans of varying complexity
- `guns/` — Gun threat images (.tip files and PNGs)
- `knife/` — Knife threat images

These scripts prepare the initial dataset that gets uploaded through the web interface.

---

## Summary

This project is a complete pipeline for generating synthetic X-ray security training data:

1. **Upload** real X-ray images of bags, threats, and non-threats
2. **Define valid regions** where objects can be placed inside bags
3. **Browse and select** items from the library
4. **Auto-generate** all valid combinations (Cartesian product)
5. **Customize** object placement with real-time X-ray physics preview
6. **Export** annotated PNG images + JSON labels for ML training

The core physics engine (Beer-Lambert attenuation) runs identically in both browser and server, ensuring what you see is what you get. The valid region system uses normalized polygon coordinates for resolution-independent storage and runtime coordinate transforms for accurate placement.