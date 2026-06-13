#!/bin/bash
# Ensure the fixtures vault's plugin directory has symlinks to the
# built plugin. Run automatically as part of `npm run docs:screenshots`.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/fixtures/studio/.obsidian/plugins/agent-console"

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
# tracked). The template carries the stable agent/mode config (Claude Code via
# Bedrock — its handshake reports the Default/Accept-Edits/... modes and the
# Default/Sonnet/Haiku models the popover docs shots need).
#
# IMPORTANT: the cp must happen while the plugin is DISABLED. The plugin saves
# its in-memory settings to data.json on unload, so a plain `cp` followed by
# plugin:reload is clobbered by the unload-save (the reload writes the OLD
# settings back over the template). Disable (which triggers the save) → cp the
# template over it → enable (which only reads). This is the only ordering that
# makes the running plugin actually load the template config.
VAULT="${SCREENSHOT_VAULT:-studio}"
obsidian vault="$VAULT" plugin:disable id=agent-console filter=community 2>/dev/null || true
sleep 1
if [ -f "$PLUGIN_DIR/data.template.json" ]; then
	cp "$PLUGIN_DIR/data.template.json" "$PLUGIN_DIR/data.json"
fi
# Enable loads the freshly-built main.js (symlinked above) AND the template
# data.json. Scoped to the fixtures vault ONLY; the daily-driver vault is never
# touched (see learned/skill-rules/agent-console.md "never reload").
obsidian vault="$VAULT" plugin:enable id=agent-console filter=community 2>/dev/null || true
sleep 3

echo "✓ Plugin symlinks + fixtures reload ready (vault=$VAULT)"
