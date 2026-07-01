/**
 * Screenshot orchestrator (layer 3).
 *
 * Iterates manifest entries, drives UI state via Cdp, captures
 * screenshots, crops/encodes via sharp, and writes .webp output.
 * All external deps are injected for testability.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Phase D.
 * Test contract: tools/screenshots/lib/__tests__/orchestrator.test.ts.
 */
import path from "node:path";
import type { ManifestEntry, AnimationAction } from "./manifest";
import type {
	AnimationFrameInput,
	EncodeGifOptions,
	EncodeGifResult,
} from "./encode-gif";
import {
	scaleRectByDevicePixelRatio,
	unionRects,
	computeCropRect,
	computeCenterExtend,
	rectIntersects,
	type Rect,
} from "./crop";
import { deriveOutputPath } from "./output";
import {
	countDistinctColors,
	DEFAULT_MIN_DISTINCT_COLORS,
} from "./content-guard";
import { checkLegibility } from "./legibility";
import {
	resolveCleanlinessConfig,
	buildCleanlinessProbeExpression,
	evaluateCleanliness,
	type CleanlinessProbeResult,
} from "./cleanliness";
import { resolveFrameConfig, type FrameOptions } from "./frame";

/** Subset of Cdp used by the orchestrator (for DI). */
export interface CdpLike {
	evaluate<T = unknown>(expression: string): Promise<T>;
	executeCommand(commandId: string): Promise<void>;
	clickElement(selector: string): Promise<void>;
	waitForElement(selector: string, timeoutMs?: number): Promise<void>;
	getElementBounds(
		selector: string,
	): Promise<{ x: number; y: number; width: number; height: number }>;
	hoverElement(selector: string): Promise<void>;
	clickWithCoords(selector: string): Promise<void>;
	focusWindow(): Promise<void>;
	openNativeSelect(selector: string): Promise<void>;
	getWindowBounds(): Promise<{
		x: number;
		y: number;
		width: number;
		height: number;
		scaleFactor: number;
	}>;
	setWindowBounds(bounds: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): Promise<void>;
	setWindowAlwaysOnTop(enabled: boolean): Promise<void>;
	getWorkArea(): Promise<{
		x: number;
		y: number;
		width: number;
		height: number;
		scaleFactor: number;
	}>;
	screenCaptureRegion(
		outputPath: string,
		region: { x: number; y: number; width: number; height: number },
	): Promise<void>;
	screenshot(outputPath: string): Promise<void>;
	setMobileEmulation(enabled: boolean): Promise<void>;
	clearViewport(): Promise<void>;
}

/** sharp factory — matches `import sharp from "sharp"`. Accepts a file path or an in-memory buffer (the group-crop does a second pass over the extracted content buffer). */
export type SharpFactory = (input: string | Buffer) => SharpPipeline;

interface SharpPipeline {
	extract(region: {
		left: number;
		top: number;
		width: number;
		height: number;
	}): SharpPipeline;
	resize(width: number, height?: number): SharpPipeline;
	extend(opts: {
		top: number;
		bottom: number;
		left: number;
		right: number;
		background: { r: number; g: number; b: number; alpha: number };
	}): SharpPipeline;
	raw(): SharpPipeline;
	png(): SharpPipeline;
	metadata(): Promise<{ width?: number; height?: number }>;
	webp(opts?: { quality?: number }): SharpPipeline;
	toFile(path: string): Promise<unknown>;
	toBuffer(opts?: {
		resolveWithObject?: boolean;
	}): Promise<
		| Buffer
		| {
				data: Buffer;
				info: { width: number; height: number; channels: number };
		  }
	>;
}

export interface OrchestratorDeps {
	cdp: CdpLike;
	sharp: SharpFactory;
	repoRoot: string;
	fixtureRoot: string;
	tmpDir: string;
	readFile: (path: string, encoding: string) => string;
	devicePixelRatio: number;
	/** Optional post-processor run on each written output file (e.g. drop shadow). */
	postProcess?: (outputPath: string) => Promise<void>;
	/**
	 * Decode a written image file to raw pixels for the content guard. Injected
	 * (rather than reusing `sharp` directly) so the guard's final-file read is
	 * mockable independently of the crop/bg-sampling sharp pipeline. Returns the
	 * raw pixel buffer and its channel count (stride). Read AFTER postProcess so
	 * it measures the exact committed artifact (post-shadow webp), which is what
	 * the I11 distinct-color calibration was measured against.
	 */
	loadRaw: (path: string) => Promise<{ data: Buffer; channels: number }>;
	/** Remove a file — used to unlink a degraded capture that fails the content guard. */
	unlink: (path: string) => void;
	/**
	 * Encode an ordered set of cropped PNG frames into a looping GIF (v2
	 * animation path). Injected so the orchestrator stays free of ffmpeg/fs
	 * spawning; run.ts binds the real `encodeGif` with its exec/fs deps.
	 */
	encodeGif: (opts: EncodeGifOptions) => Promise<EncodeGifResult>;
	/**
	 * Apply presentation framing (Decision 11) to a written output file,
	 * overwriting it in place. Called INSTEAD of `postProcess` for entries that
	 * opt into `frame` (the frame brings its own shadow). Injected so the
	 * orchestrator stays free of direct sharp framing; run.ts binds the real
	 * `frameImage`.
	 */
	frameImage?: (outputPath: string, opts: FrameOptions) => Promise<void>;
}

export interface CaptureResult {
	name: string;
	success: boolean;
	error?: string;
}

export interface CaptureAllOptions {
	filter?: string;
}

const SETTLE_MS = 500;
/** Max wait for Obsidian's native tooltip (.tooltip) to render after a hover. */
const HOVER_TOOLTIP_TIMEOUT_MS = 3000;
/** Max wait for a live agent response to finish streaming before capture. */
const RESPONSE_TIMEOUT_MS = 120_000;
/** Scopes selectors to the visible tab panel (inactive panels are display:none). */
const ACTIVE_PANEL = '.agent-client-tab-panel:not([style*="none"])';

/**
 * Max full restore attempts for a guarded restoreSessions entry
 * (requireActiveHeaderIncludes/requireActiveSelector). The restore/reset
 * sequence can race and leave the wrong tab active; we verify the outcome
 * and retry a bounded number of times before failing.
 */
const RESTORE_MAX_ATTEMPTS = 3;
/**
 * Fixed window bounds (global logical points) used for captureMode "screen".
 * Pinned before driving the UI so the screencapture region and the static crop
 * are reproducible. Width matches the renderer viewport emulation (1400) so the
 * real-window layout agrees with what dev:screenshot-based shots see; height is
 * generous to fit header chrome + transcript + composer + an upward-opening
 * menu. Position is offset from the screen edge so the window isn't clipped.
 */
const SCREEN_CAPTURE_WINDOW = { width: 1400, height: 820 };

/**
 * Reproducible window bounds for captureMode "screen-window" (the framed
 * full-window hero). Pinned before driving the UI so the composition and the
 * captured pixel size are stable across runs. Clamped to the work area at
 * capture time; enlarge for more resolution (reflows the rule-of-thirds
 * composition, so re-verify the shot after changing it).
 */
const SCREEN_WINDOW_HERO = { width: 1600, height: 1000 };

/**
 * Capture a single manifest entry: drive UI state → screenshot → crop → write.
 */
export async function captureEntry(
	entry: ManifestEntry,
	deps: OrchestratorDeps,
): Promise<void> {
	// v2: animation entries take a dedicated multi-frame capture+encode path.
	if (entry.animation) {
		await captureAnimationEntry(entry, deps);
		return;
	}

	// 0. Screen-capture mode: pin the real OS window to a fixed size/position
	// BEFORE driving any UI. screencapture grabs the real window region (the
	// only way to capture native popup menus), so the window must be a known,
	// reproducible size — and pinned before the menu opens, since resizing
	// afterward would dismiss it and reflow the layout.
	const screenMode =
		entry.captureMode === "screen" ||
		entry.captureMode === "screen-window";

	if (entry.captureMode === "screen") {
		// Bottom-align a fixed-size window within the display work area so
		// Obsidian flips popover menus UPWARD (over the transcript), keeping the
		// whole menu inside the captured window region. A top/middle position
		// leaves room below and the menu opens downward off the window edge.
		const wa = await deps.cdp.getWorkArea();
		await deps.cdp.setWindowBounds({
			x: wa.x + 60,
			y: wa.y + wa.height - SCREEN_CAPTURE_WINDOW.height - 10,
			width: SCREEN_CAPTURE_WINDOW.width,
			height: SCREEN_CAPTURE_WINDOW.height,
		});
		await sleep(SETTLE_MS);
		// I13: float the fixtures window above the daily-driver for the whole
		// capture (restored in the finally below). screencapture composites the
		// topmost window at the region; the daily-driver window hosting this
		// agent session stays OS-focused, so a focus()/raise loses the z-order
		// race — only alwaysOnTop wins it. The native Menu popup renders above
		// the floated window (verified), so popover shots capture correctly.
		await deps.cdp.setWindowAlwaysOnTop(true);
	} else if (entry.captureMode === "screen-window") {
		// Full-window framed hero: capture the REAL OS window (real macOS chrome)
		// as-is — no popover, no bottom-align. Clear any stale device-metrics
		// override first (a leftover setDeviceMetricsOverride from a prior run
		// makes the renderer smaller than the OS window, so screencapture would
		// include desktop bleed on the right/bottom). Pin to a reproducible size,
		// then float + focus so the capture composites the fixtures window with
		// ACTIVE (colored) traffic lights, above the daily-driver.
		await deps.cdp.clearViewport();
		const wa = await deps.cdp.getWorkArea();
		await deps.cdp.setWindowBounds({
			x: wa.x + 40,
			y: wa.y + 40,
			width: Math.min(SCREEN_WINDOW_HERO.width, wa.width - 80),
			height: Math.min(SCREEN_WINDOW_HERO.height, wa.height - 80),
		});
		await sleep(SETTLE_MS);
		await deps.cdp.setWindowAlwaysOnTop(true);
		await deps.cdp.focusWindow();
	}

	try {
		// 0.5 Dismiss any leftover Obsidian modal from a prior capture so this shot
		// starts clean. A modal opened by an earlier entry (e.g. confirm-close via
		// forceCloseConfirm, or settings-import) is an APP modal that survives the
		// setup.sh plugin reload and would overlap this shot. Shots that need a
		// modal open their own later in the flow, so clearing leftovers here is safe.
		await deps.cdp.evaluate(
			`(() => { let n = 0; document.querySelectorAll(".modal-container").forEach((m) => { const b = m.querySelector(".modal-close-button"); if (b) { b.click(); } else { m.remove(); } n++; }); return n; })()`,
		);

		// 1. Mobile emulation (before any UI driving)
		if (entry.mobile) {
			await deps.cdp.setMobileEmulation(true);
		}

		// 1b. Per-entry agent override: set the default agent so the session
		// opened below (clickRibbon/openChatView) connects with it. The
		// slash-command shots use Gemini CLI (its public command set) rather than
		// the default Claude Code, whose internal toolbox build leaks internal
		// slash commands. Set live on the settings object; setup.sh restores the
		// template next run.
		if (entry.agentId) {
			await deps.cdp.evaluate(
				`(() => { const s = app.plugins.plugins["agent-console"].settings; s.defaultAgentId = ${JSON.stringify(entry.agentId)}; return s.defaultAgentId; })()`,
			);
		}

		// 1b. Force a perpetual "connecting" session for the queue-next-message
		// shot: rewrite the default agent's command so its process never completes
		// the ACP handshake. A message sent into a connecting session is held in
		// the LOCKED composer (queue-of-one, #82 Decision 9) — the subject of that
		// shot. Runs before clickRibbon so the first tab connects to the hung
		// command. setup.sh restores the real command from the template next run.
		if (entry.initialState?.forceConnectingHold) {
			await deps.cdp.evaluate(
				`(() => { const s = app.plugins.plugins["agent-console"].settings; const id = s.defaultAgentId; const all = [s.claude, s.codex, s.gemini, s.kiro, ...(s.customAgents || [])]; for (const a of all) { if (a && a.id === id) { a.command = "sleep"; a.args = ["86400"]; } } return id; })()`,
			);
		}

		// 1c. Disable native menus so an Obsidian Menu popover renders as a
		// window-capturable DOM `.menu` (not an OS popup that screen-mode would
		// need). Mirrors the forceTabStates path; setup.sh restores config next run.
		if (entry.initialState?.disableNativeMenus) {
			await deps.cdp.evaluate(
				`app.vault.setConfig("nativeMenus", false)`,
			);
		}

		// 2. Initial state
		if (entry.initialState?.openNote) {
			const notePath = entry.initialState.openNote;
			await deps.cdp.evaluate(
				`app.workspace.openLinkText("${notePath}", "", false)`,
			);
		}
		if (entry.initialState?.openNotes?.length) {
			// Reset the editor area first so tabs are deterministic regardless of
			// any pre-existing note/base leaves (the manual recipe's "reset editor
			// leaves" — otherwise a stale tab from a prior state duplicates).
			await deps.cdp.evaluate(
				`(() => { app.workspace.getLeavesOfType("markdown").forEach((l) => l.detach()); app.workspace.getLeavesOfType("bases").forEach((l) => l.detach()); return true; })()`,
			);
			// Open multiple editor tabs: the first replaces the active leaf, each
			// subsequent opens in a NEW tab (background editor tabs beside the
			// active note — e.g. the hero's Weekly review + Reading list dashboard).
			const notes = entry.initialState.openNotes;
			for (let n = 0; n < notes.length; n++) {
				const where = n === 0 ? "false" : '"tab"';
				await deps.cdp.evaluate(
					`app.workspace.openLinkText(${JSON.stringify(
						notes[n],
					)}, "", ${where})`,
				);
				await sleep(SETTLE_MS);
			}
		}
		if (entry.initialState?.openSettings) {
			// Settings-surface shots (e.g. the Default-agent dropdown): open the
			// settings modal on the named plugin tab. No chat panel is involved.
			const tabId = entry.initialState.openSettings;
			await deps.cdp.evaluate(
				`(() => { app.setting.open(); app.setting.openTabById(${JSON.stringify(
					tabId,
				)}); return true; })()`,
			);
			await sleep(SETTLE_MS);
			// The tab content paints async — wait for the target <select> to exist
			// before driving it (if this shot opens one).
			if (entry.initialState.openNativeSelect) {
				await deps.cdp.waitForElement(
					entry.initialState.openNativeSelect,
					HOVER_TOOLTIP_TIMEOUT_MS,
				);
			}
		}
		// Stub plugin runtime state for shots that depend on a condition we can't
		// reproduce hermetically (an available update / a no-working-agent machine).
		// MUST run BEFORE clickRibbon/openChatView so the freshly-mounted ChatPanel
		// reads the stub on its first effect pass.
		if (entry.initialState?.forceUpdateAvailable) {
			await deps.cdp.evaluate(
				`(() => { app.plugins.plugins["agent-console"].checkForUpdates = async () => true; return true; })()`,
			);
		}
		if (entry.initialState?.forceGettingStarted) {
			const { defaultAgentId, detectedAgentIds } =
				entry.initialState.forceGettingStarted;
			await deps.cdp.evaluate(
				`(() => { const p = app.plugins.plugins["agent-console"]; const det = new Set(${JSON.stringify(
					detectedAgentIds,
				)}); p._detectedAgentsPromise = Promise.resolve(det); p.detectAgents = async () => det; p.settings.defaultAgentId = ${JSON.stringify(
					defaultAgentId,
				)}; return true; })()`,
			);
		}
		if (entry.initialState?.clickRibbon) {
			// v1.1.0 restores the panel + tabs on plugin reload
			// (restoreTabsOnStartup), and the ribbon is a TOGGLE: clicking it
			// when the panel is already open closes it, and a click racing the
			// restore is unreliable (I08). Detach any existing chat-view leaves,
			// then open the panel via its command — a deterministic open, not a
			// toggle.
			await deps.cdp.evaluate(
				`app.workspace.detachLeavesOfType("agent-client-chat-view")`,
			);
			await deps.cdp.executeCommand("agent-console:open-chat-view");
		}
		if (entry.initialState?.openChatView) {
			await deps.cdp.executeCommand("agent-console:open-chat-view");
		}
		await applyLayoutOverrides(entry, deps);
		if (entry.initialState?.hoverSelector) {
			await deps.cdp.hoverElement(entry.initialState.hoverSelector);
			// Obsidian's native tooltip renders after a show-delay; wait for the
			// real .tooltip element rather than relying on the blind SETTLE_MS,
			// which races the delay and yields a tooltip-less capture (I06; same
			// "wait on a signal, not a sleep" lesson as I01).
			await deps.cdp.waitForElement(".tooltip", HOVER_TOOLTIP_TIMEOUT_MS);
		}

		// 3. Send prompt(s). `prompts` (multi-tab) takes precedence over a single
		// `promptFile`. Each prompt after the first opens a new session tab so the
		// right panel shows a multi-session tab bar. Selectors are scoped to the
		// visible tab panel — inactive panels are display:none and carry their own
		// hidden textarea/buttons that must not be targeted.
		const promptFiles =
			entry.prompts ?? (entry.promptFile ? [entry.promptFile] : []);
		for (let i = 0; i < promptFiles.length; i++) {
			if (i > 0) {
				await deps.cdp.executeCommand("agent-console:new-chat");
				await deps.cdp.waitForElement(
					`${ACTIVE_PANEL} textarea.agent-client-chat-input-textarea`,
				);
			}
			const promptPath = path.join(
				deps.fixtureRoot,
				"prompts",
				promptFiles[i],
			);
			const content = deps.readFile(promptPath, "utf-8");
			const escaped = content
				.replace(/\\/g, "\\\\")
				.replace(/`/g, "\\`")
				.replace(/\$/g, "\\$");
			// Set the active tab's textarea via the native value setter so React's
			// controlled input picks up the change, then dispatch input.
			await deps.cdp.evaluate(
				`(() => {
				const ta = Array.from(document.querySelectorAll('textarea.agent-client-chat-input-textarea')).find((t) => t.offsetParent !== null);
				if (!ta) return false;
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
				setter.call(ta, \`${escaped}\`);
				ta.dispatchEvent(new Event('input', { bubbles: true }));
				return true;
			})()`,
			);
			await deps.cdp.waitForElement(
				`${ACTIVE_PANEL} .agent-client-chat-send-button:not(.agent-client-disabled)`,
			);
			await deps.cdp.clickElement(
				`${ACTIVE_PANEL} .agent-client-chat-send-button`,
			);
			// Await the response only on the final (screenshotted) tab, and only in
			// WINDOW mode; earlier tabs get their title from the sent message and
			// need not finish streaming. Screen-mode popover shots handle
			// send-button idle separately, immediately before the capture (I09):
			// a popover does not need the assistant response (the dropdown is
			// populated at the ACP handshake, before inference), and the connect
			// turn may end WITHOUT ever streaming an assistant message — requiring
			// the assistant element here would hang the capture.
			if (
				i === promptFiles.length - 1 &&
				entry.captureMode !== "screen"
			) {
				// v1.1.0 added a "Connecting…/Sending…" handshake before the
				// stream begins, during which the loading indicator is still
				// hidden. Waiting only for the hidden state (I01) resolves
				// prematurely in that phase and captures an empty transcript
				// (I07). Two-phase: first wait for the assistant response element
				// to appear (proves the stream began, past Connecting — and it
				// persists, so no fast-stream race), then for the loading
				// indicator to hide (proves streaming finished).
				if (entry.awaitSelector) {
					// Mid-turn PAUSED-state shots (e.g. a file-edit permission
					// card): the turn blocks on user input and never reaches
					// "response complete", so the two-phase completion wait below
					// would hang on the loading indicator that stays visible while
					// paused. Wait for the awaited element (scoped to the active
					// panel) instead — it is the subject of the shot, and the
					// mustShow assert re-checks it is inside the crop.
					await deps.cdp.waitForElement(
						`${ACTIVE_PANEL} ${entry.awaitSelector}`,
						RESPONSE_TIMEOUT_MS,
					);
				} else {
					await deps.cdp.waitForElement(
						`${ACTIVE_PANEL} .agent-client-message-renderer.agent-client-message-assistant`,
						RESPONSE_TIMEOUT_MS,
					);
					await deps.cdp.waitForElement(
						`${ACTIVE_PANEL} .agent-client-loading-indicator.agent-client-hidden`,
						RESPONSE_TIMEOUT_MS,
					);
				}
			}
		}

		// 3b. Hide chrome that isn't the subject of this shot (e.g. the chat
		// composer for a transcript-focused capture) so the window can be sized
		// tight without the hidden element forcing scroll overflow. Done before
		// the settle/scroll so the layout reflows before the screenshot.
		if (entry.hideSelectors?.length) {
			const selectors = JSON.stringify(entry.hideSelectors);
			await deps.cdp.evaluate(
				`(() => { for (const s of ${selectors}) { document.querySelectorAll(s).forEach((el) => { el.style.display = "none"; }); } return true; })()`,
			);
		}

		// 3c. Type a draft into the active composer WITHOUT sending, so the shot
		// shows the input box populated with its context-note pill(s) and example
		// text instead of an empty placeholder.
		if (entry.draftMessage) {
			const draft = entry.draftMessage
				.replace(/\\/g, "\\\\")
				.replace(/`/g, "\\`")
				.replace(/\$/g, "\\$");
			await deps.cdp.evaluate(
				`(() => {
				const ta = Array.from(document.querySelectorAll('textarea.agent-client-chat-input-textarea')).find((t) => t.offsetParent !== null);
				if (!ta) return false;
				ta.focus();
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
				setter.call(ta, "");
				ta.dispatchEvent(new Event('input', { bubbles: true }));
				document.execCommand('insertText', false, \`${draft}\`);
				return true;
			})()`,
			);
		}

		// 3c-bis. Run arbitrary Obsidian commands to open command-driven UI the
		// pipeline can't otherwise reach: the native command palette
		// (command-palette:open), the New-chat-with-agent picker
		// (agent-console:new-chat-with-agent), or extra new-chat tabs
		// (agent-console:new-chat) to populate the tab-list dropdown. BEFORE
		// clickSelector so seeded tabs exist when the chevron is clicked.
		if (entry.initialState?.runCommands?.length) {
			// When a panel was opened, wait for its tab bar to mount before running
			// commands.
			if (
				entry.initialState.clickRibbon ||
				entry.initialState.openChatView
			) {
				await deps.cdp
					.waitForElement(
						`${ACTIVE_PANEL} .agent-client-tab`,
						HOVER_TOOLTIP_TIMEOUT_MS,
					)
					.catch(() => {});
			}
			const TAB_SELECTOR = ".agent-client-tab";
			for (const cmd of entry.initialState.runCommands) {
				if (cmd === "agent-console:new-chat") {
					// Seeding (tab-status-dropdown): new-chat silently no-ops when
					// fired against a freshly-opened, not-yet-ready panel, leaving a
					// single tab. Re-fire until the tab count actually increases
					// (signal-based, not a blind settle) — the panel becomes ready
					// within ~3s and the first effective fire adds the tab.
					const before = await deps.cdp
						.evaluate<number>(
							`document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)}).length`,
						)
						.catch(() => 0);
					for (let attempt = 0; attempt < 8; attempt++) {
						await deps.cdp.executeCommand(cmd);
						await sleep(SETTLE_MS);
						const now = await deps.cdp
							.evaluate<number>(
								`document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)}).length`,
							)
							.catch(() => before);
						if (now > before) break;
					}
				} else {
					await deps.cdp.executeCommand(cmd);
					await sleep(SETTLE_MS);
				}
			}
		}
		// 3c-quater. Seed an exact labeled tab set with forced visual states so the
		// tab-list dropdown shows the full glyph legend (● ◐ △ ✕ ○). Real ACP
		// sessions can't be coerced into all five states at once, so disable native
		// menus — making the chevron dropdown a DOM `.menu` that window capture sees
		// and that opens regardless of OS focus (sidesteps the I13/I15 native-popup
		// wall) — then drive the view's tabManagerRef directly. Runs after the panel
		// is open and BEFORE clickSelector opens the chevron.
		if (entry.initialState?.forceTabStates?.length) {
			const specs = entry.initialState.forceTabStates;
			const VIEW =
				'app.workspace.getLeavesOfType("agent-client-chat-view")[0]?.view';
			// Wait for the panel's initial tab to mount.
			await deps.cdp
				.waitForElement(
					`${ACTIVE_PANEL} .agent-client-tab`,
					HOVER_TOOLTIP_TIMEOUT_MS,
				)
				.catch(() => {});
			// DOM menu (not OS popup) so the dropdown is window-capturable.
			await deps.cdp.evaluate(
				`app.vault.setConfig("nativeMenus", false)`,
			);
			// Agent id to clone for the seeded tabs + the initial auto-labeled tab
			// to drop once the seeded set exists.
			const agentId = await deps.cdp
				.evaluate<string>(`${VIEW}.tabManagerRef.tabs[0].agentId`)
				.catch(() => null);
			const initialTabId = await deps.cdp
				.evaluate<string>(`${VIEW}.tabManagerRef.tabs[0].tabId`)
				.catch(() => null);
			if (agentId && initialTabId) {
				// addTab appends one labeled tab per spec; React flushes between
				// awaited evaluate calls.
				for (const s of specs) {
					await deps.cdp.evaluate(
						`${VIEW}.tabManagerRef.addTab(${JSON.stringify(agentId)}, ${JSON.stringify(s.label)})`,
					);
					await sleep(SETTLE_MS);
				}
				// Drop the initial auto-labeled tab; active reassigns to the first
				// seeded tab, so its checkmark sits on the leading (ready) entry.
				await deps.cdp.evaluate(
					`${VIEW}.tabManagerRef.removeTab(${JSON.stringify(initialTabId)})`,
				);
				await sleep(SETTLE_MS);
				// Force each seeded tab's visual state, in declared order.
				const ids = JSON.parse(
					(await deps.cdp.evaluate<string>(
						`JSON.stringify(${VIEW}.tabManagerRef.tabs.map((t) => t.tabId))`,
					)) ?? "[]",
				) as string[];
				for (let i = 0; i < specs.length && i < ids.length; i++) {
					await deps.cdp.evaluate(
						`${VIEW}.tabManagerRef.setTabState(${JSON.stringify(ids[i])}, ${JSON.stringify(specs[i].state)})`,
					);
					await sleep(SETTLE_MS / 2);
				}
				// Activate the first (ready) tab so the dropdown checkmark sits on a
				// coherent active session rather than the disconnected one (addTab
				// activates each new tab, leaving the last-added one active).
				if (ids.length) {
					await deps.cdp.evaluate(
						`${VIEW}.tabManagerRef.setActiveTab(${JSON.stringify(ids[0])})`,
					);
					await sleep(SETTLE_MS / 2);
				}
			}
		}
		// 3c-quinquies-pre. Restore saved sessions into tabs, building a
		// multi-session tab bar where each restored tab carries its own seeded
		// transcript (the deterministic alternative to live `prompts`). Each
		// restore opens the session-history modal and clicks that session's restore
		// icon, which appends a NEW tab bound to the session and loads its messages
		// (verified 2026-06-30: restore appends + activates a tab; the tab label is
		// the session title). After restoring, drop the initial auto-labeled tab
		// and activate the session at `activeIndex` so its transcript is the
		// visible panel. The entry-level `awaitSelector` (e.g. ".mermaid svg") is
		// honored here so an async-rendered element (Mermaid renders on mount but
		// not synchronously — N1) is present before capture.
		if (entry.initialState?.restoreSessions?.titles?.length) {
			const rs = entry.initialState.restoreSessions;
			const titles = rs.titles;
			const activeIndex = rs.activeIndex ?? titles.length - 1;
			const VIEW =
				'app.workspace.getLeavesOfType("agent-client-chat-view")[0]?.view';
			const reqHeader = rs.requireActiveHeaderIncludes;
			const reqSelector = rs.requireActiveSelector;
			const guarded = Boolean(reqHeader || reqSelector);
			// Bounded retry only when a guard is configured; otherwise a single
			// pass (unchanged legacy behavior).
			const maxAttempts = guarded ? RESTORE_MAX_ATTEMPTS : 1;

			// One full restore pass: history-restore each title, drop the initial
			// auto tab, activate the chosen index, honor awaitSelector.
			const performRestore = async (): Promise<void> => {
				await deps.cdp
					.waitForElement(
						`${ACTIVE_PANEL} .agent-client-tab`,
						HOVER_TOOLTIP_TIMEOUT_MS,
					)
					.catch(() => {});
				const initialTabId = await deps.cdp
					.evaluate<string>(`${VIEW}.tabManagerRef.tabs[0]?.tabId`)
					.catch(() => null);
				for (const title of titles) {
					await deps.cdp.executeCommand(
						"agent-console:open-session-history",
					);
					await deps.cdp.waitForElement(
						".modal",
						HOVER_TOOLTIP_TIMEOUT_MS,
					);
					const clicked = await deps.cdp.evaluate<boolean>(
						`(() => { const items = Array.from(document.querySelectorAll("[class*=session-history-item],[class*=session-history-row]")); const row = items.find((r) => (r.textContent || "").includes(${JSON.stringify(
							title,
						)})); if (!row) return false; const b = row.querySelector("[class*=restore]"); if (!b) return false; b.click(); return true; })()`,
					);
					if (!clicked) {
						throw new Error(
							`restoreSessions: no session-history row matching "${title}"`,
						);
					}
					await deps.cdp.waitForElement(
						`${ACTIVE_PANEL} .agent-client-message-assistant`,
						RESPONSE_TIMEOUT_MS,
					);
					await sleep(SETTLE_MS);
				}
				// Drop the initial auto-labeled (empty) tab so only the restored
				// sessions remain in the bar.
				if (initialTabId) {
					await deps.cdp.evaluate(
						`(() => { const tm = ${VIEW}.tabManagerRef; if (tm.tabs.length > 1) tm.removeTab(${JSON.stringify(
							initialTabId,
						)}); return true; })()`,
					);
					await sleep(SETTLE_MS);
				}
				// Activate the chosen restored tab so its transcript is the visible panel.
				const ids = JSON.parse(
					(await deps.cdp.evaluate<string>(
						`JSON.stringify(${VIEW}.tabManagerRef.tabs.map((t) => t.tabId))`,
					)) ?? "[]",
				) as string[];
				const idx = Math.max(0, Math.min(activeIndex, ids.length - 1));
				if (ids[idx]) {
					await deps.cdp.evaluate(
						`${VIEW}.tabManagerRef.setActiveTab(${JSON.stringify(ids[idx])})`,
					);
					await sleep(SETTLE_MS);
				}
				// Honor awaitSelector on the restore path (e.g. wait for the Mermaid
				// SVG to render on the active transcript before capture — N1).
				if (entry.awaitSelector) {
					await deps.cdp.waitForElement(
						`${ACTIVE_PANEL} ${entry.awaitSelector}`,
						RESPONSE_TIMEOUT_MS,
					);
				}
			};

			// Assert the OUTCOME — the intended session is the visible panel — not
			// merely that the sequence ran without error. Probe the active panel's
			// chat-view header text and a required selector. This guards the
			// restore/reset race that can leave the empty Claude Code auto tab
			// active, which would capture an empty transcript (the note's flake).
			const verifyActivePanel = async (): Promise<{
				ok: boolean;
				header: string;
				sel: number;
			}> => {
				const selCount = reqSelector
					? `ap.querySelectorAll(${JSON.stringify(reqSelector)}).length`
					: "1";
				const raw = await deps.cdp.evaluate<string>(
					`(() => { const ap = document.querySelector('.agent-client-tab-panel:not([style*="none"])'); if (!ap) return JSON.stringify({ header: "", sel: 0 }); const h = ap.querySelector(".agent-client-chat-view-header"); const header = h ? (h.textContent || "").trim() : ""; return JSON.stringify({ header, sel: ${selCount} }); })()`,
				);
				let header = "";
				let sel = 0;
				try {
					const parsed = JSON.parse(raw ?? "{}") as {
						header?: string;
						sel?: number;
					};
					header = parsed.header ?? "";
					sel = parsed.sel ?? 0;
				} catch {
					/* unparseable probe → treat as a failed check */
				}
				const headerOk = !reqHeader || header.includes(reqHeader);
				const selOk = !reqSelector || sel > 0;
				return { ok: headerOk && selOk, header, sel };
			};

			let lastProbe: {
				ok: boolean;
				header: string;
				sel: number;
			} | null = null;
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				if (attempt > 1) {
					// Reset to a clean single-tab panel before retrying, so restore
					// appends onto a fresh bar (not the failed attempt's tabs).
					await deps.cdp.evaluate(
						`app.workspace.detachLeavesOfType("agent-client-chat-view")`,
					);
					await deps.cdp.executeCommand(
						"agent-console:open-chat-view",
					);
					await sleep(SETTLE_MS);
				}
				await performRestore();
				if (!guarded) break;
				lastProbe = await verifyActivePanel();
				if (lastProbe.ok) break;
				if (attempt >= maxAttempts) {
					throw new Error(
						`restoreSessions verification failed after ${maxAttempts} attempts: ` +
							`active header="${lastProbe.header}" (want ~="${
								reqHeader ?? "(any)"
							}"), selector "${
								reqSelector ?? "(none)"
							}" count=${lastProbe.sel}`,
					);
				}
			}
		}

		// 3c-quinquies. Surface the ConfirmCloseModal for the confirm-close shot.
		// The modal is reachable only through the panel's private Cmd+W handler
		// (handleCloseRequest → shouldConfirmClose → ConfirmCloseModal): there is no
		// command and a focused Cmd+W can't be synthesized reliably. Call the live
		// view's handler AFTER forceTabStates has seeded 2+ tabs so the real tab
		// count gates the real modal. The confirm action (leaf.detach) only fires
		// on the user's "Close panel" click, so capturing the open modal is safe.
		if (entry.initialState?.forceCloseConfirm) {
			await deps.cdp.evaluate(
				`(() => { const v = app.workspace.getLeavesOfType("agent-client-chat-view")[0]?.view; if (!v) return false; v.handleCloseRequest(); return true; })()`,
			);
			await deps.cdp.waitForElement(".modal", HOVER_TOOLTIP_TIMEOUT_MS);
		}
		// 3c-ter. Type a filter into an open input. Default target is the
		// command-palette `.prompt-input`; set `typeQuerySelector` to aim the
		// keystrokes at a different input — e.g. the session-history search box
		// `.agent-client-session-history-search-input`. Works for <input> and
		// <textarea> (the native value setter is chosen per element so React's
		// controlled input picks up the change).
		if (entry.initialState?.typeQuery) {
			const q = entry.initialState.typeQuery
				.replace(/\\/g, "\\\\")
				.replace(/`/g, "\\`")
				.replace(/\$/g, "\\$");
			const inputSel = JSON.stringify(
				entry.initialState.typeQuerySelector ?? ".prompt-input",
			);
			await deps.cdp.evaluate(
				`(() => { const i = document.querySelector(${inputSel}); if (!i) return false; const proto = i.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(i, \`${q}\`); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
			);
			await sleep(SETTLE_MS);
		}

		// 3d. Click a selector to open a popover/menu for capture. Fires AFTER
		// prompts — the click target often only renders once the agent session is
		// established (e.g. toolbar dropdowns report modes/models post-handshake).
		if (entry.initialState?.clickSelector) {
			await deps.cdp.waitForElement(
				entry.initialState.clickSelector,
				RESPONSE_TIMEOUT_MS,
			);
			await deps.cdp.clickWithCoords(entry.initialState.clickSelector);
			if (entry.captureMode === "screen") {
				// The opened menu is a native popup window, not in the DOM —
				// waitForElement(".menu") would time out. A brief settle lets the
				// popup paint before the screen capture grabs it.
				await sleep(SETTLE_MS);
			} else {
				const waitSel = entry.initialState.waitSelector ?? ".menu";
				await deps.cdp.waitForElement(
					waitSel,
					HOVER_TOOLTIP_TIMEOUT_MS,
				);
			}
		}

		// 3d-bis. Multi-click drive: click each selector in order, waiting for its
		// `waitFor` (or a brief settle) between steps. Used when a shot needs two
		// clicks — e.g. load a saved session from the history modal, then open the
		// shared-links dropdown on the now-active tab.
		if (entry.initialState?.clickSequence?.length) {
			for (const step of entry.initialState.clickSequence) {
				await deps.cdp.waitForElement(
					step.selector,
					RESPONSE_TIMEOUT_MS,
				);
				await deps.cdp.clickWithCoords(step.selector);
				if (step.waitFor) {
					await deps.cdp.waitForElement(
						step.waitFor,
						RESPONSE_TIMEOUT_MS,
					);
				} else {
					await sleep(SETTLE_MS);
				}
			}
		}

		// 3e. Open a native <select>'s option popup for capture (screen-mode
		// settings shots, e.g. the Default-agent dropdown). The popup is an OS
		// window invisible to the renderer and undrivable by synthetic click/CDP
		// input when the fixtures window isn't OS-frontmost (I13/I15). Focus the
		// (already-floated, step 0) fixtures window so the popup surfaces, then
		// open it via the sanctioned showPicker() API (openNativeSelect). Done
		// late so the popup is freshly open when the capture fires.
		if (entry.initialState?.openNativeSelect) {
			await deps.cdp.focusWindow();
			await sleep(SETTLE_MS);
			await deps.cdp.openNativeSelect(
				entry.initialState.openNativeSelect,
			);
			await sleep(SETTLE_MS);
		}

		// 3f. Attach a committed fixture image to the active composer. There is no
		// attach button (entry is paste/drop only), so build a File from the asset
		// and dispatch a synthetic `drop` on the input box. Read the bytes
		// IN-RENDERER (require fs) — passing them through the evaluate expression
		// would exceed the dev:cdp params size limit (L1). A JS-dispatched DragEvent
		// reaches React's onDrop regardless of window focus, unlike CDP Input which
		// is dropped when the fixtures window isn't OS-frontmost (I13/I15). Fires
		// AFTER the connect prompt so the agent's promptCapabilities.image is known
		// and the AttachmentStrip renders an image thumbnail (not a file-link).
		if (entry.attachImage) {
			const imgPath = path.join(
				deps.fixtureRoot,
				"assets",
				entry.attachImage,
			);
			await deps.cdp.evaluate(
				`(() => {
				const fs = require('fs');
				const buf = fs.readFileSync(${JSON.stringify(imgPath)});
				const arr = new Uint8Array(buf);
				const file = new File([arr], ${JSON.stringify(entry.attachImage)}, { type: 'image/png' });
				const dt = new DataTransfer();
				dt.items.add(file);
				const box = document.querySelector('${ACTIVE_PANEL} .agent-client-chat-input-box')
					|| document.querySelector('.agent-client-chat-input-box');
				if (!box) return false;
				for (const type of ['dragenter', 'dragover', 'drop']) {
					box.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
				}
				return true;
			})()`,
			);
			// The thumbnail renders after FileReader.readAsDataURL resolves (async);
			// wait for the strip's image element before the assert/capture.
			await deps.cdp.waitForElement(
				`${ACTIVE_PANEL} .agent-client-attachment-preview-thumbnail`,
				HOVER_TOOLTIP_TIMEOUT_MS,
			);
		}

		// 3g. Force-reveal controls the real UI only shows on CSS :hover (e.g. an
		// attachment's remove "x", opacity:0 until item:hover). A JS-dispatched
		// mouseover can't trigger CSS :hover and CDP Input is dropped when the
		// fixtures window isn't OS-frontmost (I13/I15), so the hover state is
		// surfaced declaratively. Runs after attachImage — the target may only
		// exist once an attachment is present.
		if (entry.revealSelectors?.length) {
			const selectors = JSON.stringify(entry.revealSelectors);
			await deps.cdp.evaluate(
				`(() => { for (const s of ${selectors}) { document.querySelectorAll(s).forEach((el) => { el.style.opacity = "1"; el.style.visibility = "visible"; }); } return true; })()`,
			);
		}

		// 3h. Settings-surface driving: collapse `<details>` accordions (by CSS) and
		// expand + scroll a named setting/section into view (by visible text). Used
		// by the settings shots (collapsible-agent-sections, obsidian-system-prompt,
		// settings-working-directory) whose subject sits inside a collapsed accordion
		// and/or below the settings-pane fold. The crop reads getBoundingClientRect
		// at capture time, so an off-screen section must be scrolled into the window.
		if (entry.initialState?.collapseSelectors?.length) {
			const sels = JSON.stringify(entry.initialState.collapseSelectors);
			await deps.cdp.evaluate(
				`(() => { for (const s of ${sels}) { document.querySelectorAll(s).forEach((el) => { const d = el.tagName === "DETAILS" ? el : el.closest("details"); if (d) d.open = false; }); } return true; })()`,
			);
			await sleep(SETTLE_MS);
		}
		if (entry.initialState?.scrollToSettingText) {
			const txt = JSON.stringify(entry.initialState.scrollToSettingText);
			await deps.cdp.evaluate(
				`(() => {
				const sc = document.querySelector(".vertical-tab-content");
				if (!sc) return false;
				const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
				const want = norm(${txt});
				const sections = Array.from(sc.querySelectorAll("details.agent-client-agent-section"));
				let accordion = sections.find((d) => norm(d.querySelector("summary") && d.querySelector("summary").textContent) === want);
				if (accordion) {
					accordion.open = true;
					// Lead with the section heading: align the summary to the top,
					// then nudge up a little so it isn't flush against the edge.
					(accordion.querySelector("summary") || accordion).scrollIntoView({ block: "start", inline: "nearest" });
					sc.scrollTop = Math.max(0, sc.scrollTop - 24);
					return true;
				}
				const item = Array.from(sc.querySelectorAll(".setting-item")).find((it) => { const n = it.querySelector(".setting-item-name"); return n && norm(n.textContent) === want; });
				if (!item) return false;
				item.scrollIntoView({ block: "center", inline: "nearest" });
				return true;
			})()`,
			);
			await sleep(SETTLE_MS);
		}
		// 4. Brief settle for UI animations
		await sleep(SETTLE_MS);

		// 4b. For conversations, scroll the active transcript to the top so the
		// capture shows the question and start of the answer, not the streamed tail.
		if (promptFiles.length > 0) {
			if (entry.awaitSelector) {
				// Paused-state shots: the subject (e.g. the permission card) is
				// at the BOTTOM of the transcript — scroll it into view rather
				// than to the top (which would push it off-screen).
				const sel = `${ACTIVE_PANEL} ${entry.awaitSelector}`;
				await deps.cdp.evaluate(
					`(() => { const el = document.querySelector('${sel}'); if (el) el.scrollIntoView({ block: "center" }); return !!el; })()`,
				);
			} else {
				await deps.cdp.evaluate(
					`(() => { const el = document.querySelector('${ACTIVE_PANEL} .agent-client-chat-view-messages'); if (el) el.scrollTop = 0; return !!el; })()`,
				);
			}
			await sleep(SETTLE_MS);
		}

		// 4b-ter. Dismiss transient Obsidian notices (toasts) before the
		// cleanliness assert + capture. A notice is never part of a docs shot
		// (the cleanliness guard forbids `.notice`); loading a session or
		// changing config can fire one (e.g. "new chat started in …"). Removing
		// any present keeps a benign toast from failing the shot or leaking in.
		await deps.cdp.evaluate(
			`(() => { document.querySelectorAll(".notice").forEach((n) => n.remove()); return true; })()`,
		);

		// 4c. Tier-2 mustShow assertion (rubric P2). Window-mode only: screen-mode
		// popovers render in a native popup window outside the renderer DOM, so
		// their bounds aren't queryable here. Assert the single delightful element
		// this shot exists to showcase is (a) present in the DOM and (b) inside the
		// crop region — so a regenerated shot can't silently drop what it sells.
		if (entry.mustShow && !screenMode) {
			let mustShowBounds: Rect;
			try {
				mustShowBounds = await deps.cdp.getElementBounds(
					entry.mustShow,
				);
			} catch {
				throw new Error(
					`mustShow assert: "${entry.name}" — required element not found in DOM: ${entry.mustShow}`,
				);
			}
			const cropCss = await resolveCropRectCss(entry, deps.cdp);
			if (!rectIntersects(cropCss, mustShowBounds)) {
				throw new Error(
					`mustShow assert: "${entry.name}" — element ${entry.mustShow} at ` +
						`(${mustShowBounds.x},${mustShowBounds.y},${mustShowBounds.width},${mustShowBounds.height}) ` +
						`is outside the crop region ` +
						`(${cropCss.x},${cropCss.y},${cropCss.width},${cropCss.height})`,
				);
			}
		}
		// 4d. Tier-2 cleanliness assert (rubric P7). The renderer DOM is queryable
		// regardless of capture backend, so this runs for BOTH window and screen
		// mode (unlike the 4c mustShow assert, which needs renderer crop coords).
		// Fail before capturing if a forbidden element is VISIBLE (error overlay,
		// tab/session-history error, stray notice) or a forbidden internal-name
		// string appears in the visible text (guards an internal-agent-name leak
		// regression — the fixtures run Claude Code/Bedrock). Per-entry
		// forbiddenSelectors/forbiddenText merge with the verified global defaults.
		{
			const cfg = resolveCleanlinessConfig(
				entry.forbiddenSelectors,
				entry.forbiddenText,
			);
			const probe = await deps.cdp.evaluate<CleanlinessProbeResult>(
				buildCleanlinessProbeExpression(cfg),
			);
			const { ok, violations } = evaluateCleanliness(probe);
			if (!ok) {
				throw new Error(
					`cleanliness assert: "${entry.name}" — ${violations.join("; ")}`,
				);
			}
		}

		// 5. Capture to a temp file. captureMode "screen" uses macOS screencapture
		// of the window's screen region — the only way to capture native popup
		// menus, which render outside the renderer dev:screenshot sees. All other
		// shots use dev:screenshot. effectiveDpr is the display backing scale for
		// screen captures (their crops are authored in window CSS-px and scaled by
		// it); window captures keep the detected renderer DPR.
		const tmpPath = path.join(deps.tmpDir, `${entry.name}-raw.png`);
		let effectiveDpr = deps.devicePixelRatio;
		if (screenMode) {
			// I09: ensure the agent turn is idle so the composer send button shows
			// its send glyph, not the in-flight red STOP square. The connect prompt
			// for a popover shot puts a turn in-flight; the send/stop button and the
			// loading indicator are gated on the SAME isSending flag, so the
			// indicator's hidden state == the button having returned to idle.
			// Single-phase (NOT the window-mode two-phase) on purpose: a popover
			// does not need an assistant response — the dropdown populates at the
			// ACP handshake — and the connect turn may end WITHOUT ever streaming a
			// response, so requiring the assistant element would hang the capture.
			// Placed immediately before the capture to minimize the window in which
			// a late stream could re-arm the STOP square. Resolves instantly when
			// already idle (e.g. a connect turn that ended without streaming).
			// Skip for settings/no-prompt shots: with no chat panel there is no
			// loading indicator, so the wait would hang to timeout. Only prompt-
			// driven popover shots put a turn in-flight that needs to go idle.
			if (promptFiles.length > 0) {
				await deps.cdp.waitForElement(
					`${ACTIVE_PANEL} .agent-client-loading-indicator.agent-client-hidden`,
					RESPONSE_TIMEOUT_MS,
				);
			}
			const bounds = await deps.cdp.getWindowBounds();
			await deps.cdp.screenCaptureRegion(tmpPath, {
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
			});
			// Screen-mode crops are authored directly in raw screencapture pixels
			// (the window is pinned deterministically, so the menu always lands in
			// the same place). effectiveDpr = 1 means the static crop is applied
			// as-is, then resized to the target dims (the 2x→1x downscale gives
			// retina-sharp output). Authoring in raw px sidesteps the renderer
			// viewport-emulation vs real-window coordinate mismatch.
			effectiveDpr = 1;
		} else {
			await deps.cdp.screenshot(tmpPath);
		}

		// 6. Determine crop region & encode — precedence: group union >
		// single selector > static crop.
		const outputPath = deriveOutputPath(entry, deps.repoRoot);

		if (entry.captureMode === "screen-window") {
			// Full-window screen capture IS the content (real macOS chrome
			// included) — no crop. Downscale to the target width if the raw
			// capture is larger than entry.width; the frame step adds the
			// gradient + soft shadow + rounded corners around the real chrome
			// (frame:{chrome:"none"}). Height follows aspect.
			const meta = await deps.sharp(tmpPath).metadata();
			let pipeline = deps.sharp(tmpPath);
			if (entry.width && (meta.width ?? 0) > entry.width) {
				pipeline = pipeline.resize(entry.width);
			}
			await pipeline.webp({ quality: 90 }).toFile(outputPath);
		} else if (entry.cropSelectors?.length) {
			// Group crop: union the selectors' bounds (+ cropPadding) into a
			// content region, then center that content on a width×height canvas
			// padded with the header background color (sampled from the content's
			// top-left pixel). Reproduces the upstream "icons centered with
			// padding" look when the icons sit flush at the window edge. A missing
			// selector is a hard error — a group crop with a dropped member would
			// be silently wrong.
			const rects: Rect[] = [];
			for (const sel of entry.cropSelectors) {
				rects.push(await deps.cdp.getElementBounds(sel));
			}
			const padding = entry.cropPadding ?? 16;
			const content = computeCropRect(unionRects(rects), { padding });
			const scaled = scaleRectByDevicePixelRatio(content, effectiveDpr);
			// Clamp the content region to the captured image bounds — the icon
			// cluster often sits flush at the window's right edge, so the padded
			// union can overrun the capture (sharp "bad extract area"). The lost
			// padding is re-synthesized as canvas fill below, so clamping is
			// visually lossless.
			const meta = await deps.sharp(tmpPath).metadata();
			const imgW = meta.width ?? scaled.x + scaled.width;
			const imgH = meta.height ?? scaled.y + scaled.height;
			const cw = Math.min(scaled.width, imgW - scaled.x);
			const ch = Math.min(scaled.height, imgH - scaled.y);
			if (cw > entry.width || ch > entry.height) {
				throw new Error(
					`group-crop content (${cw}×${ch}) exceeds target (${entry.width}×${entry.height}) for "${entry.name}" — increase width/height or reduce cropPadding`,
				);
			}
			const contentBuf = (await deps
				.sharp(tmpPath)
				.extract({
					left: scaled.x,
					top: scaled.y,
					width: cw,
					height: ch,
				})
				.toBuffer()) as Buffer;
			const sample = (await deps
				.sharp(contentBuf)
				.extract({ left: 0, top: 0, width: 1, height: 1 })
				.raw()
				.toBuffer({ resolveWithObject: true })) as { data: Buffer };
			const bg = {
				r: sample.data[0],
				g: sample.data[1],
				b: sample.data[2],
				alpha: 1,
			};
			const ext = computeCenterExtend(cw, ch, entry.width, entry.height);
			await deps
				.sharp(contentBuf)
				.extend({ ...ext, background: bg })
				.webp({ quality: 90 })
				.toFile(outputPath);
		} else {
			// Single selector (auto-bounds) or static crop.
			let cropRect = entry.crop;
			if (entry.cropSelector) {
				try {
					const bounds = await deps.cdp.getElementBounds(
						entry.cropSelector,
					);
					const padding = entry.cropPadding ?? 16;
					cropRect = {
						x: Math.max(0, bounds.x - padding),
						y: Math.max(0, bounds.y - padding),
						width: bounds.width + padding * 2,
						height: bounds.height + padding * 2,
					};
				} catch {
					// Selector didn't match — fall back to static crop
				}
			}
			let scaledCrop = scaleRectByDevicePixelRatio(
				cropRect,
				effectiveDpr,
			);
			// Clamp a single cropSelector crop to the captured image bounds. The
			// group-crop path already clamps (it re-synthesizes the lost padding as
			// canvas fill); a single selector emits at native size, so an element
			// flush at the window edge + cropPadding can push the scaled crop past
			// the image → sharp "bad extract area" (paid for twice; worked around
			// with cropPadding 0). Clamping drops only off-image padding (empty
			// edge), so it is visually lossless.
			if (entry.cropSelector) {
				const meta = await deps.sharp(tmpPath).metadata();
				const imgW = meta.width ?? scaledCrop.x + scaledCrop.width;
				const imgH = meta.height ?? scaledCrop.y + scaledCrop.height;
				scaledCrop = {
					...scaledCrop,
					width: Math.min(scaledCrop.width, imgW - scaledCrop.x),
					height: Math.min(scaledCrop.height, imgH - scaledCrop.y),
				};
			}
			// Tier-2 legibility floor (rubric P5). Only the static-crop path resizes
			// to (entry.width, entry.height); an undersized source there upscales and
			// blurs — illegible when the docs site renders the shot small. Gate on the
			// same condition as the resize decision below: cropSelector entries emit
			// at native captured size (no resize), so the floor doesn't apply to them.
			// Uses the exact scaledCrop the encode extracts; throws before any write.
			if (!entry.cropSelector) {
				const leg = checkLegibility({
					sourceWidth: scaledCrop.width,
					sourceHeight: scaledCrop.height,
					targetWidth: entry.width,
					targetHeight: entry.height,
					minScale: entry.minLegibilityScale,
				});
				if (!leg.ok) {
					throw new Error(
						`legibility floor: "${entry.name}" — source ${scaledCrop.width}×${scaledCrop.height} ` +
							`resized to ${entry.width}×${entry.height} is a ${leg.scale.toFixed(2)}× ` +
							`${leg.limitingAxis}-limited ${leg.scale < 1 ? "upscale" : "downscale"}, below ` +
							`the ${leg.minScale}× floor — would blur at display size`,
					);
				}
			}
			const pipeline = deps.sharp(tmpPath).extract({
				left: scaledCrop.x,
				top: scaledCrop.y,
				width: scaledCrop.width,
				height: scaledCrop.height,
			});
			// Static crops resize to the manifest dims; selector crops keep their
			// native captured size (resizing dynamic element bounds distorts).
			const encoded = entry.cropSelector
				? pipeline
				: pipeline.resize(entry.width, entry.height);
			await encoded.webp({ quality: 90 }).toFile(outputPath);
		}

		// 8. Post-processing on the written file. A framed entry (Decision 11) gets
		// the presentation frame (gradient + soft shadow + rounded corners + optional
		// synthetic chrome) INSTEAD of the flat drop shadow — the frame brings its
		// own shadow. Unframed entries keep the flat drop shadow as before.
		const frameCfg = resolveFrameConfig(entry);
		if (frameCfg) {
			await deps.frameImage?.(outputPath, frameCfg);
		} else {
			await deps.postProcess?.(outputPath);
		}

		// 9. Restore mobile emulation (before the guard, so a guard failure can't
		// leave the running Obsidian stuck in mobile mode).
		if (entry.mobile) {
			await deps.cdp.setMobileEmulation(false);
		}

		// 10. Content guard (I11 follow-up). The pipeline otherwise reports success
		// on exit code + output dimensions alone, so a blank/degraded capture (e.g.
		// the retina-DPR half-resolution shots that collapsed to ~400 distinct
		// colors with the tooltip lost) still exited ✓ and was only caught by
		// eyeballing the image. Decode the FINAL post-shadow webp, count distinct
		// RGB colors (the calibration surface — alpha ignored so the transparent
		// shadow margin doesn't inflate it), and reject below the per-entry floor
		// (manifest `minDistinctColors`, else the global blank-catcher default). On
		// failure, delete the degraded file (sub-decision b — so it can't be
		// staged) and throw: captureAll records the ✗ and run.ts exits non-zero.
		const floor = entry.minDistinctColors ?? DEFAULT_MIN_DISTINCT_COLORS;
		const { data, channels } = await deps.loadRaw(outputPath);
		const distinct = countDistinctColors(data, channels);
		if (distinct < floor) {
			deps.unlink(outputPath);
			throw new Error(
				`content guard: "${entry.name}" has ${distinct} distinct colors, below the floor of ${floor} — capture is blank/degraded; deleted ${outputPath}`,
			);
		}
	} finally {
		// I13: always un-float the fixtures window so it never lingers over the
		// user's daily vault — even if an assert or the content guard threw.
		if (screenMode) {
			await deps.cdp.setWindowAlwaysOnTop(false);
		}
		// Tear down a modal this entry opened (forceCloseConfirm) so it never
		// lingers in studio to overlap a later shot or the user's view.
		if (entry.initialState?.forceCloseConfirm) {
			await deps.cdp
				.evaluate(
					`(() => { document.querySelectorAll(".modal-container").forEach((m) => { const b = m.querySelector(".modal-close-button"); if (b) { b.click(); } else { m.remove(); } }); return true; })()`,
				)
				.catch(() => {});
		}
	}
}

/**
 * Capture all (or filtered) manifest entries. Continues on error.
 */
export async function captureAll(
	entries: ManifestEntry[],
	deps: OrchestratorDeps,
	options: CaptureAllOptions = {},
): Promise<CaptureResult[]> {
	let targets = entries;

	if (options.filter) {
		targets = entries.filter((e) => e.name === options.filter);
		if (targets.length === 0) {
			throw new Error(
				`No manifest entry matches filter "${options.filter}"`,
			);
		}
	}

	const results: CaptureResult[] = [];
	for (const entry of targets) {
		try {
			// Mark capture-in-progress so the Fixture theme's capture-only hides
			// (the transient scroll-to-bottom pill and non-deterministic info
			// banners) apply for THIS shot. The same fixtures vault doubles as
			// the interactive smoke-test bed (smoke-test-spawn.sh copies it), so
			// the hides must be gated to capture time — otherwise a rule that
			// exists purely for clean screenshots makes those elements
			// impossible to verify by eye during smoke testing.
			await deps.cdp.evaluate(
				`document.body.classList.add("acp-capturing")`,
			);
			await captureEntry(entry, deps);
			results.push({ name: entry.name, success: true });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results.push({ name: entry.name, success: false, error: msg });
		} finally {
			// Always clear the marker — even when the capture threw — so a
			// failed shot can't leave the fixtures vault with chrome hidden for
			// a later smoke test. Swallow cleanup errors so they can't mask the
			// real capture failure recorded above.
			await deps.cdp
				.evaluate(`document.body.classList.remove("acp-capturing")`)
				.catch(() => {});
		}
	}
	return results;
}

/**
 * Resolve an entry's crop region in CSS-pixel space (pre-DPR-scaling) — the
 * same space getElementBounds reports in. Mirrors the capture-path crop
 * precedence (group union > single selector > static) so the mustShow assert
 * checks against exactly the region that will be cropped. Window-mode only.
 */
async function resolveCropRectCss(
	entry: ManifestEntry,
	cdp: CdpLike,
): Promise<Rect> {
	if (entry.cropSelectors?.length) {
		const rects: Rect[] = [];
		for (const sel of entry.cropSelectors) {
			rects.push(await cdp.getElementBounds(sel));
		}
		return computeCropRect(unionRects(rects), {
			padding: entry.cropPadding ?? 16,
		});
	}
	if (entry.cropSelector) {
		try {
			const b = await cdp.getElementBounds(entry.cropSelector);
			const padding = entry.cropPadding ?? 16;
			return {
				x: Math.max(0, b.x - padding),
				y: Math.max(0, b.y - padding),
				width: b.width + padding * 2,
				height: b.height + padding * 2,
			};
		} catch {
			return entry.crop;
		}
	}
	return entry.crop;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Animation capture path (v2): drive each frame, capture window-mode, crop each
 * to the SAME static crop (no jitter), then encode to `<name>.gif`. Window-mode
 * only — both target GIFs are in-renderer DOM (context strip / editor / chat),
 * so no screen-mode/native-popup handling is needed. The drop shadow is NOT
 * applied (the upstream GIFs are flat).
 */
/**
 * Apply per-entry layout overrides once before capture: collapse the left
 * sidebar (file explorer) and/or force the Agent Console right-sidebar width
 * so the multi-session tab bar is the focal point (hero composition). Both are
 * fixtures-window-only tweaks; the right-split width persists across the
 * animation's tab opens. Placed after the panel opens + settles.
 */
async function applyLayoutOverrides(
	entry: ManifestEntry,
	deps: OrchestratorDeps,
): Promise<void> {
	if (entry.collapseLeftSidebar) {
		await deps.cdp.evaluate(
			`(() => { app.workspace.leftSplit.collapse(); return true; })()`,
		);
	}
	if (entry.rightSplitWidth) {
		const w = `${entry.rightSplitWidth}px`;
		await deps.cdp.evaluate(
			`(() => { const rs = document.querySelector(".workspace-split.mod-right-split"); if (rs) rs.style.width = ${JSON.stringify(w)}; return !!rs; })()`,
		);
	}
}

async function captureAnimationEntry(
	entry: ManifestEntry,
	deps: OrchestratorDeps,
): Promise<void> {
	const spec = entry.animation;
	if (!spec) return;

	// Initial state — the subset the GIF entries need (mirrors captureEntry's
	// step 1b/2 without the still-only popover/prompt machinery).
	if (entry.agentId) {
		await deps.cdp.evaluate(
			`(() => { const s = app.plugins.plugins["agent-console"].settings; s.defaultAgentId = ${JSON.stringify(entry.agentId)}; return s.defaultAgentId; })()`,
		);
	}
	if (entry.initialState?.openNote) {
		await deps.cdp.evaluate(
			`app.workspace.openLinkText("${entry.initialState.openNote}", "", false)`,
		);
	}
	if (entry.initialState?.clickRibbon) {
		await deps.cdp.evaluate(
			`app.workspace.detachLeavesOfType("agent-client-chat-view")`,
		);
		await deps.cdp.executeCommand("agent-console:open-chat-view");
	}
	if (entry.initialState?.openChatView) {
		await deps.cdp.executeCommand("agent-console:open-chat-view");
	}
	await sleep(SETTLE_MS);
	await applyLayoutOverrides(entry, deps);

	// Static crop resolved ONCE (CSS px → device px), reused for every frame so
	// the GIF doesn't jitter; clamped to the captured image bounds per frame.
	const scaledCrop = scaleRectByDevicePixelRatio(
		entry.crop,
		deps.devicePixelRatio,
	);
	const floor = entry.minDistinctColors ?? DEFAULT_MIN_DISTINCT_COLORS;
	const frames: AnimationFrameInput[] = [];

	for (let fi = 0; fi < spec.frames.length; fi++) {
		const frame = spec.frames[fi];
		for (const action of frame.actions ?? []) {
			await applyAnimationAction(action, deps);
		}
		await sleep(SETTLE_MS);

		const tmpPath = path.join(deps.tmpDir, `${entry.name}-frame-${fi}.png`);
		await deps.cdp.screenshot(tmpPath);

		const meta = await deps.sharp(tmpPath).metadata();
		const imgW = meta.width ?? scaledCrop.x + scaledCrop.width;
		const imgH = meta.height ?? scaledCrop.y + scaledCrop.height;
		const cw = Math.min(scaledCrop.width, imgW - scaledCrop.x);
		const ch = Math.min(scaledCrop.height, imgH - scaledCrop.y);
		const framePng = (await deps
			.sharp(tmpPath)
			.extract({
				left: scaledCrop.x,
				top: scaledCrop.y,
				width: cw,
				height: ch,
			})
			.resize(entry.width, entry.height)
			.png()
			.toBuffer()) as Buffer;

		// Per-frame content guard (I12 pattern) — a blank/degraded frame (a
		// mis-driven step, an empty panel) collapses to a handful of colors.
		// Decode the cropped frame to raw RGB and fail the run below the floor,
		// before any GIF is written.
		const { data, info } = (await deps
			.sharp(framePng)
			.raw()
			.toBuffer({ resolveWithObject: true })) as {
			data: Buffer;
			info: { channels: number };
		};
		const distinct = countDistinctColors(data, info.channels);
		if (distinct < floor) {
			throw new Error(
				`content guard: "${entry.name}" frame ${fi} has ${distinct} distinct colors, below the floor of ${floor} — blank/degraded frame`,
			);
		}

		frames.push({ buffer: framePng, holdMs: frame.holdMs });
	}

	const outputPath = deriveOutputPath(entry, deps.repoRoot, "gif");
	await deps.encodeGif({
		frames,
		fps: spec.fps,
		outPath: outputPath,
		maxBytes: spec.maxBytes,
	});
}

/**
 * Apply one animation drive action via a focus-independent primitive (NEVER
 * CDP Input — dropped off-frontmost, the I13/I15 wall).
 */
async function applyAnimationAction(
	action: AnimationAction,
	deps: OrchestratorDeps,
): Promise<void> {
	switch (action.type) {
		case "click":
			await deps.cdp.clickElement(action.selector);
			if (action.waitFor) {
				await deps.cdp.waitForElement(
					action.waitFor,
					RESPONSE_TIMEOUT_MS,
				);
			}
			break;
		case "wait":
			await deps.cdp.waitForElement(action.selector, RESPONSE_TIMEOUT_MS);
			break;
		case "draft": {
			const draft = action.text
				.replace(/\\/g, "\\\\")
				.replace(/`/g, "\\`")
				.replace(/\$/g, "\\$");
			await deps.cdp.evaluate(
				`(() => {
					const ta = Array.from(document.querySelectorAll('textarea.agent-client-chat-input-textarea')).find((t) => t.offsetParent !== null);
					if (!ta) return false;
					ta.focus();
					const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
					setter.call(ta, "");
					ta.dispatchEvent(new Event('input', { bubbles: true }));
					document.execCommand('insertText', false, \`${draft}\`);
					return true;
				})()`,
			);
			break;
		}
	}
}
