/**
 * `useOpenChatBridge` — the bridge a chat panel registers through
 * `view.setOpenChat`, so a chat link can find and open chats in it
 * ([[Agent Console Chat ID]], D12).
 *
 * Returns one stable bridge, built once. A link handler can hold it across
 * awaits and still see the panel's current tabs, because every input is a
 * ref object, a stable callback, or read through a latest-value ref updated
 * on each render; nothing is a render-time snapshot (T34).
 *
 * - `boundChatIds()` walks the live tab list (never the report map, which can
 *   hold an entry for a closed tab) and reports each tab's bound chat ID via
 *   `getRecordIdForTab`, with no record check (D7).
 * - `switchTo(tabId)` makes a tab active.
 * - `openFromHistory(record)` runs the final in-panel check
 *   (`findPanelTabForChat`): a tab that has reported matches by its report,
 *   one that hasn't yet by the ID it will report at mount. On a match it
 *   switches; otherwise it opens the record in a restored tab through
 *   ChatView's `openRecordInTab`.
 */
import { useRef } from "react";

import { findPanelTabForChat } from "../resolvers/chat-target";
import type {
	BoundChat,
	OpenChatBridge,
	OpenRecordResult,
} from "../types/chat-link";
import type { ChatId, SavedSessionInfo } from "../types/session";
import type { TabInfo } from "../types/tab";

/** A ref object the bridge reads at call time (`useRef` result or similar). */
interface ReadRef<T> {
	readonly current: T;
}

export interface OpenChatBridgeInputs {
	/** The panel's tabs; read at call time through a latest-value ref. */
	tabs: readonly TabInfo[];
	/** Each tab's binding report (I269); absent until its first report. */
	tabRecordIdsRef: ReadRef<Map<string, string | null>>;
	/** Record IDs from the restore sources, until a tab reports. */
	persistedRecordIdsRef: ReadRef<Map<string, string>>;
	/** Agent session IDs from the restore sources. */
	persistedSessionIdsRef: ReadRef<Map<string, string | null>>;
	/** ChatView's resolver for a tab's record ID ("" when none). */
	getRecordIdForTab: (tabId: string) => string;
	/** Activate a tab (`useTabManager.setActiveTab`). */
	setActiveTab: (tabId: string) => void;
	/** The saved history records, read at call time. */
	getSavedSessions: () => readonly SavedSessionInfo[];
	/** ChatView's inner `openRecordInTab`. */
	openRecordInTab: (
		sessionId: string,
		mode: "restore",
		opts: { recordId: ChatId },
	) => Promise<OpenRecordResult>;
}

export function useOpenChatBridge(
	inputs: OpenChatBridgeInputs,
): OpenChatBridge {
	const latestRef = useRef(inputs);
	latestRef.current = inputs;

	const bridgeRef = useRef<OpenChatBridge | null>(null);
	if (bridgeRef.current === null) {
		bridgeRef.current = {
			boundChatIds(): BoundChat[] {
				const { tabs, getRecordIdForTab } = latestRef.current;
				const bound: BoundChat[] = [];
				for (const tab of tabs) {
					const chatId = getRecordIdForTab(tab.tabId);
					if (chatId) bound.push({ tabId: tab.tabId, chatId });
				}
				return bound;
			},
			switchTo(tabId: string): void {
				latestRef.current.setActiveTab(tabId);
			},
			async openFromHistory(
				record: SavedSessionInfo,
			): Promise<OpenRecordResult> {
				const {
					tabs,
					tabRecordIdsRef,
					persistedRecordIdsRef,
					persistedSessionIdsRef,
					getSavedSessions,
					setActiveTab,
					openRecordInTab,
				} = latestRef.current;
				const hit = findPanelTabForChat(
					record.recordId,
					tabs.map((tab) => ({
						tabId: tab.tabId,
						reported: {
							has: tabRecordIdsRef.current.has(tab.tabId),
							id: tabRecordIdsRef.current.get(tab.tabId) ?? null,
						},
						persistedRecordId:
							persistedRecordIdsRef.current.get(tab.tabId) ?? null,
						persistedSessionId:
							persistedSessionIdsRef.current.get(tab.tabId) ?? null,
					})),
					getSavedSessions(),
				);
				if (hit) {
					setActiveTab(hit);
					return "switched";
				}
				return openRecordInTab(record.sessionId, "restore", {
					recordId: record.recordId,
				});
			},
		};
	}
	return bridgeRef.current;
}
