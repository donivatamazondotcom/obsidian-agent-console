/**
 * Chat ID resolvers ([[Agent Console Chat ID]]). Pure and total.
 *
 * - `deriveChatTarget`: where a chat link should go — an open tab, a tab in a
 *   panel that hasn't mounted yet, a history record, or nowhere.
 * - `savedTabChatId`: the ID a saved tab will report when it mounts. The one
 *   derivation the resolver and the in-panel check share (D4).
 * - `findPanelTabForChat`: `openFromHistory`'s final in-panel check.
 * - `usableChatId`: an ID counts only once its record exists (D3, D7).
 * - `planHistoryOpen`: the record part of opening a history record in a tab.
 * - `copyLinkResult`: what Copy link to chat does.
 *
 * Records are matched only by record ID, and tabs only by their bound chat ID,
 * never by agent session ID: a migrated record ID can equal another record's
 * current `sessionId`.
 */

import type { ChatId, SavedSessionInfo } from "../types/session";
import type { PerLeafTabState } from "../types/tab";
import type { LiveChatLeaf } from "../types/chat-link";
import { findSessionRecord } from "../utils/session-record-key";
import { buildChatLinkMarkdown } from "../utils/chat-uri";

export type ChatTarget =
	| { kind: "open-tab"; leafId: string; tabId: string }
	| { kind: "unmounted-tab"; leafId: string; tabId: string }
	| { kind: "history"; record: SavedSessionInfo }
	| { kind: "missing" };

export interface ChatTargetTabs {
	/** Every live chat leaf, with its bridge's bound IDs or null. */
	liveLeaves: readonly LiveChatLeaf[];
	/** `perLeafTabStates` as saved. */
	savedTabStates: readonly PerLeafTabState[];
	/** The Restore tabs on startup setting. */
	restoreTabsOnStartup: boolean;
}

/**
 * The ID a saved or not-yet-reported tab will report at mount: its saved
 * record ID, else the record holding its saved agent session (tabs saved
 * before I269). Mirrors `useSessionHistory`'s mount binding.
 */
export function savedTabChatId(
	tab: { recordId?: string | null; sessionId: string | null },
	records: readonly SavedSessionInfo[],
): ChatId | null {
	if (tab.recordId) return tab.recordId;
	if (!tab.sessionId) return null;
	return (
		findSessionRecord(records, { by: "sessionId", id: tab.sessionId })
			?.recordId ?? null
	);
}

export function deriveChatTarget(
	id: ChatId,
	records: readonly SavedSessionInfo[],
	openTabs: ChatTargetTabs,
): ChatTarget {
	if (!id) return { kind: "missing" };

	// A panel with a bridge is read only through its bridge.
	for (const leaf of openTabs.liveLeaves) {
		if (!leaf.bound) continue;
		const hit = leaf.bound.find((b) => b.chatId === id);
		if (hit) return { kind: "open-tab", leafId: leaf.leafId, tabId: hit.tabId };
	}

	// Saved tab state counts only for a live leaf with no bridge yet, and only
	// when tabs are restored on startup. Leftover state for closed panels is
	// ignored, so those chats fall through to history.
	if (openTabs.restoreTabsOnStartup) {
		for (const leaf of openTabs.liveLeaves) {
			if (leaf.bound) continue;
			const saved = openTabs.savedTabStates.find(
				(s) => s.leafId === leaf.leafId,
			);
			const tab = saved?.tabs.find((t) => savedTabChatId(t, records) === id);
			if (tab) {
				return { kind: "unmounted-tab", leafId: leaf.leafId, tabId: tab.tabId };
			}
		}
	}

	const record = findSessionRecord(records, { by: "recordId", id });
	return record ? { kind: "history", record } : { kind: "missing" };
}

/** A panel tab as the in-panel check sees it. */
export interface PanelTabIdentity {
	tabId: string;
	/** The tab's own binding report; `has` is false until its first report. */
	reported: { has: boolean; id: string | null };
	/** The record ID the tab was restored with, if any. */
	persistedRecordId: string | null;
	/** The agent session ID the tab was restored with, if any. */
	persistedSessionId: string | null;
}

/**
 * The tab in this panel that holds `chatId`, or null. A tab that has reported
 * matches by its report (so a tab that ran New chat can't match its old chat);
 * one that hasn't yet matches by the ID it will report at mount.
 */
export function findPanelTabForChat(
	chatId: ChatId,
	tabs: readonly PanelTabIdentity[],
	records: readonly SavedSessionInfo[],
): string | null {
	if (!chatId) return null;
	for (const tab of tabs) {
		const id = tab.reported.has
			? tab.reported.id
			: savedTabChatId(
					{
						recordId: tab.persistedRecordId,
						sessionId: tab.persistedSessionId,
					},
					records,
				);
		if (id === chatId) return tab.tabId;
	}
	return null;
}

/** `id` when its record exists, else null (D7). */
export function usableChatId(
	id: string | null,
	records: readonly SavedSessionInfo[],
): ChatId | null {
	if (!id) return null;
	return findSessionRecord(records, { by: "recordId", id }) ? id : null;
}

export type HistoryOpenPlan =
	| {
			kind: "open";
			/** The record the tab opens, if the plugin has one. */
			saved: SavedSessionInfo | undefined;
			/** The agent session the tab restores. */
			sessionId: string;
			/** The record ID to bind the new tab to. */
			persistedRecordId: ChatId | null;
			/** The record ID to load the transcript by, or null for today's path. */
			loadRecordId: ChatId | null;
	  }
	| { kind: "gone" };

/**
 * The record part of opening a history record in a tab. With a `recordId`
 * (a chat link), the record found by that ID wins, and its current agent
 * session is restored even if the caller's `sessionId` is stale. Without one
 * (the history modal), today's lookup by session ID applies, and a row with
 * no local record (agent-only) still opens.
 */
export function planHistoryOpen(input: {
	sessionId: string;
	recordId?: ChatId | null;
	savedSessions: readonly SavedSessionInfo[];
}): HistoryOpenPlan {
	const { sessionId, recordId, savedSessions } = input;
	if (recordId) {
		const saved = findSessionRecord(savedSessions, {
			by: "recordId",
			id: recordId,
		});
		if (!saved) return { kind: "gone" };
		return {
			kind: "open",
			saved,
			sessionId: saved.sessionId,
			persistedRecordId: saved.recordId,
			loadRecordId: saved.recordId,
		};
	}
	const saved = findSessionRecord(savedSessions, {
		by: "sessionId",
		id: sessionId,
	});
	return {
		kind: "open",
		saved,
		sessionId,
		persistedRecordId: saved?.recordId ?? null,
		loadRecordId: null,
	};
}

export type CopyLinkResult =
	| { kind: "copy"; markdown: string }
	| { kind: "no-id" };

/** What Copy link to chat does for a tab bound to `id`. */
export function copyLinkResult(
	id: string | null,
	records: readonly SavedSessionInfo[],
	title: string,
	vault: string,
): CopyLinkResult {
	const chatId = usableChatId(id, records);
	return chatId
		? { kind: "copy", markdown: buildChatLinkMarkdown(title, vault, chatId) }
		: { kind: "no-id" };
}
