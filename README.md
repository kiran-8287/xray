# Synthetic X-ray Synthesis Prototype

Desktop web UI prototype for an **Interactive Synthetic X-ray Bag Scan Generation System** using **structured SVG scanned bag rendering** (normalized 0–100 coordinate system).

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database

### Installation

```bash
# Install dependencies for both frontend and backend
npm install
```

### Database Setup

Ensure PostgreSQL is running locally with the following default credentials (or update `backend/scripts/seed-combined-library.js` and `backend/src/server.js` with your custom credentials):
- User: `postgres`
- Password: `SaiKiran2166`
- Database: `xray_db`
- Port: `5432`

### Seed Library

```bash
# Seed the library with all predefined scanned bags (recommended)
cd backend
npm run seed-combined-library

# Or use alternative seed scripts:
# npm run seed              # Seed taxonomy only
# npm run seed-test-images  # Generate simple test images
# npm run seed-full-library # Seed full library
```

### Run the Application

```bash
# Run both frontend and backend simultaneously
npm run dev

# Or run separately:
# Backend only
npm run dev:backend

# Frontend only
npm run dev:frontend
```

### Other Useful Commands

```bash
# Backend commands
cd backend
npm run seed-test-images           # Generate simple test images
npm run generate-organize-test-images  # Generate test images AND organize them into library structure
npm run generate-predefined-stencils  # Generate the 29 predefined SVG stencils (bags, trays, clothes, electronics, food, threats, stationary, toiletries)
npm run organize-images            # Organize library images into category folders
npm run rename-images              # Rename all images category-wise with unique IDs (bag1, bag2, threat1, etc.)
npm run start                      # Start backend in production mode

# Frontend commands
cd frontend
npm run build                      # Build for production
npm run lint                       # Lint code
```

## Project structure

- `frontend/`: React + TypeScript + Tailwind UI prototype (SVG vector scanned bags, interaction)
- `backend/`: Express API (save/export, library management, X-ray rendering)
