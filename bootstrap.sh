#!/bin/bash

# Bootstrap script for Linux/Mac
set -e

echo "=== Synthetic X-Ray Generation System - Bootstrap ==="
echo ""

# Check if Docker is available
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "Docker found! Starting with Docker..."
    docker-compose up -d --build
    echo ""
    echo "✅ Success! The app is now running!"
    echo "📱 Frontend: http://localhost:5174"
    echo "🔧 Backend: http://localhost:8080"
    echo ""
    echo "To stop the app: docker-compose down"
elif command -v npm &> /dev/null; then
    echo "npm found! Installing dependencies and starting..."
    
    # Disable npm audit and funding prompts
    export npm_config_audit=false
    export npm_config_fund=false
    
    # Install all dependencies (including concurrently)
    echo "Installing root dependencies..."
    npm install --no-audit --no-fund
    
    # Install backend dependencies
    echo "Installing backend dependencies..."
    cd backend
    npm install --no-audit --no-fund
    cd ..
    
    # Install frontend dependencies
    echo "Installing frontend dependencies..."
    cd frontend
    npm install --no-audit --no-fund
    cd ..
    
    echo ""
    echo "✅ Dependencies installed!"
    echo ""
    echo "Starting frontend and backend in parallel..."
    echo ""
    npm run dev
else
    echo "❌ Error: Neither Docker nor npm found!"
    echo ""
    echo "Please install either:"
    echo "  1. Docker (recommended): https://www.docker.com/get-started"
    echo "  2. Node.js (version 18+): https://nodejs.org/"
    exit 1
fi
