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
- **Vertical tabs by default.** A fresh studio opens with tabs in the column on
  the right (`tabDisplay: "vertical"`), the layout smoke tests are run in. Every
  other UI setting starts at the plugin's default. `--first-run` deletes
  `data.json`, so it gets the new-install default instead (also vertical).
  A studio spawned before this change keeps its own setting until it's spawned
  fresh.

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

## Isolated mode (`--isolated`)

```bash
tools/smoke-test/smoke-test-spawn.sh <worktree-name> --isolated
```

The studio runs in **its own background Obsidian instance** instead of a window
in your Obsidian, so a smoke test doesn't take your focus or touch your
Obsidian. The instance has its own user data and a fake `HOME`, and is
launched with `open -g -n`. There is no one-time open, and nothing is added to
your `obsidian.json`. It takes focus at most twice, during `st up`, and the
focus guard hands it straight back. The maintainer's design spec
is "Isolated smoke-test instances".

- The first run preps the studio as above, then runs `st up`. A re-run
  rebuilds, copies the build in, and runs `st reload` (a full window reload, so
  CSS changes load), or `st up` when the instance isn't running.
- `--isolated --first-run` is refused: first run means no `data.json`, so
  there is nowhere to give the agents your real `HOME` and `PATH`.
- The two modes never share a studio. `--isolated` refuses a studio that your
  Obsidian has open, and the plain mode refuses a studio that was last run
  isolated.
- The instance runs the Obsidian version pinned in
  `tools/screenshots/fixtures/obsidian-app.json`.
- It needs ASBX agent sandboxing off; when it is on, `st` prints a command to
  paste into a normal Terminal.

### Driving it: `st`

Your `obsidian` CLI can't reach the instance (its fake `HOME` keeps it off
`~/.obsidian-cli.sock`). Use `st` instead of `obsidian vault="ST-…" eval`,
`dev:cdp` and `dev:screenshot`:

```bash
npx tsx tools/smoke-test/st.ts <command> <worktree-name> …
```

| Command | Does |
|---|---|
| `up <wt>` | Launch the instance, or adopt one that is already running. Runs the trust step when Agent Console isn't loaded. |
| `eval <wt> <js>` | `Runtime.evaluate` on the workspace page; prints the result as JSON. |
| `cdp <wt> <method> [json]` | A raw CDP call on the workspace page, e.g. `Page.reload` to restore a seed. |
| `reload <wt> [--hard]` | `app:reload` (re-reads CSS). `--hard` is `Page.reload`, which skips the plugin's save, for seeding. |
| `restart <wt>` | Quit and relaunch, keeping user data and sessions. Use this instead of Cmd+Q: Cmd+Q quits the instance and the Dock icon relaunches **your** Obsidian. |
| `settings <wt> <tab> [--hidden]` | Open a settings tab. `--hidden` opens it invisible and click-through, for agent checks; close it with `settings <wt> --close` afterwards. Without `--hidden` it needs the instance in front (`st focus` first). |
| `screenshot <wt> <file> [selector]` | Capture the page or one element as PNG. |
| `focus <wt>` | Bring the instance to the front for the human pass. Its window title starts with `ST-<name>`, and Cmd-Tab shows a second "Obsidian". |
| `status [<wt>]` | List instances as `up`, `dead` (state left, process gone) or `orphan` (process without state), with the CLI-socket check. |
| `down <wt>` | Stop the instance and remove its instance files. Keeps the studio and its sessions. |

Instance files live in `tools/smoke-test/studios/.instances/ST-<name>/`
(user data, fake home, `state.json`, locks). `smoke-test-teardown.sh` runs
`st down` first and keeps the studio if that fails. In both modes it then
removes the Kiro CLI V2 session records made in the studio.

An instance stays up until `st down` or teardown. `st status` lists any that
were left running. While it runs, its CDP port (in its `DevToolsActivePort`)
is open on localhost, so any local process can drive it, and its agents run
under your real `HOME`. Take instances down when a smoke test is over.

After a clean `st down`, the studio can run non-isolated again: `down` removes
the `AC_SMOKE_RUN` marker rows it added to `data.json`.
