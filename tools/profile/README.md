# Runtime profiler (Gate B-phase2)

Measures how a real Obsidian renders a heavy chat: a 201-message transcript with 56 code blocks. It attaches to a running Obsidian over `obsidian dev:cdp`, seeds the transcript into a disposable vault, hard-reloads that vault, and runs four scenarios. It is not a blocking gate. The release recipe records one history point per release, so slow drift shows up over time (RELEASING.md step 1d).

## Run it

Open the fixtures `studio` vault (or an `ST-*` smoke vault) in Obsidian, then:

```bash
npm run build              # studio loads the main checkout's main.js
npm run profile            # one pass, diff vs the baseline
npm run profile:record     # median of 5 passes, appends to profile-history.jsonl
npm run profile:trend      # print the history (offline)
```

Other flags: `--vault=ST-foo`, `--runs=7`, `--update` (rewrite the baseline), `--update-golden` (rewrite the drift anchor; rarely, on purpose), `--gate` (exit 1 on a step regression), `--no-seed`, `--sha=<sha>`.

Each run hard-reloads the vault about 6 times. **Never point it at a vault with live chats.** The guard (`vault-guard.ts`) refuses any vault that is not `studio` or `ST-*`, any vault other than the one requested, and any vault without the plugin's `data.template.json`. It seeds the vault it measures, at that vault's own base path and config folder.

## Scenarios

| Scenario | What it does | Signals |
|---|---|---|
| `cold-start-restore` | Hard reload, wait until the active panel shows all 201 rows | `wallMs` (ms from navigation start, page clock), long frames |
| `activate-background-tab` | Park on the light tab, then activate the heavy tab; wait until it is selected and shows all 201 rows | `activateMs` (click to full transcript), `RecalcStyleCount`, long frames |
| `stream-tokens` | Grow a temporary span in the last assistant row ~50 tokens, forcing a layout each, then remove it | `maxStyleLayoutMs`, long frames |
| `scroll-heavy-transcript` | Step the transcript top to bottom, one step per animation frame, and count scroll events | `LayoutCount`, `RecalcStyleCount`, `maxStyleLayoutMs` |

`stream-tokens` is a layout proxy, not a streaming test: it never goes through React or the markdown renderer, and its `LayoutCount` (50 forced + 1) is set by the proxy itself. A real-stream scenario needs a fake streaming agent.

Waits run in the page: a `MutationObserver` re-checks the condition on every DOM change, so the reported time is the mutation that made it true, not the next poll.

Long frames come from `long-animation-frame` entries (`longtask` only where LoAF is unsupported). The buffer is cleared at the start of each scenario. `maxStyleLayoutMs` is the time from a frame's `styleAndLayoutStart` to its end.

## Failures

A run is **incomplete** when a scenario fails in any pass (a missing tab, row or scroll container, or a wait that times out), when a scenario in the baseline wasn't measured, or when the vault's page was hidden at any point (screen locked, window minimized or covered). A hidden page renders no frames, so its scroll and long-frame numbers mean nothing and its timings aren't comparable. Keep the profiled window visible and the screen unlocked. An incomplete run lists the reasons, exits 1, and writes nothing: no history point, no baseline, no golden anchor. That way a stale selector can't pass as a measurement.

## Files

| File | Holds |
|---|---|
| `profile-baseline.json` | The ratcheting step baseline (30% threshold) |
| `profile-golden.json` | The immutable drift anchor (50%, warn only) |
| `profile-history.jsonl` | One median-of-N point per release |
| `profile-history-2026-07-v1.jsonl` | The July v1.9.0 points. Not comparable: they predate the navigation-start `wallMs` and the rail-tab and seeding fixes |

Each history point records the plugin version from the vault's `manifest.json`, the git sha of the checkout its `main.js` resolves into, a hash of that `main.js`, the Obsidian version and the host. Step 1d runs before the version bump, so a point shows the previous version: `2.4.0@83cc049e` is the v2.5.0 release candidate. Points compare only on the same host.

Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2 (vault).
