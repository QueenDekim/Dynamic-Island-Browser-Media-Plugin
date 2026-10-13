$ErrorActionPreference = "Stop"
$native = $PSScriptRoot
$source = Join-Path $native "launcher.cpp"
$output = Join-Path $native "launcher.exe"
$compilerRoot = "C:\Program Files\Windhawk\Compiler"
$compiler = Join-Path $compilerRoot "bin\clang++.exe"

if (!(Test-Path $compiler)) {
    $clang = Get-Command clang++.exe -ErrorAction SilentlyContinue
    if ($clang) {
        $compiler = $clang.Source
    } else {
        throw "clang++ not found. Install Windhawk Compiler or a Windows MinGW/Clang C++ toolchain."
    }
}

$args = @(
    "-std=c++17", "-O2", "-static", "-static-libgcc", "-static-libstdc++"
)
if (Test-Path (Join-Path $compilerRoot "include")) {
    $args += "-I$(Join-Path $compilerRoot 'include')"
}
$args += @($source, "-o", $output)
& $compiler @args
if ($LASTEXITCODE -ne 0 -or !(Test-Path $output)) {
    throw "Failed to compile native messaging launcher"
}
Write-Host ("Native Messaging launcher built: " + $output)
