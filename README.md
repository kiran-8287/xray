### Prerequisites
- **Docker Desktop:** [Install Docker Desktop](https://www.docker.com/get-started)
- **OR Node.js 18+:** [Install Node.js](https://nodejs.org/)

---

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/kiran-8287/xray
cd xray

# Windows
.\bootstrap.bat

# Linux / Mac
chmod +x bootstrap.sh && ./bootstrap.sh
```

**Or manually:**
```bash
docker compose up -d --build
```

| Service     | URL                          |
|-------------|------------------------------|
| **Frontend**  | http://localhost:5174       |
| **Backend API** | http://localhost:8080     |

---

### Option 2: Node.js (No Docker)

```bash
git clone https://github.com/kiran-8287/xray
cd xray

# Install all dependencies
cd backend && npm install --no-audit --no-fund && cd ..
cd frontend && npm install --no-audit --no-fund && cd ..

# Start both frontend and backend
npm run dev
```

Open **http://localhost:5174**.

---

### Troubleshooting

**Docker BuildKit issues on Windows:**
1. Open Docker Desktop → **Settings** → **Builders**
2. Uncheck **"Use Docker BuildKit"** → **Apply & Restart**
3. Run `.\bootstrap.bat` or `docker compose up -d --build`

---

## Data Privacy & Isolation

### Automatic Cache Clearing

The app automatically clears browser storage on **first startup** after cloning. This ensures:
- No shared uploaded items between users
- No shared saved layouts or selections
- Each user starts with a clean slate

The app detects if it's the first time running and clears any stale data from previous sessions.

### What Gets Stored Locally

**Server-side** (in `backend/data/`):
- Uploaded items and images
- Saved layouts
- User preferences

These files are **not** committed to Git (protected by `.gitignore`), so each user has their own local data.

**Client-side** (in your browser):
- Library selections and filters
- Generated combinations
- Workspace state

Each browser maintains separate storage. Data is not shared across browsers or devices.

### Manual Cache Clear (If Needed)

If you need to clear your browser cache manually:
1. Open the app
2. Press **F12** to open DevTools
3. Go to **Application** tab (Chrome/Edge) or **Storage** tab (Firefox)
4. Click **Clear site data**

Or simply delete the `xray_initialized` key from localStorage to trigger the automatic clear on next startup.
