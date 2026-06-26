#!/bin/bash
# smoke-test-teardown.sh — remove a per-worktree smoke-test studio.
#
# Deregisters the "ST-<name>" vault from Obsidian and deletes its folder. This
# is INTENTIONALLY independent of `git worktree remove`: tearing the studio down
# here (not letting worktree removal orphan it) is what prevents a dead
# obsidian.json registration that would hang the GUI vault-picker in a
# non-interactive session.
#
# Usage:
#   tools/smoke-test/smoke-test-teardown.sh <worktree-name>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Resolve the MAIN checkout (see smoke-test-spawn.sh for rationale).
GIT_COMMON="$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir)"
case "$GIT_COMMON" in /*) ;; *) GIT_COMMON="$(cd "$SCRIPT_DIR" && cd "$GIT_COMMON" && pwd)";; esac
REPO_ROOT="$(dirname "$GIT_COMMON")"

WORKTREE_NAME="${1:-}"
if [ -z "$WORKTREE_NAME" ]; then
	echo "usage: $0 <worktree-name>" >&2
	exit 2
fi

VAULT_NAME="ST-$WORKTREE_NAME"
STUDIO_DIR="$REPO_ROOT/tools/smoke-test/studios/$VAULT_NAME"

# Note: the Obsidian CLI has no "close vault" command. If the ST-<name> window
# is open, deregister + rm leaves it pointing at a deleted folder — harmless;
# the user just closes that window. We surface a reminder at the end.

# Deregister from obsidian.json (atomic write).
STUDIO_DIR="$STUDIO_DIR" python3 - <<'PY'
import json, os, pathlib
cfg = pathlib.Path.home() / "Library/Application Support/obsidian/obsidian.json"
studio = os.environ["STUDIO_DIR"]
d = json.loads(cfg.read_text())
vaults = d.get("vaults", {})
removed = [vid for vid, v in vaults.items() if v.get("path") == studio]
for vid in removed:
    del vaults[vid]
if removed:
    tmp = cfg.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(d))
    os.replace(tmp, cfg)
    print(f"  deregistered vault id(s): {', '.join(removed)}")
else:
    print("  no obsidian.json registration found (already gone)")
PY

# Delete the studio folder.
if [ -d "$STUDIO_DIR" ]; then
	rm -rf "$STUDIO_DIR"
	echo "✓ removed $STUDIO_DIR"
else
	echo "  $STUDIO_DIR already absent"
fi

echo "✓ smoke studio '$VAULT_NAME' torn down"
echo "  (if its window is still open in Obsidian, close it — the folder is gone)"
