@echo off
REM Check and disable Docker BuildKit on Windows before building

echo Checking Docker BuildKit status...
echo.

REM Check if Docker Desktop settings file exists
if exist "%APPDATA%\Docker\settings-store.json" (
    echo Found Docker settings file
    
    REM Check if BuildKit is enabled
    powershell -Command "$s = Get-Content '%APPDATA%\Docker\settings-store.json' -Raw | ConvertFrom-Json; if ($s.useBuildKit -ne $false) { exit 1 } else { exit 0 }"
    
    if %errorlevel% neq 0 (
        echo.
        echo ========================================
        echo ERROR: Docker BuildKit is ENABLED
        echo ========================================
        echo.
        echo BuildKit has a known bug on Windows that causes "invalid file request" errors.
        echo This will prevent the frontend from building.
        echo.
        echo To fix this, please follow these steps:
        echo.
        echo   1. Open Docker Desktop
        echo   2. Go to Settings -^> Builders (or Settings -^> General)
        echo   3. Look for "Use Docker BuildKit" or "Enable BuildKit"
        echo   4. UNCHECK it
        echo   5. Click "Apply ^& Restart"
        echo   6. Wait for Docker Desktop to fully restart
        echo   7. Run this script again
        echo.
        echo ========================================
        echo.
        pause
        exit /b 1
    ) else (
        echo OK: BuildKit is disabled.
        echo.
    )
) else (
    echo WARNING: Docker settings file not found.
    echo Assuming BuildKit is disabled or using default settings.
    echo If you get "invalid file request" errors, disable BuildKit in Docker Desktop settings.
    echo.
)
