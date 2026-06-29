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
#   tools/smoke-test/smoke-test-teardown.sh <worktree-name>   # tear down one studio
#   tools/smoke-test/smoke-test-teardown.sh --prune           # deregister all dead ST-* studios
#
# --prune reconciles obsidian.json against disk: it deregisters every ST-<name>
# smoke-studio vault whose folder no longer exists (orphaned when a studio was
# removed without running this script). It deletes no folders and never touches
# a registration whose folder still exists, so in-flight studios are safe.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Resolve the MAIN checkout (see smoke-test-spawn.sh for rationale).
GIT_COMMON="$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir)"
case "$GIT_COMMON" in /*) ;; *) GIT_COMMON="$(cd "$SCRIPT_DIR" && cd "$GIT_COMMON" && pwd)";; esac
REPO_ROOT="$(dirname "$GIT_COMMON")"

WORKTREE_NAME="${1:-}"
if [ -z "$WORKTREE_NAME" ]; then
	echo "usage: $0 <worktree-name> | --prune" >&2
	exit 2
fi

# --prune: reconcile obsidian.json against disk — deregister every ST-* smoke
# studio whose folder no longer exists. Deletes no folders; leaves live studios
# (folder present) untouched. Re-runnable; the standing fix for orphaned
# registrations that hang the GUI vault-picker in non-interactive sessions.
if [ "$WORKTREE_NAME" = "--prune" ]; then
	STUDIOS_DIR="$REPO_ROOT/tools/smoke-test/studios" python3 - <<'PY'
import json, os, pathlib
cfg = pathlib.Path.home() / "Library/Application Support/obsidian/obsidian.json"
prefix = os.path.join(os.environ["STUDIOS_DIR"], "ST-")
d = json.loads(cfg.read_text())
vaults = d.get("vaults", {})
dead = [(vid, v.get("path", "")) for vid, v in list(vaults.items())
        if v.get("path", "").startswith(prefix) and not pathlib.Path(v.get("path", "")).is_dir()]
for vid, _ in dead:
    del vaults[vid]
if dead:
    tmp = cfg.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(d))
    os.replace(tmp, cfg)
    for vid, p in dead:
        print(f"  deregistered dead studio: {p.split('/studios/')[-1]} (id {vid})")
    print(f"✓ pruned {len(dead)} dead smoke-studio registration(s)")
else:
    print("✓ no dead smoke-studio registrations found")
PY
	exit 0
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
