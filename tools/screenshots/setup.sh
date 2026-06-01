#!/bin/bash
# Ensure the fixtures vault's plugin directory has symlinks to the
# built plugin. Run automatically as part of `npm run docs:screenshots`.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/fixtures/vault/.obsidian/plugins/agent-console"

mkdir -p "$PLUGIN_DIR"

# Create symlinks (relative to plugin dir → repo root build output)
cd "$PLUGIN_DIR"
ln -sf ../../../../../../../main.js main.js
ln -sf ../../../../../../../styles.css styles.css
ln -sf ../../../../../../../manifest.json manifest.json

echo "✓ Plugin symlinks ready in fixtures vault"
