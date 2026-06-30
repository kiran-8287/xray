# Disable Docker BuildKit on Windows
$settingsPath = "$env:APPDATA\Docker\settings-store.json"

if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($settings.useBuildKit -ne $false) {
        $settings.useBuildKit = $false
        $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
        Write-Host "BuildKit disabled. Restart Docker Desktop."
    }
}