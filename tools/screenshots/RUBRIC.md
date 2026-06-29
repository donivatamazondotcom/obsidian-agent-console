# Screenshot Quality Rubric

The standard every docs-site screenshot in this repo is held to. The screenshot
automation (`tools/screenshots/`) regenerates images reproducibly; this rubric
defines what makes a regenerated image *good* — not just technically valid, but
communicative.

> **Why a rubric at all?** Apple and Google Play enforce rigid screenshot slots,
> dimensions, and content rules. **Obsidian enforces none for plugins** (verified
> below). The bar is entirely self-imposed via the README, the community-directory
> detail page, and the docs site. Nothing external will catch a weak shot — so this
> document is the only gate. Our screenshots are the artwork in the directory tile,
> the README hero, and every docs page.

## Three layers of quality

A screenshot passes only when all three hold. The automation already enforces
layers 1–2; this rubric adds layer 3.

| Layer | Question | Enforced by |
|---|---|---|
| **1. Correctness** | Right UI state, fresh against the shipping build? | Freshness gates (I06–I08), `setup.sh` plugin reload |
| **2. Fidelity** | Technically clean capture — full resolution, not blank, right dimensions? | Retina-DPR capture (I11), content-guard distinct-color floor (I12), dimension match (T05) |
| **3. Communicative quality** | Does the shot tell a story, sell a differentiator, look appealing, show something delightful? | **This rubric** — Tier-1 manifest fields + Tier-2 capture asserts |

Layer 3 follows the I12 pattern: take an abstract quality, distill a rubric, encode
the *checkable* parts as gates, and leave the irreducibly-aesthetic parts to a
documented human review (or, eventually, VLM scoring — see Tier 3).

## The principles

Twelve principles. Each maps to one of three desiderata — **appealing**,
**delightful**, **differentiating** — and to a checkability tier. P1–P10 converge
across all four researched sources; P11 (accessibility) and P12 (rich rendering, below) are Agent-Console-specific
additions (see § Sources).

| # | Principle | Desideratum | Checkable? |
|---|---|---|---|
| **P1** | **Lead with the strongest shot.** The hero answers "what is this?" in ~2s. Never a splash, login, empty, or connecting state. | Differentiating | Partly — `placement: hero` |
| **P2** | **One idea per shot.** Each frame showcases exactly one capability. Don't repeat a feature from different angles. | Delightful | Human + `mustShow` |
| **P3** | **Show the authentic product with real content.** Actual UI, realistic note/chat content — never lorem, empty, or a spinner/connecting state. | Delightful | Partly — content-guard + state-wait (built) |
| **P4** | **Each shot maps to a differentiator; the set tells a story.** Sequence mirrors the value ranking, not implementation order. | Differentiating | `differentiator` field |
| **P5** | **Legible at display size.** Renders small in the directory tile, README, and docs grid — text and the focal element must read at ~30–40%. | Appealing | Yes — DPR × crop legibility floor |
| **P6** | **Visually consistent across the set.** Same theme, zoom, window width, drop-shadow, crop padding. | Appealing | Partly — fixtures pin most (Q4) |
| **P7** | **Clean frame.** No dev console, no error banners, no unrelated panels, no personal vault content, no leaked internal agent names, no stray chrome. | Appealing | Yes — forbidden-selector asserts |
| **P8** | **Current, not stale.** Matches the shipping build. (The whole freshness thesis of the initiative.) | Differentiating | Yes — freshness gates (I06–I08) |
| **P9** | **Caption sells the benefit, not the mechanism.** If a caption/alt is used: 3–7 words, benefit-led, no hype/superlatives/CTAs. Carries the docs `alt=` too. | Differentiating | `caption` / `altText` fields |
| **P10** | **Motion where motion is the value.** Use a short, focused GIF for behaviors a still can't convey (parallel agents, status transitions). | Delightful | Future — v2 gif work |
| **P11** | **Color-blind-safe signals.** Any status/state conveyed by color must also carry a non-color cue (shape, icon, text). Never red/green as the sole differentiator. | Appealing | Partly — review + `mustShow` wording |
| **P12** | **Show off Obsidian's rich rendering.** The chat view *is* Obsidian's markdown renderer and the note pane renders the full vault — favor fixture content that exercises it: syntax-highlighted code blocks, Mermaid diagrams, callouts, tables, and Bases dashboards (card/table views). Make quick-prompt pills expressive with glyphs/emoji. Colorful, varied, authentic content over plain prose. | Delightful + Differentiating | Partly — fixture content + `mustShow` on a rich element |

## Source validation

Verified against current official docs on 2026-06-10. Tier per `ground-truth.md`
(1 = official/authoritative, 2 = curated/community).

| Source | Tier | Validated finding |
|---|---|---|
| [Google Play — Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) | 1 | Confirms verbatim: screenshots must "demonstrate the actual in-app experience" (P3); "prioritize UI in the first three screenshots" (P1/P4); taglines "should not take up more than 20% of the image" and no "Best/#1/Top/New" or call-to-action (P9); "reflect the latest state" + avoid time-sensitive content (P8); "edit excess elements in the notification bar" (P7); alt text "140 characters or less", "don't use 'photo of' or 'image of'" (P9); "similar or complementary color theme" (P6). Set size: **min 2 required; ≥4 recommended** (1080px, 16:9/9:16) for promo eligibility. |
| [Apple — Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) | 1 | Confirms the **headline contrast**: Apple enforces rigid per-device pixel dimensions and 1–10 screenshots. Apple's accessibility criteria ([Differentiate Without Color Alone](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/differentiate-without-color-alone-evaluation-criteria), [Sufficient Contrast](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria)) underwrite **P11**. The narrative/caption/"7-second-scan" conventions are Tier-2 (ASO research), not Apple's literal spec. |
| [VS Code — Extension Manifest § Marketplace Presentation Tips](https://code.visualstudio.com/api/references/extension-manifest) | 1 | Confirms README.md imagery is the marketplace surface; relative-path image links are included in the extension detail body. **Calibration:** "animated GIFs strongly recommended" is **Tier-2** (the `stateful/vscode-awesome-ux` community repo), *not* on the official manifest page. P10 rests on community guidance, not an official mandate. |
| [Obsidian — Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) + [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) | 1 | **Headline finding verified.** Required root files: `README.md`, `LICENSE`, `manifest.json`. Release assets: `main.js`, `manifest.json`, `styles.css` (optional). **No screenshot asset spec for plugins anywhere.** (Contrast: the Obsidian *theme* store requires a 512×288 screenshot.) Guidelines govern only UI text (sentence case, `setHeading`), styling (no hardcoded styles), and "the developer console should only show error messages" — which reinforces P7's clean-frame rule. |

## Map to the value hierarchy

The screenshot *set* earns its keep only when it mirrors the fork's value story
(see `Agent Console Pre-Launch Differentiator Set`). Each shipped differentiator is
one candidate "one idea per shot" (P2 + P4):

| Differentiator | Candidate shot | `mustShow` — the delightful element |
|---|---|---|
| Tabbed sessions | **Hero** — multi-session | ≥3 session tabs with distinct per-tab status icons + a completed response |
| Compact tool calls | tool-call collapse | a one-row collapsed tool call beside an expanded one |
| Context strip | context pill | the `@`-note context pill pinned on the composer |
| Header branding | header | the `[Agent Console] Profile · Model` header, legible |
| Ribbon icon | ribbon-icon | the Agent Console mark + "Agent Console" tooltip |
| Sidebar-only placement | (covered by hero) | panel docked in the sidebar, tabs visible |
| Renders like Obsidian | rich-rendering shot | a syntax-highlighted code block / Mermaid diagram in the transcript, or a Bases card view in the note pane |

**Hero = multi-session** (tabs + per-tab status), matching the README value order.
The set is built one-shot-per-differentiator, ranked by `placement`.

**P12 is realized in the fixtures, not the capture code.** The `studio` fixtures must carry the richness P12 asks for: at least one note exercising code blocks + a Mermaid diagram + callouts, a `.base` + property-rich notes for a card/table dashboard, and quick-prompt fixtures with glyph/emoji labels. Because the chat view renders full Obsidian-flavored markdown, transcript fixtures should produce a colorful code block / diagram / callout; assert the rich element via `mustShow`. Authentic-but-rich content (P3 + P12) beats plain prose — a plain-text transcript undersells that the chat renders like Obsidian.

## How the rubric is encoded

A spectrum from human-only to fully automated. v1 ships Tiers 0–2; Tier 3 is deferred.

### Tier 0 — this document
The principle table is the source of truth. A human applies it at review. Necessary,
not enforced.

### Tier 1 — editorial fields in the manifest
Per-entry declarative intent alongside the technical fields. Makes editorial intent
**diffable and reviewable**, and `mustShow` doubles as the spec for the prompt
template / fixture content.

| Field | Meaning |
|---|---|
| `purpose` | One line: what this shot communicates |
| `differentiator` | Which differentiator it sells (ties to the cohort note) |
| `placement` | `hero` \| `feature` \| `reference` — sets the scrutiny bar (hero = strictest) |
| `mustShow` | The specific delightful element that must be visible (P2) |
| `caption` | Benefit-led copy, 3–7 words, no hype/CTA (P9) |
| `altText` | Docs `alt=`, ≤140 chars, no "image of" (P9, Google alt-text rule) |

### Tier 2 — capture-time assertions
The natural extension of I06–I08 + I12. A capture that violates one of these **fails
the run** (deletes the file, exits non-zero — the I12 precedent).

- **`mustShow` presence** — the element is in the DOM *and* inside the crop region
  before capture. The highest-value new gate; I06–I08 generalized. (P2/P3)
- **Legibility floor** — minimum effective resolution (DPR × crop px) so the focal
  element reads small. Extends the I11 DPR work. (P5)
- **Cleanliness asserts** — fail if forbidden selectors are present in the crop:
  dev console, error banners, unrelated leaves, known internal-agent-name strings.
  Encodes P7 mechanically.
- **Content-guard distinct-color floor** — already shipped as I12. (fidelity)

### Tier 3 — VLM aesthetic scoring (future, name don't build)
Feed the captured `.webp` + the entry's `purpose`/`mustShow` to a multimodal model:
"does this communicate X clearly and look appealing? score + critique." The only way
to automate the *appealing/delightful* axis that Tier-2 asserts can't reach.
Expensive, non-deterministic — tracked as **F06** in the spec, gated behind Tier-1/2
proving insufficient in practice.

## Using the rubric

**At authoring time** (new or reshot image):
1. Write the Tier-1 fields first. If you can't state `purpose` and `mustShow` in one
   line each, the shot isn't worth taking yet.
2. `mustShow` is the contract — it drives the prompt template / fixture content and
   becomes the Tier-2 assertion.
3. Set `placement`. A `hero` shot gets the strictest review; `reference` shots can be
   plainer.

**At review time** (eyeball diff or approval test):
- Walk P1–P11 against the image. The hero must clear every principle.
- For status/state shots, explicitly check P11 — is the signal readable without
  relying on red/green? (Maintainer has red/green color-vision deficiency.)
- An approval-test failure is **not** auto-re-approved: investigate → decide if the
  change is intentional → re-approve only if yes.

## The highest-leverage piece

**`mustShow` + its assertion.** It forces naming the delightful thing *before*
capture, makes the prompt template's job concrete, and converts "is this a good shot"
from a vibe into a checkable contract — exactly the I12 pattern, applied to
communicative quality instead of fidelity.

## See also

- `manifest.json` — the per-entry fields this rubric defines (Tier 1)
- `README.md` (this folder) — the operational runbook for capturing
- Spec: `Agent Console Screenshot Automation` (vault) — design, decisions, I01–I12
- Research synthesis: `Agent Console Screenshot Quality Rubric — research synthesis`
  (vault) — the full source analysis this distills
