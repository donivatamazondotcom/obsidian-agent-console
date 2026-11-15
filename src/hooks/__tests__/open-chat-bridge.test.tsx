/**
 * Chat ID — the per-panel open-chat bridge ([[Agent Console Chat ID]], D12).
 *
 * - T34: a bridge taken before a rerender that adds a tab sees that tab, in
 *   `boundChatIds()` and in `openFromHistory`'s in-panel check.
 * - T14 (hook half): `switchTo` activates a tab that holds the chat, with no
 *   new tab.
 * - T21 (hook half): a panel brought back with the chat's tab (restored, not
 *   yet reported) switches to it; exactly one tab holds the chat.
 * - T30 (hook half): the same, with saved tab state from before I269 (no
 *   record id, only the agent session id).
 * - T31 (hook half): a restored tab that ran New chat isn't selected by a
 *   link to its old chat; the chat opens in a new tab instead.
 *
 * Seams (R2): the real `useOpenChatBridge` over a real `useTabManager`, with
 * the binding reports fed through the real `applyRecordIdReport` and read
 * through the real `resolveRecordIdForSave`, as ChatView wires them.
 * `openRecordInTab` is ChatView's inner function (no harness, D12); the fake
 * here adds a restored tab through the real tab manager, as ChatView does.
 *
 * Assertions (R3): the tab list, the active tab and the open result.
 * Literals (R5).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef } from "react";

import { useOpenChatBridge } from "../useOpenChatBridge";
import { useTabManager } from "../useTabManager";
import {
	applyRecordIdReport,
	resolveRecordIdForSave,
} from "../../services/session-helpers";
import type { SavedSessionInfo } from "../../types/session";
import type { TabInfo } from "../../types/tab";
import type { OpenChatBridge, OpenRecordResult } from "../../types/chat-link";

function record(recordId: string, sessionId: string): SavedSessionInfo {
	return {
		recordId,
		sessionId,
		agentId: "kiro",
		cwd: "/vault",
		title: `Chat ${recordId}`,
		createdAt: "2026-11-02T09:00:00.000Z",
		updatedAt: "2026-11-02T09:05:00.000Z",
	};
}

function restoredTab(tabId: string, label: string): TabInfo {
	return {
		tabId,
		agentId: "kiro",
		origin: "restored",
		label,
		state: "disconnected",
		createdAt: new Date(0),
	};
}

interface PanelSeed {
	tabs?: TabInfo[];
	activeTabId?: string;
	/** Startup tab state: tab id → record id (what `persistedRecordIdsRef` starts with). */
	persistedRecordIds?: Record<string, string>;
	/** Startup tab state: tab id → agent session id. */
	persistedSessionIds?: Record<string, string>;
	records?: SavedSessionInfo[];
}

/** One chat panel: tab manager, the three id maps and the bridge, as ChatView wires them. */
function mountPanel(seed: PanelSeed = {}) {
	const records = seed.records ?? [];
	const opens: Array<{ sessionId: string; recordId: string }> = [];
	const hook = renderHook(() => {
		const tm = useTabManager("kiro", seed.tabs, seed.activeTabId);
		const tabRecordIdsRef = useRef(new Map<string, string | null>());
		const persistedRecordIdsRef = useRef(
			new Map(Object.entries(seed.persistedRecordIds ?? {})),
		);
		const persistedSessionIdsRef = useRef(
			new Map<string, string | null>(
				Object.entries(seed.persistedSessionIds ?? {}),
			),
		);
		const getRecordIdForTab = useCallback(
			(tabId: string) =>
				resolveRecordIdForSave(
					{
						has: tabRecordIdsRef.current.has(tabId),
						id: tabRecordIdsRef.current.get(tabId) ?? null,
					},
					persistedRecordIdsRef.current.get(tabId) ?? null,
				),
			[],
		);
		// ChatView's openRecordInTab, reduced to its tab effects: a restored
		// tab bound to the clicked record id.
		const openRecordInTab = async (
			sessionId: string,
			_mode: "restore",
			opts: { recordId: string },
		): Promise<OpenRecordResult> => {
			opens.push({ sessionId, recordId: opts.recordId });
			const id = tm.addTab("kiro", `Chat ${opts.recordId}`, true, "restored");
			persistedSessionIdsRef.current.set(id, sessionId);
			persistedRecordIdsRef.current.set(id, opts.recordId);
			return "opened";
		};
		const bridge = useOpenChatBridge({
			tabs: tm.tabs,
			tabRecordIdsRef,
			persistedRecordIdsRef,
			persistedSessionIdsRef,
			getRecordIdForTab,
			setActiveTab: tm.setActiveTab,
			getSavedSessions: () => records,
			openRecordInTab,
		});
		return { tm, bridge, tabRecordIdsRef, persistedRecordIdsRef };
	});
	/** A tab's binding report, as `handleRecordIdChange` applies it. */
	const report = (tabId: string, recordId: string | null) =>
		applyRecordIdReport(
			hook.result.current.tabRecordIdsRef.current,
			hook.result.current.persistedRecordIdsRef.current,
			tabId,
			recordId,
		);
	return { hook, report, opens };
}

describe("useOpenChatBridge — one stable bridge that reads the current tabs (T34)", () => {
	it("keeps one bridge identity across renders", () => {
		const { hook } = mountPanel();
		const first = hook.result.current.bridge;
		act(() => {
			hook.result.current.tm.addTab("kiro");
		});
		expect(hook.result.current.bridge).toBe(first);
	});

	it("a bridge taken before a tab is added sees that tab in boundChatIds()", () => {
		const { hook, report } = mountPanel();
		const held: OpenChatBridge = hook.result.current.bridge;
		let added = "";
		act(() => {
			added = hook.result.current.tm.addTab("kiro");
		});
		report(added, "rec-new");
		expect(held.boundChatIds()).toEqual([{ tabId: added, chatId: "rec-new" }]);
	});

	it("a bridge taken before a tab is added switches to it instead of opening a second", async () => {
		const rec = record("rec-new", "sess-new");
		const { hook, report, opens } = mountPanel({ records: [rec] });
		const held = hook.result.current.bridge;
		const first = hook.result.current.tm.tabs[0].tabId;
		let added = "";
		act(() => {
			added = hook.result.current.tm.addTab("kiro", "New", false);
		});
		report(added, "rec-new");
		let result: OpenRecordResult | undefined;
		await act(async () => {
			result = await held.openFromHistory(rec);
		});
		expect(result).toBe("switched");
		expect(opens).toEqual([]);
		expect(hook.result.current.tm.tabs.map((t) => t.tabId)).toEqual([
			first,
			added,
		]);
		expect(hook.result.current.tm.activeTabId).toBe(added);
	});

	it("reports only live tabs, never a report left for a closed tab", () => {
		const { hook, report } = mountPanel();
		const first = hook.result.current.tm.tabs[0].tabId;
		report(first, "rec-a");
		report("closed-tab", "rec-gone");
		expect(hook.result.current.bridge.boundChatIds()).toEqual([
			{ tabId: first, chatId: "rec-a" },
		]);
	});

	it("skips a tab with no bound ID", () => {
		const { hook, report } = mountPanel();
		report(hook.result.current.tm.tabs[0].tabId, null);
		expect(hook.result.current.bridge.boundChatIds()).toEqual([]);
	});
});

describe("useOpenChatBridge — switchTo (T14 hook half)", () => {
	it("activates the tab that holds the chat, with no new tab", () => {
		const { hook, report } = mountPanel({
			tabs: [restoredTab("a", "A"), restoredTab("b", "B")],
			activeTabId: "a",
		});
		report("a", "rec-a");
		report("b", "rec-b");
		const target = hook.result.current.bridge
			.boundChatIds()
			.find((b) => b.chatId === "rec-b");
		act(() => hook.result.current.bridge.switchTo(target!.tabId));
		expect(hook.result.current.tm.activeTabId).toBe("b");
		expect(hook.result.current.tm.tabs).toHaveLength(2);
	});
});

describe("useOpenChatBridge — openFromHistory's in-panel check", () => {
	it("T21: a tab brought back with the panel, not yet reported, is switched to", async () => {
		const rec = record("rec-x", "sess-x");
		const { hook, opens } = mountPanel({
			tabs: [restoredTab("a", "Other"), restoredTab("b", "Chat X")],
			activeTabId: "a",
			persistedRecordIds: { b: "rec-x" },
			persistedSessionIds: { a: "sess-a", b: "sess-x" },
			records: [rec],
		});
		let result: OpenRecordResult | undefined;
		await act(async () => {
			result = await hook.result.current.bridge.openFromHistory(rec);
		});
		expect(result).toBe("switched");
		expect(opens).toEqual([]);
		expect(hook.result.current.tm.tabs.map((t) => t.tabId)).toEqual([
			"a",
			"b",
		]);
		expect(hook.result.current.tm.activeTabId).toBe("b");
	});

	it("T30: a tab saved before I269 (session id only) is switched to", async () => {
		const rec = record("rec-x", "sess-x");
		const { hook, opens } = mountPanel({
			tabs: [restoredTab("a", "Other"), restoredTab("b", "Chat X")],
			activeTabId: "a",
			persistedSessionIds: { a: "sess-a", b: "sess-x" },
			records: [rec],
		});
		let result: OpenRecordResult | undefined;
		await act(async () => {
			result = await hook.result.current.bridge.openFromHistory(rec);
		});
		expect(result).toBe("switched");
		expect(opens).toEqual([]);
		expect(hook.result.current.tm.tabs).toHaveLength(2);
		expect(hook.result.current.tm.activeTabId).toBe("b");
	});

	it("T31: a restored tab that ran New chat isn't selected; the chat opens in a new tab", async () => {
		const rec = record("rec-x", "sess-x");
		const { hook, report, opens } = mountPanel({
			tabs: [restoredTab("a", "Other"), restoredTab("b", "Was chat X")],
			activeTabId: "a",
			persistedRecordIds: { b: "rec-x" },
			persistedSessionIds: { a: "sess-a", b: "sess-x" },
			records: [rec],
		});
		// Mount report, then New chat's reset.
		report("b", "rec-x");
		report("b", null);
		let result: OpenRecordResult | undefined;
		await act(async () => {
			result = await hook.result.current.bridge.openFromHistory(rec);
		});
		expect(result).toBe("opened");
		expect(opens).toEqual([{ sessionId: "sess-x", recordId: "rec-x" }]);
		const tabs = hook.result.current.tm.tabs;
		expect(tabs).toHaveLength(3);
		expect(hook.result.current.tm.activeTabId).toBe(tabs[2].tabId);
		expect(hook.result.current.tm.activeTabId).not.toBe("b");
	});

	it("passes the latest openRecordInTab, and its result, through", async () => {
		const rec = record("rec-y", "sess-y");
		const { hook, opens } = mountPanel({ records: [rec] });
		let result: OpenRecordResult | undefined;
		await act(async () => {
			result = await hook.result.current.bridge.openFromHistory(rec);
		});
		expect(result).toBe("opened");
		expect(opens).toEqual([{ sessionId: "sess-y", recordId: "rec-y" }]);
		expect(hook.result.current.tm.tabs).toHaveLength(2);
	});
});

describe("useOpenChatBridge — the open result", () => {
	it("returns gone when openRecordInTab reports the record went away", async () => {
		const rec = record("rec-z", "sess-z");
		const gone = vi.fn(async () => "gone" as const);
		const hook = renderHook(() => {
			const tm = useTabManager("kiro");
			const empty = useRef(new Map<string, string | null>());
			const persisted = useRef(new Map<string, string>());
			const sessions = useRef(new Map<string, string | null>());
			return useOpenChatBridge({
				tabs: tm.tabs,
				tabRecordIdsRef: empty,
				persistedRecordIdsRef: persisted,
				persistedSessionIdsRef: sessions,
				getRecordIdForTab: () => "",
				setActiveTab: tm.setActiveTab,
				getSavedSessions: () => [],
				openRecordInTab: gone,
			});
		});
		let result: OpenRecordResult | undefined;
		await act(async () => {
			result = await hook.result.current.openFromHistory(rec);
		});
		expect(result).toBe("gone");
		expect(gone).toHaveBeenCalledWith("sess-z", "restore", {
			recordId: "rec-z",
		});
	});
});
