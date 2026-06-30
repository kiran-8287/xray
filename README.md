### Prerequisites
- **Docker Desktop (Recommended):** [Install Docker Desktop](https://www.docker.com/get-started)
  - **Important:** After installing, launch Docker Desktop and wait for it to show **"Docker Desktop is running"** (look for the whale icon in your system tray). Containers will not start without it.
- **OR Node.js 18+:** [Install Node.js](https://nodejs.org/)

> **Note:** The backend uses Python for raw file processing. Docker will automatically install Python3, numpy, and Pillow. For local Node.js development, ensure Python 3 is available if you plan to process raw .dump.pgm and .tip files.

---

### Option 1: With Docker (Recommended)

#### A) Using the Bootstrap Script (One Command)

```bash
# Clone the project
git clone https://github.com/kiran-8287/xray
cd xray

# ---------- Linux / Mac ----------
chmod +x bootstrap.sh
./bootstrap.sh

# ---------- Windows ----------
.\bootstrap.bat
```


#### B) Or Run Docker Commands Manually

```bash
# Build and start containers (run from the xray folder)
docker compose up -d --build

# View logs (press Ctrl+C to stop following)
docker compose logs -f

# Check container status
docker compose ps

# Stop containers when done
docker compose down
```


#### C) Access the Application

| Service     | URL                          |
|-------------|------------------------------|
| **Frontend**  | http://localhost:5174       |
| **Backend API** | http://localhost:8080     |

---

### Option 2: With Node.js (No Docker)

#### A) Using the Bootstrap Script

The same bootstrap scripts also work without Docker — they auto-detect npm, suppress audit/fund prompts, and install everything:

```bash
# Clone the project
git clone https://github.com/kiran-8287/xray
cd xray

# Linux / Mac
chmod +x bootstrap.sh
./bootstrap.sh

# Windows
.\bootstrap.bat
```

#### B) Or Manually Install and Run

```bash
# Install root dependencies (concurrently for running both servers)
npm install --no-audit --no-fund

# Install backend dependencies
cd backend
npm install --no-audit --no-fund
cd ..

# Install frontend dependencies
cd frontend
npm install --no-audit --no-fund
cd ..

# Start both frontend and backend in parallel
npm run dev
```

Then open **http://localhost:5174** in your browser.

---

## Troubleshooting

### "This site can't be reached — localhost refused to connect" (Port 5174)

| Possible Cause | How to Fix |
|---|---|
| **Docker Desktop is not running** | Open Docker Desktop from the Start Menu and wait for it to show **"Running"** (green status). |
| **Old containers without the curl fix** | Run `docker compose down && docker compose up -d --build` to rebuild with the latest changes. |
| **Port 5174 already in use** | Run `netstat -ano | findstr :5174` (Windows) or `lsof -i :5174` (Linux/Mac) to see what's using the port, then close that program. |
| **Backend container is unhealthy** | Run `docker compose ps` to check. If backend shows `unhealthy`, run `docker compose logs backend` for details. |
| **Frontend container didn't start** | Run `docker compose logs frontend` to see if there's a startup error. |

### Docker Command Not Found
- **`docker: command not found`** → Docker Desktop is not installed. Download from [docker.com](https://www.docker.com/get-started).
- **`docker-compose: command not found`** → Use `docker compose` (v2 syntax, no hyphen) instead.

### Windows-Specific Tips
- Always use `.\bootstrap.bat` (not just `bootstrap.bat`) to avoid PATH ambiguity.
- Run commands in **Command Prompt** or **PowerShell** — not in Git Bash or WSL unless you intend to.
- If Docker fails with permission errors, make sure Docker Desktop is running **as administrator** (right-click → Run as administrator).

### Fixing Docker BuildKit Issues on Windows

Docker Desktop on Windows has a known bug with BuildKit that causes "invalid file request" errors when building the frontend. **This must be fixed before building.**

**⚠️ Important: BuildKit must be disabled in Docker Desktop settings before building.**

**Option 1: Manual Docker Desktop Settings (Most Reliable)**
1. Open Docker Desktop
2. Go to **Settings** → **Builders** (or **Settings** → **General** in newer versions)
3. Look for **"Use Docker BuildKit"** or **"Enable BuildKit"**
4. **Uncheck** it
5. Click **Apply & Restart**
6. Wait for Docker Desktop to fully restart
7. Run `docker compose up -d --build` or `.\bootstrap.bat`

**Option 2: Use the Bootstrap Script**
```bash
.\bootstrap.bat
```
The script will check if BuildKit is disabled and prompt you if it's not.

**Option 3: PowerShell Auto-Fix**
```bash
powershell -ExecutionPolicy Bypass -File "scripts\disable-buildkit.ps1"
```
Then restart Docker Desktop and run `docker compose up -d --build`

**Note:** The BuildKit setting is stored in Docker Desktop's configuration, not in environment variables. The bootstrap scripts will guide you through disabling it if needed.

---
