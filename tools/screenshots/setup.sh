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

# Restore a deterministic fixtures baseline from the tracked template so every
# capture run starts identically: empty sessions, no restored tabs (panel
# starts CLOSED so clickRibbon reliably OPENS it - see I08), and a clean
# worktree (the live data.json is gitignored; only data.template.json is
# tracked). The template carries the stable agent/mode config including the
# hermetic screenshot-fixtures agent pin.
if [ -f "$PLUGIN_DIR/data.template.json" ]; then
	cp "$PLUGIN_DIR/data.template.json" "$PLUGIN_DIR/data.json"
fi

# Reload the plugin in the running fixtures Obsidian so the freshly-built
# main.js (symlinked above) is what gets screenshotted — the running instance
# holds the OLD build in memory until reloaded, which silently produces
# stale screenshots. Scoped to the fixtures vault ONLY; the daily-driver vault
# is never touched (see learned/skill-rules/agent-console.md "never reload").
VAULT="${SCREENSHOT_VAULT:-vault}"
obsidian vault="$VAULT" plugin:reload id=agent-console 2>/dev/null || true
sleep 3

echo "✓ Plugin symlinks + fixtures reload ready (vault=$VAULT)"
