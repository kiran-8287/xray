# Synthetic X-Ray Bag Scan Generation System

## Prerequisites

- Node.js 18+
- PostgreSQL running locally

## Installation

```bash
# Install root dependencies
npm install

# Install backend dependencies
npm --prefix backend install

# Install frontend dependencies
npm --prefix frontend install
```

## Database Setup

The backend connects to PostgreSQL with these defaults (from `backend/src/server.js`):

- **User:** `postgres`
- **Password:** `SaiKiran2166`
- **Database:** `xray_db`
- **Host:** `localhost`
- **Port:** `5432`

Override with environment variables: `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGHOST`, `PGPORT`.

The schema initializes automatically from `backend/src/schema.sql` when the backend starts.

## Running

Run backend and frontend in **separate terminal windows**:

```bash
# Terminal 1: Backend API on http://localhost:8080
npm run dev:backend

# Terminal 2: Frontend app on http://localhost:5174
npm run dev:frontend
```

## Build

```bash
# Build frontend for production
npm run build
```
