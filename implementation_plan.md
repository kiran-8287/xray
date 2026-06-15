# Implementation Plan - Synthetic X-Ray Enhancements & Synthesis Data Integration

This implementation plan outlines the steps required to implement manual categorization, subcategory-level valid regions, importing the synthesis data, collage validation, disabling resizing on the customization page, and creating a saved layouts page.

## User Review Required

> [!IMPORTANT]
> - **Synthesis Data Conversion**: The `.dump.pgm` (bags) and `.tip` (threats) files will be decrypted/converted to standard 8-bit grayscale PNGs on database initialization and stored under `backend/data/library_images/` so they are fully compatible with browser canvas drawing.
> - **Three Main Categories**: We will collapse the existing categories into exactly three main categories: `bags`, `threats` (incorporating `electronics`), and `non-threats` (incorporating `trays`, `clothes`, `food`, and `miscellaneous`).
> - **Subcategory-Level Valid Regions**: Drawing/saving a valid region for a bag subcategory (e.g. `Bags -> easy`) will store it in a new `subcategories` table. Any newly uploaded bag of that subcategory will automatically inherit this region, but can also be custom-edited.

## Proposed Changes

---

### Backend Components

#### [NEW] [import_synthesis_data.py](file:///c:/Users/saikiran/Desktop/xray1/backend/scripts/import_synthesis_data.py)
Create a Python script to:
- Decrypt `.dump.pgm` files (using a modified cv2-free `ReadDump` logic) and save them as 8-bit grayscale PNGs in `backend/data/library_images/`.
- Convert `.tip` files to 8-bit grayscale PNGs and save them in `backend/data/library_images/`.
- Import these items into the PostgreSQL database under the appropriate categories/subcategories.

#### [MODIFY] [schema.sql](file:///c:/Users/saikiran/Desktop/xray1/backend/src/schema.sql)
- Add `categories` table (`slug` PRIMARY KEY, `name`, `type`).
- Add `subcategories` table (`slug`, `category_slug` REFERENCES categories(slug), `name`, `valid_region_points` JSONB, PRIMARY KEY (category_slug, slug)).
- Add `saved_layouts` table (`id` UUID PRIMARY KEY, `name` VARCHAR, `filepath` VARCHAR, `layout_json` JSONB, `created_at` TIMESTAMP).

#### [MODIFY] [server.js](file:///c:/Users/saikiran/Desktop/xray1/backend/src/server.js)
- Migrate and seed categories/subcategories on database initialization.
- Update `/api/upload` to accept metadata per file (JSON string with category, subcategory, item name, and valid region points).
- Add Category/Subcategory management endpoints (`POST /api/categories`, `POST /api/subcategories`).
- Add Saved Layouts endpoints (`GET /api/saved-layouts`, `POST /api/saved-layouts`, `GET /api/saved-layouts/:id`, `DELETE /api/saved-layouts/:id`).
- Update `/api/items/categorized` to return items organized under the 3 main categories.

#### [MODIFY] [datasetGenerator.js](file:///c:/Users/saikiran/Desktop/xray1/backend/src/api/datasetGenerator.js)
- When generating collages, check if any randomly placed item is out of bounds using `isObjectInsideContainer`. If it is out of bounds, skip/discard that permutation.

---

### Frontend Components

#### [MODIFY] [categories.ts](file:///c:/Users/saikiran/Desktop/xray1/frontend/src/config/categories.ts)
- Update `normalizeCategoryName` and `CATEGORY_MAP` to support exactly three main categories: `bags`, `threats` (which includes electronics), and `non-threats`.

#### [MODIFY] [UploadPage.tsx](file:///c:/Users/saikiran/Desktop/xray1/frontend/src/pages/UploadPage.tsx)
- Replace simple file queue with a collage display of staged files.
- Each box shows the image on the left and vertical details on the right (filename, size, category, subcategory, custom name annotation).
- Clicking a box opens a modal with a blurred background where the user can:
  - Select Category/Subcategory (with options to add new ones).
  - Draw/edit the valid region using `ValidRegionEditor` (only for bags).
  - Input item name/annotation.
  - Automatically load existing subcategory valid regions from the database.
- Upload action sends staged files along with metadata to `/api/upload`.

#### [MODIFY] [LibraryPage.tsx](file:///c:/Users/saikiran/Desktop/xray1/frontend/src/pages/LibraryPage.tsx)
- Remove session-wise folders from sidebar. Sidebar now lists the 3 main categories and their subcategories directly.
- Remove `ValidRegionEditor` from `LibraryPage`.
- Move the selected items tray to be horizontally fit below the "Upload Files" action button.
- List selected items with details: `item name: file name, item size: file size, category: item category, sub category: item sub category, name of item: item name`, along with edit and delete options.

#### [MODIFY] [CollagePage.tsx](file:///c:/Users/saikiran/Desktop/xray1/frontend/src/pages/CollagePage.tsx)
- Add client-side validation using `isObjectInsideContainer` to skip/discard any collage permutations where random placement leads to out-of-bounds.

#### [MODIFY] [CustomizationPage.tsx](file:///c:/Users/saikiran/Desktop/xray1/frontend/src/pages/CustomizationPage.tsx)
- Remove all resize inputs, scale sliders, and corner resize handles from the sidebar and canvas workspace.
- Save the rotation (orientation) and pixel values of added items when exporting.
- Add support for saving customized layouts back to the Saved Page.

#### [NEW] [SavedPage.tsx](file:///c:/Users/saikiran/Desktop/xray1/frontend/src/pages/SavedPage.tsx)
- Create a Saved Page containing a search bar to search through saved layouts, preview images, and edit/delete actions.
- Clicking Edit redirects the user to the Customization page.

#### [MODIFY] [App.tsx](file:///c:/Users/saikiran/Desktop/xray1/frontend/src/App.tsx)
- Add `/saved` route and navigation link.

---

## Verification Plan

### Automated Tests
- Run database seeding/migration checks.
- Test endpoint health and functionality: `/api/upload`, `/api/saved-layouts`.
- Run `npm run build` to ensure TypeScript compilation succeeds.

### Manual Verification
- Upload bags and threats on the Upload Page, draw valid regions, and verify they save default regions to the database.
- Verify subcategory valid region auto-load.
- Generate collages and verify out-of-bounds combinations are skipped.
- Edit and save a layout in Customization, verify it saves to the Saved Page, and reload/re-edit it from there.
