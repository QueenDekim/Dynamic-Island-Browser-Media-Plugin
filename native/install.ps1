param(
    [Parameter(Mandatory=$false)]
    [string]$ExtensionId
)
$ErrorActionPreference = "Stop"
if (-not $ExtensionId) {
    $ExtensionId = Read-Host "ID расширения (32 символа a-p из browser://extensions)"
}
if ($ExtensionId -cnotmatch '^[a-p]{32}$') {
    throw "Неверный ID расширения. Открой browser://extensions и скопируй ID."
}
$native = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostScript = Join-Path $native "host.py"
$launcher = Join-Path $native "launcher.exe"
$manifestFile = Join-Path $native "native-host.json"
$python = (Get-Command python.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $hostScript)) { throw "Не найден host.py" }
if (-not (Test-Path -LiteralPath $launcher)) { throw "Не найден launcher.exe" }
# Native Messaging expects an executable, not a .cmd script.
# Store the full Python interpreter path for the native launcher.
$pythonPathFile = Join-Path $native "python-path.txt"
[System.IO.File]::WriteAllText($pythonPathFile, $python + "`n", (New-Object Text.UTF8Encoding($false)))
$manifest = @{
    name = "dev.dekim.dynamic_island_media"
    description = "Dynamic Island browser media bridge (local only)"
    path = $launcher
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestFile -Encoding UTF8
# ConvertTo-Json on Windows PowerShell 5.1 writes a BOM by default; Chrome expects UTF-8.
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestFile, $json, (New-Object Text.UTF8Encoding($false)))
$registryPaths = @(
    "HKCU:\Software\Yandex\YandexBrowser\NativeMessagingHosts\dev.dekim.dynamic_island_media",
    "HKCU:\Software\Chromium\NativeMessagingHosts\dev.dekim.dynamic_island_media",
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\dev.dekim.dynamic_island_media"
)
foreach ($key in $registryPaths) {
    # Open a writable HKCU handle. Get-Item returns a read-only RegistryKey
    # in PowerShell, so calling SetValue on it throws an access exception.
    $subPath = $key.Substring("HKCU:\".Length)
    $writableKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subPath, $true)
    if ($null -eq $writableKey) {
        throw "Не удалось открыть раздел реестра для записи: $key"
    }
    try {
        $writableKey.SetValue("", $manifestFile, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $writableKey.Close()
    }
    $actual = (Get-ItemProperty -LiteralPath $key)."(default)"
    if ($actual -ne $manifestFile) {
        throw "Не удалось проверить запись реестра: $key"
    }
}
Write-Host ""
Write-Host "Готово: Native Messaging зарегистрирован" -ForegroundColor Green
Write-Host "ID расширения: $ExtensionId"
Write-Host "Манифест: $manifestFile"
Write-Host "Python: $python"
Write-Host "Перезапусти Яндекс Браузер и проверь статус в расширении."
