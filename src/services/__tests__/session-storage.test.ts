/**
 * Unit tests for SessionStorage tab-state methods (Slice 4 of
 * [[ACP Tab Persistence Across Restarts]]).
 *
 * Slice 4 EXTENDS the existing SessionStorage service with three new
 * public methods that persist per-leaf tab state to `data.json` via the
 * SettingsAccess facade:
 *
 *   saveTabState(perLeafStates: PerLeafTabState[]): Promise<void>
 *     Replaces the current tab-state in `data.json` wholesale.
 *
 *   loadTabState(): Promise<PerLeafTabState[] | null>
 *     Corruption-tolerant; returns null on missing / malformed /
 *     schema-violating state. Does NOT throw. Does NOT delete the
 *     corrupted data — preservation is the user's recovery path
 *     (spec § Corruption handling).
 *
 *   discardTabState(): Promise<void>
 *     Clears only the tab-state portion of `data.json`; leaves
 *     session-message storage and other settings untouched. Used by
 *     the corruption-recovery modal's "Discard saved state" action and
 *     by the setting toggle when the user explicitly opts out.
 *
 * Coverage map (per spec § Unit Tests → U42–U48):
 *
 *   loadTabState
 *     U42  Returns null when data.json's tab-state field is missing
 *     U43  Returns null when data.json's tab-state is malformed JSON
 *          (read at the in-memory snapshot level: not an array)
 *     U44  Returns null when data.json's tab-state contains records
 *          missing required fields (outer leaf-state and inner tab
 *          shapes both validated)
 *     U45  Does NOT throw on corruption (caller handles null)
 *     U46  Preserves the corrupted data on disk; loadTabState is
 *          read-only and does NOT auto-clear the bad value
 *
 *   discardTabState
 *     U47  Clears only the tab-state portion of data.json; other
 *          settings (savedSessions, defaultAgentId) untouched
 *
 *   Round-trip
 *     U48  saveTabState → loadTabState returns the same shape
 *
 * Architecture notes:
 *
 *   The new methods access tab state through `settingsAccess` (the
 *   plugin's settings facade), NOT direct file I/O. Plugin settings
 *   are loaded once at boot via Obsidian's `loadData()`; thereafter
 *   `getSnapshot()` returns the in-memory state and `updateSettings()`
 *   merges + persists. Tests mock `settingsAccess` with an in-memory
 *   fake — no Obsidian runtime needed.
 *
 *   Per-session message history (loadSessionMessages / saveSessionMessages)
 *   is a separate concern stored in `sessions/{id}.json` files; this
 *   slice does not touch those.
 */

import { describe, it, expect, vi } from "vitest";
import { SessionStorage } from "../session-storage";
import type { AgentClientPluginSettings } from "../../plugin";
import type AgentClientPlugin from "../../plugin";
import type {
	PerLeafTabState,
	PersistedTabInfo,
} from "../../types/tab";

// ============================================================================
// Fixtures
// ============================================================================

function makeValidPersistedTab(
	overrides: Partial<PersistedTabInfo> = {},
): PersistedTabInfo {
	return {
		tabId: "tab-1",
		agentId: "claude-code-acp",
		label: "Tab 1",
		sessionId: "sess-abc",
		tabOrder: 0,
		scrollPosition: 0,
		...overrides,
	};
}

function makeValidPerLeafState(
	overrides: Partial<PerLeafTabState> = {},
): PerLeafTabState {
	return {
		leafId: "leaf-1",
		tabs: [makeValidPersistedTab()],
		activeTabId: "tab-1",
		...overrides,
	};
}

/**
 * Mutable in-memory fake of the SettingsAccess facade.
 *
 * Mirrors the contract used by SessionStorage internally:
 *   - getSnapshot() returns the current in-memory state
 *   - updateSettings(partial) merges partial updates into the state
 *
 * Test-only helpers (`_get`, `_set`) allow tests to inspect or seed
 * the state without going through the public surface.
 */
function makeFakeSettings(initial: Partial<AgentClientPluginSettings> = {}) {
	let state: AgentClientPluginSettings = {
		// Only fields touched (or asserted) by the tab-state tests are
		// populated. Other required fields aren't used by these methods,
		// so we stub via cast — keeps fixtures focused on the
		// tab-state surface.
		savedSessions: [],
		defaultAgentId: "claude-code-acp",
		...initial,
	} as unknown as AgentClientPluginSettings;

	return {
		getSnapshot(): AgentClientPluginSettings {
			return state;
		},
		async updateSettings(
			updates: Partial<AgentClientPluginSettings>,
		): Promise<void> {
			state = { ...state, ...updates };
		},
		_get(): AgentClientPluginSettings {
			return state;
		},
		_set(updates: Partial<AgentClientPluginSettings>): void {
			state = { ...state, ...updates };
		},
	};
}

/**
 * Minimal AgentClientPlugin stub.
 *
 * SessionStorage's tab-state methods never touch `plugin.app.vault.adapter`
 * — they go through `settingsAccess`. A bare object satisfies the
 * constructor's type contract.
 */
const fakePlugin = {} as unknown as AgentClientPlugin;

// ============================================================================
// Tests
// ============================================================================

describe("SessionStorage tab-state methods", () => {
	describe("loadTabState — corruption tolerance (U42–U46)", () => {
		it("U42 — returns null when perLeafTabStates is undefined", async () => {
			const settings = makeFakeSettings();
			const storage = new SessionStorage(fakePlugin, settings);

			const result = await storage.loadTabState();

			expect(result).toBeNull();
		});

		it("U43 — returns null when perLeafTabStates is not an array", async () => {
			const settings = makeFakeSettings();
			// Force a malformed value past the type system. Real-world
			// cause: hand-edited data.json or a loadData parser bug.
			settings._set({
				perLeafTabStates: "not an array" as unknown as PerLeafTabState[],
			});
			const storage = new SessionStorage(fakePlugin, settings);

			const result = await storage.loadTabState();

			expect(result).toBeNull();
		});

		it("U44 — returns null when records are missing required fields", async () => {
			// Cover both outer (leaf-state) and inner (tab) shape
			// violations. Each sub-case is independently invalid; any
			// single violation in any record is enough to invalidate
			// the entire load (whole-file pessimism).
			const cases: Array<{ name: string; value: unknown }> = [
				{
					name: "leaf-state missing tabs",
					value: [{ leafId: "L1", activeTabId: "T1" }],
				},
				{
					name: "leaf-state missing activeTabId",
					value: [{ leafId: "L1", tabs: [] }],
				},
				{
					name: "leaf-state with non-string leafId",
					value: [{ leafId: 42, tabs: [], activeTabId: "T1" }],
				},
				{
					name: "tab missing label",
					value: [
						{
							leafId: "L1",
							activeTabId: "T1",
							tabs: [
								{
									tabId: "T1",
									agentId: "A1",
									sessionId: null,
									tabOrder: 0,
									scrollPosition: 0,
								},
							],
						},
					],
				},
				{
					name: "tab with non-string tabId",
					value: [
						{
							leafId: "L1",
							activeTabId: "T1",
							tabs: [
								{
									tabId: 42,
									agentId: "A1",
									label: "x",
									sessionId: null,
									tabOrder: 0,
									scrollPosition: 0,
								},
							],
						},
					],
				},
				{
					name: "tab with non-null non-string sessionId",
					value: [
						{
							leafId: "L1",
							activeTabId: "T1",
							tabs: [
								{
									tabId: "T1",
									agentId: "A1",
									label: "x",
									sessionId: 42,
									tabOrder: 0,
									scrollPosition: 0,
								},
							],
						},
					],
				},
				{
					name: "tab with non-number tabOrder",
					value: [
						{
							leafId: "L1",
							activeTabId: "T1",
							tabs: [
								{
									tabId: "T1",
									agentId: "A1",
									label: "x",
									sessionId: null,
									tabOrder: "0",
									scrollPosition: 0,
								},
							],
						},
					],
				},
			];

			for (const { name, value } of cases) {
				const settings = makeFakeSettings();
				settings._set({
					perLeafTabStates: value as PerLeafTabState[],
				});
				const storage = new SessionStorage(fakePlugin, settings);

				const result = await storage.loadTabState();

				expect(result, `case: ${name}`).toBeNull();
			}
		});

		it("U45 — does NOT throw on any corrupted shape", async () => {
			// Different from U44: U44 cares about the null return; U45
			// cares about the no-throw invariant across a wider variety
			// of pathological inputs (primitives, weird arrays, etc.).
			const corruptedShapes: unknown[] = [
				42,
				"string",
				{ not: "array" },
				[null],
				[undefined],
				[42],
				[{ leafId: 123 }],
				[
					{
						leafId: "L1",
						activeTabId: "T1",
						tabs: "not an array",
					},
				],
			];

			for (const shape of corruptedShapes) {
				const settings = makeFakeSettings();
				settings._set({
					perLeafTabStates: shape as PerLeafTabState[],
				});
				const storage = new SessionStorage(fakePlugin, settings);

				await expect(storage.loadTabState()).resolves.toBeNull();
			}
		});

		it("U46 — preserves the corrupted data in the snapshot (does NOT auto-clear)", async () => {
			// Spec § Corruption handling: "The corrupted state is preserved
			// in `data.json` until the user explicitly discards it —
			// automatic deletion would silently lose recoverable data."
			//
			// loadTabState is read-only and never mutates the snapshot.
			// The corrupted value remains on disk so the recovery modal's
			// "View details" action can show it to the user.
			const corrupted = "not an array" as unknown as PerLeafTabState[];
			const settings = makeFakeSettings();
			settings._set({ perLeafTabStates: corrupted });
			const storage = new SessionStorage(fakePlugin, settings);

			const result = await storage.loadTabState();

			expect(result).toBeNull();
			// The corrupted value is still in the snapshot — caller
			// must invoke discardTabState() explicitly to clear it.
			expect(settings._get().perLeafTabStates).toBe(corrupted);
		});
	});

	describe("discardTabState (U47)", () => {
		it("U47 — clears tab-state but leaves other settings untouched", async () => {
			const initialTabState: PerLeafTabState[] = [makeValidPerLeafState()];
			const initialSavedSessions = [
				{
					sessionId: "sess-1",
					agentId: "claude-code-acp",
					cwd: "/some/path",
					title: "A session",
					createdAt: "2026-05-26T00:00:00Z",
					updatedAt: "2026-05-26T00:00:00Z",
				},
			];

			const settings = makeFakeSettings({
				perLeafTabStates: initialTabState,
				savedSessions: initialSavedSessions,
				defaultAgentId: "claude-code-acp",
			});
			const storage = new SessionStorage(fakePlugin, settings);

			await storage.discardTabState();

			const after = settings._get();
			// Tab-state portion is cleared (undefined matches the
			// "field absent" semantics used by U42).
			expect(after.perLeafTabStates).toBeUndefined();
			// Other settings are untouched.
			expect(after.savedSessions).toEqual(initialSavedSessions);
			expect(after.defaultAgentId).toBe("claude-code-acp");
		});
	});

	describe("Round-trip (U48)", () => {
		it("U48 — saveTabState → loadTabState returns the same shape", async () => {
			// Lossless round-trip across all field types in PersistedTabInfo:
			//   - sessionId: string and explicit null (U33)
			//   - multiple tabs in display order
			//   - multiple leaves with independent state
			//   - non-default scrollPosition and agentId
			const input: PerLeafTabState[] = [
				{
					leafId: "leaf-1",
					tabs: [
						makeValidPersistedTab({ tabId: "t1", tabOrder: 0 }),
						makeValidPersistedTab({
							tabId: "t2",
							tabOrder: 1,
							sessionId: null,
						}),
					],
					activeTabId: "t1",
				},
				{
					leafId: "leaf-2",
					tabs: [
						makeValidPersistedTab({
							tabId: "t3",
							agentId: "codex-acp",
							scrollPosition: 1234,
						}),
					],
					activeTabId: "t3",
				},
			];

			const settings = makeFakeSettings();
			const storage = new SessionStorage(fakePlugin, settings);

			await storage.saveTabState(input);
			const loaded = await storage.loadTabState();

			expect(loaded).not.toBeNull();
			expect(loaded).toEqual(input);
		});
	});
});

/**
 * Unit tests for SessionStorage context-note persistence (T13).
 *
 * Covers the round-trip that makes crystallized pills survive a restart:
 * saveSessionMessages(..., contextNotes) -> loadSessionContextNotes().
 */
import type { ContextNote } from "../../types/context";
import type { ChatMessage } from "../../types/chat";

function makeStorage() {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	const adapter = {
		exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
		mkdir: vi.fn(async (p: string) => {
			dirs.add(p);
		}),
		write: vi.fn(async (p: string, data: string) => {
			files.set(p, data);
		}),
		read: vi.fn(async (p: string) => {
			const v = files.get(p);
			if (v === undefined) throw new Error(`not found: ${p}`);
			return v;
		}),
		remove: vi.fn(async (p: string) => {
			files.delete(p);
		}),
	};
	const plugin = {
		app: { vault: { adapter, configDir: "test-config" } },
		manifest: { id: "agent-console" },
	};
	const settingsAccess = { getSnapshot: vi.fn(), updateSettings: vi.fn() };
	return new SessionStorage(
		plugin as unknown as ConstructorParameters<typeof SessionStorage>[0],
		settingsAccess,
	);
}

const msg: ChatMessage = {
	id: "1",
	role: "user",
	content: [{ type: "text", text: "hi" }],
	timestamp: new Date(),
};

describe("SessionStorage context-note persistence", () => {
	it("round-trips crystallized notes via the session file", async () => {
		const storage = makeStorage();
		const notes: ContextNote[] = [
			{ path: "Design Doc.md", source: "user", seen: false },
			{ path: "API Spec.md", source: "mention", seen: false },
		];
		await storage.saveSessionMessages("sess-1", "agent-1", [msg], notes);
		expect(await storage.loadSessionContextNotes("sess-1")).toEqual(notes);
	});

	it("persists an empty array when no notes are supplied", async () => {
		const storage = makeStorage();
		await storage.saveSessionMessages("sess-2", "agent-1", [msg]);
		expect(await storage.loadSessionContextNotes("sess-2")).toEqual([]);
	});

	it("returns null for a session with no saved file", async () => {
		const storage = makeStorage();
		expect(await storage.loadSessionContextNotes("missing")).toBeNull();
	});
});

describe("SessionStorage context-note sanitize-on-load (restore boundary)", () => {
	// Both restore entry points (useSessionHistory.restoreSession + forkSession)
	// call loadSessionContextNotes, so sanitizing here guards every restore path.
	it("drops duplicate and malformed entries persisted on disk", async () => {
		const storage = makeStorage();
		const corrupt = [
			{ path: "A.md", source: "user", seen: false },
			{ path: "A.md", source: "mention", seen: false }, // duplicate path
			{ path: "", source: "user", seen: false }, // empty path
			{ path: "B.md", source: "bogus", seen: false }, // bad source
		] as unknown as ContextNote[];
		await storage.saveSessionMessages("sess-corrupt", "agent-1", [msg], corrupt);
		const loaded = await storage.loadSessionContextNotes("sess-corrupt");
		expect(loaded?.map((n) => n.path)).toEqual(["A.md"]);
	});
});

// ============================================================================
// I72 — saveSessionMessages write durability
//
// Today saveSessionMessages calls adapter.write exactly once with no
// try/catch, and every caller invokes it via `void`, so a rejected write is
// swallowed silently with no trace — the most likely cause of the missing
// session files behind I72. The write must retry on transient failure and,
// when it ultimately fails, surface the loss to the log rather than swallow it.
// ============================================================================

describe("SessionStorage saveSessionMessages write durability (I72)", () => {
	function makeStorageWithWrite(write: ReturnType<typeof vi.fn>) {
		const files = new Map<string, string>();
		const dirs = new Set<string>();
		const adapter = {
			exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
			mkdir: vi.fn(async (p: string) => {
				dirs.add(p);
			}),
			write,
			read: vi.fn(async (p: string) => {
				const v = files.get(p);
				if (v === undefined) throw new Error(`not found: ${p}`);
				return v;
			}),
			remove: vi.fn(async (p: string) => {
				files.delete(p);
			}),
		};
		const plugin = {
			app: { vault: { adapter, configDir: "test-config" } },
			manifest: { id: "agent-console" },
		};
		const settingsAccess = { getSnapshot: vi.fn(), updateSettings: vi.fn() };
		return new SessionStorage(
			plugin as unknown as ConstructorParameters<typeof SessionStorage>[0],
			settingsAccess,
		);
	}

	it("retries and succeeds when the first write fails transiently", async () => {
		let calls = 0;
		const write = vi.fn(async () => {
			calls += 1;
			if (calls === 1) throw new Error("EAGAIN transient");
		});
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const storage = makeStorageWithWrite(write);

		await expect(
			storage.saveSessionMessages("sess-retry", "agent-1", [msg]),
		).resolves.toBeUndefined();

		// Failed once, retried, succeeded — no error-level log for a
		// recovered transient failure.
		expect(write).toHaveBeenCalledTimes(2);
		expect(errorSpy).not.toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("logs an error (not silently swallowed) when every write attempt fails", async () => {
		const write = vi.fn(async () => {
			throw new Error("EROFS persistent");
		});
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const storage = makeStorageWithWrite(write);

		// Does not throw into the void-calling caller…
		await expect(
			storage.saveSessionMessages("sess-fail", "agent-1", [msg]),
		).resolves.toBeUndefined();

		// …but the failure is surfaced to the log, with the sessionId, not
		// swallowed without a trace.
		expect(write).toHaveBeenCalledTimes(2);
		expect(errorSpy).toHaveBeenCalled();
		const logged = errorSpy.mock.calls.flat().join(" ");
		expect(logged).toContain("sess-fail");
		errorSpy.mockRestore();
	});
});
