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
		screenshot: vi.fn().mockResolvedValue(undefined),
		setMobileEmulation: vi.fn().mockResolvedValue(undefined),
		getElementBounds: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 100, height: 100 }),
	};
}

function makeMockSharp() {
	const instance = {
		extract: vi.fn().mockReturnThis(),
		resize: vi.fn().mockReturnThis(),
		webp: vi.fn().mockReturnThis(),
		toFile: vi.fn().mockResolvedValue(undefined),
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
		expect(sharpInstance.extract).toHaveBeenCalledWith({ x: 0, y: 0, width: 3200, height: 2400 });
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
		const extractArg = sharpInstance.extract.mock.calls[0][0] as { x: number; y: number; width: number; height: number };
		// floor(10*2)=20, floor(20*2)=40, ceil((10+100)*2)-20=200, ceil((20+50)*2)-40=100
		expect(extractArg.x).toBe(20);
		expect(extractArg.y).toBe(40);
		expect(extractArg.width).toBe(200);
		expect(extractArg.height).toBe(100);
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
