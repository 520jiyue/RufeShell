$ErrorActionPreference = "Stop"

$toolsRoot = "D:\coding environment"
$repairRoot = Join-Path $toolsRoot "toolchain-repair"
$msvcRoot = Join-Path $toolsRoot "portable-msvc"
$packageIds = @(
    "Microsoft.VC.14.44.17.14.CRT.Headers.base",
    "Microsoft.VC.14.44.17.14.CRT.x64.Desktop.base"
)

foreach ($packageId in $packageIds) {
    $source = Join-Path $repairRoot "$packageId\Contents\VC\Tools\MSVC\14.44.35207"
    if (-not (Test-Path $source)) {
        throw "Verified MSVC package is missing: $source"
    }
    New-Item -ItemType Directory -Force -Path $msvcRoot | Out-Null
    foreach ($item in Get-ChildItem $source) {
        $destination = Join-Path $msvcRoot $item.Name
        if ($item.PSIsContainer) {
            New-Item -ItemType Directory -Force -Path $destination | Out-Null
            Copy-Item -Path (Join-Path $item.FullName "*") -Destination $destination -Recurse -Force
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $destination -Force
        }
    }
}

Write-Host "Portable MSVC headers and libraries restored to $msvcRoot"
