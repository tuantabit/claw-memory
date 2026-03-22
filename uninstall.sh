#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# CLAW-MEMORY UNINSTALLER v0.4.0
#
# One-command uninstall:
#   curl -fsSL https://raw.githubusercontent.com/tuantabit/claw-memory/main/uninstall.sh | bash
#
# Options:
#   --keep-data    Keep database file (claw-memory.db)
#   --force        Skip confirmation prompt
# ═══════════════════════════════════════════════════════════════════════════

set -e

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
PLUGIN_ID="claw-memory"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
PLUGIN_DIR="$OPENCLAW_DIR/plugins/$PLUGIN_ID"
DB_FILE="$OPENCLAW_DIR/claw-memory.db"

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
    echo "║   🧠 CLAW-MEMORY UNINSTALLER                                 ║"
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

# ─────────────────────────────────────────────────────────────────────────────
# Parse Arguments
# ─────────────────────────────────────────────────────────────────────────────
KEEP_DATA=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-data|-k)
            KEEP_DATA=true
            shift
            ;;
        --force|-f)
            FORCE=true
            shift
            ;;
        --help|-h)
            echo "Usage: uninstall.sh [options]"
            echo ""
            echo "Options:"
            echo "  --keep-data, -k  Keep database file (preserves memory data)"
            echo "  --force, -f      Skip confirmation prompt"
            echo "  --help, -h       Show this help"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Main Uninstallation
# ─────────────────────────────────────────────────────────────────────────────
print_banner

# Check if installed
if [ ! -d "$PLUGIN_DIR" ] && ! grep -q "claw-memory" "$OPENCLAW_CONFIG" 2>/dev/null; then
    log_warn "Claw-Memory does not appear to be installed."
    echo "  Plugin dir: $PLUGIN_DIR (not found)"
    exit 0
fi

# Confirmation
if [ "$FORCE" = false ]; then
    echo -e "${YELLOW}This will remove Claw-Memory plugin from your system.${NC}"
    echo ""
    echo "  Plugin directory: $PLUGIN_DIR"
    echo "  Config file:      $OPENCLAW_CONFIG"
    if [ "$KEEP_DATA" = false ] && [ -f "$DB_FILE" ]; then
        echo -e "  Database:         $DB_FILE ${RED}(WILL BE DELETED)${NC}"
    elif [ -f "$DB_FILE" ]; then
        echo -e "  Database:         $DB_FILE ${GREEN}(will be kept)${NC}"
    fi
    echo ""
    read -p "Continue? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

echo ""
echo -e "${BOLD}[1/4] Stopping OpenClaw gateway...${NC}"

# Kill gateway if running
if pkill -f "openclaw gateway" 2>/dev/null; then
    log_success "Gateway stopped"
    sleep 1
else
    log_info "Gateway was not running"
fi

echo ""
echo -e "${BOLD}[2/4] Removing plugin files...${NC}"

# Remove plugin directory
if [ -d "$PLUGIN_DIR" ]; then
    rm -rf "$PLUGIN_DIR"
    log_success "Removed $PLUGIN_DIR"
else
    log_info "Plugin directory not found (already removed?)"
fi

# Remove database if not keeping
if [ "$KEEP_DATA" = false ] && [ -f "$DB_FILE" ]; then
    rm -f "$DB_FILE"
    log_success "Removed database: $DB_FILE"
elif [ -f "$DB_FILE" ]; then
    log_info "Keeping database: $DB_FILE"
fi

echo ""
echo -e "${BOLD}[3/4] Updating OpenClaw config...${NC}"

# Update config
if [ -f "$OPENCLAW_CONFIG" ] && command -v node &> /dev/null; then
    node -e "
const fs = require('fs');

const configPath = '$OPENCLAW_CONFIG';
const pluginId = '$PLUGIN_ID';

let config = {};
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
    console.log('  Config not found or invalid');
    process.exit(0);
}

let modified = false;

// Remove from allow list
if (config.plugins?.allow) {
    const idx = config.plugins.allow.indexOf(pluginId);
    if (idx > -1) {
        config.plugins.allow.splice(idx, 1);
        console.log('  Removed from plugins.allow');
        modified = true;
    }
}

// Remove load paths
if (config.plugins?.load?.paths) {
    const before = config.plugins.load.paths.length;
    config.plugins.load.paths = config.plugins.load.paths.filter(p => !p.includes('claw-memory'));
    if (config.plugins.load.paths.length < before) {
        console.log('  Removed load paths');
        modified = true;
    }
}

// Remove entry
if (config.plugins?.entries?.[pluginId]) {
    delete config.plugins.entries[pluginId];
    console.log('  Removed plugin entry');
    modified = true;
}

if (modified) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('  Config saved');
} else {
    console.log('  No changes needed');
}
"
    log_success "Config updated"
else
    log_warn "Could not update config (Node.js not found or config missing)"
    echo "  Please manually remove claw-memory entries from: $OPENCLAW_CONFIG"
fi

echo ""
echo -e "${BOLD}[4/4] Uninstallation complete!${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ CLAW-MEMORY UNINSTALLED SUCCESSFULLY!                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$KEEP_DATA" = true ] && [ -f "$DB_FILE" ]; then
    echo -e "  ${YELLOW}Note:${NC} Database kept at $DB_FILE"
    echo "        Delete manually if no longer needed: rm $DB_FILE"
    echo ""
fi

echo -e "  ${BOLD}To reinstall:${NC}"
echo "    curl -fsSL https://raw.githubusercontent.com/tuantabit/claw-memory/main/install.sh | bash"
echo ""
