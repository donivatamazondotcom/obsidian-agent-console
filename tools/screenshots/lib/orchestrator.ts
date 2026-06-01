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
import { scaleRectByDevicePixelRatio } from "./crop";
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

/** sharp factory — matches `import sharp from "sharp"` call signature. */
export type SharpFactory = (input: string) => {
	extract(region: { left: number; top: number; width: number; height: number }): SharpPipeline;
};

interface SharpPipeline {
	extract(region: { left: number; top: number; width: number; height: number }): SharpPipeline;
	resize(width: number, height: number): SharpPipeline;
	webp(opts?: { quality?: number }): SharpPipeline;
	toFile(path: string): Promise<unknown>;
}

export interface OrchestratorDeps {
	cdp: CdpLike;
	sharp: SharpFactory;
	repoRoot: string;
	fixtureRoot: string;
	tmpDir: string;
	readFile: (path: string, encoding: string) => string;
	devicePixelRatio: number;
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
	}

	// 3. Send prompt if specified
	if (entry.promptFile) {
		const promptPath = path.join(deps.fixtureRoot, "prompts", entry.promptFile);
		const content = deps.readFile(promptPath, "utf-8");
		// Escape for JS template-literal embedding
		const escaped = content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
		// Set the textarea via the native value setter so React's controlled
		// input picks up the change, then dispatch input + click send.
		await deps.cdp.evaluate(
			`(() => {
				const ta = document.querySelector('textarea.agent-client-chat-input-textarea');
				if (!ta) return false;
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
				setter.call(ta, \`${escaped}\`);
				ta.dispatchEvent(new Event('input', { bubbles: true }));
				return true;
			})()`,
		);
		await deps.cdp.waitForElement(".agent-client-chat-send-button:not(.agent-client-disabled)");
		await deps.cdp.clickElement(".agent-client-chat-send-button");
		// Wait for response to appear
		await sleep(SETTLE_MS);
	}

	// 4. Brief settle for UI animations
	await sleep(SETTLE_MS);

	// 5. Capture screenshot to temp file
	const tmpPath = path.join(deps.tmpDir, `${entry.name}-raw.png`);
	await deps.cdp.screenshot(tmpPath);

	// 6. Determine crop region — auto from selector or static from manifest
	let cropRect = entry.crop;
	if (entry.cropSelector) {
		try {
			const bounds = await deps.cdp.getElementBounds(entry.cropSelector);
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

	// 7. Crop, resize, encode to .webp
	const scaledCrop = scaleRectByDevicePixelRatio(cropRect, deps.devicePixelRatio);
	const outputPath = deriveOutputPath(entry, deps.repoRoot);

	await deps.sharp(tmpPath)
		.extract({
			left: scaledCrop.x,
			top: scaledCrop.y,
			width: scaledCrop.width,
			height: scaledCrop.height,
		})
		.resize(entry.width, entry.height)
		.webp({ quality: 90 })
		.toFile(outputPath);

	// 7. Restore mobile emulation
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
