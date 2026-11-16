/**
 * Types shared by chat links: the per-panel open-chat bridge, the resolver's
 * view of live chat leaves, and the open result. They live in `types/` so the
 * bridge hook, ChatView and the chat-link handler all import downward. See
 * [[Agent Console Chat ID]].
 */

import type { ChatId, SavedSessionInfo } from "./session";
import type { PerLeafTabState } from "./tab";

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

/** The chat-link rate limit's state (D14): the last accepted link. */
export interface ChatLinkRateLimitState {
	lastAt?: number;
	lastId?: string;
}

/**
 * A workspace leaf as the chat-link handler reads it. Structural, so the real
 * `WorkspaceLeaf` fits and tests can fake one.
 */
export interface ChatLinkLeaf {
	/** Undocumented `WorkspaceLeaf.id`: the key of the leaf's saved tab state. */
	id?: string;
	/** Read only for its container's window, where frames are counted. */
	view: { containerEl: HTMLElement };
}

/** The `Workspace` calls the handler makes. */
export interface ChatLinkWorkspace<L extends ChatLinkLeaf> {
	getLeavesOfType(viewType: string): L[];
	onLayoutReady(callback: () => void): void;
	revealLeaf(leaf: L): Promise<void>;
	setActiveLeaf(leaf: L, params: { focus: boolean }): void;
}

/** Everything `createChatLinkHandler` reads ([[Agent Console Chat ID]] D12). */
export interface ChatLinkHandlerInputs<L extends ChatLinkLeaf> {
	workspace: ChatLinkWorkspace<L>;
	/** The chat view type, for `getLeavesOfType`. */
	viewType: string;
	/** The panel's bridge, or null when the leaf isn't a mounted chat view. */
	getBridge(leaf: L): OpenChatBridge | null;
	restoreTabsOnStartup(): boolean;
	perLeafTabStates(): readonly PerLeafTabState[];
	savedSessions(): readonly SavedSessionInfo[];
	/** The focus-tracked chat view's id (its `leaf.id`). */
	lastActiveChatViewId(): string | null;
	/** An open chat leaf to target, or null when none is open. */
	getTargetChatLeaf(): L | null;
	/** Open (or reveal) a chat view. */
	activateView(): Promise<void>;
	/** The view a just-created panel mounted, bounded; null if none did. */
	waitForChatViewOpener(): Promise<{ leaf: L } | null>;
	/**
	 * The plugin-owned rate-limit state. `set` runs when a link is accepted,
	 * and once more when that link's run ends with the could-not-open notice
	 * (the release), only while the holder still holds that acceptance.
	 */
	rateLimit: {
		get(): ChatLinkRateLimitState;
		set(state: ChatLinkRateLimitState): void;
	};
	now(): number;
	/**
	 * Resolve after `ms` on a main-window timer, which keeps running when a
	 * popout closes or a window stops drawing frames.
	 */
	sleep(ms: number): Promise<void>;
	/** Post a finished notice string (the handler adds the prefix). */
	notify(message: string): void;
	logError(message: string, error: unknown): void;
}
