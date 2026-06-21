/**
 * useTabPersistence — save / restore wiring for per-leaf tab state.
 *
 * Slice 5 of [[ACP Tab Persistence Across Restarts]]. Bridges the
 * runtime tab manager (useTabManager) with the persisted tab-state
 * service surface from Slice 4 (saveTabStateForLeaf /
 * loadTabStateForLeaf / loadSessionMessages).
 *
 * Save side (per spec § Save):
 *
 *   - Fires on tab-state changes that affect the persisted shape:
 *     add, close, reorder, rename (label), agentId change, and
 *     active-tab switch.
 *   - Does NOT fire on transient runtime-only changes (TabState
 *     transitions like idle → connecting → ready, createdAt). The
 *     "persistence signature" memo isolates persistence-relevant
 *     fields from runtime-only ones.
 *   - Does NOT fire when restoreEnabled is false (U39); pre-existing
 *     persisted state is left untouched on disk.
 *
 * Restore side (per spec § Restore):
 *
 *   - On mount, reads the leaf's slice via loadTabStateForLeaf.
 *   - Loads message history for tabs with non-null sessionId via
 *     loadSessionMessages (U37). Tabs with sessionId === null are
 *     skipped.
 *   - Does NOT call session/load — reconnection waits for first
 *     keystroke per the lazy-session lifecycle (Decision #2, U38).
 *     The hook's storage adapter contract structurally excludes
 *     session/load, so this property is enforced at the type level.
 *   - When restoreEnabled is false, restoredLeafState resolves to null
 *     immediately (U40 — caller opens a single fresh tab).
 *
 * Multi-leaf isolation (U41):
 *
 *   - Save uses saveTabStateForLeaf which atomically merges this
 *     leaf's slice without touching other leaves' slices.
 *   - Restore reads only this leaf's slice; other leaves' slices are
 *     opaque to the hook.
 *
 * Plugin unload (U30):
 *
 *   - flushSave triggers a save via the same path as change-driven
 *     saves. Caller (ChatView / plugin lifecycle) wires this to
 *     Obsidian's plugin onunload hook.
 *
 * Ref-based reads of unstable inputs:
 *
 *   - getSessionId, getScrollPosition, storage, tabs, activeTabId,
 *     and restoreEnabled are read via refs at save-time. The save
 *     effect's deps list intentionally uses a derived persistence
 *     signature instead of these raw values, so the effect fires
 *     only on persistence-relevant changes — not every render.
 *
 *   - This is the same "read-when-asked, don't-deps-on-it" pattern
 *     [[ACP Scroll Architecture Rework]] established for unstable
 *     references: keeps effects from re-firing when callers pass
 *     fresh closures every render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	PerLeafTabState,
	PersistedTabInfo,
	TabInfo,
} from "../types/tab";
import type { ChatMessage } from "../types/chat";
import type { ContextNote } from "../types/context";

// ============================================================================
// Types
// ============================================================================

/**
 * Storage adapter — the subset of SessionStorage / SettingsService that
 * useTabPersistence needs. Defined here so tests can mock with a
 * minimal object instead of a full ISettingsAccess implementation.
 *
 * The shape excludes any session-acquisition primitives (no
 * `session/load`, no `session/new`) — the hook's job is data wiring,
 * not connection lifecycle. Lazy reconnect is owned by useLazySession
 * (Slice 3). U38 is enforced at the type level.
 */
export interface TabPersistenceStorage {
	saveTabStateForLeaf(
		leafId: string,
		leafState: PerLeafTabState,
	): Promise<void>;
	loadTabStateForLeaf(
		leafId: string,
	): Promise<PerLeafTabState | null>;
	loadSessionMessages(
		sessionId: string,
	): Promise<ChatMessage[] | null>;
	loadSessionContextNotes(
		sessionId: string,
	): Promise<ContextNote[] | null>;
}

export interface UseTabPersistenceProps {
	/** Stable identifier for this leaf (Obsidian leaf.id) */
	leafId: string;
	/** Current runtime tabs (from useTabManager) */
	tabs: TabInfo[];
	/** Currently active tab ID */
	activeTabId: string;
	/**
	 * Resolves the ACP sessionId for a tab; null for tabs that have
	 * never had a message sent. Read at save-time via ref, not as a
	 * dep — caller can pass a fresh closure every render without
	 * causing extra saves.
	 */
	getSessionId: (tabId: string) => string | null;
	/**
	 * Resolves the current scroll position (in pixels) for a tab.
	 * Read at save-time via ref.
	 */
	getScrollPosition: (tabId: string) => number;
	/**
	 * Resolves the current unsent draft text for a tab's composer. Read at
	 * save-time via ref (like getScrollPosition), so the caller can pass a
	 * fresh closure every render without causing extra saves. Returns "" when
	 * the composer is empty. (Draft persistence — close/reopen + restart.)
	 */
	getDraft: (tabId: string) => string;
	/** Storage adapter (tab-state + session-messages) */
	storage: TabPersistenceStorage;
	/**
	 * Whether the "Restore tabs on startup" setting is enabled.
	 * When false, save is a no-op and restore returns null immediately
	 * (U39, U40).
	 */
	restoreEnabled: boolean;
	/**
	 * Opaque signature that changes when any tab's sessionId transitions
	 * (null → value on acquisition, or value → different value). Triggers
	 * a save so the sessionId is persisted for lazy reconnect on restart.
	 * Caller computes this from the live sessionId map. (I57)
	 */
	sessionSignature?: string;
}

export interface UseTabPersistenceReturn {
	/**
	 * Per-leaf state to restore, or null if no state / restore
	 * disabled / not yet loaded. Caller waits for restoreReady=true
	 * before integrating this with useTabManager.
	 */
	restoredLeafState: PerLeafTabState | null;
	/**
	 * Restored messages per saved tab, keyed by tabId. Only populated
	 * for tabs whose persisted sessionId resolved to message history.
	 * Tabs with sessionId === null or with no persisted messages are
	 * absent from the map.
	 */
	restoredMessages: Record<string, ChatMessage[]>;
	/**
	 * Restored context notes per saved tab, keyed by tabId. Populated for
	 * tabs whose persisted sessionId resolved to crystallized notes — keeps
	 * the context strip in sync on startup auto-restore (I61).
	 */
	restoredContextNotes: Record<string, ContextNote[]>;
	/**
	 * Tab IDs whose persisted sessionId is non-null but whose local message
	 * file was missing on restore (loadSessionMessages → null). Without this,
	 * such tabs fall out of restoredMessages and render a silent blank panel;
	 * the UI surfaces a labeled "history not stored locally — reload from
	 * agent" affordance for them instead (I72). Keyed set of tabIds.
	 */
	recoverableTabs: Record<string, true>;
	/**
	 * Whether the initial restore has completed. Caller should not
	 * use restoredLeafState until restoreReady is true.
	 */
	restoreReady: boolean;
	/** Manual save trigger — used by plugin's onunload hook (U30) */
	flushSave: () => Promise<void>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build the PerLeafTabState shape from current runtime state plus
 * resolver outputs. Pure function, separated from the hook for
 * testability and to keep the save effect body small.
 */
function buildPerLeafState(
	leafId: string,
	tabs: TabInfo[],
	activeTabId: string,
	getSessionId: (tabId: string) => string | null,
	getScrollPosition: (tabId: string) => number,
	getDraft: (tabId: string) => string,
): PerLeafTabState {
	const persistedTabs: PersistedTabInfo[] = tabs.map((tab, index) => ({
		tabId: tab.tabId,
		agentId: tab.agentId,
		label: tab.label,
		labelIsCustom: tab.labelIsCustom ?? false,
		sessionId: getSessionId(tab.tabId),
		tabOrder: index,
		scrollPosition: getScrollPosition(tab.tabId),
		draftText: getDraft(tab.tabId),
	}));
	return {
		leafId,
		tabs: persistedTabs,
		activeTabId,
	};
}

// ============================================================================
// Hook
// ============================================================================

export function useTabPersistence(
	props: UseTabPersistenceProps,
): UseTabPersistenceReturn {
	const {
		leafId,
		tabs,
		activeTabId,
		getSessionId,
		getScrollPosition,
		getDraft,
		storage,
		restoreEnabled,
		sessionSignature,
	} = props;

	const [restoredLeafState, setRestoredLeafState] =
		useState<PerLeafTabState | null>(null);
	const [restoredMessages, setRestoredMessages] = useState<
		Record<string, ChatMessage[]>
	>({});
	const [restoredContextNotes, setRestoredContextNotes] = useState<
		Record<string, ContextNote[]>
	>({});
	const [restoredRecoverable, setRestoredRecoverable] = useState<
		Record<string, true>
	>({});
	const [restoreReady, setRestoreReady] = useState<boolean>(false);

	// Refs — invoked at save-time, not used as effect deps. Keeps the
	// save effect from firing every render when the caller passes new
	// closures or new storage references.
	const getSessionIdRef = useRef(getSessionId);
	const getScrollPositionRef = useRef(getScrollPosition);
	const getDraftRef = useRef(getDraft);
	const storageRef = useRef(storage);
	const tabsRef = useRef(tabs);
	const activeTabIdRef = useRef(activeTabId);
	const restoreEnabledRef = useRef(restoreEnabled);

	useEffect(() => {
		getSessionIdRef.current = getSessionId;
		getScrollPositionRef.current = getScrollPosition;
		getDraftRef.current = getDraft;
		storageRef.current = storage;
		tabsRef.current = tabs;
		activeTabIdRef.current = activeTabId;
		restoreEnabledRef.current = restoreEnabled;
	});

	// === Restore on mount (and on leafId / restoreEnabled change) ===
	useEffect(() => {
		let cancelled = false;

		async function restore() {
			if (!restoreEnabled) {
				// U40 — Restore-tabs OFF: skip restore; immediately
				// ready with no state. Caller opens a single fresh tab.
				if (!cancelled) {
					setRestoredLeafState(null);
					setRestoredMessages({});
					setRestoredContextNotes({});
					setRestoredRecoverable({});
					setRestoreReady(true);
				}
				return;
			}

			const leafState =
				await storageRef.current.loadTabStateForLeaf(leafId);
			if (cancelled) return;

			if (leafState === null) {
				setRestoredLeafState(null);
				setRestoredMessages({});
				setRestoredContextNotes({});
				setRestoredRecoverable({});
				setRestoreReady(true);
				return;
			}

			// U37 — Load message history for tabs with non-null
			// sessionId. U38 — Do NOT call session/load; lazy reconnect
			// on first keystroke per Decision #2.
			const messages: Record<string, ChatMessage[]> = {};
			const contextNotes: Record<string, ContextNote[]> = {};
			// I72 — tabs with a persisted sessionId but no local message
			// file land here so the UI can offer on-demand recovery instead
			// of rendering a silent blank panel.
			const recoverable: Record<string, true> = {};
			for (const tab of leafState.tabs) {
				if (tab.sessionId !== null) {
					const msgs =
						await storageRef.current.loadSessionMessages(
							tab.sessionId,
						);
					if (cancelled) return;
					if (msgs !== null) {
						messages[tab.tabId] = msgs;
					} else {
						// sessionId present but no local file (I72).
						recoverable[tab.tabId] = true;
					}
					const notes =
						await storageRef.current.loadSessionContextNotes(
							tab.sessionId,
						);
					if (cancelled) return;
					if (notes !== null && notes.length > 0) {
						contextNotes[tab.tabId] = notes;
					}
				}
			}
			if (cancelled) return;

			setRestoredLeafState(leafState);
			setRestoredMessages(messages);
			setRestoredContextNotes(contextNotes);
			setRestoredRecoverable(recoverable);
			setRestoreReady(true);
		}

		setRestoreReady(false);
		setRestoredLeafState(null);
		setRestoredMessages({});
		setRestoredContextNotes({});
		setRestoredRecoverable({});
		void restore();

		return () => {
			cancelled = true;
		};
		// Restore re-runs only on leafId or restoreEnabled change.
		// storage / getSessionId / getScrollPosition are read via refs
		// inside restore(), so we don't dep on them.
	}, [leafId, restoreEnabled]);

	// === Persistence-relevant signature for save effect ===
	//
	// Changes only on add / close / reorder / rename / agentId-change
	// / active-switch — NOT on transient runtime fields (`state`,
	// `createdAt`). This is what distinguishes "save fires on add"
	// (U25) from "save fires on every TabState transition" (over-
	// saving on connecting/ready icon flips).
	const persistenceSignature = useMemo(
		() =>
			tabs
				.map(
					(t) =>
						`${t.tabId}::${t.agentId}::${t.label}`,
				)
				.join("||") +
			"|active=" +
			activeTabId,
		[tabs, activeTabId],
	);

	// === Save on persistence-relevant change ===
	useEffect(() => {
		if (!restoreReady) return; // Wait for restore before first save (avoid clobber).
		if (!restoreEnabled) return; // U39 — OFF: save is a no-op.

		const state = buildPerLeafState(
			leafId,
			tabsRef.current,
			activeTabIdRef.current,
			getSessionIdRef.current,
			getScrollPositionRef.current,
			getDraftRef.current,
		);
		void storageRef.current.saveTabStateForLeaf(leafId, state);
		// Deps are leafId + persistenceSignature + sessionSignature +
		// readiness flags. tabs / activeTabId are read via refs to
		// ensure save sees the latest values.
	}, [leafId, persistenceSignature, sessionSignature, restoreEnabled, restoreReady]);

	// === Manual flush (plugin unload — U30) ===
	const flushSave = useCallback(async () => {
		if (!restoreEnabledRef.current) return; // U39 also applies to flush.
		const state = buildPerLeafState(
			leafId,
			tabsRef.current,
			activeTabIdRef.current,
			getSessionIdRef.current,
			getScrollPositionRef.current,
			getDraftRef.current,
		);
		await storageRef.current.saveTabStateForLeaf(leafId, state);
	}, [leafId]);

	return {
		restoredLeafState,
		restoredMessages,
		restoredContextNotes,
		recoverableTabs: restoredRecoverable,
		restoreReady,
		flushSave,
	};
}
