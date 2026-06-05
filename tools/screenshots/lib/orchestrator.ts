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
	type Rect,
} from "./crop";
import { deriveOutputPath } from "./output";

/** Subset of Cdp used by the orchestrator (for DI). */
export interface CdpLike {
	evaluate<T = unknown>(expression: string): Promise<T>;
	clickElement(selector: string): Promise<void>;
	waitForElement(selector: string, timeoutMs?: number): Promise<void>;
	getElementBounds(selector: string): Promise<{ x: number; y: number; width: number; height: number }>;
	hoverElement(selector: string): Promise<void>;
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
}

export interface CaptureResult {
	name: string;
	success: boolean;
	error?: string;
}

export interface CaptureAllOptions {
	filter?: string;
}

const RIBBON_SELECTOR = '[aria-label*="agent-console"], [aria-label*="Agent Console"]';
const SETTLE_MS = 500;
/** Max wait for Obsidian's native tooltip (.tooltip) to render after a hover. */
const HOVER_TOOLTIP_TIMEOUT_MS = 3000;
/** Max wait for a live agent response to finish streaming before capture. */
const RESPONSE_TIMEOUT_MS = 120_000;
/** Scopes selectors to the visible tab panel (inactive panels are display:none). */
const ACTIVE_PANEL = '.agent-client-tab-panel:not([style*="none"])';

/**
 * Capture a single manifest entry: drive UI state → screenshot → crop → write.
 */
export async function captureEntry(
	entry: ManifestEntry,
	deps: OrchestratorDeps,
): Promise<void> {
	// 1. Mobile emulation (before any UI driving)
	if (entry.mobile) {
		await deps.cdp.setMobileEmulation(true);
	}

	// 2. Initial state
	if (entry.initialState?.openNote) {
		const notePath = entry.initialState.openNote;
		await deps.cdp.evaluate(
			`app.workspace.openLinkText("${notePath}", "", false)`,
		);
	}
	if (entry.initialState?.clickRibbon) {
		await deps.cdp.clickElement(RIBBON_SELECTOR);
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
		// Only await the response on the final (screenshotted) tab; earlier tabs
		// get their title from the sent message and need not finish streaming.
		if (i === promptFiles.length - 1) {
			await deps.cdp.waitForElement(
				`${ACTIVE_PANEL} .agent-client-loading-indicator.agent-client-hidden`,
				RESPONSE_TIMEOUT_MS,
			);
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
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
				setter.call(ta, \`${draft}\`);
				ta.dispatchEvent(new Event('input', { bubbles: true }));
				return true;
			})()`,
		);
	}

	// 4. Brief settle for UI animations
	await sleep(SETTLE_MS);

	// 4b. For conversations, scroll the active transcript to the top so the
	// capture shows the question and start of the answer, not the streamed tail.
	if (promptFiles.length > 0) {
		await deps.cdp.evaluate(
			`(() => { const el = document.querySelector('${ACTIVE_PANEL} .agent-client-chat-view-messages'); if (el) el.scrollTop = 0; return !!el; })()`,
		);
		await sleep(SETTLE_MS);
	}

	// 5. Capture screenshot to temp file
	const tmpPath = path.join(deps.tmpDir, `${entry.name}-raw.png`);
	await deps.cdp.screenshot(tmpPath);

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
			deps.devicePixelRatio,
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
			deps.devicePixelRatio,
		);
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

	// 9. Restore mobile emulation
	if (entry.mobile) {
		await deps.cdp.setMobileEmulation(false);
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
