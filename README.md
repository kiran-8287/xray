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

The backend connects to PostgreSQL using environment variables. Create a `.env` file in the `backend/` directory (see `backend/.env.example` if available) or set them directly:

| Variable | Default | Description |
|---|---|---|
| `PGUSER` | `postgres` | PostgreSQL username |
| `PGPASSWORD` | *(required)* | PostgreSQL password |
| `PGDATABASE` | `xray_db` | Database name |
| `PGHOST` | `localhost` | Database host |
| `PGPORT` | `5432` | Database port |

The schema initializes automatically from `backend/src/schema.sql` when the backend starts.

> **Note:** Never commit real credentials to version control. Use a `.env` file (add it to `.gitignore`) or set environment variables in your deployment environment.

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
