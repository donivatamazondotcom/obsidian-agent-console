/**
 * Screenshot manifest schema, parser, and validator.
 *
 * The manifest is a JSON file at `tools/screenshots/manifest.json` listing
 * each screenshot the docs site needs. The driver reads it, drives a
 * separately-launched Obsidian instance through each entry's UI state,
 * captures via `obsidian dev:screenshot`, crops, encodes to .webp, and
 * writes to `docs/public/images/<name>.webp` (output path derived from
 * `name` via `lib/output.ts`).
 *
 * Spec: [[Agent Console Screenshot Automation]] § Architecture Impact.
 * Test contract: tools/screenshots/lib/__tests__/manifest.test.ts.
 *
 * Decision: validation is shape-level only. Whether a crop region fits
 * inside the captured image is a runtime concern (capture is upstream of
 * crop). The validator's job is to catch authoring mistakes before
 * launching Obsidian (T04 in the spec).
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** Pixel rectangle in the source-screenshot coordinate space. */
export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Declarative UI-state hints. The driver reads these and translates to
 * `obsidian dev:cdp Runtime.evaluate` calls (open the named note, click
 * the ribbon icon, open the floating chat view) before capturing. Kept
 * narrow on purpose: the v0 entries only need these three flags. Add new
 * fields here when a new entry needs a new UI affordance.
 */
export interface InitialState {
	/**
	 * Path of a fixture note to open in the active leaf. Resolved against
	 * `<fixtureRoot>/vault/`. Validated by `validateManifest`.
	 */
	openNote?: string;
	/**
	 * When true, click the Agent Console ribbon icon to activate the
	 * plugin's panel. Idempotent — clicking again with the panel already
	 * open is a no-op.
	 */
	clickRibbon?: boolean;
	/**
	 * When true, open the plugin's floating chat view via the dedicated
	 * command. Required for floating-chat-view.webp.
	 */
	openChatView?: boolean;
	/**
	 * CSS selector to hover before capture (triggers tooltips).
	 * The driver dispatches mouseenter + mouseover on the element.
	 */
	hoverSelector?: string;
	/**
	 * CSS selector to click before capture (opens menus/popovers).
	 * Uses CDP Input.dispatchMouseEvent for a coordinate-aware click
	 * that triggers React handlers needing mouse position (e.g.
	 * Obsidian Menu.showAtMouseEvent). The driver focuses the window,
	 * clicks, then waits for `waitSelector` to appear.
	 */
	clickSelector?: string;
	/**
	 * CSS selector to wait for after `clickSelector` fires (e.g.
	 * ".menu" for Obsidian popover menus). Times out after 3s.
	 */
	waitSelector?: string;
	/**
	 * Settings tab id to open before capture (e.g. "agent-console"). The
	 * driver calls `app.setting.open()` then `app.setting.openTabById(id)`,
	 * rendering that plugin's settings pane. Used for settings-surface shots
	 * (e.g. the Default-agent dropdown) that have no chat panel.
	 */
	openSettings?: string;
	/**
	 * CSS selector for a native `<select>` whose option popup to open via
	 * `HTMLSelectElement.showPicker()` (screen-mode only). A native select
	 * popup is an OS window invisible to dev:screenshot and undrivable by
	 * synthetic click/CDP input when the fixtures window isn't OS-frontmost
	 * (I13/I15), so it needs `captureMode: "screen"` + the float + showPicker.
	 */
	openNativeSelect?: string;
}

/** One screenshot specification. */
export interface ManifestEntry {
	/**
	 * Unique identifier within the manifest. Used as CLI selector
	 * (`npm run docs:screenshots -- <name>`) and as the output filename
	 * (`<name>.webp`) under `docs/public/images/`. Must be filesystem-
	 * and URL-safe.
	 */
	name: string;
	/** Final image width in pixels (after crop, before .webp encoding). */
	width: number;
	/** Final image height in pixels. */
	height: number;
	/** Crop region in the captured screenshot's coordinate space. */
	crop: CropRect;
	/**
	 * Optional CSS selector for auto-cropping. When set, the driver
	 * queries `getBoundingClientRect()` on this element at capture time
	 * and uses the result (plus `cropPadding`) as the crop region —
	 * overriding the static `crop` field. Falls back to `crop` if the
	 * selector matches nothing.
	 */
	cropSelector?: string;
	/**
	 * Padding in CSS pixels to add around the `cropSelector` bounds on
	 * all sides. Default 16. Ignored when `cropSelector` is not set.
	 */
	cropPadding?: number;
	/**
	 * Optional list of CSS selectors whose union bounding box (plus
	 * `cropPadding`) defines the crop region — for framing a *group* of
	 * sibling elements (e.g. the cluster of chat-header action icons) that
	 * has no single wrapping element. Takes precedence over `cropSelector`
	 * and `crop`. The captured content is then centered on a canvas of
	 * `width`×`height`, padded with the background color sampled from the
	 * content's top-left pixel — reproducing the upstream "icons centered
	 * with surrounding padding" look even when the icons sit flush at the
	 * window edge. Unlike `cropSelector`, a missing selector here is a hard
	 * error (a group crop with a dropped member would be silently wrong).
	 */
	cropSelectors?: string[];
	/** Optional UI-state setup performed before capture. */
	initialState?: InitialState;
	/**
	 * Optional path to a prompt fixture file (relative to
	 * `tools/screenshots/fixtures/prompts/`). When set, the driver sends
	 * the file's contents as the user message in the active session
	 * before capturing.
	 */
	promptFile?: string;
	/**
	 * Optional ordered list of prompt fixture files. Takes precedence over
	 * `promptFile`: the first prompt is sent in the initial tab and each
	 * subsequent prompt opens a new session tab, producing a multi-session
	 * tab bar.
	 */
	prompts?: string[];
	/**
	 * CSS selectors to hide (set `display:none`) right before capture.
	 * Trims chrome that isn't the subject of the shot — e.g. the chat
	 * composer for a transcript-focused screenshot — so the window can be
	 * sized tight to the content without the hidden element forcing scroll
	 * overflow. Applied before the settle + scroll-to-top step so the layout
	 * reflows before the screenshot is taken.
	 */
	hideSelectors?: string[];
	/**
	 * Optional text typed into the active session's chat composer right
	 * before capture, WITHOUT sending. Used to show the input box populated
	 * with its context-note pill(s) and an example message (rather than an
	 * empty placeholder). Applied after prompts are sent and responses settle.
	 */
	draftMessage?: string;
	/**
	 * After sending the FINAL prompt (window mode only), wait for THIS
	 * selector (scoped to the active panel) instead of the two-phase
	 * completion wait. For shots whose subject is a mid-turn PAUSED state
	 * — e.g. a file-edit permission card — where the turn blocks on user
	 * input and never reaches "response complete" (so the
	 * loading-indicator-hidden wait would hang). Also drives the
	 * pre-capture scroll: the awaited element is scrolled INTO VIEW rather
	 * than scrolling the transcript to the top. Ignored in screen mode.
	 */
	awaitSelector?: string;
	/**
	 * When true, the driver toggles `obsidian dev:mobile on` before
	 * capturing this entry and back off after. Reserved for F01.
	 */
	mobile?: boolean;
	/**
	 * Per-entry agent override. When set, the orchestrator sets the plugin's
	 * defaultAgentId to this id before opening the session, so the captured
	 * session connects with THIS agent rather than the fixtures default. Used
	 * by the slash-command shots, which need Gemini CLI's public command set
	 * (the internal Claude Code toolbox build leaks internal slash commands).
	 */
	agentId?: string;
	/**
	 * Capture backend. Default "window" uses `obsidian dev:screenshot`, which
	 * captures the BrowserWindow renderer — correct for all in-DOM content.
	 * "screen" uses macOS `screencapture` of the window's screen region; it is
	 * ONLY needed for shots whose subject is an Obsidian native popup `Menu`
	 * (e.g. mode/model/agent selectors), which renders in a separate native
	 * window invisible to dev:screenshot. Screen-mode entries must crop via
	 * static `crop` (the menu is not in the DOM, so `cropSelector`/
	 * `cropSelectors` cannot resolve it) and pin the window to a fixed size so
	 * the crop region is reproducible.
	 */
	captureMode?: "window" | "screen";
	/**
	 * Approval-test threshold for `pixelmatch` — fraction of differing
	 * pixels above which the test fails. Default 0.05 (loose enough for
	 * real-agent variability per Decision 2; tighten per-entry for
	 * deterministic UI like ribbon icons via e.g. `0.001`).
	 */
	approvalThreshold?: number;
	/**
	 * Content-guard floor: minimum number of distinct RGB colors the final
	 * (post-shadow) webp must contain, else the capture is rejected as
	 * blank/degraded and the file is deleted (I11 follow-up). Counted on RGB
	 * only (alpha ignored), so the transparent shadow margin doesn't inflate
	 * the count — the value is directly comparable to the committed-file
	 * calibration (ribbon-icon ~1713, session-history-button ~520,
	 * mode-selection ~2794, multi-session ~4800). When omitted, the orchestrator
	 * applies `DEFAULT_MIN_DISTINCT_COLORS` (a low gross-blank backstop). A
	 * single global floor cannot separate good from bad across entries (a
	 * degraded ribbon-icon at 400 colors exceeds a healthy
	 * session-history-button at 219), so calibrated entries set this per-entry.
	 */
	minDistinctColors?: number;

	/**
	 * Legibility floor (rubric P5): minimum source/target scale for the RESIZE
	 * path. The cropped source region (device px) must be at least
	 * `minLegibilityScale ×` the output dimensions, else the emit upscales and
	 * blurs — illegible when the docs site renders the shot small. Default
	 * `DEFAULT_MIN_LEGIBILITY_SCALE` (1.0 = no upscaling). Only applies to
	 * static-crop entries (window + screen mode); `cropSelector` (native size)
	 * and group `cropSelectors` (center-padded) entries never resize, so the
	 * orchestrator skips the floor for them. Tighten for a hero (e.g. 2.0 for
	 * retina headroom); relax below 1.0 only for a tolerant reference shot.
	 */
	minLegibilityScale?: number;

	/**
	 * Tier-2 cleanliness (rubric P7): extra CSS selectors that must NOT be
	 * VISIBLE in the frame at capture time, MERGED with the verified global
	 * `DEFAULT_FORBIDDEN_SELECTORS` (error overlay, tab/session-history error,
	 * stray notice). Use for shot-specific exclusions (e.g. an unrelated leaf).
	 * A visible match fails the run before capture.
	 */
	forbiddenSelectors?: string[];
	/**
	 * Tier-2 cleanliness (rubric P7): extra case-insensitive substrings that
	 * must NOT appear in the visible text, MERGED with `DEFAULT_FORBIDDEN_TEXT`
	 * (internal agent-fleet leak markers). Use for shot-specific internal names.
	 */
	forbiddenText?: string[];

	/**
	 * Tier-1 editorial intent (screenshot quality rubric P1/P2/P4/P9). A
	 * one-line statement of what this shot communicates. Required when
	 * `placement` is "hero" or "feature".
	 */
	purpose?: string;
	/**
	 * Which product differentiator this shot sells (ties to the Pre-Launch
	 * Differentiator Set). Free text.
	 */
	differentiator?: string;
	/**
	 * Scrutiny tier. "hero" = the lead shot answering "what is this?"
	 * (strictest); "feature" = a single-capability shot; "reference" = a
	 * plain supporting image. Hero/feature entries must also set `purpose`
	 * and `mustShow`.
	 */
	placement?: "hero" | "feature" | "reference";
	/**
	 * CSS selector for the single delightful element that MUST be visible in
	 * the crop (rubric P2). The Tier-2 capture assert (window-mode only,
	 * added in a later phase) checks the element exists in the DOM and its
	 * bounds intersect the crop region. The human-readable intent lives in
	 * `purpose`.
	 */
	mustShow?: string;
	/**
	 * Benefit-led caption (rubric P9): 3-7 words, no hype/superlatives/CTAs.
	 */
	caption?: string;
	/**
	 * Docs `alt=` text (rubric P9, Google Play alt rule): <=140 chars, and
	 * must not begin with "image of"/"photo of". Validated by
	 * `validateManifest`.
	 */
	altText?: string;
}

export interface Manifest {
	entries: ManifestEntry[];
}

/**
 * Parse a manifest from a JSON string. Throws on syntax errors or
 * structural mismatches (e.g. `entries` missing or non-array). Does NOT
 * check fixture file existence — that's `validateManifest`.
 */
export function parseManifest(json: string): Manifest {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`manifest is not valid JSON: ${msg}`);
	}
	if (typeof raw !== "object" || raw === null) {
		throw new Error("manifest must be a JSON object");
	}
	const obj = raw as Record<string, unknown>;
	if (!("entries" in obj)) {
		throw new Error("manifest missing required field: entries");
	}
	if (!Array.isArray(obj.entries)) {
		throw new Error("manifest field entries must be an array");
	}
	// Shape-cast; per-entry validation lives in validateManifest.
	return { entries: obj.entries as ManifestEntry[] };
}

/**
 * Validate a parsed manifest against on-disk fixtures.
 *
 * @param manifest - parsed manifest
 * @param fixtureRoot - directory containing `vault/` and `prompts/`
 *   subdirectories (typically `tools/screenshots/fixtures/`)
 *
 * Throws on the first failure. Failures include:
 * - empty or duplicate `name`
 * - non-positive `width` or `height`
 * - `promptFile` references a file that doesn't exist under
 *   `<fixtureRoot>/prompts/`
 * - `initialState.openNote` references a file that doesn't exist under
 *   `<fixtureRoot>/vault/`
 * - `approvalThreshold` outside the `[0, 1]` range
 *
 * Notes:
 * - Crop region is NOT validated against (width, height) — they live in
 *   different coordinate spaces. See manifest.test.ts pin.
 */
export function validateManifest(
	manifest: Manifest,
	fixtureRoot: string,
): void {
	const seen = new Set<string>();
	for (const entry of manifest.entries) {
		if (!entry.name || entry.name.trim() === "") {
			throw new Error(`manifest entry has empty name`);
		}
		if (seen.has(entry.name)) {
			throw new Error(`manifest has duplicate name: ${entry.name}`);
		}
		seen.add(entry.name);

		if (!Number.isFinite(entry.width) || entry.width <= 0) {
			throw new Error(
				`manifest entry "${entry.name}" has invalid width: ${entry.width}`,
			);
		}
		if (!Number.isFinite(entry.height) || entry.height <= 0) {
			throw new Error(
				`manifest entry "${entry.name}" has invalid height: ${entry.height}`,
			);
		}

		if (entry.promptFile) {
			const promptPath = path.join(
				fixtureRoot,
				"prompts",
				entry.promptFile,
			);
			if (!existsSync(promptPath)) {
				throw new Error(
					`manifest entry "${entry.name}" references missing prompt file: ${entry.promptFile} (looked under ${path.join(fixtureRoot, "prompts")})`,
				);
			}
		}

		if (entry.initialState?.openNote) {
			const notePath = path.join(
				fixtureRoot,
				"vault",
				entry.initialState.openNote,
			);
			if (!existsSync(notePath)) {
				throw new Error(
					`manifest entry "${entry.name}" references missing note: ${entry.initialState.openNote} (looked under ${path.join(fixtureRoot, "vault")})`,
				);
			}
		}

		if (entry.approvalThreshold !== undefined) {
			const t = entry.approvalThreshold;
			if (!Number.isFinite(t) || t < 0 || t > 1) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid approvalThreshold: ${t} (must be in [0, 1])`,
				);
			}
		}

		if (entry.minDistinctColors !== undefined) {
			const m = entry.minDistinctColors;
			if (!Number.isFinite(m) || m < 0) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid minDistinctColors: ${m} (must be a finite number >= 0)`,
				);
			}
		}
		if (entry.minLegibilityScale !== undefined) {
			const s = entry.minLegibilityScale;
			if (!Number.isFinite(s) || s <= 0) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid minLegibilityScale: ${s} (must be a finite number > 0)`,
				);
			}
		}

		if (entry.awaitSelector !== undefined) {
			if (
				typeof entry.awaitSelector !== "string" ||
				entry.awaitSelector.trim() === ""
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid awaitSelector: must be a non-empty string`,
				);
			}
		}
		if (entry.agentId !== undefined) {
			if (
				typeof entry.agentId !== "string" ||
				entry.agentId.trim() === ""
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid agentId: must be a non-empty string`,
				);
			}
		}
		if (entry.forbiddenSelectors !== undefined) {
			if (
				!Array.isArray(entry.forbiddenSelectors) ||
				!entry.forbiddenSelectors.every(
					(s) => typeof s === "string" && s.trim() !== "",
				)
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid forbiddenSelectors: must be an array of non-empty strings`,
				);
			}
		}
		if (entry.forbiddenText !== undefined) {
			if (
				!Array.isArray(entry.forbiddenText) ||
				!entry.forbiddenText.every(
					(s) => typeof s === "string" && s.trim() !== "",
				)
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid forbiddenText: must be an array of non-empty strings`,
				);
			}
		}
		if (entry.cropSelectors !== undefined) {
			if (
				!Array.isArray(entry.cropSelectors) ||
				entry.cropSelectors.length === 0 ||
				!entry.cropSelectors.every(
					(s) => typeof s === "string" && s.trim() !== "",
				)
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid cropSelectors: must be a non-empty array of non-empty strings`,
				);
			}
		}

		const selectorStrings: Array<[string, string | undefined]> = [
			["openSettings", entry.initialState?.openSettings],
			["openNativeSelect", entry.initialState?.openNativeSelect],
		];
		for (const [label, value] of selectorStrings) {
			if (
				value !== undefined &&
				(typeof value !== "string" || value.trim() === "")
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid initialState.${label}: must be a non-empty string`,
				);
			}
		}

		if (
			entry.placement !== undefined &&
			entry.placement !== "hero" &&
			entry.placement !== "feature" &&
			entry.placement !== "reference"
		) {
			throw new Error(
				`manifest entry "${entry.name}" has invalid placement: ${entry.placement} (must be "hero", "feature", or "reference")`,
			);
		}

		const editorialStrings: Array<[string, string | undefined]> = [
			["purpose", entry.purpose],
			["differentiator", entry.differentiator],
			["mustShow", entry.mustShow],
			["caption", entry.caption],
		];
		for (const [label, value] of editorialStrings) {
			if (
				value !== undefined &&
				(typeof value !== "string" || value.trim() === "")
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid ${label}: must be a non-empty string`,
				);
			}
		}

		if (entry.altText !== undefined) {
			if (
				typeof entry.altText !== "string" ||
				entry.altText.trim() === ""
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid altText: must be a non-empty string`,
				);
			}
			if (entry.altText.length > 140) {
				throw new Error(
					`manifest entry "${entry.name}" has altText longer than 140 chars (${entry.altText.length})`,
				);
			}
			if (/^\s*(image|photo) of\b/i.test(entry.altText)) {
				throw new Error(
					`manifest entry "${entry.name}" altText must not start with "image of"/"photo of" (screen readers already announce this)`,
				);
			}
		}

		if (
			(entry.placement === "hero" || entry.placement === "feature") &&
			(!entry.purpose || !entry.mustShow)
		) {
			throw new Error(
				`manifest entry "${entry.name}" has placement "${entry.placement}" but is missing required purpose and/or mustShow`,
			);
		}
	}
}
