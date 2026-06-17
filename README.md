# Synthetic X-Ray Bag Scan Generation System

Web-based prototype for generating synthetic X-ray baggage scans from uploaded bag, threat, and non-threat object images. The app lets users build an image library, define valid placement regions inside bags, generate object combinations, customize layouts on a canvas, and export annotated PNG/JSON datasets for ML training.

For the complete architecture and file-by-file walkthrough, see `DETAILED_PROJECT_DOCUMENTATION.md`.

## What It Does

- Uploads scanned bags, threats, and non-threat objects into a PostgreSQL-backed library.
- Stores image files on disk under `backend/data/library_images/`.
- Draws normalized valid regions that constrain where objects may be placed inside bags.
- Renders browser previews and backend exports with Beer-Lambert-style X-ray attenuation.
- Saves layouts and exports single scenes or batch collage datasets with annotations.
- Includes local scanner conversion assets/scripts in `data_synthesis/`, `extracted_synthesis/`, and `extracted_files_low_high/`.

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, React Router, Canvas API.
- **Backend:** Node.js, Express, PostgreSQL, Multer, `node-canvas`, `pg`, `uuid`.
- **Data prep:** Python scripts for `.dump` and `.tip` scanner data conversion.

## Prerequisites

- Node.js 18+
- PostgreSQL running locally
- Python + OpenCV/NumPy only if running `data_synthesis/` conversion scripts

## Installation

Install dependencies in each npm package:

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

## Database Setup

The backend connects to PostgreSQL using these defaults from `backend/src/server.js`:

- User: `postgres`
- Password: `SaiKiran2166`
- Database: `xray_db`
- Host: `localhost`
- Port: `5432`

You can override them with environment variables:

```bash
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=xray_db
PGHOST=localhost
PGPORT=5432
```

The schema is initialized from `backend/src/schema.sql` when the backend starts.

## Running The App

Recommended during development: run backend and frontend in separate terminals.

```bash
# Terminal 1: backend API on http://localhost:8080
npm run dev:backend

# Terminal 2: frontend app on http://localhost:5174
npm run dev:frontend
```

Note: `npm run dev` currently runs `dev:backend` and then `dev:frontend` sequentially, so separate terminals are clearer for active development.

## Useful Commands

```bash
# Root
npm run build              # Build frontend
npm run lint               # Lint frontend
npm run start              # Start backend

# Backend
npm --prefix backend run seed
npm --prefix backend run seed-test-images
npm --prefix backend run generate-organize-test-images
npm --prefix backend run generate-predefined-stencils
npm --prefix backend run organize-images
npm --prefix backend run seed-full-library
npm --prefix backend run seed-combined-library
npm --prefix backend run rename-images

# Frontend
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend run preview
```

## Project Structure

```text
xray1/
|-- backend/                  # Express API, PostgreSQL schema, rendering/export logic
|   |-- src/
|   |   |-- server.js
|   |   |-- schema.sql
|   |   |-- api/datasetGenerator.js
|   |   `-- lib/
|   |-- data/                 # Uploaded images and generated exports
|   `-- scripts/              # Seed/import/image organization utilities
|-- frontend/                 # React + TypeScript + Vite UI
|   `-- src/
|       |-- pages/            # Upload, Library, Collage, Customization, Saved
|       |-- components/       # Upload/library/collage/customization UI
|       |-- context/          # UploadContext
|       |-- lib/              # X-ray rendering and geometry helpers
|       `-- types/            # Shared TypeScript types
|-- data_synthesis/           # Raw scanner conversion scripts and source samples
|-- extracted_synthesis/      # Extracted PNG assets
|-- extracted_files_low_high/ # Low/high-energy extracted PNG channels
|-- taxonomy.json             # Object taxonomy used during upload classification
`-- DETAILED_PROJECT_DOCUMENTATION.md
```
