# Synthetic X-Ray

Full-stack app for generating and reviewing synthetic X-ray bag scan data.

- **Frontend** — React + Vite + TypeScript + Tailwind CSS → http://localhost:5174
- **Backend** — Express + file processing pipelines → http://localhost:8080
- **Python scripts** — NumPy / SciPy / OpenCV / Pillow spawned by the backend for raw pixel processing

## Installation

The fastest way to run the application is with Docker Compose.

```bash
# 1. Clone and enter the repo
git clone <your-repository-url>
cd xray

# 2. Start the application
docker compose up --build
# Stop with:  docker compose down
```

Then open **http://localhost:5174**.

### Windows fallback

If `docker compose up --build` fails (known BuildKit bug on Windows), run:

```bat
bootstrap.bat
```

## Versions used

These are the versions currently used in this project. You do not need to install them manually when using Docker.

| Component | Version |
|-----------|---------|
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

## Run without Docker (optional)

If Docker is not available, you can run the services directly.

```bash
# Install JavaScript dependencies
npm install --no-audit --no-fund
npm install --prefix backend --no-audit --no-fund
npm install --prefix frontend --no-audit --no-fund

# Install Python dependencies
pip install -r backend/requirements.txt

# Start both services
npm run dev
```

Or run each separately: `cd backend && npm run dev` and `cd frontend && npm run dev`.

## Environment configuration (optional)

The application works out of the box with built-in defaults. If you want to customize paths or limits, copy the example environment file:

```bash
cp .env.example .env
```

Then edit `.env` in the project root. Common settings:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | Backend port |
| `API_KEY` | *(empty)* | Enable write-endpoint auth |
| `LIBRARY_IMAGES_PATH` | `backend/data/library_images` | Image storage path |
| `MAX_FILE_SIZE` | `104857600` (100 MB) | Upload limit |
| `MAX_FILES_PER_UPLOAD` | `5000` | Files per request |
| `UPLOAD_TIMEOUT_MS` | `1800000` (30 min) | Upload timeout |

> **Note:** When running with Docker, you typically do not need to create `.env` unless you want to override defaults.

## Useful scripts

- `npm run dev` — frontend + backend together
- `npm run build` — build frontend for production
- `npm run start` — start backend (production)
- `npm run lint` — lint the frontend

## Troubleshooting

- **Frontend can't reach backend:** make sure the backend runs on port 8080 and `VITE_API_URL` is set in `frontend/.env.development`.
- **`No module named 'scipy'`:** the Python packages aren't installed — run `pip install -r backend/requirements.txt`.
- **Docker fails on Windows:** use `bootstrap.bat` or the Node.js option.
- **Backend won't start:** check that port 8080 is free and `.env` exists in the root and `backend/`.
- **Backend crashes with `EACCES: permission denied, mkdir '/app/data/storage'`:** see **[Known Issues](#known-issues)** below.

### Known Issues

#### Backend fails to start: bind-mounted data directory ownership mismatch

**Symptoms:** backend exits immediately with `EACCES: permission denied, mkdir '/app/data/storage'`.

**Cause:** `docker-compose.yml` bind-mounts `./backend/data` to `/app/data`. If that host folder was created/owned by a different UID/GID than the container runtime user, the non-root container process cannot create subdirectories inside it.

**Permanent fix included in this repo:** the backend now uses an entrypoint script that self-heals `/app/data` ownership on every container start, so no host-side `sudo`/`chown` is required.

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

See **[SETUP.md](SETUP.md)** for the full setup guide, environment variables, and upload limits.
