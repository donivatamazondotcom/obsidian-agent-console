/**
 * Types shared by chat links: the per-panel open-chat bridge, the resolver's
 * view of live chat leaves, and the open result. They live in `types/` so the
 * bridge hook, ChatView and the chat-link handler all import downward. See
 * [[Agent Console Chat ID]].
 */

import type { ChatId, SavedSessionInfo } from "./session";

/** One open tab and the chat ID it is bound to. */
export interface BoundChat {
	tabId: string;
	chatId: ChatId;
}

/**
 * A live chat leaf as the resolver sees it. `bound` is null when the leaf has
 * no bridge yet (a deferred background view); its saved tab state then counts.
 */
export interface LiveChatLeaf {
	/** `leaf.id` — the key of the leaf's saved tab state. */
	leafId: string;
	bound: readonly BoundChat[] | null;
}

/**
 * What opening a history record in a panel did:
 * - `opened`: a new restored tab was added
 * - `switched`: a tab already held the chat; it is now active
 * - `gone`: no record holds the ID any more; nothing opened
 */
export type OpenRecordResult = "opened" | "switched" | "gone";

/**
 * The bridge a mounted chat panel registers through `view.setOpenChat`.
 * Built once per panel; every call reads the panel's current tabs.
 */
export interface OpenChatBridge {
	/** Every live tab with a non-empty bound chat ID (no record check). */
	boundChatIds(): BoundChat[];
	/** Make `tabId` the active tab. */
	switchTo(tabId: string): void;
	/** Open `record` in a restored tab, or switch to a tab that holds it. */
	openFromHistory(record: SavedSessionInfo): Promise<OpenRecordResult>;
}
