#!/bin/bash

# Vibes Installer
# Sets up Vibes TUI and creates the 'vibes' command.

set -e

REPO_URL="https://github.com/SPhillips1337/Vibes.git"
INSTALL_DIR="$HOME/Vibes"

echo "🚀 Installing Vibes TUI..."

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install it first."
    exit 1
fi

# 2. Clone or Update Repo
if [ -d "$INSTALL_DIR" ]; then
    echo "📂 Project directory already exists at $INSTALL_DIR. Updating..."
    cd "$INSTALL_DIR"
    # We check if it's a git repo before pulling
    if [ -d ".git" ]; then
        git pull || echo "⚠️  Could not pull latest changes. Continuing..."
    fi
else
    echo "📥 Cloning Vibes to $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 3. Install Dependencies
echo "📦 Installing dependencies..."
npm install

# 4. Build Project
echo "🏗️  Building project..."
npm run build

# 5. Setup Shell Command
VIBES_FUNC="
# Vibes TUI
vibes() {
  local launch_dir=\$(pwd)
  (cd \"$INSTALL_DIR\" && VIBES_LAUNCH_DIR=\"\$launch_dir\" npm start -- \"\$@\")
}
"

setup_shell() {
    local shell_rc="$1"
    if [ -f "$shell_rc" ]; then
        if ! grep -q "vibes()" "$shell_rc"; then
            echo "🔧 Adding 'vibes' command to $shell_rc"
            echo "$VIBES_FUNC" >> "$shell_rc"
        else
            echo "✅ 'vibes' command already exists in $shell_rc"
        fi
    fi
}

setup_shell "$HOME/.bashrc"
setup_shell "$HOME/.zshrc"

# Also handle .bash_aliases specifically as it's common on many distros
if [ -f "$HOME/.bashrc" ]; then
    BASH_ALIASES="$HOME/.bash_aliases"
    if [ ! -f "$BASH_ALIASES" ] || ! grep -q "vibes()" "$BASH_ALIASES"; then
        echo "🔧 Adding 'vibes' command to $BASH_ALIASES"
        echo "$VIBES_FUNC" >> "$BASH_ALIASES"
    fi
fi

echo " "
echo "✨ Vibes TUI installation complete!"
echo "🔄 Please restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"
echo "🚀 Then just type 'vibes' to start."
