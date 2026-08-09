# Save Paths Display Feature

## Overview
When users click any save/export button, they now see a popup toast notification showing the **exact paths** where files are being stored.

## Buttons Affected

### SavedPage.tsx
- **Save All** - Exports all layouts
- **Save Selected** - Exports selected layouts
- **Individual Save** (per-layout save button) - Exports single layout

### UploadPage.tsx
- **Save All** - Exports all layouts
- **Save Selected** - Exports selected layouts  
- **Individual Save** - Exports single layout

## How It Works

1. The backend already returns `savedPaths` in the export response:
   ```typescript
   {
     ok: true,
     savedPaths: {
       high: ["/path/to/exports/high/layout_high.png"],
       low: ["/path/to/exports/low/layout_low.png"],
       annotations: ["/path/to/exports/annotations/layout.json"]
     }
   }
   ```

2. The frontend now extracts these paths and displays them in a **second toast notification** that appears 300ms after the success message.

3. Toast format:
   ```
   Saved to:
   High-res: /backend/data/exports/high/SB_layout_123_high.png
   Low-res: /backend/data/exports/low/SB_layout_123_low.png
   Annotations: /backend/data/exports/annotations/SB_layout_123.json
   ```

## Example User Experience

**Before:**
- Click "Save All"
- Toast: "Successfully exported 10 layouts (10 high, 10 low, 10 annotations)"

**After:**
- Click "Save All"
- Toast 1: "Successfully exported 10 layouts (10 high, 10 low, 10 annotations)"
- Toast 2 (300ms later): 
  ```
  Saved to:
  High-res: /backend/data/exports/high/SB_layout_1_high.png
  Low-res: /backend/data/exports/low/SB_layout_1_low.png
  Annotations: /backend/data/exports/annotations/SB_layout_1.json
  ```

## Files Modified

1. `frontend/src/pages/SavedPage.tsx`
   - Added `formatSavedPaths()` helper function
   - Updated `exportSelected()` to show paths
   - Updated `exportAll()` to show paths
   - Updated individual layout export to show paths

2. `frontend/src/pages/UploadPage.tsx`
   - Added `formatSavedPaths()` helper function
   - Updated `exportSelected()` to show paths
   - Updated `doExportAll()` to show paths
   - Updated `doExportIndividual()` to show paths

## Technical Details

- Paths are extracted from `result.savedPaths` returned by `/api/saved-layouts/export`
- Shows first path from each category (high, low, annotations)
- Uses `\n` for line breaks in toast messages
- Second toast appears after 300ms delay to avoid cluttering the UI
- Build passes successfully with no TypeScript errors

## Backend Paths

The actual save locations depend on the backend configuration:

- **Default exports path:** `backend/data/exports/`
  - High-res images: `backend/data/exports/high/`
  - Low-res images: `backend/data/exports/low/`
  - Annotations: `backend/data/exports/annotations/`

- **Custom exports path:** User can configure via Settings > Export Path

The paths shown in the toast are the **absolute filesystem paths** where files are actually saved on the server.