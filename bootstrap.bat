@echo off
REM Bootstrap script for Windows

echo === Synthetic X-Ray Generation System - Bootstrap ===
echo.

REM Check if Docker is available (Compose V1 or V2)
where docker >nul 2>nul
if %errorlevel% == 0 (
    docker compose version >nul 2>nul
    if %errorlevel% == 0 (
        set DOCKER_COMPOSE_CMD=docker compose
    ) else (
        where docker-compose >nul 2>nul
        if %errorlevel% == 0 (
            set DOCKER_COMPOSE_CMD=docker-compose
        )
    )

    if defined DOCKER_COMPOSE_CMD (
        echo Docker found! Starting with Docker...
        echo.
        echo NOTE: If you encounter "invalid file request" errors, disable Docker BuildKit:
        echo 1. Open Docker Desktop
        echo 2. Go to Settings -^> Builders
        echo 3. Uncheck "Use Docker BuildKit"
        echo 4. Click Apply and Restart
        echo.
        
        REM Disable BuildKit for this session to avoid Windows compatibility issues
        set DOCKER_BUILDKIT=0
        
        %DOCKER_COMPOSE_CMD% up -d --build
        echo.
        echo Success! The app is now running!
        echo Frontend: http://localhost:5174
        echo Backend: http://localhost:8080
        echo.
        echo To stop the app: %DOCKER_COMPOSE_CMD% down
        goto :eof
    )
)

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
