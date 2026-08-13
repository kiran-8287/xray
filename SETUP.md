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
| `LOG_RETENTION_DAYS` | `14` | Number of days to keep rotated `monitoring.log` archives before purging them |
| `LOG_MAX_SIZE_MB` | `100` | Rotate the active `monitoring.log` once it grows past this size (MB) |
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

### Logging & monitoring

Logging is **always on**.

- **Request / error log (live, append-only):** every API request writes two newline-delimited JSON entries (`request_started` / `request_finished` with status, latency, memory, page hint, etc.) to:
  - Local run: `backend/data/storage/monitoring.log`
  - Docker run: `/app/data/storage/monitoring.log` → host `backend/data/storage/monitoring.log`
- **Console / app logs:** the backend uses `pino`. The Docker image sets `LOG_LEVEL=warn` by default (quieter terminals); set `LOG_LEVEL=info` for more detail.
- **Rotation & retention:** the active `monitoring.log` is rotated once it exceeds `LOG_MAX_SIZE_MB` (default **100 MB**), and rotated archives older than `LOG_RETENTION_DAYS` (default **14 days**) are purged automatically — the active file is never deleted or truncated while running.
- **Dashboard:** a Streamlit dashboard that visualizes these logs lives in `perf/monitoring/` (`streamlit run monitoring_dashboard.py`).

> **Why you might not see any logs:** the log file lives *inside the data folder* (`backend/data/storage/`), not in a top-level `logs/` folder, and the Docker image sets `LOG_LEVEL=warn` so the terminal is quiet while the file still gets written.

### Known deployment issues

#### Backend fails to start: bind-mounted data directory ownership mismatch

**Symptoms:** backend exits immediately with `EACCES: permission denied, mkdir '/app/data/storage'`.

**Cause:** `docker-compose.yml` bind-mounts `./backend/data` to `/app/data`. If that host folder was created/owned by a different UID/GID than the container runtime user, the non-root container process cannot create subdirectories inside it.

**Permanent fix included in this repo:** the backend uses an entrypoint script that self-heals `/app/data` ownership on every container start, so no host-side `sudo`/`chown` is required.

**One-time workaround commands (if needed):**

```bash
# Option 1: fix ownership from inside a throwaway root container
docker compose run --rm --user root backend chown -R 1000:1000 /app/data

# Option 2: if Option 1 is blocked by host security policies, run the backend
# container as the host folder's owner instead of the default node UID.
# Replace 2263 and 1001 with the UID/GID shown by:
#   docker compose run --rm --user root backend sh -c "ls -ld /app/data"
docker compose run --rm --user root backend sh -c "id -u node; ls -ld /app/data"
```

After applying either option, restart normally:

```bash
docker compose up --build
```

#### Custom export folder "does nothing" — files are saved but never show up (Linux + Docker)

**Symptoms:** using the **Export location** button, you pick a custom path on an absolute Linux path such as `/home/you/exports` — saving works (no error, a success toast appears), but **no files appear in the folder** on your machine. Saving to the *default* folders (`backend/data/...`) works fine.

**First: the app never blocks custom paths.** The backend happily creates and writes to any absolute path it can reach. Whether "it can reach" your folder depends on **where the backend is running**:

- **Running natively on Linux (no Docker):** any absolute path works. The user can save anywhere the Linux user running the backend has write permission (`/home/you/exports`, `/mnt/data/...`). Path = host path. Done.
- **Running inside Docker:** the container is effectively a separate machine with its **own filesystem**. It can only see (1) folders inside the container and (2) folders explicitly **bind-mounted** from the host. In our `docker-compose.yml` only one host folder is mounted:
  ```
  ./backend/data  →  /app/data
  ```
  So typing `/home/you/exports` is interpreted as `/home/you/exports` **inside the container**. The container creates that folder, writes the files and reports "success!" — but the host never sees the container's private filesystem, so the folder on the host stays empty. The files also disappear if the container is recreated.

That is the whole "silent failure": not a permission check rejecting the path, but a **host-path vs container-path mismatch**.

**Fix — so users can still "save wherever they want":**

1. **Recommended — pick a folder under the mounted data folder:** use `/app/data/exports_custom` (or any `/app/data/...`) in the UI. It persists on the host at `./backend/data/exports_custom`. No config change.
2. **Map a specific host folder into the container:** add a bind-mount in `docker-compose.yml`, then use the *container-side* path in the UI:
   ```yaml
   services:
     backend:
       volumes:
         - ./backend/data:/app/data
         - /home/you/exports:/exports   # expose a real host folder at /exports
   ```
   Now typing `/exports` in the UI writes to `/home/you/exports` on the host. (The host folder must be writable by the container's UID 1000 — `sudo chown -R 1000:1000 /home/you/exports` if needed.)
3. **Run the backend natively (no Docker):** every absolute host path just works, no mounts required.

The UI **warns you** (instead of silently accepting) when you pick a path that isn't mapped to the host, and the backend rejects read-only destinations immediately at save time.

#### `backend/data` is "undeletable" and you can't manually copy files out of it

**Symptoms:** on Linux you cannot `rm`/modify files or folders under `backend/data`, and pulling generated images out of that folder "doesn't work". You might suspect the app intentionally locks those folders and only lets you change them through the UI.

**That's not the case.** Nothing in the code restricts file access there. The cause is **ownership, not design**: the backend runs in Docker as a non-root `node` user (UID **1000**), and `backend/entrypoint.sh` runs `chown -R node:node /app/data` on startup. Every file in `./backend/data` therefore belongs to **UID 1000** on your host. If your host login has a different UID, Linux blocks you from deleting/modifying those files without elevated privileges — and the app itself has **no** download button for exported files (it just writes them to a folder), which is why "manual download" (copying them out of the folder) is what you're trying to do.

**Fix on the Linux host:**
```bash
# Give your own user ownership of the data folder so you can browse/modify/delete it:
sudo chown -R "$USER":"$USER" backend/data
# or, for one-off access, prefix commands with sudo, e.g.:
sudo ls -la backend/data
```
After running `sudo chown`, copy/delete files normally. This affects only file ownership; the app keeps working as before.