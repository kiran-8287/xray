@echo off
REM Bootstrap script for Windows

echo === Synthetic X-Ray Generation System - Bootstrap ===
echo.

REM Check if Docker is available
where docker >nul 2>nul
if %errorlevel% == 0 (
    where docker-compose >nul 2>nul
    if %errorlevel% == 0 (
        echo Docker found! Starting with Docker...
        docker-compose up -d --build
        echo.
        echo Success! The app is now running!
        echo Frontend: http://localhost:5174
        echo Backend: http://localhost:8080
        echo.
        echo To stop the app: docker-compose down
        goto :eof
    )
)

REM Check if npm is available
where npm >nul 2>nul
if %errorlevel% == 0 (
    echo npm found! Installing dependencies and starting...
    
    REM Install all dependencies (including concurrently)
    echo Installing root dependencies...
    call npm install
    
    REM Install backend dependencies
    echo Installing backend dependencies...
    cd backend
    call npm install
    cd ..
    
    REM Install frontend dependencies
    echo Installing frontend dependencies...
    cd frontend
    call npm install
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
