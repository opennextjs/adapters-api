#!/usr/bin/env bash
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TSX_TSCONFIG_PATH="$PKG_DIR/tsconfig.json"
exec "$PKG_DIR/node_modules/.bin/tsx" "$PKG_DIR/src/hook-entry.ts" deploy
