<#
.SYNOPSIS
    Installs Vibes TUI and creates the 'vibes' command in PowerShell.
.DESCRIPTION
    Clones the Vibes repo, installs dependencies, builds the project,
    and adds a 'vibes' function to your PowerShell profile so you
    can launch it from anywhere by typing 'vibes'.
#>

$ErrorActionPreference = 'Continue'

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
    Push-Location -LiteralPath $InstallDir -ErrorAction SilentlyContinue
    if (-not $?) {
        Write-Host "ERROR: Failed to enter directory $InstallDir" -ForegroundColor Red
        exit 1
    }
    try {
        if (Test-Path -LiteralPath ".git") {
            $null = git pull
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
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $InstallDir)) {
        Write-Host 'ERROR: Failed to clone repository or directory was not created.' -ForegroundColor Red
        exit 1
    }
}

# 4. Install Dependencies
Write-Host 'Installing dependencies...' -ForegroundColor Green
Push-Location -LiteralPath $InstallDir -ErrorAction SilentlyContinue
if (-not $?) {
    Write-Host "ERROR: Failed to enter directory $InstallDir to install dependencies." -ForegroundColor Red
    exit 1
}
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

# 5.5 Setup LLM Configuration
$EnvFile = Join-Path $InstallDir ".env"
$EnvExample = Join-Path $InstallDir ".env.example"

function Get-ExistingVal {
    param([string]$varName)
    if (Test-Path -LiteralPath $EnvFile) {
        $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match "^${varName}=" }
        if ($line) {
            return ($line -split '=', 2)[1]
        }
    }
    if (Test-Path -LiteralPath $EnvExample) {
        $line = Get-Content -LiteralPath $EnvExample | Where-Object { $_ -match "^${varName}=" }
        if ($line) {
            return ($line -split '=', 2)[1]
        }
    }
    return ""
}

function Update-EnvVar {
    param([string]$varName, [string]$value)
    if (Test-Path -LiteralPath $EnvFile) {
        $content = Get-Content -LiteralPath $EnvFile
        $found = $false
        for ($i = 0; $i -lt $content.Length; $i++) {
            if ($content[$i] -match "^${varName}=") {
                $content[$i] = "${varName}=${value}"
                $found = $true
                break
            }
        }
        if (-not $found) {
            $content += "${varName}=${value}"
        }
        Set-Content -LiteralPath $EnvFile -Value $content
    } else {
        Add-Content -LiteralPath $EnvFile -Value "${varName}=${value}"
    }
}

function Configure-Env {
    if (-not [Environment]::UserInteractive) {
        Write-Host '⚠️  Skipping interactive configuration (non-interactive mode)' -ForegroundColor Yellow
        return
    }

    if (-not (Test-Path -LiteralPath $EnvFile)) {
        if (Test-Path -LiteralPath $EnvExample) {
            Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
        } else {
            New-Item -ItemType File -Path $EnvFile -Force | Out-Null
        }
    }

    Write-Host '⚙️  LLM Provider Configuration' -ForegroundColor Cyan
    
    $defaultUrl = Get-ExistingVal 'OLLAMA_BASE_URL'
    $defaultModel = Get-ExistingVal 'OLLAMA_MODEL'
    $defaultKey = Get-ExistingVal 'OLLAMA_API_KEY'

    $inputUrl = Read-Host "Enter Ollama Base URL [$defaultUrl]"
    if ([string]::IsNullOrWhiteSpace($inputUrl)) { $inputUrl = $defaultUrl }

    $inputModel = Read-Host "Enter Ollama Model [$defaultModel]"
    if ([string]::IsNullOrWhiteSpace($inputModel)) { $inputModel = $defaultModel }

    $inputKey = Read-Host "Enter Ollama API Key [$defaultKey]"
    if ([string]::IsNullOrWhiteSpace($inputKey)) { $inputKey = $defaultKey }

    Update-EnvVar 'OLLAMA_BASE_URL' $inputUrl
    Update-EnvVar 'OLLAMA_MODEL' $inputModel
    Update-EnvVar 'OLLAMA_API_KEY' $inputKey
    
    Write-Host "✅ Configuration updated in $EnvFile" -ForegroundColor Green
}

if ([Environment]::UserInteractive) {
    Write-Host ''
    $configureNow = Read-Host '❓ Would you like to configure your LLM settings now? (y/n) [y]'
    if ([string]::IsNullOrWhiteSpace($configureNow)) { $configureNow = 'y' }
    if ($configureNow -match '^[Yy]$') {
        Configure-Env
    } else {
        if (-not (Test-Path -LiteralPath $EnvFile) -and (Test-Path -LiteralPath $EnvExample)) {
            Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
            Write-Host '📝 Created default .env from .env.example. You can modify it later.' -ForegroundColor Yellow
        }
    }
} else {
    if (-not (Test-Path -LiteralPath $EnvFile) -and (Test-Path -LiteralPath $EnvExample)) {
        Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
    }
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
