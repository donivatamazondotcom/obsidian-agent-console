# Screenshot Automation

Regenerate documentation screenshots reproducibly by driving a live Obsidian instance via the Obsidian CLI's Chrome DevTools Protocol surface.

## Prerequisites

- **macOS** (v0 is Mac-only)
- **Obsidian ≥ 1.12** — `dev:screenshot` requires a recent installer. Download from https://obsidian.md/download
- **Node.js ≥ 18** with `npx tsx` available
- **`obsidian` CLI** on PATH (installed via Obsidian settings → General → "Install CLI")
- **Runs from inside Agent Console's kiro-cli session _or_ a regular Terminal** — the driver *attaches* to the running Obsidian via the `obsidian` CLI's CDP surface (`dev:cdp` / `dev:screenshot`) and uses macOS `screencapture` for native-popup shots. It does **not** launch a second Obsidian, so the macOS App Sandbox (`__CFBundleIdentifier=md.obsidian`) does not block it (`dev:*` is IPC, `screencapture` is a system binary). The one requirement: the fixtures vault must be open as the Obsidian window targeted by `vault="vault"`.

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
│   ├── vault/             # Minimal Obsidian vault for consistent captures
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
     "approvalThreshold": 0.05
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
