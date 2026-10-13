$ErrorActionPreference = 'Stop'
$base = 'C:\Projects\DynamicIslandBrowserMedia\windhawk'
$source = Join-Path $base 'mod.wh.cpp'
$backup = Join-Path $base 'mod.before-browser-bridge.wh.cpp'
$target = 'C:\ProgramData\Windhawk\EditorWorkspace\mod.wh.cpp'
$result = Join-Path $base 'install-result.txt'
try {
    if ((Get-FileHash -Algorithm SHA256 $backup).Hash -ne
        (Get-FileHash -Algorithm SHA256 $target).Hash) {
        throw 'Editor source changed after patch generation; aborting to avoid overwriting your edits.'
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
    $expected = (Get-FileHash -Algorithm SHA256 $source).Hash
    $actual = (Get-FileHash -Algorithm SHA256 $target).Hash
    if ($actual -ne $expected) { throw 'File checksum mismatch' }
    Set-Content -LiteralPath $result -Value "SUCCESS $actual" -Encoding ASCII
} catch {
    Set-Content -LiteralPath $result -Value "ERROR $($_.Exception.Message)" -Encoding ASCII
    exit 1
}
