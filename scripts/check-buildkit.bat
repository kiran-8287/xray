@echo off
REM Check and disable Docker BuildKit on Windows before building

echo Checking Docker BuildKit status...

REM Check if Docker Desktop settings file exists
if exist "%APPDATA%\Docker\settings-store.json" (
    echo Found Docker settings file
    
    REM Check if BuildKit is enabled
    powershell -Command "$s = Get-Content '%APPDATA%\Docker\settings-store.json' -Raw | ConvertFrom-Json; if ($s.useBuildKit -ne $false) { exit 1 } else { exit 0 }"
    
    if %errorlevel% neq 0 (
        echo.
        echo ========================================
        echo WARNING: Docker BuildKit is ENABLED
        echo ========================================
        echo.
        echo BuildKit has a known bug on Windows that causes "invalid file request" errors.
        echo.
        echo To fix this, you have two options:
        echo.
        echo Option 1 (Recommended): Run the auto-fix script
        echo   powershell -ExecutionPolicy Bypass -File "%~dp0scripts\disable-buildkit.ps1"
        echo   Then restart Docker Desktop
        echo.
        echo Option 2: Manual fix
        echo   1. Open Docker Desktop
        echo   2. Go to Settings -^> Builders
        echo   3. Uncheck "Use Docker BuildKit"
        echo   4. Click "Apply and Restart"
        echo.
        echo After disabling BuildKit, run this command again:
        echo   docker compose up -d --build
        echo.
        
        set /p response="Do you want to run the auto-fix script now? (Y/N): "
        if /i "%response%"=="Y" (
            powershell -ExecutionPolicy Bypass -File "%~dp0scripts\disable-buildkit.ps1"
            echo.
            echo Please restart Docker Desktop, then run: docker compose up -d --build
            pause
            exit /b 1
        ) else (
            echo.
            echo Please disable BuildKit manually and try again.
            pause
            exit /b 1
        )
    ) else (
        echo BuildKit is already disabled. Proceeding with build...
        echo.
    )
) else (
    echo Docker settings file not found. Assuming BuildKit is disabled or using default settings.
    echo.
)