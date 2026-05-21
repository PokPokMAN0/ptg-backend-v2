#!/usr/bin/env bash
# =============================================================================
# Prime Tech Gallery – Catalog Engine Launcher (Linux / macOS)
# Run: chmod +x start.sh   (once)
# Then: ./start.sh
# =============================================================================
set -e
cd "$(dirname "$0")"
echo "🔍 Checking dependencies..."
node init.server.js