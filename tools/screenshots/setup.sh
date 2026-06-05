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

# Reset accumulated session history so capture runs don't dirty data.json with
# volatile per-run sessionIds/timestamps. The stable agent/mode config is kept.
if [ -f "$PLUGIN_DIR/data.json" ]; then
	python3 - "$PLUGIN_DIR/data.json" <<'PY'
import json, sys
p = sys.argv[1]
with open(p) as f:
    d = json.load(f)
if d.get("savedSessions"):
    d["savedSessions"] = []
    with open(p, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
PY
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
