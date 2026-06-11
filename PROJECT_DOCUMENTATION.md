
# Synthetic X-Ray Project Documentation
---

## 1. PROJECT OVERVIEW
The **Synthetic X-Ray Project** is a web app for creating realistic X-ray images of bags with threats and other items for training X-ray scanners.

---

## 2. FULL FILE BREAKDOWN

### A. Root Directory (`c:\Users\saikiran\Desktop\xray1`)
| File/Folder | Purpose |
|-------------|---------|
| `README.md` | Project introduction (currently minimal) |
| `package.json` | Root npm config (scripts for running dev servers) |
| `plan.txt` / `list.txt` | Internal planning/notes files |
| `xray_scanner_object_taxonomy.html` | Taxonomy page for X-ray object categorization |
| `taxonomy.json` | **JSON file defining object categories, subcategories, and items** - used to organize library images |
| `synthetic_x_ray_workspace.tsx` | Legacy/unused workspace component (contains old prototype) |
| `roomplanner/` | Unrelated side project (folder we can ignore for our main app) |
| `frontend/` | The React + TypeScript + Vite user interface |
| `backend/` | Express.js server with database and file operations |
| `test_images/` | Large collection of test SVG images for object libraries (organized by category) |
| `design_document/` | Project planning docs, diagrams, and screenshots |
| `PROJECT_DOCUMENTATION.md` | This file! Detailed project documentation |

---

### B. Backend (`c:\Users\saikiran\Desktop\xray1\backend`)

#### Core Backend Files
1. **`package.json`**
   - Defines backend dependencies: `express`, `cors`, `pg` (PostgreSQL), `multer`, `uuid`, `canvas`
   - `dev` script: `node --watch src/server.js` (auto-reload on changes)
   - `seed` script: (future) seeds library from taxonomy
   - `organize-images` script: runs image organizer (see below)

2. **`src/server.js`**
   - **Main Express server entry point**:
     - Initializes the Express app with CORS and JSON body parser
     - Sets up paths for data storage (exports, library images, collage images)
     - Serves static files from `data/` at `/api/static`
     - **API Routes**:
       1. `GET /api/health` → Simple health check (returns `{ ok: true }`)
       2. `POST /api/export` → Saves synthesis session to `data/exports/` and generates X-ray PNG with JSON annotations using `generateDataset`
       3. `POST /api/dataset/generate` → Batch generates X-ray combinations from CollagePage
       4. `GET /api/taxonomy` → Returns the full taxonomy from `taxonomy.json`
       5. `GET /api/items/categorized` → Returns all items from PostgreSQL DB organized by category/subcategory
       6. `POST /api/upload` → Accepts multiple images, categorizes them, saves to `data/library_images/` and database
       7. `GET /api/sessions` → Returns all upload sessions
       8. `DELETE /api/sessions/:id` / `DELETE /api/items/:id` → Deletes sessions or items
       9. `PUT /api/items/:id/valid-region` → Updates a bag's valid placement region polygon
       10. `GET /api/items/:id` → Returns details for a single item
     - Starts server on port 8080

3. **`src/lib/renderCanvas.js`**
   - **Core X-ray rendering engine using Node Canvas (`canvas` npm package)**:
     - `renderSceneAsync(objects, width, height)`: Takes a list of scene objects and composes them into a realistic X-ray PNG
     - Uses Beer-Lambert law for simulating X-ray attenuation
     - Combines overlapping object densities
     - **NEW:** Includes `findImageFile` function to recursively search organized library folders
     - Supports SVG and other image formats

4. **`src/api/datasetGenerator.js`**
   - Generates PNG dataset + JSON annotations for both single exports and batch collages
   - Handles random object placement within valid regions
   - Saves images to `data/collage_images/` or `data/exports/`

5. **`src/taxonomy.js`** (if exists)
   - Loads and parses `taxonomy.json` for server-side use

#### Backend Scripts (`backend/scripts/`)
| Script | Purpose |
|--------|---------|
| `organize-library-images.js` | **Organizes library images** into `category/subcategory/` folders using: <br>1. Database info first <br>2. `taxonomy.json` + SVG content <br>3. Falls back to `miscellaneous/general` |
| `cleanup-empty-dirs.js` | Cleans up empty directories after organizing |
| `generate-test-images.js` | Generates simple placeholder SVGs from `taxonomy.json` |
| `seed-taxonomy.js` | Seeds the PostgreSQL database from `taxonomy.json` |
| `parse-taxonomy.js` | Parses `taxonomy.json` into structured format |

#### Backend Data Storage (`backend/data/`)
| Folder/File | Purpose |
|-------------|---------|
| `library_images/` | **Organized library images**! Now in `category/subcategory/` folders (e.g., `bags/backpacks/`, `threats/firearms-pistols/`) |
| `collage_images/` | Generated X-ray collage PNGs + annotations |
| `exports/` | Saved single-scene exports (PNG, metadata, annotations, summary) |
| `customization_exports/` | Empty folder (future use) |

---

### C. Frontend (`c:\Users\saikiran\Desktop\xray1\frontend`)
#### Frontend Config Files
| File | Purpose |
|------|---------|
| `package.json` | Defines frontend dependencies: React, react-router-dom, vite, tailwindcss, lucide-react |
| `vite.config.ts` | Vite build tool configuration |
| `tsconfig.json` / `tsconfig.node.json` | TypeScript config |
| `tailwind.config.js` | Tailwind CSS styling framework config |
| `postcss.config.js` | PostCSS config for Tailwind |
| `eslint.config.js` | ESLint linting rules |
| `index.html` | Entry HTML file (mounts React app) |

#### Frontend Source Code (`frontend/src/`)
1. **`main.tsx`**
   - App entry point: Renders the React app into `#root`

2. **`App.tsx`**
   - Main app component with React Router
   - **Routes**:
     - `/` → LibraryPage
     - `/collage` → CollagePage
     - `/customize` → CustomizationPage
     - `/upload` → UploadPage
   - Top navigation bar with links to Library and Collage

3. **`components/HelpMenu.tsx`**
   - Help menu with app usage instructions and keyboard shortcuts

4. **`lib/geometry.ts`**
   - **Core geometric functions**:
     - `isPointInPolygon`: Uses ray-casting algorithm to determine if a point is inside a polygon
     - `getRectCorners`: Calculates 4 corners of a rectangle, considering rotation
     - `getTransformedPolygon`: Transforms a polygon by position, size, rotation
     - `getRandomPositionInContainer`: Tries 1000 random positions to place an object safely inside a container's valid region

5. **`pages/LibraryPage.tsx`**
   - Shows all library categories (from hardcoded `STENCILS`)
   - Lets users select items and click "Generate Combinations" to go to CollagePage

6. **`pages/CollagePage.tsx`**
   - Generates and previews multiple bag+threat+other item combinations
   - Uses `getRandomPositionInContainer` to randomly place items safely inside the bag's valid region
   - Each preview links to CustomizationPage for detailed editing

7. **`pages/CustomizationPage.tsx`**
   - The main workspace for creating synthetic X-rays!
   - Features:
     - Drag and drop objects
     - Rotate objects
     - Layer ordering
     - Valid region visualization
     - Export functionality (calls `/api/export` on backend)

8. **`pages/UploadPage.tsx`**
   - Lets users upload multiple images (with category prefixes like `bag_`, `threat_`)
   - Calls `/api/upload` on backend
   - Shows upload status

9. **`stencils/registry.tsx`**
   - **THE HEART OF THE FRONTEND LIBRARY**:
     - Hardcoded `STENCILS` object with all predefined items (bags, threats, clothes, etc.)
     - Each stencil includes: `id`, `kind`, `name`, `desc`, `viewBox`, `pixelValue`, `validRegion` (polygon points), `render` (SVG function)
   - `renderObjectSvg`: Helper to render stencil SVG with pixel-based gray color

10. **`stencils/tokens.ts`**
    - Color tokens for stencils (currently minimal)

11. **`stencils/types.ts`**
    - TypeScript type definitions for stencils (StencilId, StencilDescriptor, etc.)

12. **`types/geometry.ts`**
    - TypeScript type for 2D Point: `{ x: number; y: number }`

13. **`index.css`**
    - Global Tailwind CSS styles

---

## 3. HOW FRONTEND ↔ BACKEND ↔ DATABASE INTERACT

### Currently Active Interactions
1. **Export Synthesis**:
   - User clicks "Save" button in CustomizationPage
   - Frontend sends POST request to `/api/export` with all object states and valid region
   - Backend:
     - Creates a new subfolder in `data/exports/` with timestamp
     - Writes `metadata.json` (detailed export data) and `summary.txt` (human-readable summary)
     - **Calls `generateDataset`** which renders a PNG X-ray image using `renderSceneAsync`
     - Also saves JSON annotations with bounding boxes and segmentation polygons
     - Returns success to frontend

### Future-Ready Interactions (APIs exist but not used yet)
- `/api/libraries` → Frontend could fetch library categories from database instead of hardcoding
- `/api/libraries/:name/items` → Fetch items for a specific library from database
- `/api/upload` → Upload new items to database and file system
- `/api/collage-combinations` → Fetch pre-generated combinations from database
- `/api/dataset/generate` → Batch generate many X-ray images at once

---

## 4. KEY CONCEPTS RECAP

### Random Object Placement
1. Get the bag's valid region polygon
2. Find its bounding box
3. Try 1000 random positions/rotations
4. Check each time if all 4 corners are inside valid region
5. Use first valid position found

### Containment Check
- Uses ray-casting algorithm (`isPointInPolygon`) to verify every corner of an object is inside the bag's valid region polygon

### X-Ray Pixel Simulation
- Pixel values (0-65535) represent material density (lower = darker/absorptive, higher = lighter)
- Uses **Beer-Lambert law** to simulate realistic attenuation
- Overlapping objects combine their densities logarithmically

---

## 5. ORGANIZED LIBRARY IMAGES
Your library images are now neatly organized in `backend/data/library_images/` using `taxonomy.json` into folders like:
```
library_images/
├── bags/
│   ├── backpacks/
│   ├── suitcases/
│   ├── duffel-bags/
│   └── ...
├── threats/
│   ├── firearms-pistols/
│   ├── edged-weapons/
│   ├── explosive-ied-components/
│   └── ...
├── electronics/
├── food/
├── stationary/
└── miscellaneous/
```
- Use `npm run organize-images` in `backend/` to re-organize at any time
- The render engine automatically finds images no matter which subfolder they're in!

