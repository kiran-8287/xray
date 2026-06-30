# Disable Docker BuildKit on Windows
$settingsPath = "$env:APPDATA\Docker\settings-store.json"

if (Test-Path $settingsPath) {
    try {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
        
        # Check for different possible property names for BuildKit setting
        $buildKitProps = @("useBuildKit", "buildkit", "enableBuildKit", "BuildKitEnabled")
        $foundProp = $null
        
        foreach ($prop in $buildKitProps) {
            if ($settings.PSObject.Properties.Name -contains $prop) {
                $foundProp = $prop
                break
            }
        }
        
        if ($foundProp) {
            $currentValue = $settings.$foundProp
            Write-Host "Found BuildKit setting: $foundProp = $currentValue"
            
            if ($currentValue -eq $false) {
                Write-Host "BuildKit is already disabled."
                exit 0
            }
            
            $settings.$foundProp = $false
            $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
            Write-Host "BuildKit disabled. Please restart Docker Desktop for changes to take effect."
            exit 0
        } else {
            Write-Host "WARNING: No BuildKit setting found in Docker configuration."
            Write-Host "Available settings: $($settings.PSObject.Properties.Name -join ', ')"
            Write-Host ""
            Write-Host "Docker Desktop may be using a different settings location or version."
            Write-Host ""
            Write-Host "Please disable BuildKit manually:"
            Write-Host "1. Open Docker Desktop"
            Write-Host "2. Go to Settings -> Builders"
            Write-Host "3. Uncheck 'Use Docker BuildKit'"
            Write-Host "4. Click 'Apply & Restart'"
            exit 1
        }
    } catch {
        Write-Host "Error: $_"
        exit 1
    }
} else {
    Write-Host "ERROR: Docker settings file not found at: $settingsPath"
    Write-Host "Please ensure Docker Desktop is installed."
    exit 1
}
