# Windows Compatibility Fixes

This document summarizes the fixes applied to make the project work on Windows without sudo/admin privileges.

## Issues Fixed

### 1. Canvas Native Module Error (Invalid ELF Header)
**Problem:** The `canvas` npm package is a native module that requires build tools (Python, C++ compiler) and fails on Windows with "Invalid ELF header" error.

**Solution:** Replaced `canvas` with `jimp` (pure JavaScript image processing library):
- Removed `canvas` from root `package.json` and `backend/package.json`
- Added `jimp` to `backend/package.json`
- Updated `backend/src/server.js` to use `Jimp.read()` instead of `loadImage()`
- Updated `backend/src/lib/renderCanvas.js` to use Jimp for image rendering instead of Canvas API

### 2. Vite Permission Denied Error
**Problem:** The vite binary had permission issues on Windows (exit code 126).

**Solution:** Changed frontend scripts to use `npx vite` instead of direct `vite` command:
- `"dev": "npx vite"` instead of `"dev": "vite"`
- `"build": "npx vite build"` instead of `"build": "tsc -b && vite build"`
- `"preview": "npx vite preview"` instead of `"preview": "vite preview"`

### 3. NPM Audit/Fund Prompts
**Problem:** NPM was showing audit warnings and funding prompts during installation.

**Solution:** Updated both bootstrap scripts to disable these prompts:
- Added `--no-audit --no-fund` flags to all `npm install` commands
- Set environment variables `npm_config_audit=false` and `npm_config_fund=false`

## How to Run

### Option 1: Using Docker (Recommended)
```bash
# Windows - use bootstrap.bat
bootstrap.bat

# Or manually:
docker-compose up -d --build
```
Then open:
- Frontend: http://localhost:5174
- Backend: http://localhost:8080

### Option 2: Using npm directly
```bash
# Windows - use bootstrap.bat
bootstrap.bat

# Or manually:
npm install --no-audit --no-fund
cd backend && npm install --no-audit --no-fund && cd ..
cd frontend && npm install --no-audit --no-fund && cd ..
npm run dev
```

### Option 3: Linux/Mac
```bash
chmod +x bootstrap.sh
./bootstrap.sh
```

## Files Modified

1. `package.json` - Removed canvas dependency
2. `backend/package.json` - Replaced canvas with jimp
3. `backend/src/server.js` - Updated to use Jimp for image loading
4. `backend/src/lib/renderCanvas.js` - Rewritten to use Jimp instead of Canvas
5. `frontend/package.json` - Changed scripts to use npx
6. `bootstrap.bat` - Added --no-audit --no-fund flags
7. `bootstrap.sh` - Added --no-audit --no-fund flags

## Notes

- No sudo/admin privileges required
- No build tools (Python, C++ compiler) needed
- All dependencies are pure JavaScript
- Works on Windows, Linux, and Mac