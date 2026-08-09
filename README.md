# Synthetic X-Ray

Full-stack app for generating and reviewing synthetic X-ray bag scan data.

- **Frontend** — React + Vite + TypeScript + Tailwind CSS → http://localhost:5174
- **Backend** — Express + file processing pipelines → http://localhost:8080
- **Python scripts** — NumPy / SciPy / OpenCV / Pillow spawned by the backend for raw pixel processing

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Git | any recent | clone the repo |
| Docker Desktop | latest stable | primary way to run |
| Python | 3.8+ | required by backend scripts |
| pip | bundled | `pip install -r backend/requirements.txt` |
| Node.js | 20+ | optional, local dev without Docker |
| npm | bundled with Node 20+ | optional |

## Quick start

```bash
# 1. Clone and enter the repo
git clone <your-repository-url>
cd xray

# 2. Configure environment (defaults are safe to keep)
cp .env.example .env

# 3. Run (recommended: Docker Compose)
docker compose up --build
# Stop with:  docker compose down
```

Then open **http://localhost:5174**. Backend health check:

```bash
curl http://localhost:8080/api/items/categorized
```

### Windows fallback

If `docker compose up --build` fails (known BuildKit bug on Windows), run:

```bat
bootstrap.bat
```

## Run without Docker (Node.js)

```bash
npm install --no-audit --no-fund
npm install --prefix backend --no-audit --no-fund
npm install --prefix frontend --no-audit --no-fund
pip install -r backend/requirements.txt   # Python deps
npm run dev                               # starts frontend + backend
```

Or run each separately: `cd backend && npm run dev` and `cd frontend && npm run dev`.

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

See **[setup.md](setup.md)** for the full setup guide, environment variables, and upload limits.
