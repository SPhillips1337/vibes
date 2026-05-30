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

# 5. Setup LLM Configuration
ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

get_existing_val() {
    local var_name="$1"
    if [ -f "$ENV_FILE" ]; then
        grep "^${var_name}=" "$ENV_FILE" | cut -d'=' -f2-
    else
        grep "^${var_name}=" "$ENV_EXAMPLE" | cut -d'=' -f2-
    fi
}

update_env_var() {
    local var_name="$1"
    local value="$2"
    local temp_file="${ENV_FILE}.tmp"
    if grep -q "^${var_name}=" "$ENV_FILE"; then
        sed "s|^${var_name}=.*|${var_name}=${value}|" "$ENV_FILE" > "$temp_file"
        mv "$temp_file" "$ENV_FILE"
    else
        echo "${var_name}=${value}" >> "$ENV_FILE"
    fi
}

configure_env() {
    # Guard: only run in interactive mode
    if [ ! -t 0 ]; then
        echo "⚠️  Skipping interactive configuration (non-interactive mode)"
        return
    fi

    if [ ! -f "$ENV_FILE" ]; then
        if [ -f "$ENV_EXAMPLE" ]; then
            cp "$ENV_EXAMPLE" "$ENV_FILE"
        else
            touch "$ENV_FILE"
        fi
    fi

    echo "⚙️  LLM Provider Configuration"
    
    local default_url=$(get_existing_val "OLLAMA_BASE_URL")
    local default_model=$(get_existing_val "OLLAMA_MODEL")
    local default_key=$(get_existing_val "OLLAMA_API_KEY")

    read -p "Enter Ollama Base URL [$default_url]: " input_url
    input_url=${input_url:-$default_url}

    read -p "Enter Ollama Model [$default_model]: " input_model
    input_model=${input_model:-$default_model}

    read -p "Enter Ollama API Key [$default_key]: " input_key
    input_key=${input_key:-$default_key}

    update_env_var "OLLAMA_BASE_URL" "$input_url"
    update_env_var "OLLAMA_MODEL" "$input_model"
    update_env_var "OLLAMA_API_KEY" "$input_key"
    
    echo "✅ Configuration updated in $ENV_FILE"
}

if [ -t 0 ]; then
    echo " "
    read -p "❓ Would you like to configure your LLM settings now? (y/n) [y]: " configure_now
    configure_now=${configure_now:-y}
    if [[ "$configure_now" =~ ^[Yy]$ ]]; then
        configure_env
    else
        if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
            cp "$ENV_EXAMPLE" "$ENV_FILE"
            echo "📝 Created default .env from .env.example. You can modify it later."
        fi
    fi
else
    if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
        cp "$ENV_EXAMPLE" "$ENV_FILE"
    fi
fi

# 6. Setup Shell Command
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

