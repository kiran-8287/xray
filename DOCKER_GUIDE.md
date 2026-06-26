# Docker Setup Guide for Synthetic X-Ray Generator

## Table of Contents
1. [What is Docker?](#what-is-docker)
2. [Project Docker Files Overview](#project-docker-files-overview)
3. [How to Run the Project with Docker](#how-to-run-the-project-with-docker)
4. [Stopping the Project](#stopping-the-project)
5. [Troubleshooting](#troubleshooting)

---

## What is Docker?

Docker is a platform that lets you package and run applications in isolated, lightweight environments called **containers**.

### Why use Docker for this project?
- **No need to install Node.js on your computer!**
- Works the same on Windows, Mac, and Linux
- Easy to set up, just a few commands

---

## Project Docker Files Overview

Here are the key files we added/modified:

| File Name | Location | Purpose |
|-----------|----------|---------|
| `Dockerfile` | `/backend/` | Instructions to build the backend container |
| `Dockerfile` | `/frontend/` | Instructions to build the frontend container |
| `docker-compose.yml` | Root project folder | Orchestrates running both backend and frontend together |
| `.dockerignore` | Root, backend, frontend | Excludes build artifacts and large files from Docker context for fast, portable builds |
| `bootstrap.sh` | Root project folder | Quick start script for Linux/Mac |
| `bootstrap.bat` | Root project folder | Quick start script for Windows |
| `.gitignore` | Root project folder | Tells Git which files to ignore (like node_modules, generated data) |
| `.gitattributes` | Root project folder | Ensures correct line endings for shell scripts |

---

## How to Run the Project with Docker

### Prerequisites
First, make sure you have Docker installed on your computer:
- Download from https://www.docker.com/get-started
- Install and open Docker Desktop (it needs to be running)

### Step 1: Clone the Project
```bash
git clone <your-project-repo-url>
cd xray
```

### Step 2: Quick Start (Easiest Way)

#### For Windows Users
Double-click on `bootstrap.bat` in the project folder, or run it in Command Prompt:
```cmd
bootstrap.bat
```

#### For Linux/Mac Users
Open a terminal and run:
```bash
chmod +x bootstrap.sh  # Make the script executable (only needed first time)
./bootstrap.sh
```

### Step 3: Open the Application
Once the containers are running:
- Frontend: Open your browser and go to http://localhost:5174
- Backend API: http://localhost:8080

---

## What if I don't want to use the bootstrap scripts?

If you prefer to run Docker commands manually:

### 1. Build and Start Both Containers
```bash
docker-compose up -d --build
```

### 2. See the Logs
```bash
docker-compose logs -f
```
Press `Ctrl+C` to stop viewing logs (containers will keep running).

---

## Stopping the Project

### If you used the bootstrap scripts:
- The script will show you the correct command for your setup.
- Run that to stop both containers.

### Manually stop:
```bash
docker-compose down
```
This will stop and remove both containers, but all your data (like library items, saved workspaces) is preserved in `backend/data`.

---

## Troubleshooting

### "Address already in use" Error
If you get an error like this:
```
Error: listen EADDRINUSE: address already in use :::8080
```
That means something is already using port 8080 or 5174.

**Solution:**
1. Open Task Manager (Windows) or Activity Monitor (Mac)
2. Find and kill any Node.js processes
3. Or restart your computer
4. Try running the bootstrap script again

### Docker Desktop isn't starting
Make sure Docker Desktop is open and running. Wait a minute or two after opening it for it to fully start.

---

## What about my data?
All your data is stored in `backend/data/`:
- `items.json`: Your library items
- `savedLayouts.json`: Your saved workspaces
- `library_images/`: Uploaded images
- `pixel_data/`: Raw pixel data from dump/tip files
- `exports/`: Generated synthetic scans
- `collage_images/`: Batch generated images

This data is **not deleted** when you stop Docker, so you can pick up where you left off!

---

## That's It!
You're all set to use the Synthetic X-Ray Generator with Docker! 🚀
