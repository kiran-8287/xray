# Synthetic X-Ray Bag Scan Generation System

## 📚 Documentation
- [Docker Setup Guide](./DOCKER_GUIDE.md) - Complete step-by-step guide for using Docker
- [Windows Compatibility Fixes](./WINDOWS_FIX.md) - Windows-specific fixes and troubleshooting

## Quick Start

### Prerequisites
- **Docker (Recommended):** [Install Docker Desktop](https://www.docker.com/get-started) and ensure it's running
- **OR Node.js 18+:** [Install Node.js](https://nodejs.org/)

No admin/sudo privileges or build tools (Python, C++ compiler) required. All dependencies are pure JavaScript.

---

### Option 1: With Docker (Recommended)
See the [Docker Setup Guide](./DOCKER_GUIDE.md) for detailed instructions, or use the quick start:

```bash
# Clone the project
git clone https://github.com/kiran-8287/xray
cd xray

# Linux/Mac
chmod +x bootstrap.sh
./bootstrap.sh

# Windows
bootstrap.bat
```

**Or run Docker commands manually:**
```bash
docker-compose up -d --build    # Start containers
docker-compose logs -f          # View logs
docker-compose down             # Stop containers
```

---

### Option 2: With Node.js
Use the same bootstrap scripts — they auto-detect npm, suppress audit/fund prompts, and install dependencies:

```bash
# Clone the project
git clone https://github.com/kiran-8287/xray
cd xray

# Linux/Mac
chmod +x bootstrap.sh
./bootstrap.sh

# Windows
bootstrap.bat
```

**Or manually install and run:**
```bash
npm install --no-audit --no-fund
cd backend && npm install --no-audit --no-fund && cd ..
cd frontend && npm install --no-audit --no-fund && cd ..
npm run dev
```

---

## Access the Application

- **Frontend:** http://localhost:5174
- **Backend API:** http://localhost:8080

---

## What's Included

- **No PostgreSQL**: Uses JSON files for all data storage
- **Portable Docker setup**: Run without installing Node.js on your system (see [Docker Guide](./DOCKER_GUIDE.md))
- **Cross-platform scripts**: `bootstrap.sh` (Linux/Mac) and `bootstrap.bat` (Windows) for one-command setup
- **No native modules**: Replaced `canvas` with pure-JS `jimp` — no Python/C++ build tools needed
- **No admin/sudo required**: All dependencies install without elevated privileges
- **Clean npm output**: Audit and funding prompts disabled (`--no-audit --no-fund`) in all scripts
- **Vite compatibility**: Frontend uses `npx vite` to avoid Windows permission issues
- **Data auto-creation**: All necessary directories and files are created automatically
- **Data persistence**: Your library items and saved workspaces are stored in `backend/data/` and survive container restarts or process stops
