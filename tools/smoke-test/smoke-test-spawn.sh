#!/bin/bash
# smoke-test-spawn.sh — spawn (or redeploy) a per-worktree smoke-test studio.
#
# Each git worktree under .trees/<name> can get its own isolated Obsidian
# vault, "ST-<name>", so smoke testing is no longer serialized on a single
# shared "studio" vault.
#
# A smoke studio is a COPY of the canonical screenshot fixtures vault, parked
# at tools/smoke-test/studios/ST-<name>/ (in the MAIN checkout, OUTSIDE any
# .trees/ worktree, gitignored). Its plugin build files are REAL COPIES of the
# worktree's build — never symlinks — so `git worktree remove` can never orphan
# the Obsidian registration or split the session store.
#
# TWO PHASES (Obsidian only reads its vault registry at startup, so a brand-new
# vault cannot be auto-opened into a running Obsidian — see the one-time open
# step below):
#
#   1. FRESH  (studio dir absent): build + copy fixtures + deploy build +
#             reset baseline + register in obsidian.json, then print a ONE-TIME
#             "open this folder as a vault" instruction and stop. Pure file prep
#             — no Obsidian needed yet.
#   2. REDEPLOY (studio dir present + vault open): rebuild + copy the new build
#             in + scoped plugin reload + verify. Smoke session state preserved.
#             This is the normal iterate-after-a-fix path and is fully automatic.
#
# After the one-time open, the vault is known to Obsidian for the session (and
# persisted for future startups), so every later redeploy/reload/teardown is
# hands-off.
#
# Usage:   tools/smoke-test/smoke-test-spawn.sh <worktree-name>
# Teardown: tools/smoke-test/smoke-test-teardown.sh <worktree-name>
set -euo pipefail

# --- resolve the MAIN checkout (works from main checkout OR a worktree copy) -
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIT_COMMON="$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir)"
case "$GIT_COMMON" in /*) ;; *) GIT_COMMON="$(cd "$SCRIPT_DIR" && cd "$GIT_COMMON" && pwd)";; esac
REPO_ROOT="$(dirname "$GIT_COMMON")"

WORKTREE_NAME="${1:-}"
if [ -z "$WORKTREE_NAME" ]; then
	echo "usage: $0 <worktree-name>   (must match a directory under .trees/)" >&2
	exit 2
fi

WORKTREE_DIR="$REPO_ROOT/.trees/$WORKTREE_NAME"
VAULT_NAME="ST-$WORKTREE_NAME"
STUDIO_DIR="$REPO_ROOT/tools/smoke-test/studios/$VAULT_NAME"
PLUGIN_DIR="$STUDIO_DIR/.obsidian/plugins/agent-console"
FIXTURES="$REPO_ROOT/tools/screenshots/fixtures/studio"

# --- helpers ---------------------------------------------------------------
# Bound every obsidian CLI call (macOS has no `timeout`); the CLI hangs on the
# GUI vault-picker when a vault name is ambiguous/unknown.
ob() { perl -e 'alarm shift; exec @ARGV' 15 obsidian "$@"; }

# The eval CLI prefixes results with "=> "; strip it plus quotes/whitespace.
vault_name_check() {
	ob vault="$VAULT_NAME" eval code='window.app.vault.getName()' 2>/dev/null \
		| sed 's/^=> *//' | tr -d '"' | tr -d '[:space:]'
}

wait_until_open() {
	local tries=0
	while [ "$tries" -lt 20 ]; do
		[ "$(vault_name_check)" = "$VAULT_NAME" ] && return 0
		sleep 1; tries=$((tries + 1))
	done
	return 1
}

deploy_build() {
	# Copy the worktree's freshly built artifacts in as REAL files. rm first so
	# we never write THROUGH a symlink back into the main checkout.
	mkdir -p "$PLUGIN_DIR"
	local f
	for f in main.js styles.css manifest.json; do
		[ -f "$WORKTREE_DIR/$f" ] || { echo "✗ build artifact missing: $WORKTREE_DIR/$f" >&2; exit 1; }
		rm -f "$PLUGIN_DIR/$f"
		cp "$WORKTREE_DIR/$f" "$PLUGIN_DIR/$f"
	done
}

build_worktree() {
	if [ ! -d "$WORKTREE_DIR/node_modules" ]; then
		echo "▶ installing deps in worktree (npm ci)…"
		(cd "$WORKTREE_DIR" && npm ci --prefer-offline)
	fi
	echo "▶ building plugin in worktree…"
	(cd "$WORKTREE_DIR" && npm run build >/tmp/smoke-build-"$WORKTREE_NAME".log 2>&1) \
		|| { echo "✗ build failed — see /tmp/smoke-build-$WORKTREE_NAME.log" >&2; tail -20 /tmp/smoke-build-"$WORKTREE_NAME".log >&2; exit 1; }
	echo "  build ok"
}

print_open_instructions() {
	cat <<EOF

────────────────────────────────────────────────────────────────────────────
ONE-TIME STEP — open this folder as a vault in Obsidian:

  $STUDIO_DIR

  In Obsidian: vault switcher → "Open folder as vault". In the macOS folder
  chooser press Cmd+Shift+G, paste the path above, Enter, then Open.

(Obsidian only learns about a new vault at startup, so a running Obsidian can't
be told to open a brand-new vault non-interactively. This is needed once per
worktree; after it, redeploys/reloads/teardown are fully automatic.)

Then re-run:   tools/smoke-test/smoke-test-spawn.sh $WORKTREE_NAME
to deploy the latest build, or just start smoke testing.
────────────────────────────────────────────────────────────────────────────
EOF
}

# --- validate worktree -----------------------------------------------------
if [ ! -d "$WORKTREE_DIR" ]; then
	echo "✗ no worktree at $WORKTREE_DIR" >&2
	echo "  existing worktrees:" >&2
	git -C "$REPO_ROOT" worktree list >&2
	exit 1
fi
BRANCH="$(git -C "$WORKTREE_DIR" rev-parse --abbrev-ref HEAD)"
echo "▶ worktree '$WORKTREE_NAME' on branch '$BRANCH' -> vault '$VAULT_NAME'"

# --- FRESH spawn vs REDEPLOY -----------------------------------------------
if [ ! -d "$STUDIO_DIR" ]; then
	# ---------- FRESH (pure file prep; vault not open yet) ----------
	build_worktree
	echo "▶ creating fresh smoke studio from fixtures…"
	mkdir -p "$(dirname "$STUDIO_DIR")"
	rsync -a \
		--exclude '.obsidian/plugins/agent-console/main.js' \
		--exclude '.obsidian/plugins/agent-console/styles.css' \
		--exclude '.obsidian/plugins/agent-console/manifest.json' \
		--exclude '.DS_Store' \
		"$FIXTURES/" "$STUDIO_DIR/"
	deploy_build
	# Clean baseline: seed from the template, then strip settings keys that have
	# code defaults so a FRESH smoke vault opens with DEFAULT settings (e.g.
	# restoreTabsOnStartup -> plugin default `true`), not the template's pinned
	# values. Only agent/runtime config + first-run suppressors are kept; the
	# settings-normalizer fills code defaults for everything dropped. The shared
	# template keeps its pinned values for the screenshot fixture (setup.sh),
	# which deliberately wants restore-off for deterministic captures.
	if [ -f "$PLUGIN_DIR/data.template.json" ]; then
		cp "$PLUGIN_DIR/data.template.json" "$PLUGIN_DIR/data.json"
		SMOKE_DATA_JSON="$PLUGIN_DIR/data.json" python3 - <<'PY'
import json, os
p = os.environ["SMOKE_DATA_JSON"]
d = json.load(open(p))
# Whitelist: agent/runtime config + first-run suppressors. Everything else
# (all UI/behavior settings) is dropped so the plugin applies code defaults.
keep = {
	"claude", "codex", "gemini", "kiro", "customAgents", "nodePath",
	"migrationNoticeShown", "legacySessionsMigrated", "settingsImportOfferShown",
}
seeded = {k: v for k, v in d.items() if k in keep}
json.dump(seeded, open(p, "w"), indent=2)
PY
	fi

	# Register in obsidian.json (idempotent by path; atomic write). This makes
	# the vault selectable once Obsidian next reads the registry.
	STUDIO_DIR="$STUDIO_DIR" python3 - <<'PY'
import json, os, secrets, time, pathlib
cfg = pathlib.Path.home() / "Library/Application Support/obsidian/obsidian.json"
studio = os.environ["STUDIO_DIR"]
d = json.loads(cfg.read_text())
vaults = d.setdefault("vaults", {})
if not any(v.get("path") == studio for v in vaults.values()):
    vid = secrets.token_hex(8)  # 16 hex chars, matching Obsidian's id format
    vaults[vid] = {"path": studio, "ts": int(time.time() * 1000), "open": False}
    tmp = cfg.with_suffix(".json.tmp"); tmp.write_text(json.dumps(d)); os.replace(tmp, cfg)
    print(f"  registered vault id={vid}")
else:
    print("  vault already registered")
PY
	echo "✓ smoke studio prepped: $STUDIO_DIR"
	print_open_instructions
	exit 0
fi

# ---------- REDEPLOY (studio exists; needs the vault open) ----------
echo "▶ redeploying into existing $VAULT_NAME (smoke session state preserved)…"
if [ "$(vault_name_check)" != "$VAULT_NAME" ]; then
	# Vault is registered but not currently open. It's a KNOWN vault now, so the
	# obsidian:// URI resolves it (unlike a brand-new vault).
	echo "  vault not open — opening via obsidian:// …"
	open "obsidian://open?vault=$VAULT_NAME" 2>/dev/null || true
	if ! wait_until_open; then
		echo "✗ could not open $VAULT_NAME automatically." >&2
		print_open_instructions
		exit 1
	fi
fi
build_worktree
deploy_build
ob vault="$VAULT_NAME" plugin:reload id=agent-console >/dev/null 2>&1 || true
sleep 2

# --- verify the OUTCOME (not a proxy) --------------------------------------
NAME="$(vault_name_check)"
PLUG="$(ob vault="$VAULT_NAME" eval code='!!window.app.plugins.plugins["agent-console"]' 2>/dev/null | sed 's/^=> *//' | tr -d '[:space:]')"
if [ "$NAME" = "$VAULT_NAME" ] && [ "$PLUG" = "true" ]; then
	echo "✓ redeployed — vault '$VAULT_NAME' open, agent-console loaded with the latest build"
	echo "  tear down when done:  tools/smoke-test/smoke-test-teardown.sh $WORKTREE_NAME"
else
	echo "✗ verification failed: name='${NAME:-<empty>}' (want '$VAULT_NAME'), plugin-loaded='${PLUG:-<empty>}'" >&2
	exit 1
fi
