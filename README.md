
# Synthetic X-Ray Bag Scan Generation System

## 📚 Documentation
- [Docker Setup Guide](./DOCKER_GUIDE.md) - Complete step-by-step guide for using Docker

## Quick Start

### With Docker (Recommended - No Node.js installation needed!)
See the [Docker Setup Guide](./DOCKER_GUIDE.md) for detailed instructions, or use the quick start:
```bash
# Clone the project
git clone <repo-url>
cd xray1

# Linux/Mac
chmod +x bootstrap.sh
./bootstrap.sh

# Windows
bootstrap.bat
```

### With Node.js
```bash
# Clone the project
git clone <repo-url>
cd xray1

# Linux/Mac
chmod +x bootstrap.sh
./bootstrap.sh

# Windows
bootstrap.bat
```

**Or manually run these commands:**
```bash
npm install          # Install all dependencies
npm run dev          # Start both frontend and backend in parallel!
```

Now both frontend and backend will be running! 🎉
- Frontend: http://localhost:5174
- Backend: http://localhost:8080

## What's Included

- **No PostgreSQL**: Uses JSON files for all data storage
- **Portable Docker setup**: Run without installing Node.js on your system (see [Docker Guide](./DOCKER_GUIDE.md))
- **Data auto-creation**: All necessary directories and files are created automatically
- **No extra libraries**: Everything is self-contained
