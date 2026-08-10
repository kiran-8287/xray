# Setup Guide

## Overview

This repository contains a full-stack application for generating and reviewing synthetic X-ray bag scan data. It consists of:

- **Frontend** — React + Vite + TypeScript + Tailwind CSS (served on `http://localhost:5174`)
- **Backend** — Express.js server with file processing pipelines (served on `http://localhost:8080`)
- **Python scripts** — NumPy / SciPy / OpenCV / Pillow utilities spawned by the backend for raw pixel processing

---

## Installation

The recommended way to run the application is with Docker Compose.

### Step 1: Clone the repository

```bash
git clone <your-repository-url>
cd xray
```

### Step 2: Run with Docker

From the repository root:

```bash
docker compose up --build
```

Once the containers are healthy:

- **Frontend:** http://localhost:5174
- **Backend:** http://localhost:8080

To stop:

```bash
docker compose down
```

### Step 3: Verify the setup

1. Open http://localhost:5174 in your browser.
2. Confirm the frontend loads without errors.
3. Confirm the backend health endpoint responds:

```bash
curl http://localhost:8080/api/items/categorized
```

---

## Versions used

These are the versions currently used in this project. You do not need to install them manually when using Docker.

| Component | Version / Constraint |
|-----------|---------------------|
| Docker image base | `node:20-alpine` |
| Node.js | 20 |
| React | ^18.3.1 |
| TypeScript | ^5.9.3 |
| Vite | ^5.4.20 |
| Tailwind CSS | ^3.4.17 |
| Express | ^4.22.2 |
| Python | 3.11 (container) |
| numpy | >= 1.24 |
| scipy | >= 1.10 |
| opencv-python | >= 4.8 |
| Pillow | >= 10.0 |

---

## Environment configuration (optional)

The application works out of the box with built-in defaults. If you want to customize paths or limits, copy the example environment file:

```bash
cp .env.example .env
```

Then edit `.env` in the project root.

### What you need to set

Most variables have safe built-in defaults. You only need to change them if you know why.

| Variable | Default | When to change it |
|----------|---------|-------------------|
| `PORT` | `8080` | Only if another service already uses port 8080 |
| `NODE_ENV` | `development` | Leave as-is for local use |
| `API_KEY` | *(empty)* | Only if you want to enable write-endpoint auth. Leave empty for development. |
| `LIBRARY_IMAGES_PATH` | `<project>/backend/data/library_images` | Only if you want to store images on a different drive |
| `COLLAGE_IMAGES_PATH` | `<project>/backend/data/collage_images` | Only if you want to store collages on a different drive |
| `PIXEL_DATA_PATH` | `<project>/backend/data/pixel_data` | Only if you want to store pixel data on a different drive |
| `DATA_DIR` | `<project>/backend/data/storage` | Only if you want to store JSON data on a different drive |
| `EXPORTS_PATH` | `<project>/backend/data/exports` | Only if you want exports saved elsewhere |
| `TEMP_PATH` | `<project>/backend/data/temp` | Only if you want temp files saved elsewhere |
| `LOG_LEVEL` | `info` | Only if you want more/less server logging |
| `MAX_FILE_SIZE` | `104857600` (100 MB) | Only if you need a different max file size for the `/api/upload` endpoint |
| `MAX_FILES_PER_UPLOAD` | `5000` | Only if you need to raise/lower the max files per request for `/api/upload` |
| `UPLOAD_TIMEOUT_MS` | `1800000` (30 min) | Only if you need a longer/shorter timeout for `/api/upload` |

> **Note for Windows users:** Use absolute Windows paths (e.g. `B:\\xray_data`) and escape backslashes in `.env` (e.g. `B:\\\\xray_data`).

### Storage paths

By default, all data is stored under `backend/data/` inside the project. You do not need to set any path variables unless:
- You want to store data on an external drive
- You are running the app in production and want to separate data from the app code

If you do not set the path variables, the backend creates the directories automatically on first run.

### Upload limits

The backend enforces upload limits to protect against resource exhaustion. These are applied per-endpoint:

- **MAX_FILE_SIZE** — Largest single file accepted (default: 100 MB). Used by the legacy `/api/upload` endpoint.
- **MAX_FILES_PER_UPLOAD** — Maximum files per request batch (default: 5,000). Used by the legacy `/api/upload` endpoint.
- **UPLOAD_TIMEOUT_MS** — Request timeout for `/api/upload` (default: 30 minutes). If exceeded, the server returns a clean `408` error instead of crashing.

**For the current frontend upload flow**, files are sent to `/api/process-raw-files` in pages of 100. That endpoint uses a separate hardcoded limit of 5,000 files per request and does not use the timeout setting above. So for typical use, the defaults are sufficient and these settings only need changing if you are using the `/api/upload` endpoint directly.
From the repository root:

---

## Run without Docker (optional)

If Docker is not available, you can run the application locally with Node.js.

### Node.js

Install JavaScript dependencies for all `package.json` files:

```bash
npm install --no-audit --no-fund
npm install --prefix backend --no-audit --no-fund
npm install --prefix frontend --no-audit --no-fund
```

### Python dependencies (required if not using Docker)

If you are running with Docker, Python dependencies are installed automatically inside the container. If you are running without Docker, install them locally:

```bash
pip install -r backend/requirements.txt
```

Or equivalently:

```bash
cd backend && pip install -r requirements.txt
```

### Start the application

From the repository root:

```bash
npm run dev
```

This runs concurrently:

- **Frontend** — Vite dev server at http://localhost:5174
- **Backend** — Express API at http://localhost:8080

#### Run services separately

**Backend only:**

```bash
cd backend
npm run dev
```

**Frontend only:**

```bash
cd frontend
npm run dev
```

#### Windows fallback

If `docker compose up --build` fails due to the Docker BuildKit bug on Windows, use the fallback bootstrap script:

```bat
bootstrap.bat
```

This script attempts Docker first, then falls back to the Node.js setup automatically.

---

## Useful scripts

From the repository root:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend and backend together (Node.js only) |
| `npm run dev:frontend` | Start frontend only (Node.js only) |
| `npm run dev:backend` | Start backend only (Node.js only) |
| `npm run build` | Build the frontend for production |
| `npm run build:frontend` | Build frontend only |
| `npm run start` | Start the backend (production mode, Node.js only) |
| `npm run start:backend` | Start backend only (production, Node.js only) |
| `npm run lint` | Lint the frontend |

From `backend/`:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend with file watching (Node.js only) |
| `npm run start` | Start backend (production, Node.js only) |
| `npm test` | Run backend tests with Jest |

From `frontend/`:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

---

## Troubleshooting

- **Frontend cannot reach backend:** Ensure the backend is running on port `8080` and `VITE_API_URL` is set correctly in `frontend/.env.development`.
- **`ModuleNotFoundError: No module named 'scipy'`:** Python packages are not installed. Run `pip install -r backend/requirements.txt`.
- **Docker is slow or fails to build on Windows:** Use `bootstrap.bat` which handles the Docker-first fallback automatically.
- **Multiple Python versions installed:** Make sure the `python` and `pip` commands on your `PATH` point to the same installation where you installed the requirements.
- **Backend fails to start:** Check that `PORT` is not already in use and that `.env` exists in the project root and `backend/` directories.
- **Upload fails with large files:** Adjust `MAX_FILE_SIZE` and `UPLOAD_TIMEOUT_MS` in `.env` if needed.