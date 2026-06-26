from pathlib import Path

compose_path = Path(r"c:\Users\saikiran\Desktop\xray\docker-compose.yml")
text = compose_path.read_text(encoding="utf-8")
lines = text.splitlines()

# Remove trailing blank lines
while lines and lines[-1].strip() == "":
    lines.pop()

# Find and remove trailing unused volume declarations
if lines and lines[-1].strip() == "node_modules_frontend:":
    lines.pop()
if lines and lines[-1].strip() == "node_modules_backend:":
    lines.pop()
if lines and lines[-1].strip() == "volumes:":
    lines.pop()

# Remove blank lines at the end
while lines and lines[-1].strip() == "":
    lines.pop()

compose_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

bootstrap_sh = Path(r"c:\Users\saikiran\Desktop\xray\bootstrap.sh")
text = bootstrap_sh.read_text(encoding="utf-8")

old = '''# Check if Docker is available
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "Docker found! Starting with Docker..."
    docker-compose up -d --build
    echo ""
    echo "✅ Success! The app is now running!"
    echo "📱 Frontend: http://localhost:5174"
    echo "🔧 Backend: http://localhost:8080"
    echo ""
    echo "To stop the app: docker-compose down"'''

new = '''# Check if Docker is available (Compose V1 or V2)
DOCKER_COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
fi

if [ -n "$DOCKER_COMPOSE_CMD" ]; then
    echo "Docker found! Starting with Docker..."
    $DOCKER_COMPOSE_CMD up -d --build
    echo ""
    echo "✅ Success! The app is now running!"
    echo "📱 Frontend: http://localhost:5174"
    echo "🔧 Backend: http://localhost:8080"
    echo ""
    echo "To stop the app: $DOCKER_COMPOSE_CMD down"'''

if old in text:
    text = text.replace(old, new)
    bootstrap_sh.write_text(text, encoding="utf-8")

bootstrap_bat = Path(r"c:\Users\saikiran\Desktop\xray\bootstrap.bat")
text = bootstrap_bat.read_text(encoding="utf-8")

old = '''REM Check if Docker is available
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
)'''

new = '''REM Check if Docker is available (Compose V1 or V2)
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
        %DOCKER_COMPOSE_CMD% up -d --build
        echo.
        echo Success! The app is now running!
        echo Frontend: http://localhost:5174
        echo Backend: http://localhost:8080
        echo.
        echo To stop the app: %DOCKER_COMPOSE_CMD% down
        goto :eof
    )
)'''

if old in text:
    text = text.replace(old, new)
    bootstrap_bat.write_text(text, encoding="utf-8")

print("Done")
