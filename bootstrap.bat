@echo off
REM Bootstrap script for Windows

echo === Synthetic X-Ray Generation System - Bootstrap ===
echo.

REM Check if Docker is available (Compose V1 or V2)
set DOCKER_COMPOSE_CMD=
where docker >nul 2>nul
if %errorlevel% == 0 (
    docker compose version >nul 2>nul
    if %errorlevel% == 0 (
        set DOCKER_COMPOSE_CMD=docker compose
    )
)

if not defined DOCKER_COMPOSE_CMD (
    where docker-compose >nul 2>nul
    if %errorlevel% == 0 (
        set DOCKER_COMPOSE_CMD=docker-compose
    )
)

REM Check if Docker Compose command was found
if defined DOCKER_COMPOSE_CMD (
    echo Docker found! Starting with Docker...
    echo.
    
    REM Try building with Docker (may fail on Windows due to BuildKit bug)
    echo Building and starting containers...
    %DOCKER_COMPOSE_CMD% up -d --build
    if %errorlevel% neq 0 (
        echo.
        echo ========================================
        echo Docker build failed. This is likely due to
        echo the Docker BuildKit bug on Windows.
        echo.
        echo Falling back to Node.js mode...
        echo ========================================
        echo.
        goto :python_install
    )
    
    echo.
    echo Success! The app is now running!
    echo Frontend: http://localhost:5174
    echo Backend: http://localhost:8080
    echo.
    echo To stop the app: %DOCKER_COMPOSE_CMD% down
    goto :eof
)

:python_install

REM Check if Python is available
where python >nul 2>nul
if %errorlevel% == 0 (
    echo Python found! Installing Python dependencies...
    cd backend
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo.
        echo Warning: Failed to install Python dependencies.
        echo The backend requires numpy, scipy, opencv-python, and Pillow.
        echo Please install them manually: pip install -r backend/requirements.txt
    )
    cd ..
) else (
    echo.
    echo Warning: Python not found! The backend requires Python 3 with:
    echo   - numpy
    echo   - scipy
    echo   - opencv-python
    echo   - Pillow
    echo Please install Python 3 from https://www.python.org/ and rerun this script.
)

:npm_install

REM Check if npm is available
where npm >nul 2>nul
if %errorlevel% == 0 (
    echo npm found! Installing dependencies and starting...
    
    REM Disable npm audit and funding prompts
    set npm_config_audit=false
    set npm_config_fund=false
    
    REM Install all dependencies (including concurrently)
    echo Installing root dependencies...
    call npm install --no-audit --no-fund
    
    REM Install backend dependencies
    echo Installing backend dependencies...
    cd backend
    call npm install --no-audit --no-fund
    cd ..
    
    REM Install frontend dependencies
    echo Installing frontend dependencies...
    cd frontend
    call npm install --no-audit --no-fund
    cd ..
    
    echo.
    echo Dependencies installed!
    echo.
    echo Starting frontend and backend in parallel...
    echo.
    call npm run dev
) else (
    echo Error: Neither Docker nor npm found!
    echo.
    echo Please install either:
    echo   1. Docker (recommended): https://www.docker.com/get-started
    echo   2. Node.js (version 18+): https://nodejs.org/
)
