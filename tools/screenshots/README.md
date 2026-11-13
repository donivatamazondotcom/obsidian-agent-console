# Screenshot Automation

Regenerate documentation screenshots reproducibly. By default each run launches its own isolated Obsidian (separate user data, fake `HOME`, mock keychain, pinned app version) and drives it over a direct Chrome DevTools Protocol session, so it never touches your own Obsidian or takes your screen beyond two brief focus flashes at launch.

## Prerequisites

- **macOS** (Mac-only)
- **`/Applications/Obsidian.app`** recent enough to load the pinned app version (see below). Download from https://obsidian.md/download
- **Node.js ≥ 18** with `npx tsx` available
- **A normal terminal.** The launcher needs `open` and `ps`, which the agent sandbox (ASBX) blocks. Preflight fails with a clear message when they're unavailable.

## Quick Start

```bash
# Regenerate every entry the isolated driver supports
npm run docs:screenshots

# One entry, or several in a single launch
npm run docs:screenshots -- ribbon-icon
npm run docs:screenshots -- ribbon-icon,export,zero-tab-landing

# The old path: the `studio` window inside your own Obsidian, via the `obsidian` CLI
SCREENSHOT_LEGACY=1 npm run docs:screenshots -- language-setting
```

Output lands in `docs/public/images/<name>.webp` (or `.gif`).

Entries that still need the real screen (native popups and the screen-captured heroes) are skipped on the isolated path and listed at the end of the run; capture them with `SCREENSHOT_LEGACY=1` until they move over. A run that captures nothing exits non-zero.

## Settings shots

Settings open in their own window on Obsidian 1.13+. On the isolated path every entry with `captureMode: "settings-window"` or `initialState.openSettings` (but no `openNativeSelect`) is captured from that window:

- `lib/settings-window-hook.cjs` runs in the isolated instance's main process and tames the window inside its creation event: `show()` becomes `showInactive()`, `focus()` is ignored, and the window is invisible, non-focusable and click-through. A listener in the renderer is called back over IPC and can lose the race with Obsidian showing the window, which takes focus.
- The driver renders the settings page at `settingsWindowSize` (default 1200×900 CSS px) and the run's device pixel ratio, and the entry fails if it renders at anything else. The shot gets the shared drop shadow.
- The crop is the visible content, not the whole pane (`lib/settings-crop.ts`): whole groups, the page title and whole rows inside the window, plus `cropPadding`, never past `.vertical-tab-content` and never into a group or row it left out. A group or row cut by the window edge is left out, so size `settingsWindowSize` to fit what the shot is about. Hover is turned off in the settings page before capture, so no row shows its hover state.
- `app.*` calls run on the main page. DOM work (`openSettingPage`, `clickSequence`, `scrollToSettingText`, `scrollIntoViewSelector`, `mustShow`, the crop) runs on the settings page, so write it against `activeDocument`.
- `initialState.openSettingPage: "<row name>"` clicks the settings row with that name (a sub-page such as `"OpenCode"`, or an action such as `"Add custom agent"`) and waits for the sub-page.
- While settings are open, each agent shows the fixtures template's `command` and an empty environment (the plugin default), not the run's absolute paths or the fixtures' env vars. Every settings entry lists `"/Users/"`, `"/home/"`, `"AC_VIDEO_RUN"` and `"BEDROCK"` in `forbiddenText` (so a legacy run of `settings-agent-page`, which shows the fixtures' env as is, fails by design); the run adds its own seeded values (agent commands, `HOME`, `PATH`, run id, run folder) and every seeded env var name with an underscore, such as `CLAUDE_CODE_USE_BEDROCK`. Don't seed an env var whose name the settings UI prints (for example `ANTHROPIC_API_KEY`, `OLLAMA_CONTEXT_LENGTH`): its shot would fail. Text and visible input values inside the crop are checked.
- Only the fields the settings path drives are allowed on these entries; `validateManifest` names any other.

## Session mode

`initialState.sessionMode: "<mode id>"` starts the entry's session in that mode: the run writes it as the saved mode pick for the entry's agent before the panel opens, and restores the pick afterwards. `editing` uses `"default"`, because a user-level Claude Code `permissions.defaultMode` such as `auto` applies the edit with no permission card.

## Pinned Obsidian version

`fixtures/obsidian-app.json` pins the Obsidian **app** version and the sha256 of its `obsidian-<version>.asar`. `/Applications/Obsidian.app` is only the installer; Obsidian runs the newest asar in its user-data folder, so each run copies the pinned asar into its own user data. The asar comes from `~/Library/Caches/agent-console/`, else your own downloaded update, else the official `obsidianmd/obsidian-releases` asset; every source is checked against the pinned hash. The run fails if the instance isn't on the pinned version.

To move to a new Obsidian release, update both fields:

```bash
curl -sSL https://github.com/obsidianmd/obsidian-releases/releases/download/v<version>/obsidian-<version>.asar.gz | gunzip | shasum -a 256
```

## How It Works

1. Reads `manifest.json` for the list of screenshots to capture
2. Launches the isolated Obsidian on a fresh copy of the `studio` fixtures vault, trusts it, and closes the settings window Obsidian opens after the trust prompt
3. For each entry, drives the instance over CDP: opens fixture notes and the chat view, sends templated prompts to the real agent (if specified), and afterwards restores the plugin settings, agent configs, layout and stubs it changed (the vault-wide `nativeMenus` config is left off, as the fixtures vault ships it)
4. Captures with `Page.captureScreenshot`, crops to the manifest's region (scaled by device pixel ratio), and encodes to `.webp` via `sharp`
5. Tears the instance down by its run markers and checks nothing is left behind

The `▶ [i/n] <entry>` lines and the focus-guard lines tie any focus steal to the entry that caused it. More than two steals fails the run.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SCREENSHOT_DPR` | `2` (isolated); the window's DPR (legacy) | Device pixel ratio for capture and crop scaling |
| `SCREENSHOT_LEGACY` | unset | `1` runs the old path in your own Obsidian (`setup.sh` + the `studio` window) |
| `SCREENSHOT_SETTINGS_HOOK_LOG` | unset | A file path: the settings-window hook logs each window it creates and tames, every window that gets focus, and each time the instance becomes active. Use it to trace a focus steal. |

## File Layout

```
tools/screenshots/
├── manifest.json          # What to capture (entries with crop/dimensions)
├── run.ts                 # CLI entry point
├── sharp.d.ts             # Type stub (until sharp is installed)
├── fixtures/
│   ├── studio/             # Minimal Obsidian vault for consistent captures
│   │   ├── .obsidian/     # Pinned theme, window size, plugin config
│   │   ├── Welcome.md     # Fixture note
│   │   └── Project Notes.md
│   └── prompts/           # Templated prompts sent to the agent
│       └── multi-session.txt
├── lib/
│   ├── manifest.ts        # Schema, parser, validator
│   ├── cdp.ts             # Obsidian CDP wrapper
│   ├── crop.ts            # Coordinate math (CSS px → device px)
│   ├── output.ts          # Output path derivation
│   ├── prompts.ts         # Template rendering
│   ├── orchestrator.ts    # Main capture loop
│   └── __tests__/         # Unit tests (vitest)
└── README.md              # This file
```

## Adding a New Screenshot

1. Add an entry to `manifest.json`:
   ```json
   {
     "name": "my-feature",
     "width": 800,
     "height": 600,
     "crop": { "x": 0, "y": 0, "width": 400, "height": 300 },
     "initialState": { "clickRibbon": true },
     "promptFile": "my-feature.txt",
     "approvalThreshold": 0.05,
     "minDistinctColors": 800
   }
   ```
2. Create the prompt fixture at `fixtures/prompts/my-feature.txt` (if needed)
3. Run `npm run docs:screenshots -- my-feature`
4. Eyeball the output at `docs/public/images/my-feature.webp`

## Crop Region Notes

- Crop coordinates are in **CSS pixels** (not device pixels)
- The orchestrator multiplies by `SCREENSHOT_DPR` before passing to `sharp`
- On a 2× retina display, a 100px CSS crop becomes a 200px device-pixel extract
- Use Obsidian's DevTools (Cmd+Opt+I → Elements → inspect element → check `getBoundingClientRect()`) to find crop coordinates for new entries


## Content Guard

Every capture is validated before the run reports success. After encoding (and
the drop-shadow pass), the orchestrator decodes the final `.webp` and counts its
distinct RGB colors. A blank or degraded capture collapses to a handful of
colors; a healthy shot has hundreds-to-thousands. If the count falls below the
entry's floor, the file is **deleted** and the run fails loudly with a non-zero
exit — instead of silently reporting `✓` on a blank image (the gap that hid the
I11 retina-DPR regression).

- **`minDistinctColors`** (per-entry, optional) — the floor for that entry.
  Calibrated from known-good captures (counted on the final post-shadow webp,
  alpha ignored): `ribbon-icon` 800, `session-history-button` 120,
  `mode-selection` 1000, `multi-session` 1500.
- **Global default** (`DEFAULT_MIN_DISTINCT_COLORS`, currently 50) applies when
  an entry sets no floor — a gross-blank backstop only. Per-entry floors do the
  real work: a single global floor can't separate good from bad across entries
  (a degraded `ribbon-icon` at ~400 colors exceeds a healthy
  `session-history-button` at ~219), so calibrated entries set their own.

To calibrate a new entry, capture it once, count the colors of the good output,
and set `minDistinctColors` to roughly half that (comfortably below the good
count, well above any degraded floor).

## Animated GIFs (v2)

Some behaviors a still can't convey (parallel tabs, pinning/unpinning context) ship as short, stepped GIFs. An entry becomes animated by adding an `animation` block:

```jsonc
{
  "name": "temporary-disable",
  "width": 628, "height": 184,
  "crop": { "x": 772, "y": 548, "width": 628, "height": 184 },
  "initialState": { "openNote": "Welcome.md", "clickRibbon": true },
  "animation": {
    "fps": 5,
    "maxBytes": 1500000,
    "frames": [
      { "holdMs": 900 },
      { "actions": [{ "type": "click", "selector": ".some-button" }], "holdMs": 1000 }
    ]
  }
}
```

- **Window-mode only.** The animation path captures the renderer (`dev:screenshot`) per frame, crops each to the **same static `crop`** (no jitter), runs the per-frame content guard, and encodes with ffmpeg (`palettegen`/`paletteuse`). No drop shadow (GIFs ship flat). Native popup menus are NOT supported (use a still + `captureMode: "screen"`).
- **Frame actions** (focus-independent — never CDP Input):
  - `{ "type": "click", "selector": "...", "waitFor": "..." }` — fires the element's React onClick; optional post-click wait.
  - `{ "type": "draft", "text": "..." }` — types into the composer via `execCommand("insertText")` (fires onChange, so `@`/`/` menus open).
  - `{ "type": "wait", "selector": "..." }` — poll for an element before the next action (e.g. the send button enabling after a lazy session connects).
- **Hold** is realized at the constant `fps` by repeating each frame `round(holdMs/1000 × fps)` times (min 1). Output is `<name>.gif`; `maxBytes` is a hard ceiling.
- **ffmpeg** must be on `PATH`.

## Consistency check (v3)

A static gate — no Obsidian, no agents, no Xvfb — that keeps the manifest, the committed images, and the docs references in sync:

```bash
npm run docs:screenshots:check
```

It fails (non-zero) if:

- a manifest entry has no committed image (`<name>.webp`, or `<name>.gif` for animation entries);
- a committed image is an **orphan** (referenced by neither a manifest entry nor a docs page);
- a docs page references an image that isn't on disk;
- an animation gif's dimensions don't match its manifest `width`/`height` (gifs carry no shadow and never resize, so this is exact — webp sizes are left to the manual T05 check because of the drop-shadow margin / `cropSelector` native sizing).

It does **not** regenerate screenshots: most shots are driven by a real agent and are non-deterministic by design (Decision 2), so a content-hash compare is infeasible — true visual-regression is deferred to F02 (Percy/Chromatic, loose thresholds). CI runs this check (plus the unit tests) on every PR — see `.github/workflows/ci.yaml`.

## Tab display during captures

The fixtures vault opens on vertical tabs (`tabDisplay: "vertical"` in `data.template.json`), the layout smoke tests are run in. Most committed shots show the top tab bar, so every capture applies `tabDisplay: "horizontal"` for the length of the entry and then puts the vault's own value back. An entry that wants the vertical rail sets it in `initialState.pluginSettings` (for example `{ "tabDisplay": "vertical", "tabRailWidth": 32 }`). `pluginSettings` applies on every capture path: stills, animated GIFs and settings-window shots.

## Fixture theme: capture-only styling

The fixtures vault uses a custom `Fixture` theme (`fixtures/studio/.obsidian/themes/Fixture/theme.css`) to keep captures clean and deterministic — e.g. hiding the transient scroll-to-bottom pill and the network-driven info banners that must never appear in docs images.

**This same fixtures vault doubles as the interactive smoke-test bed** (`tools/smoke-test/smoke-test-spawn.sh` copies the `studio` vault). So any styling that exists *only* for clean screenshots must NOT apply unconditionally — otherwise it hides elements during interactive testing too, making them impossible to verify by eye.

**Rule:** gate every screenshot-only rule on the `body.acp-capturing` marker class:

```css
/* ✗ wrong — leaks into smoke testing */
.agent-client-scroll-to-bottom { display: none !important; }

/* ✓ right — applies only while a shot is being captured */
body.acp-capturing .agent-client-scroll-to-bottom { display: none !important; }
```

The driver sets the marker for you: `captureAll` (in `lib/orchestrator.ts`) adds `acp-capturing` to `document.body` before each shot and removes it in a `finally` (cleared even if the capture throws). You only need to author the gated CSS. Smoke studios then render the real UI; screenshots stay clean.
