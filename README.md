
# Synthetic X-Ray Bag Scan Generation System

## Prerequisites

- Node.js 18+

## Installation

```bash
# Install root dependencies
npm install

# Install backend dependencies
npm --prefix backend install

# Install frontend dependencies
npm --prefix frontend install
```

## Project Structure

- `frontend/` - React + TypeScript frontend application
- `backend/` - Node.js + Express backend API
  - `backend/src/lib/storage.js` - File-based JSON storage (replaces PostgreSQL)
  - `backend/data/` - Directory for data files (auto-created)
    - `data/items.json` - Library items
    - `data/bags.json` - Bag data with valid regions
    - `data/threats.json` - Threat item data
    - `data/nonThreatItems.json` - Non-threat item data
    - `data/savedLayouts.json` - Saved annotation layouts
    - `data/library_images/` - Uploaded image files
    - `data/exports/` - Exported X-ray scans with annotations
    - `data/collage_images/` - Batch-generated collages
- `data_synthesis/` - Original Python utilities (kept for compatibility)

## Running

Run backend and frontend in **separate terminal windows**:

```bash
# Terminal 1: Backend API on http://localhost:8080
npm run dev:backend

# Terminal 2: Frontend app on http://localhost:5174
npm run dev:frontend
```

## Key Improvements

1. **Image Scaling Fix**: All objects now render at their exact original dimensions, no scaling/resizing
2. **File-Based Storage**: Replaced PostgreSQL with simple JSON files for portability
3. **Improved Annotations**: 
   - 4-corner coordinates for all objects
   - Coordinates relative to bag origin (leftmost point)
   - Valid region polygon included in annotations
   - Unique object IDs for reproducibility
4. **Native Node.js File Readers**: 
   - `backend/src/lib/dumpRead.js`: Node.js implementation of dumpread.py
   - `backend/src/lib/tipRead.js`: Node.js implementation of tipread.py
   - Original Python files in `data_synthesis/` are preserved for compatibility

## Annotations

Each exported annotation JSON includes:
- `bag_origin`: {x, y} coordinates of the bag's leftmost point
- `valid_region`: The bag's valid placement region polygon
- `objects`: Array of all objects in the scene
  - Each object has: `corners` (absolute coordinates), `corners_relative_to_bag`, `segmentation`, `segmentation_relative_to_bag`

## Build

```bash
# Build frontend for production
npm run build
```
