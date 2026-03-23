#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# CLAW-MEMORY INSTALLER v0.5.0
#
# One-command install:
#   curl -fsSL https://raw.githubusercontent.com/tuantabit/claw-memory/main/install.sh | bash
#
# Or with specific version:
#   curl -fsSL https://raw.githubusercontent.com/tuantabit/claw-memory/main/install.sh | bash -s -- --version v0.4.0
# ═══════════════════════════════════════════════════════════════════════════

set -e

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
PLUGIN_ID="claw-memory"
PLUGIN_VERSION="0.5.0"
GITHUB_REPO="tuantabit/claw-memory"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
PLUGIN_DIR="$OPENCLAW_DIR/plugins/$PLUGIN_ID"
TEMP_DIR=$(mktemp -d)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────
print_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║   🧠 CLAW-MEMORY INSTALLER                                   ║"
    echo "║   Verified memory for AI agents                              ║"
    echo "║   Version: ${PLUGIN_VERSION}                                          ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup() {
    rm -rf "$TEMP_DIR" 2>/dev/null || true
}

trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
# Parse Arguments
# ─────────────────────────────────────────────────────────────────────────────
INSTALL_VERSION="main"
LOCAL_INSTALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --version|-v)
            INSTALL_VERSION="$2"
            shift 2
            ;;
        --local|-l)
            LOCAL_INSTALL=true
            shift
            ;;
        --help|-h)
            echo "Usage: install.sh [options]"
            echo ""
            echo "Options:"
            echo "  --version, -v <version>  Install specific version (default: main)"
            echo "  --local, -l              Install from local source (for development)"
            echo "  --help, -h               Show this help"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Main Installation
# ─────────────────────────────────────────────────────────────────────────────
print_banner

# Step 1: Check prerequisites
echo -e "${BOLD}[1/6] Checking prerequisites...${NC}"

# Check OpenClaw
if ! command -v openclaw &> /dev/null; then
    log_error "OpenClaw not found!"
    echo "  Install OpenClaw first: https://openclaw.dev"
    exit 1
fi
OPENCLAW_VER=$(openclaw --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
log_success "OpenClaw found: v$OPENCLAW_VER"

# Check Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js not found!"
    echo "  Install Node.js first: https://nodejs.org"
    exit 1
fi
NODE_VER=$(node --version)
log_success "Node.js found: $NODE_VER"

# Check npm
if ! command -v npm &> /dev/null; then
    log_error "npm not found!"
    exit 1
fi
log_success "npm found: $(npm --version)"

# Check/create config
if [ ! -f "$OPENCLAW_CONFIG" ]; then
    log_warn "OpenClaw config not found, will be created"
    mkdir -p "$OPENCLAW_DIR"
    echo '{}' > "$OPENCLAW_CONFIG"
fi
log_success "Config: $OPENCLAW_CONFIG"

# Step 2: Download/Copy plugin
echo ""
echo -e "${BOLD}[2/6] Downloading plugin...${NC}"

if [ "$LOCAL_INSTALL" = true ]; then
    # Local install (for development)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -d "$SCRIPT_DIR/dist" ]; then
        log_info "Installing from local source: $SCRIPT_DIR"
        mkdir -p "$PLUGIN_DIR"

        # Copy dist files
        cp -r "$SCRIPT_DIR/dist/"* "$PLUGIN_DIR/"

        # Copy package.json for dependencies
        cp "$SCRIPT_DIR/package.json" "$PLUGIN_DIR/"

        # Install dependencies in plugin dir
        log_info "Installing dependencies..."
        cd "$PLUGIN_DIR"
        npm install --omit=dev --silent 2>/dev/null || npm install --omit=dev
        cd - > /dev/null

        log_success "Copied local dist to $PLUGIN_DIR"
    else
        log_error "No dist folder found. Run 'npm run build' first."
        exit 1
    fi
else
    # Download from GitHub
    log_info "Downloading from GitHub ($GITHUB_REPO@$INSTALL_VERSION)..."

    cd "$TEMP_DIR"

    # Try git clone first, fallback to tarball
    if command -v git &> /dev/null; then
        git clone --depth 1 --branch "$INSTALL_VERSION" "https://github.com/$GITHUB_REPO.git" claw-memory 2>/dev/null || \
        git clone --depth 1 "https://github.com/$GITHUB_REPO.git" claw-memory
        cd claw-memory
    else
        # Fallback: download tarball
        curl -sL "https://github.com/$GITHUB_REPO/archive/$INSTALL_VERSION.tar.gz" | tar xz
        cd claw-memory-* || cd claw-memory-main
    fi

    log_success "Downloaded source code"

    # Build
    log_info "Building plugin..."
    npm install --silent 2>/dev/null || npm install
    npm run build --silent 2>/dev/null || npm run build
    log_success "Build complete"

    # Copy to plugin dir
    mkdir -p "$PLUGIN_DIR"
    cp -r dist/* "$PLUGIN_DIR/"

    # Copy package.json and install dependencies
    cp package.json "$PLUGIN_DIR/"
    log_info "Installing dependencies in plugin dir..."
    cd "$PLUGIN_DIR"
    npm install --omit=dev --silent 2>/dev/null || npm install --omit=dev
    cd - > /dev/null

    log_success "Installed to $PLUGIN_DIR"
fi

# Step 3: Update OpenClaw config
echo ""
echo -e "${BOLD}[3/6] Configuring OpenClaw...${NC}"

node -e "
const fs = require('fs');
const path = require('path');

const configPath = '$OPENCLAW_CONFIG';
const pluginDir = '$PLUGIN_DIR';
const pluginId = '$PLUGIN_ID';

let config = {};
try {
    const content = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(content);
} catch (e) {
    config = {};
}

// Ensure structure
if (!config.plugins) config.plugins = {};
if (!config.plugins.allow) config.plugins.allow = [];
if (!config.plugins.load) config.plugins.load = {};
if (!config.plugins.load.paths) config.plugins.load.paths = [];
if (!config.plugins.entries) config.plugins.entries = {};

// Add to allow list
if (!config.plugins.allow.includes(pluginId)) {
    config.plugins.allow.push(pluginId);
    console.log('  Added to plugins.allow');
}

// Update load path (remove old, add new)
const entryPath = path.join(pluginDir, 'claw-memory.js');
config.plugins.load.paths = config.plugins.load.paths.filter(p => !p.includes('claw-memory'));
config.plugins.load.paths.push(entryPath);
console.log('  Set load path: ' + entryPath);

// Configure plugin
config.plugins.entries[pluginId] = {
    enabled: true,
    config: {
        autoVerify: true
    }
};
console.log('  Enabled plugin with autoVerify');

// Write config
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('  Config saved');
"

log_success "OpenClaw configured"

# Step 4: Import existing OpenClaw history
echo ""
echo -e "${BOLD}[4/6] Importing existing data...${NC}"

if [ -d "$HOME/.openclaw/agents" ]; then
    # Check if there are session files
    SESSION_COUNT=$(find "$HOME/.openclaw/agents" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$SESSION_COUNT" -gt 0 ]; then
        log_info "Found $SESSION_COUNT session files"

        # Run import script
        if [ -f "$PLUGIN_DIR/scripts/import-history.js" ]; then
            cd "$PLUGIN_DIR"
            node scripts/import-history.js 2>/dev/null || log_warn "Import skipped (will run on first use)"
            cd - > /dev/null
        else
            log_info "Import script not found, skipping"
        fi
    else
        log_info "No existing sessions found (fresh install)"
    fi
else
    log_info "No existing history found (fresh install)"
fi

# Step 5: Verify installation
echo ""
echo -e "${BOLD}[5/6] Verifying installation...${NC}"

# Check files
if [ -f "$PLUGIN_DIR/claw-memory.js" ] || [ -f "$PLUGIN_DIR/index.js" ]; then
    log_success "Plugin files OK"
else
    log_error "Plugin files missing!"
    exit 1
fi

if [ -f "$PLUGIN_DIR/openclaw.plugin.json" ]; then
    log_success "Plugin manifest OK"
else
    log_warn "Plugin manifest missing (non-critical)"
fi

# Check config
if grep -q "claw-memory" "$OPENCLAW_CONFIG" 2>/dev/null; then
    log_success "Config entry OK"
else
    log_error "Config entry missing!"
    exit 1
fi

# Step 6: Done!
echo ""
echo -e "${BOLD}[6/6] Installation complete!${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ CLAW-MEMORY v${PLUGIN_VERSION} INSTALLED SUCCESSFULLY!           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Plugin location:${NC} $PLUGIN_DIR"
echo -e "  ${CYAN}Config file:${NC}     $OPENCLAW_CONFIG"
echo ""
echo -e "  ${BOLD}Features enabled:${NC}"
echo "    • Claim verification (detect lies)"
echo "    • Vector search memory"
echo "    • Knowledge graph"
echo "    • Temporal memory"
echo "    • Auto-retry on contradictions"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo "    1. Restart gateway:  ${CYAN}pkill -f 'openclaw gateway' && openclaw gateway &${NC}"
echo "    2. Open dashboard:   ${CYAN}openclaw dashboard${NC}"
echo ""
echo -e "  ${BOLD}Uninstall:${NC}"
echo "    curl -fsSL https://raw.githubusercontent.com/$GITHUB_REPO/main/uninstall.sh | bash"
echo ""
