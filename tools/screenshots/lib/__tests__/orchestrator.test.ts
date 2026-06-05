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

// --- Helpers ---

function makeFixtureRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), "orch-test-"));
	mkdirSync(path.join(root, "vault"), { recursive: true });
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
		clickElement: vi.fn().mockResolvedValue(undefined),
		waitForElement: vi.fn().mockResolvedValue(undefined),
		hoverElement: vi.fn().mockResolvedValue(undefined),
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

	it("clicks ribbon when initialState.clickRibbon is true", async () => {
		const deps = makeDeps();
		const entry = makeEntry({ initialState: { clickRibbon: true } });

		await captureEntry(entry, deps);

		expect(deps.cdp.clickElement).toHaveBeenCalled();
		const selector = (deps.cdp.clickElement as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(selector).toContain("agent-console");
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

		expect(deps.cdp.evaluate).toHaveBeenCalled();
		const calls = (deps.cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls;
		const chatCall = calls.find((c: string[]) => (c[0] as string).includes("agent-console"));
		expect(chatCall).toBeDefined();
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
		const newTabCalls = evals.filter((e) => e.includes("new-session-tab"));
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
		const entry = makeEntry({ crop: { x: 10, y: 20, width: 100, height: 50 } });

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
