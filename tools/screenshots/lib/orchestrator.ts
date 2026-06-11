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
import type { ManifestEntry } from "./manifest";
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

/** Subset of Cdp used by the orchestrator (for DI). */
export interface CdpLike {
	evaluate<T = unknown>(expression: string): Promise<T>;
	clickElement(selector: string): Promise<void>;
	waitForElement(selector: string, timeoutMs?: number): Promise<void>;
	getElementBounds(selector: string): Promise<{ x: number; y: number; width: number; height: number }>;
	hoverElement(selector: string): Promise<void>;
	clickWithCoords(selector: string): Promise<void>;
	focusWindow(): Promise<void>;
	openNativeSelect(selector: string): Promise<void>;
	getWindowBounds(): Promise<{ x: number; y: number; width: number; height: number; scaleFactor: number }>;
	setWindowBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
	setWindowAlwaysOnTop(enabled: boolean): Promise<void>;
	getWorkArea(): Promise<{ x: number; y: number; width: number; height: number; scaleFactor: number }>;
	screenCaptureRegion(outputPath: string, region: { x: number; y: number; width: number; height: number }): Promise<void>;
	screenshot(outputPath: string): Promise<void>;
	setMobileEmulation(enabled: boolean): Promise<void>;
}

/** sharp factory — matches `import sharp from "sharp"`. Accepts a file path or an in-memory buffer (the group-crop does a second pass over the extracted content buffer). */
export type SharpFactory = (input: string | Buffer) => SharpPipeline;

interface SharpPipeline {
	extract(region: { left: number; top: number; width: number; height: number }): SharpPipeline;
	resize(width: number, height: number): SharpPipeline;
	extend(opts: {
		top: number;
		bottom: number;
		left: number;
		right: number;
		background: { r: number; g: number; b: number; alpha: number };
	}): SharpPipeline;
	raw(): SharpPipeline;
	metadata(): Promise<{ width?: number; height?: number }>;
	webp(opts?: { quality?: number }): SharpPipeline;
	toFile(path: string): Promise<unknown>;
	toBuffer(opts?: {
		resolveWithObject?: boolean;
	}): Promise<
		Buffer | { data: Buffer; info: { width: number; height: number; channels: number } }
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
	loadRaw: (
		path: string,
	) => Promise<{ data: Buffer; channels: number }>;
	/** Remove a file — used to unlink a degraded capture that fails the content guard. */
	unlink: (path: string) => void;
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
 * Fixed window bounds (global logical points) used for captureMode "screen".
 * Pinned before driving the UI so the screencapture region and the static crop
 * are reproducible. Width matches the renderer viewport emulation (1400) so the
 * real-window layout agrees with what dev:screenshot-based shots see; height is
 * generous to fit header chrome + transcript + composer + an upward-opening
 * menu. Position is offset from the screen edge so the window isn't clipped.
 */
const SCREEN_CAPTURE_WINDOW = { width: 1400, height: 820 };

/**
 * Capture a single manifest entry: drive UI state → screenshot → crop → write.
 */
export async function captureEntry(
	entry: ManifestEntry,
	deps: OrchestratorDeps,
): Promise<void> {
	// 0. Screen-capture mode: pin the real OS window to a fixed size/position
	// BEFORE driving any UI. screencapture grabs the real window region (the
	// only way to capture native popup menus), so the window must be a known,
	// reproducible size — and pinned before the menu opens, since resizing
	// afterward would dismiss it and reflow the layout.
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
	}

	try {

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

	// 2. Initial state
	if (entry.initialState?.openNote) {
		const notePath = entry.initialState.openNote;
		await deps.cdp.evaluate(
			`app.workspace.openLinkText("${notePath}", "", false)`,
		);
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
		await deps.cdp.evaluate(
			`app.commands.executeCommandById("agent-console:open-chat-view")`,
		);
	}
	if (entry.initialState?.openChatView) {
		await deps.cdp.evaluate(
			`app.commands.executeCommandById("agent-console:open-chat-view")`,
		);
	}
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
			await deps.cdp.evaluate(
				`app.commands.executeCommandById("agent-console:new-session-tab")`,
			);
			await deps.cdp.waitForElement(
				`${ACTIVE_PANEL} textarea.agent-client-chat-input-textarea`,
			);
		}
		const promptPath = path.join(deps.fixtureRoot, "prompts", promptFiles[i]);
		const content = deps.readFile(promptPath, "utf-8");
		const escaped = content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
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
		await deps.cdp.clickElement(`${ACTIVE_PANEL} .agent-client-chat-send-button`);
		// Await the response only on the final (screenshotted) tab, and only in
		// WINDOW mode; earlier tabs get their title from the sent message and
		// need not finish streaming. Screen-mode popover shots handle
		// send-button idle separately, immediately before the capture (I09):
		// a popover does not need the assistant response (the dropdown is
		// populated at the ACP handshake, before inference), and the connect
		// turn may end WITHOUT ever streaming an assistant message — requiring
		// the assistant element here would hang the capture.
		if (i === promptFiles.length - 1 && entry.captureMode !== "screen") {
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
			await deps.cdp.waitForElement(waitSel, HOVER_TOOLTIP_TIMEOUT_MS);
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
		await deps.cdp.openNativeSelect(entry.initialState.openNativeSelect);
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
		const imgPath = path.join(deps.fixtureRoot, "assets", entry.attachImage);
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

	// 4c. Tier-2 mustShow assertion (rubric P2). Window-mode only: screen-mode
	// popovers render in a native popup window outside the renderer DOM, so
	// their bounds aren't queryable here. Assert the single delightful element
	// this shot exists to showcase is (a) present in the DOM and (b) inside the
	// crop region — so a regenerated shot can't silently drop what it sells.
	if (entry.mustShow && entry.captureMode !== "screen") {
		let mustShowBounds: Rect;
		try {
			mustShowBounds = await deps.cdp.getElementBounds(entry.mustShow);
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
	if (entry.captureMode === "screen") {
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

	if (entry.cropSelectors?.length) {
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
		const scaled = scaleRectByDevicePixelRatio(
			content,
			effectiveDpr,
		);
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
			.extract({ left: scaled.x, top: scaled.y, width: cw, height: ch })
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
		const scaledCrop = scaleRectByDevicePixelRatio(
			cropRect,
			effectiveDpr,
		);
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

	// 8. Optional post-processing (e.g. drop shadow) on the written file.
	await deps.postProcess?.(outputPath);

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
		if (entry.captureMode === "screen") {
			await deps.cdp.setWindowAlwaysOnTop(false);
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
			await captureEntry(entry, deps);
			results.push({ name: entry.name, success: true });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results.push({ name: entry.name, success: false, error: msg });
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
