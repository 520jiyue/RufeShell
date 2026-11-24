$ErrorActionPreference = "Stop"

$toolsRoot = "D:\coding environment"
$lessmsi = Join-Path $toolsRoot "tools\lessmsi\lessmsi.exe"
$cabRoot = Join-Path $toolsRoot "sdk-cabs"
$sdkRoot = Join-Path $toolsRoot "portable-sdk\10"
$msi = Join-Path $toolsRoot "toolchain-repair\sdk-tools.msi"

$directories = @{
    TARGETDIR = Join-Path $toolsRoot "portable-sdk"
    ProgramFilesFolder = Join-Path $toolsRoot "portable-sdk"
    WindowsKitsParent = Join-Path $toolsRoot "portable-sdk"
    KitsRoot = $sdkRoot
    WDKContentRoot = $sdkRoot
    SDKToolRoot = Join-Path $sdkRoot "bin"
    SDKToolRootVersioned = Join-Path $sdkRoot "bin\10.0.22621.0"
}

$pending = @(& $lessmsi l -t Directory $msi | ConvertFrom-Csv)
while ($pending.Count -gt 0) {
    $remaining = @()
    foreach ($row in $pending) {
        if ($directories.ContainsKey($row.Directory)) {
            continue
        }
        $name = ($row.DefaultDir -split "\|")[-1]
        if ([string]::IsNullOrEmpty($row.Directory_Parent)) {
            $directories[$row.Directory] = $toolsRoot
        } elseif ($directories.ContainsKey($row.Directory_Parent)) {
            if ($name -ne ".") {
                $directories[$row.Directory] = Join-Path $directories[$row.Directory_Parent] $name
            }
        } else {
            $remaining += $row
        }
    }
    if ($remaining.Count -eq $pending.Count) {
        throw "Unresolved SDK directories: $($remaining.Directory)"
    }
    $pending = $remaining
}

$components = @{}
foreach ($row in (& $lessmsi l -t Component $msi | ConvertFrom-Csv)) {
    $components[$row.Component] = $row.Directory_
}

$count = 0
foreach ($row in (& $lessmsi l -t File $msi | ConvertFrom-Csv)) {
    $name = ($row.FileName -split "\|")[-1]
    $source = Join-Path $cabRoot $row.File
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Expanded SDK file is missing: $source"
    }
    $parent = $directories[$components[$row.Component_]]
    if ($null -eq $parent) {
        throw "SDK target directory is missing: $($row.File)"
    }
    $target = Join-Path $parent $name
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    $count++
}

Write-Host "Restored $count SDK tool files to $sdkRoot"
