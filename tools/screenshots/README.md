# Screenshot Automation

Regenerate documentation screenshots reproducibly by driving a live Obsidian instance via the Obsidian CLI's Chrome DevTools Protocol surface.

## Prerequisites

- **macOS** (v0 is Mac-only)
- **Obsidian ≥ 1.12** — `dev:screenshot` requires a recent installer. Download from https://obsidian.md/download
- **Node.js ≥ 18** with `npx tsx` available
- **`obsidian` CLI** on PATH (installed via Obsidian settings → General → "Install CLI")
- **Runs from inside Agent Console's kiro-cli session _or_ a regular Terminal** — the driver *attaches* to the running Obsidian via the `obsidian` CLI's CDP surface (`dev:cdp` / `dev:screenshot`) and uses macOS `screencapture` for native-popup shots. It does **not** launch a second Obsidian, so the macOS App Sandbox (`__CFBundleIdentifier=md.obsidian`) does not block it (`dev:*` is IPC, `screencapture` is a system binary). The one requirement: the fixtures vault must be open as the Obsidian window targeted by `vault="studio"`.

## Quick Start

```bash
# Regenerate the v0 screenshots (ribbon-icon, multi-session)
npm run docs:screenshots

# Regenerate a single screenshot by name
npm run docs:screenshots -- ribbon-icon
```

Output lands in `docs/public/images/<name>.webp`.

## How It Works

1. Reads `manifest.json` for the list of screenshots to capture
2. For each entry, drives the running Obsidian instance via `obsidian dev:cdp`:
   - Opens fixture notes, clicks ribbon, opens chat views
   - Sends templated prompts to the real agent (if specified)
3. Captures via `obsidian dev:screenshot`
4. Crops to the manifest's region (scaled by device pixel ratio)
5. Resizes and encodes to `.webp` via `sharp`

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SCREENSHOT_DPR` | `2` | Device pixel ratio for crop scaling (2 = retina Mac) |

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
