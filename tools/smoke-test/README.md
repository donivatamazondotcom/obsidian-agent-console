# Smoke-test studios

Per-worktree Obsidian vaults for smoke-testing plugin branches in parallel,
without serializing on the single shared screenshot fixtures vault (`studio`).

Each git worktree under `.trees/<name>` can get its own isolated vault,
`ST-<name>`, which is a copy of the canonical screenshot fixtures vault
(`tools/screenshots/fixtures/studio/`) loaded with that worktree's build.

## Why a copy per worktree

- **Parallel smoke testing.** Several feature branches can be exercised at once,
  each in its own Obsidian window, instead of one branch at a time.
- **Durable, worktree-independent.** The copies live in the **main checkout** at
  `tools/smoke-test/studios/` (gitignored) — never inside a `.trees/` worktree —
  so `git worktree remove` can't orphan the Obsidian registration (which would
  otherwise hang the GUI vault-picker) or split the plugin's session store.
- **Real build copies, not symlinks.** Each studio's `main.js` / `styles.css` /
  `manifest.json` are real copies of the worktree's build, so they survive the
  worktree being removed.

## Usage

```bash
# First run for a worktree: build + prep + register the vault, then print a
# one-time "open this folder as a vault" instruction (see below).
tools/smoke-test/smoke-test-spawn.sh <worktree-name>

# Re-run after opening (or after a code fix): rebuild, redeploy the build, and
# scoped-reload the plugin. Smoke session state is preserved. Fully automatic.
tools/smoke-test/smoke-test-spawn.sh <worktree-name>

# Remove the studio (deregister + delete). Independent of `git worktree remove`.
tools/smoke-test/smoke-test-teardown.sh <worktree-name>
```

## The one-time open (per worktree)

Obsidian reads its vault registry **only at startup**, so a running Obsidian
cannot be told to open a brand-new vault non-interactively. The first
`smoke-test-spawn.sh` run therefore stops and asks you to open the printed
folder once via Obsidian's vault switcher → **Open folder as vault** (in the
macOS chooser, `Cmd+Shift+G` to paste the path). After that one-time open, the
vault is known to Obsidian and every later redeploy / reload / teardown is
hands-off.

Restarting Obsidian to pick up the new vault is intentionally **not** used: it
tears down every live ACP agent session in open tabs.
