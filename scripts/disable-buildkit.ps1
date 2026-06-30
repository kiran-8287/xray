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
            Write-Host "BuildKit disabled. Restart Docker Desktop."
        } else {
            Write-Host "No BuildKit setting found in Docker configuration."
            Write-Host "Available settings: $($settings.PSObject.Properties.Name -join ', ')"
        }
    } catch {
        Write-Host "Error: $_"
    }
} else {
    Write-Host "Docker settings file not found at: $settingsPath"
}
