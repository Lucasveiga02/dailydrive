#!/bin/bash
# =============================================================================
# Daily Drive — Quick Installer
# =============================================================================
# Run this once to set everything up on your Orange Pi / Raspberry Pi.
#
# Usage:  chmod +x install.sh && ./install.sh
# =============================================================================

set -e

echo ""
echo "🚗 Daily Drive — Installer"
echo "=========================="
echo ""

# --- Check for Node.js ---
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "✅ Node.js installed: $(node --version)"
else
    echo "✅ Node.js found: $(node --version)"
fi

# --- Install dependencies ---
echo ""
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"

# --- Create config if needed ---
if [ ! -f config.yaml ]; then
    cp config.example.yaml config.yaml
    echo ""
    echo "📝 Created config.yaml from template"
    echo "   Edit it now:  nano config.yaml"
else
    echo ""
    echo "✅ config.yaml already exists"
fi

echo ""
echo "=========================="
echo "🎉 Installation complete!"
echo "=========================="
echo ""
echo "Next steps:"
echo "  1. Edit config.yaml with your Spotify credentials and preferences"
echo "  2. Run: npm run setup    (one-time Spotify login)"
echo "  3. Run: npm start        (build your playlist!)"
echo "  4. Optional: Set up auto-refresh (see README.md)"
echo ""
