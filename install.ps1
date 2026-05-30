<#
.SYNOPSIS
    Installs Vibes TUI and creates the 'vibes' command in PowerShell.
.DESCRIPTION
    Clones the Vibes repo, installs dependencies, builds the project,
    and adds a 'vibes' function to your PowerShell profile so you
    can launch it from anywhere by typing 'vibes'.
#>

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/SPhillips1337/Vibes.git'
$InstallDir = "$HOME\Vibes"

Write-Host '=== Vibes TUI Installer for Windows ===' -ForegroundColor Cyan

# 1. Check for Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'ERROR: Node.js is not installed. Please install it from https://nodejs.org first.' -ForegroundColor Red
    exit 1
}
Write-Host "Node.js found: $($node.Source)" -ForegroundColor Green

# 2. Check for Git
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host 'ERROR: Git is not installed. Please install it from https://git-scm.com first.' -ForegroundColor Red
    exit 1
}
Write-Host "Git found: $($git.Source)" -ForegroundColor Green

# 3. Clone or Update Repo
if (Test-Path -LiteralPath $InstallDir) {
    Write-Host "Project directory already exists at $InstallDir. Updating..." -ForegroundColor Yellow
    Push-Location -LiteralPath $InstallDir
    try {
        if (Test-Path -LiteralPath ".git") {
            $null = git pull 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host 'Warning: Could not pull latest changes. Continuing...' -ForegroundColor Yellow
            }
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Cloning Vibes to $InstallDir ..." -ForegroundColor Green
    git clone $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: Failed to clone repository.' -ForegroundColor Red
        exit 1
    }
}

# 4. Install Dependencies
Write-Host 'Installing dependencies...' -ForegroundColor Green
Push-Location -LiteralPath $InstallDir
try {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: npm install failed.' -ForegroundColor Red
        exit 1
    }

    # 5. Build Project
    Write-Host 'Building project...' -ForegroundColor Green
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: Build failed.' -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

# 6. Setup PowerShell Command
$vibesFunc = @'

# Vibes TUI
function vibes {
    param([string[]]$UserArgs)
    $launchDir = Get-Location
    Push-Location "$HOME\Vibes"
    try {
        $env:VIBES_LAUNCH_DIR = "$launchDir"
        npm start -- @UserArgs
    } finally {
        Pop-Location
    }
}
'@

$profileContent = Get-Content -LiteralPath $PROFILE -ErrorAction SilentlyContinue -Raw

if ($profileContent -and $profileContent.Contains('function vibes')) {
    Write-Host "'vibes' command already exists in $PROFILE" -ForegroundColor Green
} else {
    Write-Host "Adding 'vibes' command to $PROFILE ..." -ForegroundColor Green
    $profileDir = Split-Path -Parent $PROFILE
    if (-not (Test-Path -LiteralPath $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }
    Add-Content -LiteralPath $PROFILE -Value $vibesFunc
}

Write-Host ''
Write-Host 'Vibes TUI installation complete!' -ForegroundColor Cyan
Write-Host "To start using it:" -ForegroundColor White
Write-Host "  1. Restart PowerShell or run: . `$PROFILE" -ForegroundColor Yellow
Write-Host "  2. Then type: vibes" -ForegroundColor Yellow
