/**
 * Unit tests for useTabPersistence (Slice 5 of
 * [[ACP Tab Persistence Across Restarts]]).
 *
 * Pins the save/restore wiring described in spec § Persistence
 * (Save / Restore) and § Setting.
 *
 * Coverage map (per spec § Unit Tests → U25–U41, 17 tests):
 *
 *   Save triggers (U25–U30)
 *     U25  Save fires on tab add
 *     U26  Save fires on tab close
 *     U27  Save fires on tab reorder
 *     U28  Save fires on active-tab switch
 *     U29  Save fires on tab rename
 *     U30  Save fires on plugin unload (via flushSave)
 *
 *   Save shape (U31–U33)
 *     U31  Serializes per-leaf shape: { leafId, tabs, activeTabId }
 *     U32  Each tab serializes: tabId, agentId, label, sessionId,
 *          tabOrder, scrollPosition
 *     U33  Tab with sessionId: null is saved with explicit null
 *
 *   Restore (U34–U38)
 *     U34  Loads per-leaf state by leafId
 *     U35  Re-creates tabs in saved order with saved labels
 *     U36  Sets activeTabId to the saved active tab
 *     U37  Loads message history for tabs with non-null sessionId
 *     U38  Does NOT call session/load on tab restoration (lazy
 *          reconnect — structurally enforced by adapter type)
 *
 *   Setting + multi-leaf (U39–U41)
 *     U39  Restore-tabs OFF: save is a no-op; data.json untouched
 *     U40  Restore-tabs OFF on restore: opens single fresh tab
 *          (restoredLeafState=null, no storage read)
 *     U41  Two leaves persist independently keyed by leafId
 *
 * Mocking strategy:
 *
 *   - storage adapter is a vi.fn-backed mock matching the
 *     TabPersistenceStorage type. Tests never instantiate
 *     SessionStorage / SettingsService directly — Slice 5's hook is
 *     unit-tested in isolation, decoupled from the persistence
 *     substrate it ultimately wires up.
 *
 *   - getSessionId / getScrollPosition are vi.fn callbacks. The hook
 *     reads them via refs at save-time, not as deps; tests can pass
 *     fresh closures across rerenders without inducing extra saves.
 *
 *   - No fake timers — restore + save are real-async, gated on
 *     waitFor(). The save effect fires synchronously after a render
 *     where the persistence signature changed.
 *
 * Initial-save handling:
 *
 *   The hook fires one save when restoreReady transitions from false
 *   to true (initial state get persisted to disk so subsequent saves
 *   are diffs from a known baseline). Tests that assert "save fires
 *   on Xxx event" mockClear the initial save first, then trigger the
 *   event under test.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
	useTabPersistence,
	type TabPersistenceStorage,
	type UseTabPersistenceProps,
} from "../useTabPersistence";
import type { TabInfo, PerLeafTabState, PersistedTabInfo } from "../../types/tab";

// ============================================================================
// Helpers
// ============================================================================

function makeRuntimeTab(overrides: Partial<TabInfo> = {}): TabInfo {
	return {
		tabId: "T1",
		agentId: "claude-code-acp",
		label: "Tab 1",
		state: "ready",
		createdAt: new Date("2026-05-26T10:00:00Z"),
		...overrides,
	};
}

function makePersistedTab(
	overrides: Partial<PersistedTabInfo> = {},
): PersistedTabInfo {
	return {
		tabId: "T1",
		agentId: "claude-code-acp",
		label: "Tab 1",
		sessionId: "sess-1",
		tabOrder: 0,
		scrollPosition: 0,
		...overrides,
	};
}

type MockStorage = TabPersistenceStorage & {
	saveTabStateForLeaf: ReturnType<typeof vi.fn>;
	loadTabStateForLeaf: ReturnType<typeof vi.fn>;
	loadSessionMessages: ReturnType<typeof vi.fn>;
};

function makeStorage(overrides: Partial<MockStorage> = {}): MockStorage {
	return {
		saveTabStateForLeaf: vi.fn().mockResolvedValue(undefined),
		loadTabStateForLeaf: vi.fn().mockResolvedValue(null),
		loadSessionMessages: vi.fn().mockResolvedValue(null),
		...overrides,
	};
}

function makeProps(
	overrides: Partial<UseTabPersistenceProps> = {},
): UseTabPersistenceProps {
	return {
		leafId: "leaf-1",
		tabs: [makeRuntimeTab()],
		activeTabId: "T1",
		getSessionId: () => null,
		getScrollPosition: () => 0,
		storage: makeStorage(),
		restoreEnabled: true,
		...overrides,
	};
}

/**
 * Spin until the hook's restore-on-mount has settled. All save
 * trigger tests start by waiting for this so the initial save
 * (which fires on restoreReady=true transition) is observable
 * and can be cleared before the test's actual trigger.
 */
async function waitForRestoreReady(
	resultGetter: () => { restoreReady: boolean },
): Promise<void> {
	await waitFor(() => expect(resultGetter().restoreReady).toBe(true));
}

// ============================================================================
// Mock-call helpers — typed wrappers around vi.fn().mock.calls so tests
// don't fall foul of @typescript-eslint/no-unsafe-* rules when reading
// arguments back. The Vitest mock array is loosely typed by default.
// ============================================================================

type SaveCallArgs = [leafId: string, leafState: PerLeafTabState];
type LoadCallArgs = [leafId: string];

function saveCalls(storage: MockStorage): SaveCallArgs[] {
	return storage.saveTabStateForLeaf.mock.calls as SaveCallArgs[];
}

function loadCalls(storage: MockStorage): LoadCallArgs[] {
	return storage.loadTabStateForLeaf.mock.calls as LoadCallArgs[];
}

// ============================================================================
// Save triggers (U25–U30)
// ============================================================================

describe("useTabPersistence — save triggers", () => {
	it("U25: saves on tab add", async () => {
		const storage = makeStorage();
		const initialProps = makeProps({
			tabs: [makeRuntimeTab({ tabId: "T1" })],
			storage,
		});
		const { result, rerender } = renderHook(
			(props: UseTabPersistenceProps) => useTabPersistence(props),
			{ initialProps },
		);

		await waitForRestoreReady(() => result.current);
		storage.saveTabStateForLeaf.mockClear();

		rerender({
			...initialProps,
			tabs: [
				makeRuntimeTab({ tabId: "T1" }),
				makeRuntimeTab({ tabId: "T2", label: "Tab 2" }),
			],
		});

		await waitFor(() =>
			expect(storage.saveTabStateForLeaf).toHaveBeenCalledTimes(1),
		);
		const [leafIdArg, stateArg] =
			saveCalls(storage)[0];
		expect(leafIdArg).toBe("leaf-1");
		expect(stateArg.tabs.map((t: PersistedTabInfo) => t.tabId)).toEqual([
			"T1",
			"T2",
		]);
	});

	it("U26: saves on tab close", async () => {
		const storage = makeStorage();
		const initialProps = makeProps({
			tabs: [
				makeRuntimeTab({ tabId: "T1" }),
				makeRuntimeTab({ tabId: "T2" }),
			],
			storage,
		});
		const { result, rerender } = renderHook(
			(props: UseTabPersistenceProps) => useTabPersistence(props),
			{ initialProps },
		);

		await waitForRestoreReady(() => result.current);
		storage.saveTabStateForLeaf.mockClear();

		rerender({
			...initialProps,
			tabs: [makeRuntimeTab({ tabId: "T1" })],
			activeTabId: "T1",
		});

		await waitFor(() =>
			expect(storage.saveTabStateForLeaf).toHaveBeenCalledTimes(1),
		);
		const [, stateArg] = saveCalls(storage)[0];
		expect(stateArg.tabs.map((t: PersistedTabInfo) => t.tabId)).toEqual([
			"T1",
		]);
	});

	it("U27: saves on tab reorder", async () => {
		const storage = makeStorage();
		const initialProps = makeProps({
			tabs: [
				makeRuntimeTab({ tabId: "T1" }),
				makeRuntimeTab({ tabId: "T2" }),
				makeRuntimeTab({ tabId: "T3" }),
			],
			storage,
		});
		const { result, rerender } = renderHook(
			(props: UseTabPersistenceProps) => useTabPersistence(props),
			{ initialProps },
		);

		await waitForRestoreReady(() => result.current);
		storage.saveTabStateForLeaf.mockClear();

		// Reorder: T1, T2, T3 → T3, T1, T2
		rerender({
			...initialProps,
			tabs: [
				makeRuntimeTab({ tabId: "T3" }),
				makeRuntimeTab({ tabId: "T1" }),
				makeRuntimeTab({ tabId: "T2" }),
			],
		});

		await waitFor(() =>
			expect(storage.saveTabStateForLeaf).toHaveBeenCalledTimes(1),
		);
		const [, stateArg] = saveCalls(storage)[0];
		expect(stateArg.tabs.map((t: PersistedTabInfo) => t.tabId)).toEqual([
			"T3",
			"T1",
			"T2",
		]);
		// tabOrder reflects the new positions
		expect(stateArg.tabs.map((t: PersistedTabInfo) => t.tabOrder)).toEqual([
			0, 1, 2,
		]);
	});

	it("U28: saves on active-tab switch", async () => {
		const storage = makeStorage();
		const initialProps = makeProps({
			tabs: [
				makeRuntimeTab({ tabId: "T1" }),
				makeRuntimeTab({ tabId: "T2" }),
			],
			activeTabId: "T1",
			storage,
		});
		const { result, rerender } = renderHook(
			(props: UseTabPersistenceProps) => useTabPersistence(props),
			{ initialProps },
		);

		await waitForRestoreReady(() => result.current);
		storage.saveTabStateForLeaf.mockClear();

		rerender({ ...initialProps, activeTabId: "T2" });

		await waitFor(() =>
			expect(storage.saveTabStateForLeaf).toHaveBeenCalledTimes(1),
		);
		const [, stateArg] = saveCalls(storage)[0];
		expect(stateArg.activeTabId).toBe("T2");
	});

	it("U29: saves on tab rename", async () => {
		const storage = makeStorage();
		const initialProps = makeProps({
			tabs: [makeRuntimeTab({ tabId: "T1", label: "Original" })],
			storage,
		});
		const { result, rerender } = renderHook(
			(props: UseTabPersistenceProps) => useTabPersistence(props),
			{ initialProps },
		);

		await waitForRestoreReady(() => result.current);
		storage.saveTabStateForLeaf.mockClear();

		rerender({
			...initialProps,
			tabs: [makeRuntimeTab({ tabId: "T1", label: "Renamed" })],
		});

		await waitFor(() =>
			expect(storage.saveTabStateForLeaf).toHaveBeenCalledTimes(1),
		);
		const [, stateArg] = saveCalls(storage)[0];
		expect(stateArg.tabs[0].label).toBe("Renamed");
	});

	it("U30: flushSave triggers save (plugin unload path)", async () => {
		const storage = makeStorage();
		const { result } = renderHook(() =>
			useTabPersistence(
				makeProps({
					tabs: [makeRuntimeTab({ tabId: "T1" })],
					storage,
				}),
			),
		);

		await waitForRestoreReady(() => result.current);
		storage.saveTabStateForLeaf.mockClear();

		await act(async () => {
			await result.current.flushSave();
		});

		expect(storage.saveTabStateForLeaf).toHaveBeenCalledTimes(1);
		const [leafIdArg, stateArg] =
			saveCalls(storage)[0];
		expect(leafIdArg).toBe("leaf-1");
		expect(stateArg.tabs[0].tabId).toBe("T1");
	});
});

// ============================================================================
// Save shape (U31–U33)
// ============================================================================

describe("useTabPersistence — save shape", () => {
	it("U31: serializes per-leaf shape { leafId, tabs, activeTabId }", async () => {
		const storage = makeStorage();
		const { result } = renderHook(() =>
			useTabPersistence(
				makeProps({
					leafId: "leaf-XYZ",
					tabs: [makeRuntimeTab({ tabId: "T1" })],
					activeTabId: "T1",
					storage,
				}),
			),
		);

		await waitForRestoreReady(() => result.current);

		// At least the initial save fired with the correct shape.
		expect(storage.saveTabStateForLeaf).toHaveBeenCalled();
		const [, stateArg] = saveCalls(storage)[0];
		expect(Object.keys(stateArg).sort()).toEqual(
			["activeTabId", "leafId", "tabs"].sort(),
		);
		expect(stateArg.leafId).toBe("leaf-XYZ");
		expect(stateArg.activeTabId).toBe("T1");
		expect(Array.isArray(stateArg.tabs)).toBe(true);
	});

	it("U32: each tab serializes tabId, agentId, label, sessionId, tabOrder, scrollPosition", async () => {
		const storage = makeStorage();
		const { result } = renderHook(() =>
			useTabPersistence(
				makeProps({
					tabs: [
						makeRuntimeTab({
							tabId: "T1",
							agentId: "codex-acp",
							label: "Test label",
						}),
					],
					getSessionId: (id) => (id === "T1" ? "S1-uuid" : null),
					getScrollPosition: (id) => (id === "T1" ? 487 : 0),
					storage,
				}),
			),
		);

		await waitForRestoreReady(() => result.current);

		const [, stateArg] = saveCalls(storage)[0];
		const tab: PersistedTabInfo = stateArg.tabs[0];
		expect(Object.keys(tab).sort()).toEqual(
			[
				"agentId",
				"label",
				"scrollPosition",
				"sessionId",
				"tabId",
				"tabOrder",
			].sort(),
		);
		expect(tab.tabId).toBe("T1");
		expect(tab.agentId).toBe("codex-acp");
		expect(tab.label).toBe("Test label");
		expect(tab.sessionId).toBe("S1-uuid");
		expect(tab.tabOrder).toBe(0);
		expect(tab.scrollPosition).toBe(487);
	});

	it("U33: tab with sessionId === null is saved with explicit null (not undefined)", async () => {
		const storage = makeStorage();
		const { result } = renderHook(() =>
			useTabPersistence(
				makeProps({
					tabs: [makeRuntimeTab({ tabId: "T1" })],
					// Default getSessionId returns null
					storage,
				}),
			),
		);

		await waitForRestoreReady(() => result.current);

		const [, stateArg] = saveCalls(storage)[0];
		const tab: PersistedTabInfo = stateArg.tabs[0];
		// Explicit null — not undefined, not omitted.
		expect(tab.sessionId).toBeNull();
		expect("sessionId" in tab).toBe(true);
	});
});

// ============================================================================
// Restore (U34–U38)
// ============================================================================

describe("useTabPersistence — restore", () => {
	it("U34: loads per-leaf state by leafId", async () => {
		const storage = makeStorage();
		storage.loadTabStateForLeaf.mockResolvedValue({
			leafId: "leaf-1",
			tabs: [],
			activeTabId: "",
		});
		const { result } = renderHook(() =>
			useTabPersistence(
				makeProps({ leafId: "leaf-1", storage }),
			),
		);

		await waitForRestoreReady(() => result.current);

		expect(storage.loadTabStateForLeaf).toHaveBeenCalledWith("leaf-1");
		expect(storage.loadTabStateForLeaf).toHaveBeenCalledTimes(1);
	});

	it("U35: re-creates tabs in saved order with saved labels", async () => {
		const savedTabs = [
			makePersistedTab({ tabId: "T1", label: "Alpha", tabOrder: 0 }),
			makePersistedTab({ tabId: "T2", label: "Beta", tabOrder: 1 }),
			makePersistedTab({ tabId: "T3", label: "Gamma", tabOrder: 2 }),
		];
		const storage = makeStorage();
		storage.loadTabStateForLeaf.mockResolvedValue({
			leafId: "leaf-1",
			tabs: savedTabs,
			activeTabId: "T1",
		});

		const { result } = renderHook(() =>
			useTabPersistence(makeProps({ leafId: "leaf-1", storage })),
		);

		await waitForRestoreReady(() => result.current);

		expect(
			result.current.restoredLeafState?.tabs.map((t) => t.tabId),
		).toEqual(["T1", "T2", "T3"]);
		expect(
			result.current.restoredLeafState?.tabs.map((t) => t.label),
		).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("U36: sets activeTabId to the saved active tab", async () => {
		const storage = makeStorage();
		storage.loadTabStateForLeaf.mockResolvedValue({
			leafId: "leaf-1",
			tabs: [
				makePersistedTab({ tabId: "T1" }),
				makePersistedTab({ tabId: "T2" }),
				makePersistedTab({ tabId: "T3" }),
			],
			activeTabId: "T2",
		});

		const { result } = renderHook(() =>
			useTabPersistence(makeProps({ leafId: "leaf-1", storage })),
		);

		await waitForRestoreReady(() => result.current);

		expect(result.current.restoredLeafState?.activeTabId).toBe("T2");
	});

	it("U37: loads message history for tabs with non-null sessionId", async () => {
		const storage = makeStorage();
		storage.loadTabStateForLeaf.mockResolvedValue({
			leafId: "leaf-1",
			tabs: [
				makePersistedTab({ tabId: "T1", sessionId: "S1" }),
				makePersistedTab({ tabId: "T2", sessionId: null }),
				makePersistedTab({ tabId: "T3", sessionId: "S3" }),
			],
			activeTabId: "T1",
		});
		const t1Messages = [
			{
				id: "m1",
				role: "user" as const,
				content: [{ type: "text" as const, text: "hi" }],
				timestamp: new Date("2026-05-26T10:00:00Z"),
			},
		];
		const t3Messages = [
			{
				id: "m2",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "hello" }],
				timestamp: new Date("2026-05-26T10:01:00Z"),
			},
		];
		storage.loadSessionMessages.mockImplementation(async (id: string) => {
			if (id === "S1") return t1Messages;
			if (id === "S3") return t3Messages;
			return null;
		});

		const { result } = renderHook(() =>
			useTabPersistence(makeProps({ leafId: "leaf-1", storage })),
		);

		await waitForRestoreReady(() => result.current);

		// Called for tabs with non-null sessionId, NOT for the null one.
		expect(storage.loadSessionMessages).toHaveBeenCalledWith("S1");
		expect(storage.loadSessionMessages).toHaveBeenCalledWith("S3");
		expect(storage.loadSessionMessages).not.toHaveBeenCalledWith(null);
		expect(storage.loadSessionMessages).toHaveBeenCalledTimes(2);

		// Restored messages keyed by tabId, with T2 absent.
		expect(result.current.restoredMessages).toEqual({
			T1: t1Messages,
			T3: t3Messages,
		});
		expect("T2" in result.current.restoredMessages).toBe(false);
	});

	it("U38: does NOT call session/load on tab restoration (structural enforcement)", async () => {
		// The TabPersistenceStorage interface contains only:
		//   - saveTabStateForLeaf
		//   - loadTabStateForLeaf
		//   - loadSessionMessages
		//
		// No session-acquisition primitive (no `sessionLoad`,
		// no `sessionNew`). Lazy reconnect on first keystroke is owned
		// by useLazySession (Slice 3); useTabPersistence only handles
		// data wiring.
		//
		// This test verifies the runtime behavior matches the type-level
		// guarantee: after restore completes, the only adapter calls
		// are loadTabStateForLeaf (always once) and loadSessionMessages
		// (per non-null sessionId). No connection establishment happens.
		const storage = makeStorage();
		storage.loadTabStateForLeaf.mockResolvedValue({
			leafId: "leaf-1",
			tabs: [
				makePersistedTab({ tabId: "T1", sessionId: "S1" }),
				makePersistedTab({ tabId: "T2", sessionId: null }),
			],
			activeTabId: "T1",
		});
		storage.loadSessionMessages.mockResolvedValue([]);

		const { result } = renderHook(() =>
			useTabPersistence(makeProps({ leafId: "leaf-1", storage })),
		);

		await waitForRestoreReady(() => result.current);

		// loadTabStateForLeaf called exactly once during restore.
		expect(storage.loadTabStateForLeaf).toHaveBeenCalledTimes(1);
		// loadSessionMessages called exactly once (only T1 has sessionId).
		expect(storage.loadSessionMessages).toHaveBeenCalledTimes(1);
		expect(storage.loadSessionMessages).toHaveBeenCalledWith("S1");
		// Save fired once (initial-state save). No session-acquisition
		// methods exist on the adapter — restore was purely a data load.
	});
});

// ============================================================================
// Setting + multi-leaf (U39–U41)
// ============================================================================

describe("useTabPersistence — setting + multi-leaf", () => {
	it("U39: restore-tabs OFF — save is a no-op", async () => {
		const storage = makeStorage();
		const initialProps = makeProps({
			restoreEnabled: false,
			tabs: [makeRuntimeTab({ tabId: "T1" })],
			storage,
		});
		const { result, rerender } = renderHook(
			(props: UseTabPersistenceProps) => useTabPersistence(props),
			{ initialProps },
		);

		await waitForRestoreReady(() => result.current);

		// No save fired during initial restore (restoreEnabled=false).
		expect(storage.saveTabStateForLeaf).not.toHaveBeenCalled();

		// Now trigger what would normally be a save (tab add).
		rerender({
			...initialProps,
			tabs: [
				makeRuntimeTab({ tabId: "T1" }),
				makeRuntimeTab({ tabId: "T2" }),
			],
		});

		// Wait a tick for any potential save to land.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(storage.saveTabStateForLeaf).not.toHaveBeenCalled();

		// flushSave should also be a no-op.
		await act(async () => {
			await result.current.flushSave();
		});
		expect(storage.saveTabStateForLeaf).not.toHaveBeenCalled();
	});

	it("U40: restore-tabs OFF on restore — opens single fresh tab (no storage read)", async () => {
		const storage = makeStorage();
		const { result } = renderHook(() =>
			useTabPersistence(
				makeProps({
					restoreEnabled: false,
					tabs: [makeRuntimeTab({ tabId: "T1" })],
					storage,
				}),
			),
		);

		await waitForRestoreReady(() => result.current);

		// restoredLeafState is null — caller opens a single fresh tab.
		expect(result.current.restoredLeafState).toBeNull();
		expect(result.current.restoredMessages).toEqual({});
		// data.json untouched: no read happened.
		expect(storage.loadTabStateForLeaf).not.toHaveBeenCalled();
		expect(storage.loadSessionMessages).not.toHaveBeenCalled();
	});

	it("U41: two leaves persist independently keyed by leafId", async () => {
		// Both hooks share the same storage adapter — exactly the
		// real-world setup where two ChatView leaves share the same
		// SessionStorage instance.
		const storage = makeStorage();

		const { result: leaf1Result } = renderHook(() =>
			useTabPersistence(
				makeProps({
					leafId: "leaf-A",
					tabs: [
						makeRuntimeTab({
							tabId: "T1A",
							label: "Leaf A Tab",
						}),
					],
					activeTabId: "T1A",
					storage,
				}),
			),
		);
		const { result: leaf2Result } = renderHook(() =>
			useTabPersistence(
				makeProps({
					leafId: "leaf-B",
					tabs: [
						makeRuntimeTab({
							tabId: "T1B",
							label: "Leaf B Tab",
						}),
					],
					activeTabId: "T1B",
					storage,
				}),
			),
		);

		await waitForRestoreReady(() => leaf1Result.current);
		await waitForRestoreReady(() => leaf2Result.current);

		// Each leaf's initial save fired with its own leafId.
		const calls = saveCalls(storage);
		const leafIds = calls.map((c) => c[0]);
		expect(leafIds).toContain("leaf-A");
		expect(leafIds).toContain("leaf-B");

		// The leaf-A save's payload references leaf-A only (not leaf-B).
		const leafACall = calls.find((c) => c[0] === "leaf-A");
		expect(leafACall?.[1].leafId).toBe("leaf-A");
		expect(leafACall?.[1].tabs[0].tabId).toBe("T1A");
		expect(leafACall?.[1].tabs[0].label).toBe("Leaf A Tab");

		// Likewise leaf-B's save references leaf-B only.
		const leafBCall = calls.find((c) => c[0] === "leaf-B");
		expect(leafBCall?.[1].leafId).toBe("leaf-B");
		expect(leafBCall?.[1].tabs[0].tabId).toBe("T1B");
		expect(leafBCall?.[1].tabs[0].label).toBe("Leaf B Tab");

		// Each loadTabStateForLeaf call used its own leafId.
		const loadLeafIds = loadCalls(storage).map((c) => c[0]);
		expect(loadLeafIds).toContain("leaf-A");
		expect(loadLeafIds).toContain("leaf-B");
	});
});
