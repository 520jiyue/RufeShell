$ErrorActionPreference = "Stop"

$toolsRoot = "D:\coding environment"
$sdkRoot = Join-Path $toolsRoot "portable-sdk\10"
$sdkVersion = "10.0.22621.0"
$sdkInclude = Join-Path $sdkRoot "Include\$sdkVersion"
$sdkLibrary = Join-Path $sdkRoot "Lib\$sdkVersion"
$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
$npmCli = Join-Path $toolsRoot "tools\npm\package\bin\npm-cli.js"
$nodeBin = (Get-Command node).Source | Split-Path
$npmBin = Join-Path $toolsRoot "tools\npm\bin"
New-Item -ItemType Directory -Force -Path $npmBin | Out-Null
if (-not (Test-Path (Join-Path $npmBin "npm.cmd"))) {
    Set-Content -LiteralPath (Join-Path $npmBin "npm.cmd") -Value "@echo off`r`nnode `"$npmCli`" %*" -Encoding Ascii
}

$msvc = Join-Path $toolsRoot "VSBuildTools\VC\Tools\MSVC\14.44.35207"
$msvcBin = Join-Path $msvc "bin\HostX64\x64"
$sdkBin = Join-Path $sdkRoot "bin\$sdkVersion\x64"
$portableInclude = Join-Path $toolsRoot "portable-msvc\include"
$portableLibrary = Join-Path $toolsRoot "portable-msvc\lib\x64"
if (-not (Test-Path (Join-Path $portableInclude "vcruntime.h"))) {
    throw "Portable MSVC headers are missing. Run scripts\repair-toolchain.ps1 first."
}
if (-not (Test-Path (Join-Path $sdkInclude "ucrt\corecrt.h"))) {
    throw "Portable Windows SDK is missing. Run scripts\repair-toolchain.ps1 first."
}

$sdkIncludeRoots = @($sdkInclude)
$originalSdkInclude = "C:\Program Files (x86)\Windows Kits\10\Include\$sdkVersion"
if (Test-Path $originalSdkInclude) {
    $sdkIncludeRoots += $originalSdkInclude
}
$sdkLibraryRoots = @($sdkLibrary)
$originalSdkLibrary = "C:\Program Files (x86)\Windows Kits\10\Lib\$sdkVersion"
if (Test-Path $originalSdkLibrary) {
    $sdkLibraryRoots += $originalSdkLibrary
}

$env:PATH = "$(Split-Path $cargo);$npmBin;$nodeBin;$msvcBin;$sdkBin;$env:PATH"
$sdkIncludes = $sdkIncludeRoots | ForEach-Object {
    "$_\ucrt", "$_\um", "$_\shared", "$_\winrt", "$_\cppwinrt"
}
$sdkLibraries = $sdkLibraryRoots | ForEach-Object { "$_\ucrt\x64", "$_\um\x64" }
$env:INCLUDE = (@($portableInclude, "$msvc\include") + $sdkIncludes) -join ";"
$env:LIB = (@($portableLibrary, "$msvc\lib\x64") + $sdkLibraries) -join ";"
$env:CARGO_TARGET_DIR = Join-Path $toolsRoot "cargo-cache\finalpowershell"
$env:npm_config_cache = Join-Path $toolsRoot "npm-cache"

switch ($args[0]) {
    "test" {
        if ($args.Count -gt 1) {
            $testArgs = $args[1..($args.Count - 1)]
            $testCommand = @($cargo, "test", "--manifest-path", "src-tauri/Cargo.toml") + $testArgs
            & $testCommand[0] $testCommand[1..($testCommand.Count - 1)]
        } else {
            & $cargo test --manifest-path src-tauri/Cargo.toml
        }
    }
    "dev" { node $npmCli run tauri dev }
    "build" { node $npmCli run tauri build }
    "check" {
        node $npmCli run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $cargo test --manifest-path src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
    }
    default {
        Write-Host "Usage: .\scripts\dev-env.ps1 [dev|build|check]"
        Write-Host "Commands run in the current PowerShell process with the project toolchain."
    }
}
