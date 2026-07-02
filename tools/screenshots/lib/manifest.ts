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
	 * Multiple editor tabs to open before capture. The first replaces the
	 * active leaf; each subsequent note opens in a NEW editor tab (background
	 * tabs beside the active note — e.g. the hero's Weekly review + Reading
	 * list dashboard). Use instead of openNote when >1 editor tab is wanted.
	 */
	openNotes?: string[];
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
	 * When true, force `quickPromptLibrary.rescan()` after the panel opens so
	 * quick prompts reflect their current frontmatter labels/flags. Guards the
	 * scan/cache race (QP-I26) where a prompt scanned before its frontmatter is
	 * cached falls back to its filename (losing the emoji `label:` + new-tab
	 * marker); without this a fresh fixtures-vault load can capture the wrong
	 * label non-deterministically. Remove once QP-I26 is fixed.
	 */
	rescanQuickPrompts?: boolean;
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
	/**
	 * Obsidian command ids to execute in order before capture — opens
	 * command-driven UI the pipeline can't otherwise reach (command palette,
	 * the New-chat-with-agent picker, or extra `agent-console:new-chat` tabs to
	 * populate the tab-list dropdown). Runs after clickRibbon/openChatView and
	 * BEFORE clickSelector.
	 */
	runCommands?: string[];
	/**
	 * Text typed into the active `.prompt-input` after runCommands (filters the
	 * command palette to the Agent Console commands).
	 */
	typeQuery?: string;
	/**
	 * Optional CSS selector for the input `typeQuery` types into (default
	 * `.prompt-input`). Use to drive a non-palette input, e.g. the
	 * session-history search box `.agent-client-session-history-search-input`.
	 */
	typeQuerySelector?: string;
	/**
	 * Force the chat header "update available" pill by stubbing the plugin's
	 * checkForUpdates() to resolve true before the panel mounts. Deterministic
	 * substitute for a real newer GitHub release.
	 */
	forceUpdateAvailable?: boolean;
	/**
	 * Force the Layer-2 getting-started empty state: stub detectAgents() to
	 * resolve `detectedAgentIds` and set the default agent to `defaultAgentId`
	 * (a built-in NOT in that set) before the panel mounts.
	 */
	forceGettingStarted?: {
		defaultAgentId: string;
		detectedAgentIds: string[];
	};
	/**
	 * Force a perpetual "connecting" session by rewriting the default agent's
	 * command so its process never completes the ACP handshake. A message sent
	 * into a connecting session is held in the locked composer (queue-of-one,
	 * #82 Decision 9) — drives the queue-next-message shot. setup.sh restores
	 * the real command from the template on the next run.
	 */
	forceConnectingHold?: boolean;
	/**
	 * Disable native menus before capture so an Obsidian `Menu` popover renders
	 * as a window-capturable DOM `.menu` instead of an OS popup (which would
	 * otherwise need screen-mode). Mirrors the forceTabStates path.
	 */
	disableNativeMenus?: boolean;
	/**
	 * Ordered click steps for multi-click drives. Each step clicks `selector`
	 * then waits for `waitFor` (or a brief settle if omitted). Use when a shot
	 * needs more than one click — e.g. load a saved session from the history
	 * modal, then open the shared-links dropdown on the now-active tab.
	 */
	clickSequence?: { selector: string; waitFor?: string }[];
	/**
	 * Seed the tab bar with an exact set of labeled tabs, each forced into a
	 * specific visual state, so the tab-list dropdown shows the full glyph
	 * legend (● ready / ◐ busy / △ permission / ✕ error / ○ disconnected)
	 * deterministically. Real ACP sessions can't be coerced into all five
	 * states at once, so the driver sets `nativeMenus=false` (making the
	 * chevron dropdown a DOM `.menu`, window-capturable and focus-independent)
	 * then drives the view's `tabManagerRef.setTabState`. Runs after
	 * clickRibbon/openChatView and BEFORE clickSelector (which opens the
	 * chevron). The seeded tabs replace the panel's initial auto-labeled tab.
	 */
	forceTabStates?: {
		label: string;
		state: "ready" | "busy" | "permission" | "error" | "disconnected";
	}[];
	/**
	 * Surface the ConfirmCloseModal for the confirm-close shot. The modal is
	 * only reachable via the panel's private Cmd+W handler (handleCloseRequest
	 * → shouldConfirmClose → ConfirmCloseModal); there is no command and Cmd+W
	 * can't be synthesized reliably. When true, the driver calls the live
	 * view's close handler AFTER forceTabStates has seeded 2+ tabs, so the real
	 * tab count gates the real modal. Capturing the open modal never detaches
	 * the leaf (the leaf.detach() only runs on a "Close panel" click).
	 */
	forceCloseConfirm?: boolean;
	/**
	 * CSS selectors whose `<details>` accordion to collapse (set `open=false`)
	 * before capture — e.g. collapse the built-in-agent sections so the compact
	 * accordion row is the subject (collapsible-agent-sections).
	 */
	collapseSelectors?: string[];
	/**
	 * Settings-pane text target: the visible name of a `.setting-item` or the
	 * summary of a `details.agent-client-agent-section`. The driver finds the
	 * matching element, expands it if it is a collapsed accordion, then
	 * `scrollIntoView({ block: "center" })`s it so a section below the
	 * settings-pane fold is captured (obsidian-system-prompt,
	 * settings-working-directory). Matches on the rendered label, so it is
	 * robust to section reordering and class churn (no positional CSS).
	 */
	scrollToSettingText?: string;

	/**
	 * Restore saved sessions (by title) into tabs, building a multi-session tab
	 * bar where each tab carries its own seeded transcript. For each title, the
	 * driver opens the session-history modal and clicks that session's restore
	 * icon, which appends a NEW tab bound to the session and loads its messages
	 * (verified 2026-06-30: each restore appends + activates a tab; the tab
	 * label is the session title — diverse labels come for free). After
	 * restoring, the initial auto-labeled tab is dropped and the session at
	 * `activeIndex` (default: last) is activated so its rich transcript is the
	 * visible panel. Requires each title to exist in savedSessions with a
	 * message file in sessions/. Runs after clickRibbon/openChatView. Pair with
	 * entry-level `awaitSelector` (e.g. ".mermaid svg") to wait for async
	 * rendering on the active transcript before capture (N1).
	 *
	 * Restore-race guard (optional): the restore + reset sequence can race and
	 * leave the WRONG tab active — most notably the initial empty auto tab
	 * (Claude Code default agent) instead of the intended restored session.
	 * When `requireActiveHeaderIncludes` and/or `requireActiveSelector` are set,
	 * the orchestrator verifies the active panel after restoring (header text
	 * contains the substring; the selector matches ≥1 element in the active
	 * panel) and, if the check fails, resets the panel and retries the whole
	 * restore up to a bounded number of attempts before throwing. This asserts
	 * the outcome (the intended session is the visible one) rather than trusting
	 * the sequence completed without error.
	 */
	restoreSessions?: {
		titles: string[];
		activeIndex?: number;
		/**
		 * Substring the active panel's chat-view header must contain after
		 * restore (e.g. "Kiro CLI"). Enables the verify+retry guard.
		 */
		requireActiveHeaderIncludes?: string;
		/**
		 * Selector that must match ≥1 element in the active panel after restore
		 * (e.g. ".callout"). Enables the verify+retry guard.
		 */
		requireActiveSelector?: string;
		/**
		 * After restoring + activating the chosen tab, click its Reload button
		 * to resume the session (keeps the transcript) so the agent's capability
		 * handshake renders the model/mode toolbar under the composer. A restored
		 * session is otherwise disconnected and shows no model dropdown. The
		 * transient "· Not connected" header text is hidden at capture time by
		 * the Fixtures theme's `body.acp-capturing` rule.
		 */
		reconnectActive?: boolean;
	};
}

/**
 * One driving action in an animation frame (v2). The orchestrator translates
 * each to a focus-INDEPENDENT primitive — NEVER CDP Input, which is silently
 * dropped when the fixtures window isn't OS-frontmost (the I13/I15 wall, since
 * the daily-driver window hosts the agent session driving the capture):
 * - "click": `el.click()` in-renderer, firing React's onClick (the context
 *   strip's grab "+" / pill "×", the send button); optional `waitFor` selector
 *   is polled after the click.
 * - "draft": focus the composer + `execCommand("insertText", …)`, which fires
 *   React's onChange (slash/mention filtering, send-enable) where the
 *   native-value-setter hack does not.
 * - "wait": poll for a selector before the next action (e.g. the send button
 *   enabling once a lazy session connects).
 * - "activateTab": switch the active session tab by zero-based index (drives
 *   `tabManagerRef.setActiveTab` on the id at that index, clamped to range).
 *   Focus-independent (an in-renderer API call, no synthetic input). Used by
 *   the hero GIF to cycle across restored session tabs without sending
 *   anything live.
 */
export type AnimationAction =
	| { type: "click"; selector: string; waitFor?: string }
	| { type: "draft"; text: string }
	| { type: "wait"; selector: string }
	| { type: "activateTab"; index: number };

/** One step of an animation: drive into a state, then hold it for the GIF. */
export interface AnimationFrame {
	/**
	 * Actions performed to transition INTO this frame's state, in order.
	 * Omit/empty for the initial frame (capture the as-set-up state).
	 */
	actions?: AnimationAction[];
	/** How long this state is shown in the GIF, ms (> 0). */
	holdMs: number;
	/**
	 * Wait for this selector inside the active tab panel to appear BEFORE the
	 * frame is captured (scoped to the visible panel, like the still path's
	 * entry-level `awaitSelector`). Use when a frame's action switches content
	 * that renders asynchronously — a fixed settle can screenshot the prior
	 * state (the "one hold late" tab-cycle bug).
	 */
	awaitSelector?: string;
	/**
	 * Wait until the active tab panel's rendered text CONTAINS this substring
	 * before the frame is captured. This is the content-level signal (not the
	 * tab-active class, which flips synchronously while the transcript renders
	 * a tick later) — pin each `activateTab` frame to a phrase unique to that
	 * tab's transcript so the capture never lands one hold behind.
	 */
	awaitText?: string;
}

/**
 * Animated-GIF spec (v2). When set on an entry, the orchestrator takes the
 * multi-frame path: drive each frame, capture (window mode), crop each to the
 * SAME crop region (resolved ONCE before the loop — from `cropSelector` /
 * `cropSelectors` when present, else the static `crop` — so the GIF doesn't
 * jitter), content-guard each frame, then encode to `<name>.gif`. A frame may
 * carry `awaitSelector` / `awaitText` to wait on the active panel's rendered
 * content before capture (fixes async tab-switch renders). `captureMode:
 * "screen"` is NOT used by the animation path. The drop shadow is NOT applied
 * (a `frame.chrome:"macos"` synthetic title bar is applied per frame instead;
 * `frame.chrome:"none"` or no `frame` yields a bare cropped panel).
 */
export interface AnimationSpec {
	/** Ordered frames; the first is usually the initial state (no actions). */
	frames: AnimationFrame[];
	/** Constant encode frame rate (fps, > 0). Each frame's holdMs is realized by repetition. */
	fps: number;
	/** Hard output file-size ceiling (bytes, > 0); exceed → run fails. */
	maxBytes: number;
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
	/**
	 * When true, this entry is a registered capture spec whose image has not
	 * been captured yet. The consistency check exempts it from the
	 * "missing committed image" rule (orphan and broken-ref checks still
	 * apply). Drop the flag and commit the image once captured.
	 */
	pending?: boolean;
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
	 * Collapse Obsidian's left sidebar (file explorer) before capture, so the
	 * composition is the note editor + the Agent Console panel without the
	 * file tree. Uses `app.workspace.leftSplit.collapse()`; the left ribbon
	 * strip stays. Applied once after the panel opens. (hero composition)
	 */
	collapseLeftSidebar?: boolean;
	/**
	 * Force the Agent Console right-sidebar width (px) before capture so the
	 * multi-session tab bar is prominent. Sets the inline width on
	 * `.workspace-split.mod-right-split` (default is ~300px); it persists
	 * across the animation's tab opens. Applied once after the panel opens.
	 */
	rightSplitWidth?: number;
	/**
	 * CSS selectors to force VISIBLE (`opacity:1; visibility:visible`) right
	 * before capture — the mirror of `hideSelectors`. For surfacing controls
	 * that the real UI only reveals on CSS `:hover` (e.g. an attachment's
	 * remove "x" button, `opacity:0` until `:item:hover`). A JS-dispatched
	 * mouseover can't trigger CSS `:hover`, and CDP Input is dropped when the
	 * fixtures window isn't OS-frontmost (I13/I15) — so the hover state is
	 * surfaced declaratively instead. Applied after `attachImage` (the target
	 * may only exist once an attachment is present). Same capture-time-CSS
	 * precedent as the I05 scroll-chevron hide.
	 */
	revealSelectors?: string[];
	/**
	 * Optional text typed into the active session's chat composer right
	 * before capture, WITHOUT sending. Used to show the input box populated
	 * with its context-note pill(s) and an example message (rather than an
	 * empty placeholder). Applied after prompts are sent and responses settle.
	 */
	draftMessage?: string;
	/**
	 * Filename of a committed fixture image (under
	 * `tools/screenshots/fixtures/assets/`) to attach to the active composer
	 * before capture. The orchestrator reads the file in-renderer, builds a
	 * `File`, and dispatches a synthetic `drop` on the input box — there is no
	 * attach button (entry is paste/drop only), and a JS-dispatched DragEvent
	 * reaches React's onDrop regardless of window focus (CDP Input is dropped
	 * when the fixtures window isn't OS-frontmost — I13/I15). Fires after the
	 * connect prompt so the agent's `promptCapabilities.image` is known and the
	 * AttachmentStrip renders an image thumbnail rather than a file-link.
	 */
	attachImage?: string;
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
	captureMode?: "window" | "screen" | "screen-window";
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

	/**
	 * Known cosmetic follow-up for a future capture pass (not a release
	 * blocker). Surfaced during release-cycle review of this shot so a
	 * non-blocking nit isn't lost. Free text.
	 */
	followUp?: string;

	/**
	 * Presentation framing (Decision 11). `true` mounts the shot in a
	 * placement-appropriate frame (hero → synthetic macOS window + soft shadow +
	 * gradient; else → chrome-less card); an object overrides specific fields.
	 * A framed entry SKIPS the flat drop shadow. Resolved by `lib/frame.ts`
	 * resolveFrameConfig and applied as the orchestrator post-process step.
	 */
	frame?:
		| boolean
		| {
				chrome?: "macos" | "none";
				background?: { from?: string; to?: string };
				cornerRadius?: number;
				padding?: number;
				chromeHeight?: number;
				shadow?: { opacity?: number; blur?: number; offsetY?: number };
		  };

	/**
	 * Animated-GIF spec (v2). When present, the entry is captured as a
	 * multi-frame `.gif` (output `<name>.gif`, not `.webp`): the orchestrator
	 * drives each frame, captures window-mode, crops each to the static `crop`,
	 * content-guards each frame, and encodes via ffmpeg. For behaviors a still
	 * can't convey (rubric P10).
	 */
	animation?: AnimationSpec;
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
				"studio",
				entry.initialState.openNote,
			);
			if (!existsSync(notePath)) {
				throw new Error(
					`manifest entry "${entry.name}" references missing note: ${entry.initialState.openNote} (looked under ${path.join(fixtureRoot, "studio")})`,
				);
			}
		}
		for (const n of entry.initialState?.openNotes ?? []) {
			const notePath = path.join(fixtureRoot, "studio", n);
			if (!existsSync(notePath)) {
				throw new Error(
					`manifest entry "${entry.name}" references missing note in openNotes: ${n} (looked under ${path.join(fixtureRoot, "studio")})`,
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

		if (entry.rightSplitWidth !== undefined) {
			const w = entry.rightSplitWidth;
			if (!Number.isFinite(w) || w <= 0) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid rightSplitWidth: ${w} (must be a finite number > 0)`,
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
		if (entry.attachImage !== undefined) {
			if (
				typeof entry.attachImage !== "string" ||
				entry.attachImage.trim() === ""
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid attachImage: must be a non-empty string`,
				);
			}
			const assetPath = path.join(
				fixtureRoot,
				"assets",
				entry.attachImage,
			);
			if (!existsSync(assetPath)) {
				throw new Error(
					`manifest entry "${entry.name}" references missing attachImage asset: ${entry.attachImage} (looked under ${path.join(fixtureRoot, "assets")})`,
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
		if (entry.revealSelectors !== undefined) {
			if (
				!Array.isArray(entry.revealSelectors) ||
				!entry.revealSelectors.every(
					(s) => typeof s === "string" && s.trim() !== "",
				)
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid revealSelectors: must be an array of non-empty strings`,
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

		if (entry.initialState?.restoreSessions !== undefined) {
			const rs = entry.initialState.restoreSessions;
			if (
				typeof rs !== "object" ||
				rs === null ||
				!Array.isArray(rs.titles) ||
				rs.titles.length === 0 ||
				!rs.titles.every(
					(t) => typeof t === "string" && t.trim() !== "",
				)
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid initialState.restoreSessions.titles: must be a non-empty array of non-empty strings`,
				);
			}
			if (
				rs.activeIndex !== undefined &&
				(!Number.isInteger(rs.activeIndex) || rs.activeIndex < 0)
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid initialState.restoreSessions.activeIndex: must be a non-negative integer`,
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
				`manifest entry "${entry.name}" has invalid placement: ${String(entry.placement)} (must be "hero", "feature", or "reference")`,
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

		if (entry.frame !== undefined) {
			const fr = entry.frame;
			if (
				typeof fr !== "boolean" &&
				(typeof fr !== "object" || fr === null || Array.isArray(fr))
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid frame: must be a boolean or an object`,
				);
			}
			if (typeof fr === "object") {
				if (
					fr.chrome !== undefined &&
					fr.chrome !== "macos" &&
					fr.chrome !== "none"
				) {
					throw new Error(
						`manifest entry "${entry.name}" has invalid frame.chrome: ${String(fr.chrome)} (must be "macos" or "none")`,
					);
				}
				const nums: Array<[string, number | undefined]> = [
					["cornerRadius", fr.cornerRadius],
					["padding", fr.padding],
					["chromeHeight", fr.chromeHeight],
				];
				for (const [k, v] of nums) {
					if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
						throw new Error(
							`manifest entry "${entry.name}" has invalid frame.${k}: ${v} (must be a finite number >= 0)`,
						);
					}
				}
				if (fr.shadow !== undefined) {
					const op = fr.shadow.opacity;
					if (
						op !== undefined &&
						(!Number.isFinite(op) || op < 0 || op > 1)
					) {
						throw new Error(
							`manifest entry "${entry.name}" has invalid frame.shadow.opacity: ${op} (must be in [0, 1])`,
						);
					}
					const sn: Array<[string, number | undefined]> = [
						["blur", fr.shadow.blur],
						["offsetY", fr.shadow.offsetY],
					];
					for (const [k, v] of sn) {
						if (v !== undefined && !Number.isFinite(v)) {
							throw new Error(
								`manifest entry "${entry.name}" has invalid frame.shadow.${k}: ${v} (must be a finite number)`,
							);
						}
					}
				}
				if (fr.background !== undefined) {
					const bg: Array<[string, string | undefined]> = [
						["from", fr.background.from],
						["to", fr.background.to],
					];
					for (const [k, v] of bg) {
						if (
							v !== undefined &&
							(typeof v !== "string" || v.trim() === "")
						) {
							throw new Error(
								`manifest entry "${entry.name}" has invalid frame.background.${k}: must be a non-empty string`,
							);
						}
					}
				}
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

		if (entry.animation !== undefined) {
			const a = entry.animation;
			if (
				typeof a !== "object" ||
				a === null ||
				!Array.isArray(a.frames) ||
				a.frames.length === 0
			) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid animation: frames must be a non-empty array`,
				);
			}
			if (!Number.isFinite(a.fps) || a.fps <= 0) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid animation.fps: ${a.fps} (must be a finite number > 0)`,
				);
			}
			if (!Number.isFinite(a.maxBytes) || a.maxBytes <= 0) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid animation.maxBytes: ${a.maxBytes} (must be a finite number > 0)`,
				);
			}
			a.frames.forEach((frame, fi) => {
				if (!Number.isFinite(frame.holdMs) || frame.holdMs <= 0) {
					throw new Error(
						`manifest entry "${entry.name}" animation frame ${fi} has invalid holdMs: ${frame.holdMs} (must be a finite number > 0)`,
					);
				}
				if (
					frame.awaitSelector !== undefined &&
					(typeof frame.awaitSelector !== "string" ||
						frame.awaitSelector.trim() === "")
				) {
					throw new Error(
						`manifest entry "${entry.name}" animation frame ${fi}: awaitSelector must be a non-empty string`,
					);
				}
				if (
					frame.awaitText !== undefined &&
					(typeof frame.awaitText !== "string" ||
						frame.awaitText.trim() === "")
				) {
					throw new Error(
						`manifest entry "${entry.name}" animation frame ${fi}: awaitText must be a non-empty string`,
					);
				}
				if (frame.actions !== undefined) {
					if (!Array.isArray(frame.actions)) {
						throw new Error(
							`manifest entry "${entry.name}" animation frame ${fi}: actions must be an array`,
						);
					}
					for (const action of frame.actions) {
						validateAnimationAction(entry.name, fi, action);
					}
				}
			});
		}
	}
}

/**
 * Validate one animation action's shape (the manifest is untyped JSON at the
 * trust boundary). Each `type` requires different fields; an unknown type is a
 * hard error so a typo can't silently no-op a frame.
 */
function validateAnimationAction(
	entryName: string,
	frameIndex: number,
	action: AnimationAction,
): void {
	const where = `manifest entry "${entryName}" animation frame ${frameIndex}`;
	switch (action.type) {
		case "click":
			if (
				typeof action.selector !== "string" ||
				action.selector.trim() === ""
			) {
				throw new Error(
					`${where}: click action needs a non-empty selector`,
				);
			}
			if (
				action.waitFor !== undefined &&
				(typeof action.waitFor !== "string" ||
					action.waitFor.trim() === "")
			) {
				throw new Error(
					`${where}: click action waitFor must be a non-empty string`,
				);
			}
			break;
		case "wait":
			if (
				typeof action.selector !== "string" ||
				action.selector.trim() === ""
			) {
				throw new Error(
					`${where}: wait action needs a non-empty selector`,
				);
			}
			break;
		case "draft":
			if (typeof action.text !== "string" || action.text === "") {
				throw new Error(`${where}: draft action needs non-empty text`);
			}
			break;
		case "activateTab":
			if (!Number.isInteger(action.index) || action.index < 0) {
				throw new Error(
					`${where}: activateTab action needs a non-negative integer index`,
				);
			}
			break;
		default:
			throw new Error(
				`${where}: unknown action type "${(action as { type?: string }).type}"`,
			);
	}
}
