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