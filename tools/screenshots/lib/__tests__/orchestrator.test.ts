/**
 * Tests for the screenshot orchestrator (layer 3).
 *
 * The orchestrator iterates manifest entries, drives UI state via Cdp,
 * captures screenshots, crops/encodes via sharp, and writes .webp output.
 * All external deps are injected for testability.
 *
 * Test contract: tools/screenshots/lib/__tests__/orchestrator.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ManifestEntry } from "../manifest";
import {
	captureEntry,
	captureAll,
	type OrchestratorDeps,
} from "../orchestrator";
import { scaleRectByDevicePixelRatio } from "../crop";

// --- Helpers ---

function makeFixtureRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), "orch-test-"));
	mkdirSync(path.join(root, "studio"), { recursive: true });
	mkdirSync(path.join(root, "prompts"), { recursive: true });
	return root;
}

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
	return {
		name: "test-shot",
		width: 800,
		height: 600,
		crop: { x: 0, y: 0, width: 1600, height: 1200 },
		...overrides,
	};
}

function makeMockCdp() {
	return {
		evaluate: vi.fn().mockResolvedValue(undefined),
		executeCommand: vi.fn().mockResolvedValue(undefined),
		clickElement: vi.fn().mockResolvedValue(undefined),
		waitForElement: vi.fn().mockResolvedValue(undefined),
		hoverElement: vi.fn().mockResolvedValue(undefined),
		clickWithCoords: vi.fn().mockResolvedValue(undefined),
		focusWindow: vi.fn().mockResolvedValue(undefined),
		openNativeSelect: vi.fn().mockResolvedValue(undefined),
		getWindowBounds: vi.fn().mockResolvedValue({ x: 100, y: 50, width: 800, height: 600, scaleFactor: 2 }),
		setWindowBounds: vi.fn().mockResolvedValue(undefined),
		setWindowAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
		getWorkArea: vi.fn().mockResolvedValue({ x: 0, y: 30, width: 3200, height: 1770, scaleFactor: 2 }),
		screenCaptureRegion: vi.fn().mockResolvedValue(undefined),
		screenshot: vi.fn().mockResolvedValue(undefined),
		setMobileEmulation: vi.fn().mockResolvedValue(undefined),
		getElementBounds: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 100, height: 100 }),
	};
}

function makeMockSharp() {
	const instance = {
		extract: vi.fn().mockReturnThis(),
		resize: vi.fn().mockReturnThis(),
		extend: vi.fn().mockReturnThis(),
		raw: vi.fn().mockReturnThis(),
		png: vi.fn().mockReturnThis(),
		webp: vi.fn().mockReturnThis(),
		toFile: vi.fn().mockResolvedValue(undefined),
		metadata: vi.fn().mockResolvedValue({ width: 1400, height: 760 }),
		toBuffer: vi.fn().mockImplementation((opts?: { resolveWithObject?: boolean }) =>
			opts?.resolveWithObject
				? Promise.resolve({
						data: Buffer.from([20, 20, 20]),
						info: { width: 1, height: 1, channels: 3 },
					})
				: Promise.resolve(Buffer.from("rawpng")),
		),
	};
	return vi.fn().mockReturnValue(instance);
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
	return {
		cdp: makeMockCdp() as unknown as OrchestratorDeps["cdp"],
		sharp: makeMockSharp() as unknown as OrchestratorDeps["sharp"],
		repoRoot: "/fake/repo",
		fixtureRoot: "/fake/fixtures",
		tmpDir: "/fake/tmp",
		readFile: vi.fn().mockReturnValue("prompt content"),
		devicePixelRatio: 2,
		// Healthy by default: 256 distinct RGB colors (R sweeps 0..255), well
		// above the global floor — so existing tests pass once the guard wires
		// in. The content-guard reproduce-first tests override this per case.
		loadRaw: vi.fn().mockResolvedValue({
			data: Buffer.from(
				Array.from({ length: 256 * 4 }, (_, k) =>
					k % 4 === 0 ? Math.floor(k / 4) : k % 4 === 3 ? 255 : 0,
				),
			),
			channels: 4,
		}),
		unlink: vi.fn(),
		encodeGif: vi.fn().mockResolvedValue({ frameCount: 1, bytes: 1000 }),
		...overrides,
	};
}

// --- Tests ---

describe("captureEntry", () => {
	it("captures a minimal entry (no initialState, no prompt)", async () => {
		const deps = makeDeps();
		const entry = makeEntry();

		await captureEntry(entry, deps);

		// Should call screenshot
		expect(deps.cdp.screenshot).toHaveBeenCalledTimes(1);
		// Should call sharp pipeline: extract → resize → webp → toFile
		expect(deps.sharp).toHaveBeenCalledTimes(1);
		const sharpInstance = (deps.sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
		// Crop is scaled by DPR (2): floor(0*2)=0, ceil((0+1600)*2)-0=3200, etc.
		expect(sharpInstance.extract).toHaveBeenCalledWith({ left: 0, top: 0, width: 3200, height: 2400 });
		expect(sharpInstance.resize).toHaveBeenCalledWith(entry.width, entry.height);
		expect(sharpInstance.webp).toHaveBeenCalled();
		expect(sharpInstance.toFile).toHaveBeenCalledWith(
			path.join("/fake/repo", "docs", "public", "images", "test-shot.webp"),
		);
	});

	it("opens the chat panel when initialState.clickRibbon is true", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ initialState: { clickRibbon: true } });

		await captureEntry(entry, deps);

		// clickRibbon opens the panel via the open-chat-view command
		// (deterministic), not the ribbon toggle — see I08.
		// The command is issued via the fire-and-forget executeCommand path (I18).
		expect(deps.cdp.executeCommand).toHaveBeenCalledWith(
			"agent-console:open-chat-view",
		);
	});

	it("detaches existing chat-view leaves then opens the panel via command (I08)", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ initialState: { clickRibbon: true } });

		await captureEntry(entry, deps);

		const evalMock = deps.cdp.evaluate as ReturnType<typeof vi.fn>;
		const execMock = deps.cdp.executeCommand as ReturnType<typeof vi.fn>;
		const evalCalls = evalMock.mock.calls.map((c: unknown[]) => c[0] as string);
		const detachIdx = evalCalls.findIndex((sel) => sel.includes("detachLeavesOfType"));
		const openIdx = execMock.mock.calls.findIndex(
			(c: unknown[]) => (c[0] as string).includes("open-chat-view"),
		);
		// v1.1.0 restores the panel on reload and the ribbon is a TOGGLE, so
		// clicking it is unreliable (closes a restored panel / races restore).
		// Detach existing leaves, then open via the command (deterministic) (I08).
		expect(detachIdx).toBeGreaterThanOrEqual(0);
		expect(openIdx).toBeGreaterThanOrEqual(0);
		expect(evalMock.mock.invocationCallOrder[detachIdx]).toBeLessThan(
			execMock.mock.invocationCallOrder[openIdx],
		);
	});

	it("tolerates empty CDP output from the open-chat-view command (I18)", async () => {
		const deps = makeDeps();
		// Reproduce I18: opening the chat view triggers a fresh ACP agent
		// connection whose load drops the CDP Runtime.evaluate response, so the
		// open-chat-view command evaluate returns empty stdout and cdp.evaluate
		// throws. The command's side effect still lands; the capture must NOT fail.
		(deps.cdp.evaluate as ReturnType<typeof vi.fn>).mockImplementation(
			(expr: string) =>
				expr.includes("open-chat-view")
					? Promise.reject(new Error("CDP evaluate: empty output from obsidian"))
					: Promise.resolve(undefined),
		);
		const entry = makeEntry({ initialState: { clickRibbon: true } });

		// The fix routes open-chat-view through the fire-and-forget executeCommand
		// path (tolerates empty stdout), not the throwing evaluate path.
		await expect(captureEntry(entry, deps)).resolves.toBeUndefined();
		expect(deps.cdp.executeCommand).toHaveBeenCalledWith(
			"agent-console:open-chat-view",
		);
	});

	it("opens a note when initialState.openNote is set", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ initialState: { openNote: "Example.md" } });

		await captureEntry(entry, deps);

		expect(deps.cdp.evaluate).toHaveBeenCalled();
		const calls = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls;
		const openCall = calls.find((c: string[]) => (c[0] as string).includes("openFile") || (c[0] as string).includes("Example"));
		expect(openCall).toBeDefined();
	});

	it("opens chat view when initialState.openChatView is true", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ initialState: { openChatView: true } });

		await captureEntry(entry, deps);

		expect(deps.cdp.executeCommand).toHaveBeenCalledWith(
			"agent-console:open-chat-view",
		);
	});

	it("waits for the tooltip after hoverSelector, before screenshot (I06)", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			initialState: { hoverSelector: '[aria-label="Agent Console"]' },
		});

		await captureEntry(entry, deps);

		expect(deps.cdp.hoverElement).toHaveBeenCalledWith('[aria-label="Agent Console"]');
		const waitMock = deps.cdp.waitForElement as ReturnType<typeof vi.fn>;
		const shotMock = deps.cdp.screenshot as ReturnType<typeof vi.fn>;
		const tooltipIdx = waitMock.mock.calls.findIndex(
			(c: unknown[]) => c[0] === ".tooltip",
		);
		// orchestrator must wait for the real .tooltip element (not the blind
		// SETTLE_MS) so the capture doesn't race Obsidian's tooltip show-delay.
		expect(tooltipIdx).toBeGreaterThanOrEqual(0);
		// and that wait must precede the screenshot
		expect(waitMock.mock.invocationCallOrder[tooltipIdx]).toBeLessThan(
			shotMock.mock.invocationCallOrder[0],
		);
	});

	it("reads and sends prompt when promptFile is set", async () => {
		const fixtureRoot = makeFixtureRoot();
		writeFileSync(path.join(fixtureRoot, "prompts", "hello.txt"), "Say hello");
		const deps = makeDeps({ fixtureRoot });
		const entry = makeEntry({ promptFile: "hello.txt" });

		await captureEntry(entry, deps);

		expect(deps.readFile).toHaveBeenCalledWith(
			path.join(fixtureRoot, "prompts", "hello.txt"),
			"utf-8",
		);
		// Should evaluate something that sends the prompt text
		const calls = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls;
		const sendCall = calls.find((c: string[]) => (c[0] as string).includes("prompt content"));
		expect(sendCall).toBeDefined();
	});

	it("waits for response completion when promptFile is set", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ promptFile: "hello.txt" });

		await captureEntry(entry, deps);

		const selectors = (deps.cdp.waitForElement as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: string[]) => c[0] as string,
		);
		expect(
			selectors.some((s) =>
				s.includes(".agent-client-loading-indicator.agent-client-hidden"),
			),
		).toBe(true);
	});

	it("waits for the assistant response to appear before waiting for completion (I07)", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ promptFile: "hello.txt" });

		await captureEntry(entry, deps);

		const waitMock = deps.cdp.waitForElement as ReturnType<typeof vi.fn>;
		const calls = waitMock.mock.calls.map((c: unknown[]) => c[0] as string);
		const beganIdx = calls.findIndex((sel) =>
			sel.includes("agent-client-message-assistant"),
		);
		const doneIdx = calls.findIndex((sel) =>
			sel.includes("agent-client-loading-indicator.agent-client-hidden"),
		);
		// v1.1.0's Connecting/Sending phase keeps the loading indicator hidden,
		// so the orchestrator must first confirm the response began (assistant
		// element present) before waiting for the indicator to hide — otherwise
		// the hidden-wait resolves during Connecting and captures an empty
		// transcript.
		expect(beganIdx).toBeGreaterThanOrEqual(0);
		expect(doneIdx).toBeGreaterThanOrEqual(0);
		expect(waitMock.mock.invocationCallOrder[beganIdx]).toBeLessThan(
			waitMock.mock.invocationCallOrder[doneIdx],
		);
	});

	it("propagates timeout when the response never completes", async () => {
		const deps = makeDeps();
		(deps.cdp.waitForElement as ReturnType<typeof vi.fn>).mockImplementation(
			(selector: string) =>
				selector.includes("loading-indicator")
					? Promise.reject(new Error("waitForElement: timeout"))
					: Promise.resolve(),
		);
		const entry = makeEntry({ promptFile: "hello.txt" });

		await expect(captureEntry(entry, deps)).rejects.toThrow(/timeout/);
		expect(deps.cdp.screenshot).not.toHaveBeenCalled();
	});

	it("opens a new tab for each prompt after the first", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ prompts: ["a.txt", "b.txt", "c.txt"] });

		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: string[]) => c[0] as string,
		);
		const newTabCalls = (deps.cdp.executeCommand as ReturnType<typeof vi.fn>).mock.calls.filter(
			// v1.2.0 rationalization removed `new-session-tab`; new tabs now
			// open via the surviving `new-chat` command (browser-tab model).
			(c: unknown[]) => (c[0] as string).includes("agent-console:new-chat"),
		);
		expect(newTabCalls).toHaveLength(2); // 3 prompts -> 2 extra tabs
		expect((deps.readFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
		expect(evals.some((e) => e.includes("scrollTop"))).toBe(true);
	});

	it("hides hideSelectors via display:none before capturing", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			hideSelectors: [".agent-client-chat-input-container", ".foo"],
		});

		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: string[]) => c[0] as string,
		);
		const hideCall = evals.find(
			(e) =>
				e.includes('style.display = "none"') &&
				e.includes(".agent-client-chat-input-container"),
		);
		expect(hideCall).toBeDefined();
		expect(deps.cdp.screenshot).toHaveBeenCalledTimes(1);
	});

	it("types draftMessage into the composer without sending", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ draftMessage: "Draft this please" });

		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: string[]) => c[0] as string,
		);
		expect(evals.some((e) => e.includes("Draft this please"))).toBe(true);
		// a draft is never sent (no send-button / ribbon click for this entry)
		expect(deps.cdp.clickElement).not.toHaveBeenCalled();
	});

	it("attaches a fixture image via a synthetic drop and waits for the thumbnail", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ attachImage: "sample-diagram.png" });

		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: string[]) => c[0] as string,
		);
		// A drop event carrying a DataTransfer File built from the named asset
		// is dispatched on the input box (the only JS-dispatchable attach path).
		const dropEval = evals.find(
			(e) =>
				e.includes("DataTransfer") &&
				e.includes("DragEvent") &&
				e.includes("'drop'") &&
				e.includes("sample-diagram.png"),
		);
		expect(dropEval).toBeDefined();
		expect(dropEval).toContain(".agent-client-chat-input-box");
		// The thumbnail renders async (FileReader); the orchestrator waits for
		// the strip's image element before the assert/capture.
		expect(deps.cdp.waitForElement).toHaveBeenCalledWith(
			expect.stringContaining(".agent-client-attachment-preview-thumbnail"),
			expect.any(Number),
		);
	});

	it("force-reveals revealSelectors (opacity:1) before capture", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			revealSelectors: [".agent-client-attachment-preview-remove"],
		});

		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: string[]) => c[0] as string,
		);
		// A hover-gated control (opacity:0 until :hover) is surfaced
		// declaratively since JS mouseover can't trigger CSS :hover.
		expect(
			evals.some(
				(e) =>
					e.includes('opacity') &&
					e.includes(".agent-client-attachment-preview-remove"),
			),
		).toBe(true);
	});

	it("runs postProcess on the output path when provided", async () => {
		const postProcess = vi.fn().mockResolvedValue(undefined);
		const deps = makeDeps({ postProcess });
		const entry = makeEntry({ name: "shot" });

		await captureEntry(entry, deps);

		expect(postProcess).toHaveBeenCalledTimes(1);
		expect(postProcess).toHaveBeenCalledWith(
			expect.stringContaining(path.join("docs", "public", "images", "shot.webp")),
		);
	});

	it("toggles mobile emulation when mobile is true", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ mobile: true });

		await captureEntry(entry, deps);

		expect(deps.cdp.setMobileEmulation).toHaveBeenCalledWith(true);
		expect(deps.cdp.setMobileEmulation).toHaveBeenCalledWith(false);
		// on before screenshot, off after
		const calls = (deps.cdp.setMobileEmulation as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls[0][0]).toBe(true);
		expect(calls[1][0]).toBe(false);
	});

	it("scales crop by devicePixelRatio", async () => {
		const deps = makeDeps({ devicePixelRatio: 2 });
		const entry = makeEntry({ crop: { x: 10, y: 20, width: 100, height: 50 }, width: 200, height: 100 });

		await captureEntry(entry, deps);

		const sharpInstance = (deps.sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
		const extractArg = sharpInstance.extract.mock.calls[0][0] as { left: number; top: number; width: number; height: number };
		// floor(10*2)=20, floor(20*2)=40, ceil((10+100)*2)-20=200, ceil((20+50)*2)-40=100
		expect(extractArg.left).toBe(20);
		expect(extractArg.top).toBe(40);
		expect(extractArg.width).toBe(200);
		expect(extractArg.height).toBe(100);
	});

	it("uses cropSelector bounds when available", async () => {
		const deps = makeDeps();
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockResolvedValue({
			x: 10, y: 50, width: 30, height: 26,
		});
		const entry = makeEntry({
			cropSelector: ".my-icon",
			cropPadding: 16,
			crop: { x: 0, y: 0, width: 999, height: 999 }, // static fallback — should be ignored
		});

		await captureEntry(entry, deps);

		expect(deps.cdp.getElementBounds).toHaveBeenCalledWith(".my-icon");
		const sharpInstance = (deps.sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
		// Bounds: x=10-16=-6→0, y=50-16=34, w=30+32=62, h=26+32=58, scaled by DPR 2
		const extractArg = sharpInstance.extract.mock.calls[0][0] as { left: number; top: number; width: number; height: number };
		expect(extractArg.left).toBe(0);    // max(0, (10-16)*2) = 0
		expect(extractArg.top).toBe(68);    // floor(34*2)
		expect(extractArg.width).toBe(124); // ceil((0+62)*2) - 0 ... actually let's just check it's not 999*2
		expect(extractArg.width).not.toBe(1998);
		expect(sharpInstance.resize).not.toHaveBeenCalled();
	});

	it("falls back to static crop when cropSelector matches nothing", async () => {
		const deps = makeDeps();
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("no element matches"),
		);
		const entry = makeEntry({
			cropSelector: ".missing",
			crop: { x: 5, y: 10, width: 100, height: 50 },
		});

		await captureEntry(entry, deps);

		const sharpInstance = (deps.sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
		const extractArg = sharpInstance.extract.mock.calls[0][0] as { left: number; top: number };
		// Should use static crop scaled by DPR: left = floor(5*2) = 10
		expect(extractArg.left).toBe(10);
		expect(extractArg.top).toBe(20);
	});

	it("propagates Cdp errors", async () => {
		const deps = makeDeps();
		(deps.cdp.screenshot as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("screenshot timeout"),
		);
		const entry = makeEntry();

		await expect(captureEntry(entry, deps)).rejects.toThrow("screenshot timeout");
	});

	it("propagates sharp errors", async () => {
		const toFileMock = vi.fn().mockRejectedValue(new Error("disk full"));
		const sharpInstance = {
			extract: vi.fn().mockReturnThis(),
			resize: vi.fn().mockReturnThis(),
			webp: vi.fn().mockReturnThis(),
			toFile: toFileMock,
		};
		const sharpFactory = vi.fn().mockReturnValue(sharpInstance);
		const deps = makeDeps({ sharp: sharpFactory as unknown as OrchestratorDeps["sharp"] });
		const entry = makeEntry();

		await expect(captureEntry(entry, deps)).rejects.toThrow("disk full");
	});
});

describe("captureAll", () => {
	it("processes all entries sequentially", async () => {
		const deps = makeDeps();
		const entries = [makeEntry({ name: "a" }), makeEntry({ name: "b" })];

		const results = await captureAll(entries, deps);

		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({ name: "a", success: true });
		expect(results[1]).toEqual({ name: "b", success: true });
		expect(deps.cdp.screenshot).toHaveBeenCalledTimes(2);
	});

	it("continues on error and reports failures", async () => {
		const deps = makeDeps();
		let callCount = 0;
		(deps.cdp.screenshot as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.reject(new Error("first failed"));
			return Promise.resolve();
		});
		const entries = [makeEntry({ name: "fail" }), makeEntry({ name: "pass" })];

		const results = await captureAll(entries, deps);

		expect(results[0]).toEqual({ name: "fail", success: false, error: "first failed" });
		expect(results[1]).toEqual({ name: "pass", success: true });
	});

	it("filters entries by name when filter is provided", async () => {
		const deps = makeDeps();
		const entries = [makeEntry({ name: "a" }), makeEntry({ name: "b" })];

		const results = await captureAll(entries, deps, { filter: "a" });

		expect(results).toHaveLength(1);
		expect(results[0].name).toBe("a");
		expect(deps.cdp.screenshot).toHaveBeenCalledTimes(1);
	});

	it("throws when filter matches no entries", async () => {
		const deps = makeDeps();
		const entries = [makeEntry({ name: "a" })];

		await expect(captureAll(entries, deps, { filter: "zzz" })).rejects.toThrow(
			/no manifest entry matches filter/i,
		);
	});
});

describe("captureEntry — group crop (cropSelectors)", () => {
	it("unions selector bounds and center-pads to target dims via extend", async () => {
		const deps = makeDeps({ devicePixelRatio: 1 });
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockImplementation(
			(sel: string) =>
				Promise.resolve(
					sel === ".a"
						? { x: 100, y: 80, width: 30, height: 26 }
						: { x: 160, y: 80, width: 30, height: 26 },
				),
		);
		const entry = makeEntry({
			name: "group-shot",
			width: 300,
			height: 96,
			cropSelectors: [".a", ".b"],
			cropPadding: 16,
		});

		await captureEntry(entry, deps);

		const sharpInstance = (deps.sharp as unknown as ReturnType<typeof vi.fn>).mock
			.results[0].value;
		// union of .a/.b = {x:100,y:80,w:90,h:26}; +16 padding -> {x:84,y:64,w:122,h:58}
		expect(sharpInstance.extract).toHaveBeenCalledWith({
			left: 84,
			top: 64,
			width: 122,
			height: 58,
		});
		// bg sampled from the content's top-left 1x1 pixel
		expect(sharpInstance.extract).toHaveBeenCalledWith({
			left: 0,
			top: 0,
			width: 1,
			height: 1,
		});
		// center-pad 122x58 content into 300x96: dw=178 -> 89/89, dh=38 -> 19/19
		expect(sharpInstance.extend).toHaveBeenCalledWith({
			top: 19,
			bottom: 19,
			left: 89,
			right: 89,
			background: { r: 20, g: 20, b: 20, alpha: 1 },
		});
		// group crops never resize (would distort the framed content)
		expect(sharpInstance.resize).not.toHaveBeenCalled();
		expect(sharpInstance.toFile).toHaveBeenCalledWith(
			path.join("/fake/repo", "docs", "public", "images", "group-shot.webp"),
		);
	});

	it("throws when group-crop content exceeds the target dimensions", async () => {
		const deps = makeDeps({ devicePixelRatio: 1 });
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockResolvedValue({
			x: 0,
			y: 0,
			width: 500,
			height: 400,
		});
		const entry = makeEntry({
			name: "too-big",
			width: 100,
			height: 100,
			cropSelectors: [".big"],
		});

		await expect(captureEntry(entry, deps)).rejects.toThrow(/exceeds target/);
	});

	it("fails hard when a group selector matches nothing (no silent fallback)", async () => {
		const deps = makeDeps({ devicePixelRatio: 1 });
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("getElementBounds: no element matches selector .missing"),
		);
		const entry = makeEntry({
			name: "missing-member",
			cropSelectors: [".present", ".missing"],
		});

		await expect(captureEntry(entry, deps)).rejects.toThrow(/no element matches/);
	});
});

describe("captureEntry — single cropSelector clamp (bad-extract-area hardening)", () => {
	it("clamps a single cropSelector crop to the captured image bounds (prevents sharp 'bad extract area')", async () => {
		const deps = makeDeps(); // metadata 1400×760, devicePixelRatio 2
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockResolvedValue({
			x: 660, y: 100, width: 120, height: 60,
		});
		const entry = makeEntry({ cropSelector: ".edge-el", cropPadding: 12 });

		await captureEntry(entry, deps);

		const sharpInstance = (deps.sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
		const arg = sharpInstance.extract.mock.calls[0][0] as {
			left: number; top: number; width: number; height: number;
		};
		const imgW = 1400;
		const imgH = 760;
		// The element + padding overruns the right edge; the crop must stay inside
		// the image — the invariant a real sharp.extract enforces.
		expect(arg.left + arg.width).toBeLessThanOrEqual(imgW);
		expect(arg.top + arg.height).toBeLessThanOrEqual(imgH);
		// Clamped to the right edge, not zeroed/negative.
		expect(arg.width).toBe(imgW - arg.left);
		expect(arg.width).toBeGreaterThan(0);
	});

	it("leaves a single cropSelector crop unchanged when it fits within the image", async () => {
		const deps = makeDeps();
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockResolvedValue({
			x: 100, y: 100, width: 120, height: 60,
		});
		const entry = makeEntry({ cropSelector: ".inner-el", cropPadding: 12 });

		await captureEntry(entry, deps);

		const sharpInstance = (deps.sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
		const arg = sharpInstance.extract.mock.calls[0][0] as {
			left: number; top: number; width: number; height: number;
		};
		// Well within 1400×760 → clamp is a no-op; width/height equal the full
		// padded crop scaled by DPR (cropRect {88,88,144,84} × 2).
		const expected = scaleRectByDevicePixelRatio({ x: 88, y: 88, width: 144, height: 84 }, 2);
		expect(arg.width).toBe(expected.width);
		expect(arg.height).toBe(expected.height);
		expect(arg.left + arg.width).toBeLessThanOrEqual(1400);
	});
});

describe("captureEntry — screen capture mode (popovers)", () => {
	it("uses screenCaptureRegion (not dev:screenshot) and the window scale factor for screen mode", async () => {
		const deps = makeDeps();
		const entry = {
			name: "mode-selection",
			width: 100,
			height: 50,
			crop: { x: 10, y: 20, width: 100, height: 50 },
			captureMode: "screen" as const,
			initialState: {
				openNote: "Welcome.md",
				clickRibbon: true,
				clickSelector: ".agent-client-toolbar-dropdown",
			},
		};

		await captureEntry(entry, deps);

		// screen mode must NOT use dev:screenshot
		expect(deps.cdp.screenshot).not.toHaveBeenCalled();
		// it must capture the window's screen region from getWindowBounds
		expect(deps.cdp.getWindowBounds).toHaveBeenCalled();
		expect(deps.cdp.screenCaptureRegion).toHaveBeenCalledWith(
			expect.stringContaining("mode-selection-raw.png"),
			{ x: 100, y: 50, width: 800, height: 600 },
		);
		const sharpInstance = (deps.sharp as ReturnType<typeof vi.fn>).mock.results[0]
			.value;
		// screen-mode crops are authored in raw px and applied as-is
		// (effectiveDpr = 1), NOT scaled by the window scaleFactor — so the
		// crop {x:10,y:20,w:100,h:50} extracts exactly that region.
		expect(sharpInstance.extract).toHaveBeenCalledWith({
			left: 10,
			top: 20,
			width: 100,
			height: 50,
		});
	});

	it("floats the fixtures window before screen capture and restores it after (I13)", async () => {
		const deps = makeDeps();
		const entry = {
			name: "mode-selection",
			width: 100,
			height: 50,
			crop: { x: 0, y: 0, width: 100, height: 50 },
			captureMode: "screen" as const,
			promptFile: "connect.txt",
			initialState: { clickRibbon: true, clickSelector: ".x" },
		};

		await captureEntry(entry, deps);

		const aot = deps.cdp.setWindowAlwaysOnTop as ReturnType<typeof vi.fn>;
		// Floated on (true) and restored off (false).
		expect(aot).toHaveBeenCalledWith(true);
		expect(aot).toHaveBeenCalledWith(false);
		// The float must precede the screencapture; the restore must follow it.
		const order = aot.mock.invocationCallOrder;
		const capOrder = (deps.cdp.screenCaptureRegion as ReturnType<typeof vi.fn>)
			.mock.invocationCallOrder[0];
		expect(order[0]).toBeLessThan(capOrder); // setTrue before capture
		expect(order[order.length - 1]).toBeGreaterThan(capOrder); // setFalse after
	});

	it("restores alwaysOnTop even when the capture throws — the window never lingers over the daily vault (I13)", async () => {
		const deps = makeDeps();
		(
			deps.cdp.screenCaptureRegion as ReturnType<typeof vi.fn>
		).mockRejectedValue(new Error("screencapture boom"));
		const entry = {
			name: "mode-selection",
			width: 100,
			height: 50,
			crop: { x: 0, y: 0, width: 100, height: 50 },
			captureMode: "screen" as const,
			promptFile: "connect.txt",
			initialState: { clickRibbon: true, clickSelector: ".x" },
		};

		await expect(captureEntry(entry, deps)).rejects.toThrow(/boom/);
		// Finally restored the float despite the throw.
		expect(deps.cdp.setWindowAlwaysOnTop).toHaveBeenCalledWith(false);
	});

	it("does NOT float the window for window-mode (dev:screenshot) entries (I13)", async () => {
		const deps = makeDeps();
		const entry = {
			name: "ribbon-icon",
			width: 100,
			height: 50,
			crop: { x: 0, y: 0, width: 100, height: 50 },
			initialState: { openNote: "Welcome.md" },
		};

		await captureEntry(entry, deps);

		// Window mode uses dev:screenshot (renderer capture) — immune to
		// z-order — so no float/restore is needed.
		expect(deps.cdp.setWindowAlwaysOnTop).not.toHaveBeenCalled();
		expect(deps.cdp.screenshot).toHaveBeenCalled();
	});

	
	
	it("clicks the dropdown via clickWithCoords and does NOT wait for .menu in screen mode", async () => {
		const deps = makeDeps();
		const entry = {
			name: "model-selection",
			width: 100,
			height: 50,
			crop: { x: 0, y: 0, width: 100, height: 50 },
			captureMode: "screen" as const,
			initialState: {
				clickRibbon: true,
				clickSelector: ".agent-client-toolbar-dropdown:last-child",
			},
		};

		await captureEntry(entry, deps);

		expect(deps.cdp.clickWithCoords).toHaveBeenCalledWith(
			".agent-client-toolbar-dropdown:last-child",
		);
		// .menu never resolves in the DOM for a native popup; screen mode must
		// not block on it. waitForElement is only used to wait for the click
		// target to exist (the dropdown), never for ".menu".
		const waitCalls = (deps.cdp.waitForElement as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(waitCalls.every((c: unknown[]) => c[0] !== ".menu")).toBe(true);
	});

	it("waits for the send button to go idle (loading-indicator hidden) before screen capture, without requiring an assistant response (I09)", async () => {
		const deps = makeDeps();
		const entry = {
			name: "mode-selection",
			width: 100,
			height: 50,
			crop: { x: 0, y: 0, width: 100, height: 50 },
			captureMode: "screen" as const,
			promptFile: "connect.txt",
			initialState: {
				clickRibbon: true,
				clickSelector:
					".agent-client-tab-panel:not([style*=\"none\"]) .agent-client-toolbar-dropdown:first-child",
			},
		};

		await captureEntry(entry, deps);

		const waitMock = deps.cdp.waitForElement as ReturnType<typeof vi.fn>;
		const calls = waitMock.mock.calls.map((c: unknown[]) => c[0] as string);
		const idleIdx = calls.findIndex((sel) =>
			sel.includes("agent-client-loading-indicator.agent-client-hidden"),
		);
		const screenMock = deps.cdp
			.screenCaptureRegion as ReturnType<typeof vi.fn>;

		// The connect prompt for a popover shot puts a turn in-flight; the
		// send/stop button shows a red STOP square while isSending is true (the
		// button and the loading indicator are gated on the same flag). The
		// capture must wait for the indicator to hide (== button idle) before
		// the screen capture (I09).
		expect(idleIdx).toBeGreaterThanOrEqual(0);
		expect(waitMock.mock.invocationCallOrder[idleIdx]).toBeLessThan(
			screenMock.mock.invocationCallOrder[0],
		);
		// Regression guard: screen mode must NOT wait for an assistant response
		// element. A popover does not need the response, and the connect turn
		// may end without ever streaming one — requiring it would hang the
		// capture (observed: a "Hi" connect turn that finished with zero
		// assistant messages, send button already idle).
		expect(
			calls.some((sel) => sel.includes("agent-client-message-assistant")),
		).toBe(false);
	});
});

describe("captureEntry — content guard (I11 follow-up)", () => {
	const imagesDir = path.join("/fake/repo", "docs", "public", "images");

	it("throws and unlinks the output when distinct colors fall below the floor", async () => {
		const deps = makeDeps();
		// A uniform (blank) capture: 1 distinct color, below the global floor.
		(deps.loadRaw as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: Buffer.from([10, 10, 10, 255, 10, 10, 10, 255]),
			channels: 4,
		});
		const entry = makeEntry({ name: "blank-shot" });

		await expect(captureEntry(entry, deps)).rejects.toThrow(
			/distinct color|content guard|below the floor/i,
		);
		// (b): the degraded file is deleted so it can't be staged.
		expect(deps.unlink).toHaveBeenCalledWith(
			path.join(imagesDir, "blank-shot.webp"),
		);
	});

	it("passes (no throw, no unlink) when distinct colors meet the floor", async () => {
		const deps = makeDeps(); // healthy default loadRaw = 256 distinct
		const entry = makeEntry({ name: "ok-shot" });

		await expect(captureEntry(entry, deps)).resolves.toBeUndefined();
		expect(deps.unlink).not.toHaveBeenCalled();
	});

	it("honors a per-entry minDistinctColors floor above the global default", async () => {
		const deps = makeDeps();
		// 256 distinct (default mock) clears the global default (50) but must
		// fail an 800 floor — the calibrated ribbon-icon case.
		const entry = makeEntry({ name: "ribbon-icon", minDistinctColors: 800 });

		await expect(captureEntry(entry, deps)).rejects.toThrow(/800/);
		expect(deps.unlink).toHaveBeenCalledWith(
			path.join(imagesDir, "ribbon-icon.webp"),
		);
	});

	it("measures the final output file AFTER postProcess (loadRaw on the output path, post-shadow)", async () => {
		const postProcess = vi.fn().mockResolvedValue(undefined);
		const deps = makeDeps({ postProcess });
		const entry = makeEntry({ name: "shot" });
		const outPath = path.join(imagesDir, "shot.webp");

		await captureEntry(entry, deps);

		expect(deps.loadRaw).toHaveBeenCalledWith(outPath);
		// The guard reads the post-shadow webp, so loadRaw must run after the
		// postProcess shadow pass (the calibration was measured post-shadow).
		const loadOrder = (deps.loadRaw as ReturnType<typeof vi.fn>).mock
			.invocationCallOrder[0];
		const ppOrder = postProcess.mock.invocationCallOrder[0];
		expect(loadOrder).toBeGreaterThan(ppOrder);
	});

	it("guards screen-mode (popover) captures too", async () => {
		const deps = makeDeps();
		(deps.loadRaw as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: Buffer.from([0, 0, 0, 255, 0, 0, 0, 255]),
			channels: 4,
		});
		const entry = makeEntry({
			name: "mode-selection",
			captureMode: "screen",
			crop: { x: 0, y: 0, width: 100, height: 50 },
			width: 100,
			height: 50,
		});

		await expect(captureEntry(entry, deps)).rejects.toThrow(
			/distinct color|content guard|below the floor/i,
		);
		expect(deps.unlink).toHaveBeenCalledWith(
			path.join(imagesDir, "mode-selection.webp"),
		);
	});
});

describe("captureEntry — mustShow assertion (rubric P2)", () => {
	it("throws when the mustShow element is not in the DOM (window mode)", async () => {
		const cdp = makeMockCdp();
		cdp.getElementBounds = vi.fn().mockRejectedValue(new Error("not found"));
		const deps = makeDeps({
			cdp: cdp as unknown as OrchestratorDeps["cdp"],
		});
		const entry = makeEntry({ mustShow: ".agent-client-tab-state-icon" });
		await expect(captureEntry(entry, deps)).rejects.toThrow(
			/mustShow assert.*not found/,
		);
	});

	it("throws when the mustShow element is outside the crop region", async () => {
		const cdp = makeMockCdp();
		// Default entry crop is {0,0,1600,1200}; place the element far outside.
		cdp.getElementBounds = vi
			.fn()
			.mockResolvedValue({ x: 5000, y: 5000, width: 10, height: 10 });
		const deps = makeDeps({
			cdp: cdp as unknown as OrchestratorDeps["cdp"],
		});
		const entry = makeEntry({ mustShow: ".agent-client-tab-state-icon" });
		await expect(captureEntry(entry, deps)).rejects.toThrow(
			/outside the crop region/,
		);
	});

	it("passes when the mustShow element is inside the crop region", async () => {
		const cdp = makeMockCdp();
		cdp.getElementBounds = vi
			.fn()
			.mockResolvedValue({ x: 10, y: 10, width: 50, height: 50 });
		const deps = makeDeps({
			cdp: cdp as unknown as OrchestratorDeps["cdp"],
		});
		const entry = makeEntry({ mustShow: ".agent-client-tab-state-icon" });
		await expect(captureEntry(entry, deps)).resolves.toBeUndefined();
		expect(cdp.getElementBounds).toHaveBeenCalledWith(
			".agent-client-tab-state-icon",
		);
	});

	it("skips the assert for screen-mode entries (popover not in DOM)", async () => {
		const cdp = makeMockCdp();
		// Would fail the assert if it ran — proves screen mode skips it.
		cdp.getElementBounds = vi.fn().mockRejectedValue(new Error("not found"));
		const deps = makeDeps({
			cdp: cdp as unknown as OrchestratorDeps["cdp"],
		});
		const entry = makeEntry({
			mustShow: ".agent-client-tab-state-icon",
			captureMode: "screen",
			crop: { x: 0, y: 0, width: 800, height: 600 },
		});
		await expect(captureEntry(entry, deps)).resolves.toBeUndefined();
		expect(cdp.getElementBounds).not.toHaveBeenCalledWith(
			".agent-client-tab-state-icon",
		);
	});
});

describe("captureEntry — legibility floor (rubric P5)", () => {
	it("throws when a static crop would upscale (source < target)", async () => {
		const deps = makeDeps({ devicePixelRatio: 2 });
		// crop 100×100 @ dpr2 = 200×200 source; target 800×600 → 0.25× upscale.
		const entry = makeEntry({
			name: "tiny-crop",
			width: 800,
			height: 600,
			crop: { x: 0, y: 0, width: 100, height: 100 },
		});

		await expect(captureEntry(entry, deps)).rejects.toThrow(/legibility/i);
		// It throws before encoding the output, so the content guard never runs.
		expect(deps.unlink).not.toHaveBeenCalled();
	});

	it("passes when the static crop source meets/exceeds the target (downscale)", async () => {
		const deps = makeDeps({ devicePixelRatio: 2 });
		// crop 800×600 @ dpr2 = 1600×1200 source; target 800×600 → 2× downscale.
		const entry = makeEntry({
			name: "ample-crop",
			width: 800,
			height: 600,
			crop: { x: 0, y: 0, width: 800, height: 600 },
		});

		await expect(captureEntry(entry, deps)).resolves.toBeUndefined();
	});

	it("honors a tighter per-entry minLegibilityScale (hero retina headroom)", async () => {
		const deps = makeDeps({ devicePixelRatio: 2 });
		// crop 600×450 @ dpr2 = 1200×900 source; target 800×600 → 1.5× — clears
		// the default floor (1) but must fail a 2.0 per-entry floor.
		const entry = makeEntry({
			name: "needs-retina",
			width: 800,
			height: 600,
			crop: { x: 0, y: 0, width: 600, height: 450 },
			minLegibilityScale: 2,
		});

		await expect(captureEntry(entry, deps)).rejects.toThrow(/legibility/i);
	});

	it("skips the floor for cropSelector entries (native size, no resize)", async () => {
		const deps = makeDeps({ devicePixelRatio: 2 });
		// A tiny selector region would "upscale" if resized — but cropSelector
		// entries emit at native captured size and never resize, so the floor
		// must not fire.
		(deps.cdp.getElementBounds as ReturnType<typeof vi.fn>).mockResolvedValue({
			x: 0,
			y: 0,
			width: 20,
			height: 20,
		});
		const entry = makeEntry({
			name: "selector-shot",
			width: 800,
			height: 600,
			cropSelector: ".tiny",
		});

		await expect(captureEntry(entry, deps)).resolves.toBeUndefined();
	});
});

describe("captureEntry — cleanliness assert (rubric P7)", () => {
	function cdpWithProbe(probe: {
		selectors: string[];
		text: string[];
	}) {
		const cdp = makeMockCdp();
		cdp.evaluate = vi.fn().mockImplementation((expr: string) =>
			typeof expr === "string" && expr.includes("__cleanliness_probe__")
				? Promise.resolve(probe)
				: Promise.resolve(undefined),
		);
		return cdp;
	}

	it("throws when a forbidden element is visible (error overlay), before capture", async () => {
		const cdp = cdpWithProbe({
			selectors: [".agent-client-error-overlay"],
			text: [],
		});
		const deps = makeDeps({ cdp: cdp as unknown as OrchestratorDeps["cdp"] });
		const entry = makeEntry({ name: "dirty-error" });

		await expect(captureEntry(entry, deps)).rejects.toThrow(/cleanliness/i);
		// fails before the capture (no wasted screenshot) and before the guard
		expect(cdp.screenshot).not.toHaveBeenCalled();
		expect(deps.unlink).not.toHaveBeenCalled();
	});

	it("throws when a forbidden internal-name string is present (leak guard)", async () => {
		const cdp = cdpWithProbe({ selectors: [], text: ["Auto-SA"] });
		const deps = makeDeps({ cdp: cdp as unknown as OrchestratorDeps["cdp"] });
		const entry = makeEntry({ name: "leaky" });

		await expect(captureEntry(entry, deps)).rejects.toThrow(
			/cleanliness|forbidden text/i,
		);
		expect(cdp.screenshot).not.toHaveBeenCalled();
	});

	it("runs the probe and captures when the frame is clean", async () => {
		const cdp = cdpWithProbe({ selectors: [], text: [] });
		const deps = makeDeps({ cdp: cdp as unknown as OrchestratorDeps["cdp"] });
		const entry = makeEntry({ name: "clean" });

		await expect(captureEntry(entry, deps)).resolves.toBeUndefined();
		const exprs = (cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		expect(exprs.some((e) => e.includes("__cleanliness_probe__"))).toBe(true);
		expect(cdp.screenshot).toHaveBeenCalledTimes(1);
	});

	it("runs the cleanliness probe for screen-mode entries too", async () => {
		const cdp = cdpWithProbe({
			selectors: [".agent-client-tab-error"],
			text: [],
		});
		const deps = makeDeps({ cdp: cdp as unknown as OrchestratorDeps["cdp"] });
		const entry = makeEntry({
			name: "screen-dirty",
			captureMode: "screen",
			crop: { x: 0, y: 0, width: 100, height: 50 },
			width: 100,
			height: 50,
		});

		await expect(captureEntry(entry, deps)).rejects.toThrow(/cleanliness/i);
		expect(cdp.screenCaptureRegion).not.toHaveBeenCalled();
	});
});


describe("captureEntry — settings / native select (switch-default-agent)", () => {
	it("opens the settings tab when initialState.openSettings is set", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			initialState: { openSettings: "agent-console" },
		});

		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		expect(
			evals.some(
				(e) =>
					e.includes("app.setting.open()") &&
					e.includes('openTabById("agent-console")'),
			),
		).toBe(true);
	});

	it("opens the native select via focusWindow then openNativeSelect, before screen capture", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			captureMode: "screen",
			initialState: {
				openSettings: "agent-console",
				openNativeSelect: ".vertical-tab-content select",
			},
		});

		await captureEntry(entry, deps);

		expect(deps.cdp.focusWindow).toHaveBeenCalled();
		expect(deps.cdp.openNativeSelect).toHaveBeenCalledWith(
			".vertical-tab-content select",
		);
		const focusOrder = (deps.cdp.focusWindow as ReturnType<typeof vi.fn>).mock
			.invocationCallOrder[0];
		const openOrder = (deps.cdp.openNativeSelect as ReturnType<typeof vi.fn>)
			.mock.invocationCallOrder[0];
		const capOrder = (deps.cdp.screenCaptureRegion as ReturnType<typeof vi.fn>)
			.mock.invocationCallOrder[0];
		// focus must precede the showPicker open, which must precede the capture.
		expect(focusOrder).toBeLessThan(openOrder);
		expect(openOrder).toBeLessThan(capOrder);
	});

	it("does not idle-wait on the loading indicator for a no-prompt screen-mode settings shot", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			captureMode: "screen",
			initialState: {
				openSettings: "agent-console",
				openNativeSelect: ".vertical-tab-content select",
			},
		});

		await captureEntry(entry, deps);

		// With no prompt there is no chat panel / loading indicator; the I09
		// idle-wait must be skipped or it would hang to timeout.
		const waitCalls = (
			deps.cdp.waitForElement as ReturnType<typeof vi.fn>
		).mock.calls.map((c: unknown[]) => c[0] as string);
		expect(waitCalls.some((sel) => sel.includes("loading-indicator"))).toBe(
			false,
		);
		expect(deps.cdp.screenCaptureRegion).toHaveBeenCalledTimes(1);
	});
});

describe("captureEntry — awaitSelector (paused-state shots, e.g. edit permission card)", () => {
	it("waits for awaitSelector (active-panel scoped) and SKIPS the two-phase completion wait (window mode)", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			promptFile: "editing.txt",
			awaitSelector: ".agent-client-message-permission-request",
		});

		await captureEntry(entry, deps);

		const waitMock = deps.cdp.waitForElement as ReturnType<typeof vi.fn>;
		const calls = waitMock.mock.calls.map((cc: unknown[]) => cc[0] as string);
		// Waits for the awaited element (the subject of the shot).
		expect(
			calls.some((s) => s.includes(".agent-client-message-permission-request")),
		).toBe(true);
		// The turn pauses at the permission card and never completes, so the
		// two-phase wait (assistant element + indicator-hidden) must be SKIPPED
		// — the indicator-hidden wait would hang on a paused turn.
		expect(
			calls.some((s) => s.includes("agent-client-message-assistant")),
		).toBe(false);
		expect(
			calls.some((s) =>
				s.includes("agent-client-loading-indicator.agent-client-hidden"),
			),
		).toBe(false);
	});

	it("scrolls the awaited element into view (not transcript-to-top) before capture", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			promptFile: "editing.txt",
			awaitSelector: ".agent-client-message-permission-request",
		});

		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(cc: unknown[]) => cc[0] as string,
		);
		// The paused-state subject is at the transcript bottom — scrollIntoView
		// it, never scrollTop = 0 (which would push it off-screen).
		expect(
			evals.some(
				(e) =>
					e.includes("scrollIntoView") &&
					e.includes(".agent-client-message-permission-request"),
			),
		).toBe(true);
		expect(evals.some((e) => e.includes("scrollTop = 0"))).toBe(false);
	});
});

describe("captureEntry — agentId override + execCommand draft", () => {
	it("sets defaultAgentId to the entry agentId BEFORE opening the session", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			agentId: "gemini-cli",
			initialState: { clickRibbon: true },
		});
		await captureEntry(entry, deps);
		const evalMock = deps.cdp.evaluate as ReturnType<typeof vi.fn>;
		const evals = evalMock.mock.calls.map((c: unknown[]) => c[0] as string);
		const setIdx = evals.findIndex(
			(e) => e.includes("defaultAgentId") && e.includes("gemini-cli"),
		);
		const execMock = deps.cdp.executeCommand as ReturnType<typeof vi.fn>;
		const openIdx = execMock.mock.calls.findIndex(
			(c: unknown[]) => (c[0] as string).includes("open-chat-view"),
		);
		expect(setIdx).toBeGreaterThanOrEqual(0);
		expect(openIdx).toBeGreaterThanOrEqual(0);
		// the agent must be set before the session opens, else the new session
		// connects with the wrong (default) agent.
		expect(evalMock.mock.invocationCallOrder[setIdx]).toBeLessThan(
			execMock.mock.invocationCallOrder[openIdx],
		);
	});

	it("types draftMessage via execCommand insertText (so input-driven menus like slash open)", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ draftMessage: "/" });
		await captureEntry(entry, deps);
		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		// The native-setter+input path does NOT fire React onChange’s slash/mention
		// filter; execCommand insertText delivers a real InputEvent that does.
		expect(
			evals.some((e) => e.includes("execCommand") && e.includes("insertText")),
		).toBe(true);
	});
});

describe("captureEntry — animation (v2)", () => {
	// A sharp mock whose raw decode yields 256 distinct RGB colors, so the
	// per-frame content guard passes; `.png().toBuffer()` returns frame bytes.
	function makeHealthySharp() {
		const healthyRaw = {
			data: Buffer.from(
				Array.from({ length: 256 * 3 }, (_, k) =>
					k % 3 === 0 ? Math.floor(k / 3) : 0,
				),
			),
			info: { width: 16, height: 16, channels: 3 },
		};
		const instance = {
			extract: vi.fn().mockReturnThis(),
			resize: vi.fn().mockReturnThis(),
			extend: vi.fn().mockReturnThis(),
			raw: vi.fn().mockReturnThis(),
			png: vi.fn().mockReturnThis(),
			webp: vi.fn().mockReturnThis(),
			toFile: vi.fn().mockResolvedValue(undefined),
			metadata: vi.fn().mockResolvedValue({ width: 1400, height: 760 }),
			toBuffer: vi
				.fn()
				.mockImplementation((opts?: { resolveWithObject?: boolean }) =>
					opts?.resolveWithObject
						? Promise.resolve(healthyRaw)
						: Promise.resolve(Buffer.from("framepng")),
				),
		};
		return vi.fn().mockReturnValue(instance);
	}

	function animEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
		return makeEntry({
			name: "temporary-disable",
			width: 400,
			height: 300,
			crop: { x: 0, y: 0, width: 800, height: 600 },
			initialState: { openNote: undefined, clickRibbon: true },
			animation: {
				fps: 4,
				maxBytes: 2_000_000,
				frames: [
					{ holdMs: 600 },
					{ actions: [{ type: "click", selector: ".x-remove" }], holdMs: 600 },
					{
						actions: [{ type: "click", selector: ".grab", waitFor: ".pill" }],
						holdMs: 600,
					},
				],
			},
			...overrides,
		});
	}

	it("captures one frame per spec frame and encodes to <name>.gif", async () => {
		const deps = makeDeps({
			sharp: makeHealthySharp() as unknown as OrchestratorDeps["sharp"],
		});
		await captureEntry(animEntry(), deps);

		expect(deps.cdp.screenshot).toHaveBeenCalledTimes(3);
		expect(deps.encodeGif).toHaveBeenCalledTimes(1);
		const opts = (deps.encodeGif as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(opts.frames.length).toBe(3);
		expect(opts.fps).toBe(4);
		expect(String(opts.outPath).endsWith("temporary-disable.gif")).toBe(true);
	});

	it("drives click actions via clickElement and honors waitFor", async () => {
		const deps = makeDeps({
			sharp: makeHealthySharp() as unknown as OrchestratorDeps["sharp"],
		});
		await captureEntry(animEntry(), deps);

		expect(deps.cdp.clickElement).toHaveBeenCalledWith(".x-remove");
		expect(deps.cdp.clickElement).toHaveBeenCalledWith(".grab");
		expect(deps.cdp.waitForElement).toHaveBeenCalledWith(
			".pill",
			expect.any(Number),
		);
	});

	it("draft types via execCommand insertText; wait polls for a selector", async () => {
		const deps = makeDeps({
			sharp: makeHealthySharp() as unknown as OrchestratorDeps["sharp"],
		});
		const entry = animEntry({
			animation: {
				fps: 4,
				maxBytes: 2_000_000,
				frames: [
					{ actions: [{ type: "draft", text: "What changed here?" }], holdMs: 400 },
					{ actions: [{ type: "wait", selector: ".ready" }], holdMs: 400 },
				],
			},
		});
		await captureEntry(entry, deps);

		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		expect(evals.some((e) => e.includes("execCommand"))).toBe(true);
		expect(deps.cdp.waitForElement).toHaveBeenCalledWith(
			".ready",
			expect.any(Number),
		);
	});

	it("rejects a blank/degraded frame via the per-frame content guard (no encode)", async () => {
		// Default makeDeps sharp returns a 1-color raw decode — below the floor.
		const deps = makeDeps();
		await expect(captureEntry(animEntry(), deps)).rejects.toThrow(
			/content guard/,
		);
		expect(deps.encodeGif).not.toHaveBeenCalled();
	});
});

describe("captureEntry — layout overrides (collapseLeftSidebar / rightSplitWidth)", () => {
	it("collapses the left sidebar and forces the right-split width when set", async () => {
		const deps = makeDeps();
		const entry = makeEntry({
			initialState: { clickRibbon: true },
			collapseLeftSidebar: true,
			rightSplitWidth: 680,
		});
		await captureEntry(entry, deps);
		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		expect(evals.some((e) => e.includes("leftSplit.collapse"))).toBe(true);
		expect(
			evals.some((e) => e.includes("mod-right-split") && e.includes("680px")),
		).toBe(true);
	});

	it("skips layout overrides when the knobs are unset", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ initialState: { clickRibbon: true } });
		await captureEntry(entry, deps);
		const evals = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		expect(evals.some((e) => e.includes("leftSplit.collapse"))).toBe(false);
		expect(evals.some((e) => e.includes("mod-right-split"))).toBe(false);
	});
});
