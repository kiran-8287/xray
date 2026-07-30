# Synthetic X-Ray Prototype

This project contains a frontend and backend for generating and reviewing synthetic X-ray bag scan data.

## Prerequisites

Before you start, install:

- Git
- Node.js 20+ and npm
- Docker Desktop (optional, for the Docker-based setup)

## Clone the repository

```bash
git clone <your-repository-url>
cd xray
```

## Option 1: Run with Docker (recommended)

This starts both services together with Docker Compose.

```bash
docker compose up --build
```

Once the containers are running:

- Frontend: http://localhost:5174
- Backend: http://localhost:8080

To stop the services:

```bash
docker compose down
```

### Windows note

If Docker build fails on Windows, the included bootstrap script can be used as a fallback:

```bat
bootstrap.bat
```

## Option 2: Run with Node.js

Install dependencies for the root app, backend, and frontend:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

Start both services together:

```bash
npm run dev
```

This starts:

- Frontend dev server on http://localhost:5174
- Backend API on http://localhost:8080

### Run each service separately

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

## Useful scripts

From the repository root:

- `npm run dev` — starts frontend and backend together
- `npm run build` — builds the frontend
- `npm run start` — starts the backend

## Troubleshooting

- If the frontend cannot reach the backend, make sure the backend is running on port 8080.
- If Docker is slow or fails to build on Windows, try the Node.js option instead.
- If dependencies are missing, rerun the install commands above.
