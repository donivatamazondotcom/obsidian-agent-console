/**
 * Chat ID — the pure core in `chat-target.ts` ([[Agent Console Chat ID]]).
 *
 * - T10: `deriveChatTarget` gives all four results, and matches records only
 *   by record ID. A migrated record ID can equal another record's current
 *   agent session ID; the link must open the record that owns the ID.
 * - T22: with Restore tabs on startup off, leftover saved tab state counts
 *   for nothing.
 * - T23: a panel with a bridge is read only through its bridge, so its stale
 *   saved tab state (after New chat) can't win.
 * - T30, T31, T33 (resolver halves): saved state from before I269 counts with
 *   the ID the tab will report at mount; a tab that ran New chat matches
 *   nothing; leftover state for a closed panel falls through to history.
 * - T38: `planHistoryOpen` binds the clicked record by its ID, restores that
 *   record's current agent session, and keeps today's lookup without an ID.
 * - `usableChatId` and `copyLinkResult` (D7): an ID counts only when its
 *   record exists.
 *
 * Expected values are literals (R5).
 */
import { describe, expect, it } from "vitest";
import {
	copyLinkResult,
	deriveChatTarget,
	findPanelTabForChat,
	planHistoryOpen,
	savedTabChatId,
	usableChatId,
} from "../chat-target";
import type { SavedSessionInfo } from "../../types/session";
import type { PerLeafTabState, PersistedTabInfo } from "../../types/tab";
import type { LiveChatLeaf } from "../../types/chat-link";

function record(
	recordId: string,
	sessionId: string,
	title = `Chat ${recordId}`,
	agentId = "kiro",
): SavedSessionInfo {
	return {
		recordId,
		sessionId,
		agentId,
		cwd: "/vault",
		title,
		createdAt: "2026-11-15T09:00:00.000Z",
		updatedAt: "2026-11-15T09:00:00.000Z",
	};
}

function savedTab(
	tabId: string,
	sessionId: string | null,
	recordId?: string,
): PersistedTabInfo {
	return {
		tabId,
		agentId: "kiro",
		label: tabId,
		sessionId,
		tabOrder: 0,
		scrollPosition: 0,
		...(recordId ? { recordId } : {}),
	};
}

function leafState(leafId: string, tabs: PersistedTabInfo[]): PerLeafTabState {
	return { leafId, tabs, activeTabId: tabs[0]?.tabId ?? "" };
}

// A: migrated before I269 (record ID = its first agent ID), now on sess-y.
// B: a different chat whose CURRENT agent session is sess-x.
const A = record("sess-x", "sess-y", "Number memory");
const B = record("rec-b", "sess-x", "Q3 offsite");
const C = record("rec-c", "sess-c", "Docs site");
const RECORDS = [A, B, C];

const NO_TABS = {
	liveLeaves: [] as LiveChatLeaf[],
	savedTabStates: [] as PerLeafTabState[],
	restoreTabsOnStartup: true,
};

describe("T10 deriveChatTarget", () => {
	it("open-tab: a bridged panel reports a tab bound to the ID", () => {
		expect(
			deriveChatTarget("rec-c", RECORDS, {
				...NO_TABS,
				liveLeaves: [
					{ leafId: "leaf-1", bound: [{ tabId: "t1", chatId: "rec-c" }] },
				],
			}),
		).toEqual({ kind: "open-tab", leafId: "leaf-1", tabId: "t1" });
	});

	it("unmounted-tab: a panel with no bridge whose saved state holds the ID", () => {
		expect(
			deriveChatTarget("rec-c", RECORDS, {
				...NO_TABS,
				liveLeaves: [{ leafId: "leaf-2", bound: null }],
				savedTabStates: [
					leafState("leaf-2", [savedTab("t9", "sess-c", "rec-c")]),
				],
			}),
		).toEqual({ kind: "unmounted-tab", leafId: "leaf-2", tabId: "t9" });
	});

	it("history: a saved record with the ID", () => {
		expect(deriveChatTarget("rec-c", RECORDS, NO_TABS)).toEqual({
			kind: "history",
			record: C,
		});
	});

	it("missing: no tab and no record", () => {
		expect(deriveChatTarget("rec-zzz", RECORDS, NO_TABS)).toEqual({
			kind: "missing",
		});
	});

	it("missing: an empty ID", () => {
		expect(deriveChatTarget("", RECORDS, NO_TABS)).toEqual({
			kind: "missing",
		});
	});

	it("a migrated ID that equals another record's current agent session opens its own record", () => {
		expect(deriveChatTarget("sess-x", RECORDS, NO_TABS)).toEqual({
			kind: "history",
			record: A,
		});
	});

	it("an agent session ID is never a chat ID", () => {
		expect(deriveChatTarget("sess-y", RECORDS, NO_TABS)).toEqual({
			kind: "missing",
		});
	});

	it("a tab whose agent session equals the link's ID doesn't match", () => {
		// The deferred tab runs as sess-x, so it will report B's record ID.
		expect(
			deriveChatTarget("sess-x", RECORDS, {
				...NO_TABS,
				liveLeaves: [{ leafId: "leaf-2", bound: null }],
				savedTabStates: [leafState("leaf-2", [savedTab("t9", "sess-x")])],
			}),
		).toEqual({ kind: "history", record: A });
	});

	it("an open tab wins over a deferred panel and over history", () => {
		expect(
			deriveChatTarget("rec-c", RECORDS, {
				liveLeaves: [
					{ leafId: "leaf-2", bound: null },
					{ leafId: "leaf-1", bound: [{ tabId: "t1", chatId: "rec-c" }] },
				],
				savedTabStates: [
					leafState("leaf-2", [savedTab("t9", "sess-c", "rec-c")]),
				],
				restoreTabsOnStartup: true,
			}),
		).toEqual({ kind: "open-tab", leafId: "leaf-1", tabId: "t1" });
	});
});

describe("T22 Restore tabs on startup off", () => {
	it("leftover saved tab state resolves to history", () => {
		expect(
			deriveChatTarget("rec-c", RECORDS, {
				liveLeaves: [{ leafId: "leaf-2", bound: null }],
				savedTabStates: [
					leafState("leaf-2", [savedTab("t9", "sess-c", "rec-c")]),
				],
				restoreTabsOnStartup: false,
			}),
		).toEqual({ kind: "history", record: C });
	});
});

describe("T23 a bridged panel is read only through its bridge", () => {
	it("stale saved state after New chat doesn't resolve to unmounted-tab", () => {
		expect(
			deriveChatTarget("rec-c", RECORDS, {
				liveLeaves: [{ leafId: "leaf-1", bound: [] }],
				savedTabStates: [
					leafState("leaf-1", [savedTab("t1", "sess-c", "rec-c")]),
				],
				restoreTabsOnStartup: true,
			}),
		).toEqual({ kind: "history", record: C });
	});
});

describe("saved state from before I269 (T30, T33 resolver halves)", () => {
	it("T33: a deferred panel's saved tab with no record ID counts with the ID it will report", () => {
		expect(
			deriveChatTarget("rec-c", RECORDS, {
				...NO_TABS,
				liveLeaves: [{ leafId: "leaf-2", bound: null }],
				savedTabStates: [leafState("leaf-2", [savedTab("t9", "sess-c")])],
			}),
		).toEqual({ kind: "unmounted-tab", leafId: "leaf-2", tabId: "t9" });
	});

	it("T30: leftover state for a panel that isn't live falls through to history", () => {
		expect(
			deriveChatTarget("rec-c", RECORDS, {
				...NO_TABS,
				liveLeaves: [{ leafId: "leaf-1", bound: [] }],
				savedTabStates: [leafState("leaf-closed", [savedTab("t9", "sess-c")])],
			}),
		).toEqual({ kind: "history", record: C });
	});

	it("savedTabChatId prefers the saved record ID, then the record holding the session", () => {
		expect(savedTabChatId({ recordId: "rec-c", sessionId: "sess-x" }, RECORDS)).toBe(
			"rec-c",
		);
		expect(savedTabChatId({ sessionId: "sess-x" }, RECORDS)).toBe("rec-b");
		expect(savedTabChatId({ sessionId: "sess-unknown" }, RECORDS)).toBeNull();
		expect(savedTabChatId({ sessionId: null }, RECORDS)).toBeNull();
	});
});

describe("findPanelTabForChat (openFromHistory's in-panel check)", () => {
	it("matches a reported tab by its reported ID", () => {
		expect(
			findPanelTabForChat(
				"rec-c",
				[
					{
						tabId: "t1",
						reported: { has: true, id: "rec-b" },
						persistedRecordId: null,
						persistedSessionId: null,
					},
					{
						tabId: "t2",
						reported: { has: true, id: "rec-c" },
						persistedRecordId: null,
						persistedSessionId: null,
					},
				],
				RECORDS,
			),
		).toBe("t2");
	});

	it("T30: matches a tab that hasn't reported, saved before I269, by its session's record", () => {
		expect(
			findPanelTabForChat(
				"rec-c",
				[
					{
						tabId: "t1",
						reported: { has: false, id: null },
						persistedRecordId: null,
						persistedSessionId: "sess-c",
					},
				],
				RECORDS,
			),
		).toBe("t1");
	});

	it("T31: a restored tab that ran New chat isn't selected by a link to its old chat", () => {
		expect(
			findPanelTabForChat(
				"rec-c",
				[
					{
						tabId: "t1",
						reported: { has: true, id: null },
						persistedRecordId: null,
						persistedSessionId: "sess-c",
					},
				],
				RECORDS,
			),
		).toBeNull();
	});

	it("T10: a tab that hasn't reported, running as a migrated ID's agent session, doesn't match it", () => {
		expect(
			findPanelTabForChat(
				"sess-x",
				[
					{
						tabId: "t1",
						reported: { has: false, id: null },
						persistedRecordId: null,
						persistedSessionId: "sess-x",
					},
				],
				RECORDS,
			),
		).toBeNull();
	});
});

describe("T38 planHistoryOpen", () => {
	it("with a record ID: binds it, restores the record's current session, and loads by the ID", () => {
		// X is now on S2; the caller passed a stale S1.
		const X = record("X", "S2", "Renamed chat", "claude");
		expect(
			planHistoryOpen({ sessionId: "S1", recordId: "X", savedSessions: [X] }),
		).toEqual({
			kind: "open",
			saved: X,
			sessionId: "S2",
			persistedRecordId: "X",
			loadRecordId: "X",
		});
	});

	it("with a record ID no record holds: gone", () => {
		expect(
			planHistoryOpen({ sessionId: "S1", recordId: "X", savedSessions: [C] }),
		).toEqual({ kind: "gone" });
	});

	it("without a record ID: today's lookup by session ID", () => {
		expect(
			planHistoryOpen({ sessionId: "sess-x", savedSessions: RECORDS }),
		).toEqual({
			kind: "open",
			saved: B,
			sessionId: "sess-x",
			persistedRecordId: "rec-b",
			loadRecordId: null,
		});
	});

	it("without a record ID, an agent-only row still opens, with no saved record", () => {
		expect(
			planHistoryOpen({ sessionId: "agent-only", savedSessions: RECORDS }),
		).toEqual({
			kind: "open",
			saved: undefined,
			sessionId: "agent-only",
			persistedRecordId: null,
			loadRecordId: null,
		});
	});
});

describe("usableChatId (D7)", () => {
	it.each([
		["", null],
		["rec-zzz", null],
		["sess-y", null],
		["rec-c", "rec-c"],
		["sess-x", "sess-x"],
	] as const)("%j → %j", (id, expected) => {
		expect(usableChatId(id, RECORDS)).toBe(expected);
	});

	it("null → null", () => {
		expect(usableChatId(null, RECORDS)).toBeNull();
	});
});

describe("copyLinkResult", () => {
	it("copies a Markdown link when the record exists", () => {
		expect(copyLinkResult("rec-c", RECORDS, "Docs [site]", "My vault")).toEqual({
			kind: "copy",
			markdown:
				"[Docs \\[site\\]](obsidian://agent-console-chat?vault=My%20vault&id=rec-c)",
		});
	});

	it("gives no-id when the ID has no record yet", () => {
		expect(copyLinkResult("rec-pending", RECORDS, "Docs", "My vault")).toEqual({
			kind: "no-id",
		});
	});

	it("gives no-id for an empty ID", () => {
		expect(copyLinkResult("", RECORDS, "Docs", "My vault")).toEqual({
			kind: "no-id",
		});
	});
});
