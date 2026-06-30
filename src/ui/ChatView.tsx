import { ItemView, WorkspaceLeaf, Menu, Notice, Scope, type MenuItem } from "obsidian";
import { registerOpenMenu, showMenuAtEvent } from "../utils/menu-registry";
import { focusActiveTabComposer } from "./composer-focus";
import type {
	IChatViewContainer,
	IChatTabHandle,
	ChatViewType,
} from "../services/view-registry";
import * as React from "react";
const { useEffect, useMemo, useCallback, useRef, useState } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import type { ChatInputState, ChatMessage } from "../types/chat";
import type { ContextNote } from "../types/context";
import type { TabInfo, TabState, PerLeafTabState, PersistedTabInfo } from "../types/tab";
import type { QuickPrompt } from "../types/quick-prompt";
import type { QuickPromptGesture } from "../services/quick-prompts-logic";

// Utility imports
import { getLogger, Logger } from "../utils/logger";
import { shouldConfirmClose } from "../utils/close-confirm";

// Context imports
import { ChatContextProvider } from "./ChatContext";

// Component imports
import { ChatPanel, type ChatPanelCallbacks } from "./ChatPanel";
import { TabBar } from "./TabBar";
import { TabErrorBoundary } from "./TabErrorBoundary";
import { EditTitleModal } from "./SessionHistoryModal";
import { CorruptionRecoveryModal } from "./CorruptionRecoveryModal";
import { ConfirmCloseModal } from "./ConfirmCloseModal";

// Hook imports
import { useTabManager, truncateLabel, suffixOnCollision } from "../hooks/useTabManager";
import { useTabPersistence, type TabPersistenceStorage } from "../hooks/useTabPersistence";
import { useRecentlyClosedTabs } from "../hooks/useRecentlyClosedTabs";
import { resolveInitialAgentId } from "../resolvers/resolveInitialAgentId";
import {
	resolveSeededMessages,
	resolveSeededContextNotes,
} from "../utils/restored-tab-content";

// Service imports
import { VaultService } from "../services/vault-service";
import { resolveSessionIdForSave, resolveRenamedSessionWrite } from "../services/session-helpers";
import {
	buildClosedLeafRecord,
	buildClosedTabRecord,
	resolveRestoredLeaf,
} from "../services/recently-closed-stack";
import type { AcpClient } from "../acp/acp-client";

export const VIEW_TYPE_CHAT = "agent-client-chat-view";

/**
 * Debounce for persisting unsent draft text. Long enough to avoid a save per
 * keystroke, short enough that a draft reaches disk well before a typical
 * quit/close. The active tab's draft has no other reliable save trigger (tab
 * events save tabs you leave; flushSave at quit races with app exit), so this
 * is what makes "type → restart → draft restored" work. (Draft persistence.)
 */
const DRAFT_SAVE_DEBOUNCE_MS = 800;

// ============================================================================
// TabPanel — per-tab wrapper that memoizes context value
// ============================================================================

/**
 * Wrapper component for each tab that memoizes the ChatContextProvider value.
 * Without this, every ChatComponent re-render creates a new context value object
 * for every tab, causing all ChatPanel instances to re-render unnecessarily.
 * This was the root cause of I7 (context note toggle stops working after first use).
 */
function TabPanel({
	plugin,
	acpClient,
	vaultService,
	children,
}: {
	plugin: AgentClientPlugin;
	acpClient: AcpClient;
	vaultService: VaultService;
	children: React.ReactNode;
}) {
	const contextValue = useMemo(
		() => ({
			plugin,
			acpClient,
			vaultService,
			settingsService: plugin.settingsService,
		}),
		[plugin, acpClient, vaultService],
	);

	return (
		<ChatContextProvider value={contextValue}>
			{children}
		</ChatContextProvider>
	);
}

// ============================================================================
// Helpers — tab persistence
// ============================================================================

/**
 * Synchronously read this leaf's persisted tab state from plugin settings.
 * Returns null if no state exists or the setting is disabled.
 */
function readPersistedLeafState(
	plugin: AgentClientPlugin,
	leafId: string,
): PerLeafTabState | null {
	if (!plugin.settings.restoreTabsOnStartup) return null;
	const all = plugin.settings.perLeafTabStates;
	if (!Array.isArray(all)) return null;
	const entry = all.find((s) => s.leafId === leafId);
	if (!entry) return null;
	// Validate the entry has the required shape (tabs array with valid records)
	if (!Array.isArray(entry.tabs) || typeof entry.activeTabId !== "string") {
		return null; // Corruption — caller detects via hasCorruptedLeafState
	}
	for (const t of entry.tabs) {
		if (
			typeof t?.tabId !== "string" ||
			typeof t?.agentId !== "string" ||
			typeof t?.label !== "string"
		) {
			return null;
		}
	}
	return entry;
}

/**
 * Detect if there's a raw entry for this leaf that exists but failed
 * validation in readPersistedLeafState. Used to trigger the corruption
 * Notice (T16).
 */
function hasCorruptedLeafState(
	plugin: AgentClientPlugin,
	leafId: string,
): boolean {
	if (!plugin.settings.restoreTabsOnStartup) return false;
	const all = plugin.settings.perLeafTabStates;
	if (!Array.isArray(all)) return false;
	// Check if there's a raw entry with matching leafId
	const rawEntry = all.find(
		(s) => typeof s === "object" && s !== null && (s as unknown as Record<string, unknown>).leafId === leafId,
	);
	if (!rawEntry) return false;
	// If readPersistedLeafState would return null for this entry, it's corrupted
	return readPersistedLeafState(plugin, leafId) === null;
}

/**
 * Convert persisted tab records to runtime TabInfo[].
 * Restored tabs start in "disconnected" state per spec § Restore.
 */
function persistedToRuntime(persisted: PersistedTabInfo[]): TabInfo[] {
	return persisted.map((p) => ({
		tabId: p.tabId,
		agentId: p.agentId,
		label: p.label,
		labelIsCustom: p.labelIsCustom ?? false,
		state: "disconnected",
		createdAt: new Date(),
	}));
}

// ============================================================================
// ChatComponent — React root with tab management
// ============================================================================

function ChatComponent({
	plugin,
	view,
	viewId,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
	viewId: string;
}) {
	const initialAgentId = resolveInitialAgentId({
		restoreEnabled: plugin.settings.restoreTabsOnStartup,
		viewStateAgentId: view.getInitialAgentId(),
		defaultAgentId: plugin.settings.defaultAgentId,
	});

	// ============================================================
	// Tab Persistence — synchronous restore for initial render
	// ============================================================
	// Read persisted leaf state synchronously from plugin.settings
	// (already in memory from loadData). This lets useTabManager
	// initialize with restored tabs on the first render — no async
	// two-phase mount needed.
	//
	// Resolution (once, on mount — the lazy initializer guarantees the adopt
	// pop runs exactly once):
	//   - Restart path: Obsidian recreates this leaf with its original id, so
	//     the synchronous id-match wins and the recently-closed stack is left
	//     intact. (Restart auto-restores.)
	//   - Default open (ribbon / "Open chat"): a fresh leaf with no id-match
	//     and no force-fresh intent → adopts the most-recently-closed tab set,
	//     so opening the panel resumes where you left off.
	//   - Explicit "new view" ("Open new view" menu/command, or "New chat" with
	//     no panel): sets the one-shot force-fresh intent, consumed here →
	//     stays a single fresh tab. "New" is the only path that doesn't
	//     restore. Gated on the "Restore tabs on startup" setting.
	//     See [[ACP Restore Tabs on View Reopen]].
	const [restoredLeaf] = useState<PerLeafTabState | null>(() =>
		resolveRestoredLeaf(readPersistedLeafState(plugin, viewId), () =>
			!plugin.consumeForceFreshView() && plugin.settings.restoreTabsOnStartup
				? plugin.adoptClosedLeaf()
				: null,
		),
	);
	// When the resolved source was adopted (its leafId differs from this fresh
	// leaf's viewId), hand it to useTabPersistence as the restore source so
	// message history loads by the snapshot's tab sessionIds — a disk read by
	// the new viewId would find nothing. undefined on the restart path leaves
	// that path byte-for-byte unchanged.
	const restoreSource = useMemo(
		() =>
			restoredLeaf && restoredLeaf.leafId !== viewId
				? restoredLeaf
				: undefined,
		[restoredLeaf, viewId],
	);
	const restoredTabs = useMemo(
		() => (restoredLeaf ? persistedToRuntime(restoredLeaf.tabs) : undefined),
		[restoredLeaf],
	);

	// Per-tab restored drafts, keyed by tabId, read synchronously from the
	// persisted leaf state. Seeds each ChatPanel's composer at first mount so a
	// half-typed prompt survives panel close/reopen and restart. Synchronous
	// (not the async useTabPersistence restore) because initial input state
	// must be seeded at mount — unlike message history, applied post-mount.
	// See [[ACP Preserve Unsent Draft Text Per Tab]].
	const restoredDraftByTabId = useMemo(() => {
		const map: Record<string, string> = {};
		for (const t of restoredLeaf?.tabs ?? []) {
			if (typeof t.draftText === "string" && t.draftText !== "") {
				map[t.tabId] = t.draftText;
			}
		}
		return map;
	}, [restoredLeaf]);

	// Per-tab restored working directory, keyed by tabId. Passed as the
	// workingDirectory prop so restored tabs keep their cwd (suppresses
	// the launch notice and shows the banner).
	const restoredCwdByTabId = useMemo(() => {
		const map: Record<string, string> = {};
		for (const t of restoredLeaf?.tabs ?? []) {
			if (typeof t.workingDirectory === "string" && t.workingDirectory !== "") {
				map[t.tabId] = t.workingDirectory;
			}
		}
		return map;
	}, [restoredLeaf]);

	const tabManager = useTabManager(
		initialAgentId,
		restoredTabs,
		restoredLeaf?.activeTabId,
	);
	const { tabs, activeTabId, activeTab } = tabManager;

	// ============================================================
	// Recently-closed-tab stack (F13 — Undo Close Tab)
	// ============================================================
	// Per-leaf, in-memory LIFO stack of closed tabs. reopenClosed() pops the
	// head, loads its transcript + context from disk, and recreates a tab that
	// reuses the existing restore-by-sessionId path (see reopenPayload below).
	const recentlyClosed = useRecentlyClosedTabs();

	// Restore payload for tabs recreated by reopenClosed(), keyed by the new
	// tabId. Feeds the same ChatPanel restore props the mount-time persistence
	// path uses (restoredSessionId / restoredMessages / restoredContextNotes),
	// so a reopened tab rehydrates its conversation identically to a tab
	// restored on startup. The render prefers this over the mount-time maps.
	const [reopenPayload, setReopenPayload] = useState<
		Record<
			string,
			{
				sessionId: string;
				messages: ChatMessage[];
				contextNotes: ContextNote[];
			}
		>
	>({});

	// One-shot seed for tabs spawned by a `newTab` quick prompt, keyed by the
	// new tabId. The new tab's ChatPanel consumes it on mount (send through the
	// lazy-acquisition path, or just seed the composer). Mirrors reopenPayload.
	const [pendingPromptByTab, setPendingPromptByTab] = useState<
		Record<string, { text: string; send: boolean }>
	>({});

	// Track C — fork payload, keyed by new tabId. Seeds the ORIGINAL session's
	// transcript for display in a tab opened via Session History "fork"; the
	// tab branches a NEW session on first send (connect-then-fork via
	// restoredForkSessionId). Kept separate from reopenPayload so a fork tab is
	// NOT given the original sessionId as restoredSessionId (which would load
	// the original instead of branching).
	const [forkPayload, setForkPayload] = useState<
		Record<
			string,
			{
				sessionId: string;
				messages: ChatMessage[];
				contextNotes: ContextNote[];
				/** Explicit, collision-suffixed "Fork: …" title for the branch. */
				title: string;
			}
		>
	>({});

	// ============================================================
	// Per-tab AcpClient management
	// ============================================================
	const acpClientsRef = useRef<Map<string, AcpClient>>(new Map());

	// Per-tab session ID tracking (for rename persistence to session history)
	const tabSessionIdsRef = useRef<Map<string, string | null>>(new Map());

	// Session-ID signature — changes when any tab acquires or loses a session.
	// Drives useTabPersistence save effect (I57). A ref-only approach misses
	// the render cycle needed to propagate the change to the hook's effect deps.
	const [sessionSignature, setSessionSignature] = useState("");

	// Draft signature — bumped (debounced) when any tab's composer text
	// changes, so useTabPersistence saves the draft shortly after typing.
	// (Draft persistence — restart fix.)
	const [draftSignature, setDraftSignature] = useState("");

	// Per-tab persisted session IDs (for lazy session restore on first keystroke)
	const persistedSessionIdsRef = useRef<Map<string, string | null>>(
		new Map(
			restoredLeaf?.tabs.map((t) => [t.tabId, t.sessionId]) ?? [],
		),
	);

	// ============================================================
	// Corruption detection (T16/T17)
	// ============================================================
	useEffect(() => {
		if (!hasCorruptedLeafState(plugin, viewId)) return;
		const notice = new Notice(
			"Could not restore previous tabs — saved state was corrupted.",
			0, // persistent until dismissed
		);
		// Add "View details" link to the notice
		const fragment = notice.messageEl.createEl("a", {
			text: " View details",
			cls: "agent-client-corruption-link",
		});
		fragment.addEventListener("click", (e) => {
			e.preventDefault();
			notice.hide();
			const rawState = JSON.stringify(
				plugin.settings.perLeafTabStates,
				null,
				2,
			);
			const modal = new CorruptionRecoveryModal(
				plugin.app,
				rawState,
				() => {
					// Retry: reload the plugin (simplest way to re-attempt restore)
					const appAny = plugin.app as unknown as {
						plugins: {
							disablePlugin: (id: string) => Promise<void>;
							enablePlugin: (id: string) => Promise<void>;
						};
					};
					void appAny.plugins.disablePlugin(plugin.manifest.id)
						.then(() => appAny.plugins.enablePlugin(plugin.manifest.id));
				},
				async () => {
					// Discard: clear tab state via settings service
					await plugin.settingsService.discardTabState();
					notice.hide();
				},
			);
			modal.open();
		});
	}, [plugin, viewId]);

	const getOrCreateClient = useCallback(
		(tabId: string): AcpClient => {
			let client = acpClientsRef.current.get(tabId);
			if (!client) {
				client = plugin.getOrCreateAcpClient(tabId);
				acpClientsRef.current.set(tabId, client);
			}
			return client;
		},
		[plugin],
	);

	const removeClient = useCallback(
		async (tabId: string) => {
			await plugin.removeAcpClient(tabId);
			acpClientsRef.current.delete(tabId);
			tabSessionIdsRef.current.delete(tabId);
		},
		[plugin],
	);

	// Cleanup all clients on unmount
	useEffect(() => {
		return () => {
			for (const tabId of acpClientsRef.current.keys()) {
				void plugin.removeAcpClient(tabId);
			}
			acpClientsRef.current.clear();
		};
	}, [plugin]);

	// Shared VaultService (one per view, not per tab)
	const vaultService = useMemo(
		() => view.vaultService,
		[view.vaultService],
	);

	// ============================================================
	// Tab Persistence — save side + async message loading
	// ============================================================
	const persistenceStorage: TabPersistenceStorage = useMemo(
		() => ({
			saveTabStateForLeaf: (leafId: string, state: PerLeafTabState) =>
				plugin.settingsService.saveTabStateForLeaf(leafId, state),
			loadTabStateForLeaf: (leafId: string) =>
				plugin.settingsService.loadTabStateForLeaf(leafId),
			loadSessionMessages: (sessionId: string) =>
				plugin.settingsService.loadSessionMessages(sessionId),
			loadSessionContextNotes: (sessionId: string) =>
				plugin.settingsService.loadSessionContextNotes(sessionId),
		}),
		[plugin.settingsService],
	);

	const getSessionIdForTab = useCallback(
		(tabId: string) =>
			resolveSessionIdForSave(
				tabSessionIdsRef.current.get(tabId) ?? null,
				persistedSessionIdsRef.current.get(tabId) ?? null,
			),
		[],
	);

	const getScrollPositionForTab = useCallback(
		(_tabId: string) => 0, // TODO: wire real scroll position in a follow-up commit
		[],
	);

	// Per-tab callback handles, registered by each ChatPanel. Declared here —
	// ahead of useTabPersistence — so getDraftForTab can read live composer
	// text from them at save-time. Also consumed by the IChatViewContainer
	// delegation and the F11 broadcast wiring further down.
	const activeCallbacksRef = useRef<ChatPanelCallbacks | null>(null);
	const tabHandlesRef = useRef<Map<string, ChatPanelCallbacks>>(new Map());

	// Resolves a tab's current unsent draft for persistence. Reads the live
	// composer value via the already-registered per-tab callbacks
	// (getInputState().text) — no extra plumbing. Read at save-time via the
	// hook's ref, so this closure does not itself trigger extra saves.
	const getDraftForTab = useCallback(
		(tabId: string) =>
			tabHandlesRef.current.get(tabId)?.getInputState()?.text ?? "",
		[],
	);

	// Resolves a tab's current resolved working directory for persistence.
	const getWorkingDirectoryForTab = useCallback(
		(tabId: string) =>
			tabHandlesRef.current.get(tabId)?.getWorkingDirectory() ?? "",
		[],
	);

	// Debounced draft-save trigger. Each ChatPanel calls this on composer
	// change; after the debounce we recompute a signature from all tabs' live
	// drafts and bump state, which fires useTabPersistence's save effect. Using
	// window.setTimeout (popout-window compat); timer ref typed as number.
	const draftDebounceRef = useRef<number | null>(null);
	const bumpDraftSignature = useCallback(() => {
		if (draftDebounceRef.current !== null) {
			window.clearTimeout(draftDebounceRef.current);
		}
		draftDebounceRef.current = window.setTimeout(() => {
			draftDebounceRef.current = null;
			const sig = Array.from(tabHandlesRef.current.entries())
				.map(([id, cb]) => `${id}:${cb.getInputState()?.text ?? ""}`)
				.join("||");
			setDraftSignature(sig);
		}, DRAFT_SAVE_DEBOUNCE_MS);
	}, []);
	useEffect(() => {
		return () => {
			if (draftDebounceRef.current !== null) {
				window.clearTimeout(draftDebounceRef.current);
			}
		};
	}, []);

	const tabPersistence = useTabPersistence({
		leafId: viewId,
		tabs,
		activeTabId,
		getSessionId: getSessionIdForTab,
		getScrollPosition: getScrollPositionForTab,
		getDraft: getDraftForTab,
		getWorkingDirectory: getWorkingDirectoryForTab,
		storage: persistenceStorage,
		restoreEnabled: plugin.settings.restoreTabsOnStartup,
		sessionSignature,
		draftSignature,
		restoreSource,
	});

	// Expose flushSave to the view class for onClose
	const flushSaveRef = useRef(tabPersistence.flushSave);
	flushSaveRef.current = tabPersistence.flushSave;
	useEffect(() => {
		view.setFlushSave(() => flushSaveRef.current());
	}, [view]);

	// Agent identity is owned by the tab (TabInfo.agentId, persisted) and by
	// per-tab restore. The legacy onAgentIdRestored->addTab effect was removed:
	// it appended a spurious last-agent tab on every reload (clobbering the
	// per-tab restore and ignoring the Default Agent setting when restore is
	// off). view.setAgentId is now a downstream mirror only.
	// See [[Tab Agent Identity and Session Acquisition Unification]] D1 + TP-I05.

	// ============================================================
	// Tab callbacks
	// ============================================================
	const handleAddTab = useCallback(() => {
		tabManager.addTab(plugin.settings.defaultAgentId);
	}, [tabManager, plugin.settings.defaultAgentId]);

	// newTab quick prompt: spawn a fresh tab on the default agent and seed it
	// with the resolved prompt. addTab appends and (when foreground) activates;
	// the new tab's ChatPanel reads `initialPrompt` on mount and either sends
	// (queues until the lazy session connects) or only seeds its composer. A
	// background open (foreground:false) appends without switching — the tab
	// still mounts and sends, the user stays on their current tab.
	const handleOpenInNewTab = useCallback(
		(text: string, opts: { send: boolean; foreground: boolean }) => {
			const newTabId = tabManager.addTab(
				plugin.settings.defaultAgentId,
				undefined,
				opts.foreground,
			);
			setPendingPromptByTab((prev) => ({
				...prev,
				[newTabId]: { text, send: opts.send },
			}));
		},
		[tabManager, plugin.settings.defaultAgentId],
	);

	const handleCloseTab = useCallback(
		(tabId: string) => {
			if (tabs.length <= 1) return; // Don't close last tab
			const idx = tabs.findIndex((t) => t.tabId === tabId);
			const tab = tabs[idx];
			if (tab) {
				recentlyClosed.capture(
					buildClosedTabRecord({
						tab,
						sessionId: getSessionIdForTab(tabId),
						position: idx,
					}),
				);
			}
			void removeClient(tabId);
			tabManager.removeTab(tabId);
		},
		[tabs, removeClient, tabManager, recentlyClosed, getSessionIdForTab],
	);

	const handleCloseOtherTabs = useCallback(
		(tabId: string) => {
			tabs.forEach((tab, idx) => {
				if (tab.tabId !== tabId) {
					recentlyClosed.capture(
						buildClosedTabRecord({
							tab,
							sessionId: getSessionIdForTab(tab.tabId),
							position: idx,
						}),
					);
					void removeClient(tab.tabId);
				}
			});
			tabManager.removeOtherTabs(tabId);
		},
		[tabs, removeClient, tabManager, recentlyClosed, getSessionIdForTab],
	);

	const handleCloseTabsToRight = useCallback(
		(tabId: string) => {
			const idx = tabs.findIndex((t) => t.tabId === tabId);
			for (let i = idx + 1; i < tabs.length; i++) {
				recentlyClosed.capture(
					buildClosedTabRecord({
						tab: tabs[i],
						sessionId: getSessionIdForTab(tabs[i].tabId),
						position: i,
					}),
				);
				void removeClient(tabs[i].tabId);
			}
			tabManager.removeTabsToRight(tabId);
		},
		[tabs, removeClient, tabManager, recentlyClosed, getSessionIdForTab],
	);

	// Reopen the most-recently-closed tab and restore its conversation (F13).
	const reopenClosed = useCallback(async () => {
		const record = recentlyClosed.reopenLast();
		if (!record) {
			new Notice("No recently closed session to reopen");
			return;
		}

		// Load the closed session's transcript + context notes from disk —
		// the same storage calls the mount-time restore path uses (U37/I61).
		const [messages, contextNotes] = await Promise.all([
			persistenceStorage.loadSessionMessages(record.sessionId),
			persistenceStorage.loadSessionContextNotes(record.sessionId),
		]);

		// Recreate the tab. addTab appends and activates it; capture the
		// pre-add length so we can best-effort reinsert at the prior index.
		const priorLength = tabs.length;
		const newTabId = tabManager.addTab(record.agentId, record.label);
		if (record.labelIsCustom) {
			tabManager.setTabLabel(newTabId, record.label, true);
		}

		// Seed the restore payload so the new tab's ChatPanel rehydrates via
		// the existing restoredSessionId / restoredMessages / restoredContextNotes
		// props — idle-seed of the transcript on arrival (I43/I61) and reconnect
		// on first keystroke (useLazySession). Identical to startup auto-restore.
		setReopenPayload((prev) => ({
			...prev,
			[newTabId]: {
				sessionId: record.sessionId,
				messages: messages ?? [],
				contextNotes: contextNotes ?? [],
			},
		}));

		// Persist the sessionId for the reopened tab so it survives a later
		// restart and resolves on save (getSessionIdForTab falls back to this
		// ref). Set synchronously so the addTab-driven save effect captures it.
		persistedSessionIdsRef.current.set(newTabId, record.sessionId);

		// Best-effort: move the reopened tab to its prior bar position. The
		// new tab sits at index `priorLength`; only reinsert when that index
		// still exists (later tabs may have shifted things).
		if (record.position < priorLength) {
			tabManager.moveTab(priorLength, record.position);
		}
	}, [recentlyClosed, persistenceStorage, tabManager, tabs.length]);

	const handleRenameTab = useCallback(
		(tabId: string) => {
			const tab = tabs.find((t) => t.tabId === tabId);
			if (!tab) return;

			const modal = new EditTitleModal(
				plugin.app,
				tab.label,
				async (newTitle) => {
					const duplicate = tabs.find(
						(t) =>
							t.tabId !== tabId &&
							t.label === truncateLabel(newTitle),
					);
					if (duplicate) {
						new Notice(
							"[Agent Console] A tab with that name already exists",
						);
						return;
					}
					tabManager.setTabLabel(tabId, newTitle, true);

					// Persist to session history. Resolve the session id with
					// the persisted fallback (I73) — a restored tab that has
					// not reconnected yet has no entry in the live map, only
					// in persistedSessionIdsRef. Mirrors resolveSessionIdForSave
					// (I59); without it the rename is lost from history.
					const updated = resolveRenamedSessionWrite(
						tabSessionIdsRef.current.get(tabId) ?? null,
						persistedSessionIdsRef.current.get(tabId) ?? null,
						plugin.settingsService.getSavedSessions(),
						newTitle,
						new Date().toISOString(),
					);
					if (updated) {
						await plugin.settingsService.saveSession(updated);
					}
				},
			);
			modal.open();
		},
		[tabs, plugin, tabManager],
	);

	const handleAddTabWithAgent = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const menu = new Menu();
			registerOpenMenu(menu);
			const agents = plugin.getAvailableAgents();
			for (const agent of agents) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(agent.displayName).onClick(() => {
						tabManager.addTab(agent.id);
					});
				});
			}
			showMenuAtEvent(menu, e);
		},
		[plugin, tabManager],
	);

	// ============================================================
	// State change callback for tab icons
	// ============================================================
	const handleTabStateChange = useCallback(
		(tabId: string, state: TabState) => {
			tabManager.setTabState(tabId, state);
		},
		[tabManager],
	);

	const handleTabLabelChange = useCallback(
		(tabId: string, label: string) => {
			if (label === "") {
				tabManager.resetTab(tabId);
				return;
			}
			// F03: auto-applied labels (prompt-derived interim + the AI title
			// swap) get a filesystem-style numeric suffix on collision with
			// another OPEN tab's label, computed here at apply time against the
			// other tabs only. Never retroactively renumbered when a sibling
			// closes. Manual renames go through handleRenameTab (custom=true)
			// and reject duplicates instead (T40/I22).
			const truncated = truncateLabel(label);
			const otherLabels = tabManager.tabs
				.filter((t) => t.tabId !== tabId)
				.map((t) => t.label);
			tabManager.setTabLabel(
				tabId,
				suffixOnCollision(truncated, otherLabels),
			);
		},
		[tabManager],
	);

	const handleSessionIdChange = useCallback(
		(tabId: string, sessionId: string | null) => {
			tabSessionIdsRef.current.set(tabId, sessionId);
			// Trigger a save via useTabPersistence by updating the session
			// signature (I57 — ensures sessionId is persisted on acquisition).
			setSessionSignature(
				Array.from(tabSessionIdsRef.current.entries())
					.map(([id, sid]) => `${id}:${sid ?? ""}`)
					.join("||"),
			);
		},
		[],
	);

	/** Find a tab that owns the given session ID (for I20: avoid restoring an already-open session) */
	const findTabBySessionId = useCallback(
		(sessionId: string): { tabId: string; label: string } | null => {
			for (const [tabId, sid] of tabSessionIdsRef.current) {
				if (sid === sessionId) {
					const tab = tabs.find((t) => t.tabId === tabId);
					if (tab) return { tabId: tab.tabId, label: tab.label };
				}
			}
			return null;
		},
		[tabs],
	);


	// Track C — open a history session in a tab (restore or fork). The
	// session-history modal routes its restore/fork actions here (via the
	// onOpenSessionInTab prop threaded through ChatPanel) instead of restoring
	// INTO the current tab, so the active session is never clobbered ("safe
	// defaults — no surprise data loss", [[Restore-fork gated on agent
	// connection]]). Gated on data + intent, not connection — the new tab
	// reconnects lazily on first send (supersedes I09/I41).
	//
	// Target-tab decision:
	//   - target already open in another tab → switch to it (I20)
	//   - otherwise → append a NEW tab, activated, seeded so its ChatPanel
	//     rehydrates via the same restored* props the F13 reopen + startup
	//     restore paths use. (Reuse-of-an-empty-lazy-tab is a deferred
	//     refinement — restored* props are read at mount, so a fresh tab is
	//     the mechanism that actually works; always-new-tab is also the safe
	//     default that never clobbers.)
	//
	// Restore loads the original session; fork branches a NEW session from it.
	const openSessionInTab = useCallback(
		// Fork is deferred to the Session History Source Model track; this
		// orchestration handles RESTORE only (the `mode` param is retained for
		// the upcoming fork path).
		async (sessionId: string, cwd: string, mode: "restore" | "fork") => {
			void cwd; // cwd is carried for parity; agentCwd is resolved per tab.
			// Switch-if-open is RESTORE-only (I20): restoring a session that is
			// already open just focuses its tab. Fork must NOT switch — forking
			// a session whose tab is open is the primary use case, so it always
			// branches into a new tab.
			if (mode === "restore") {
				const existing = findTabBySessionId(sessionId);
				if (existing) {
					tabManager.setActiveTab(existing.tabId);
					return;
				}
			}

			// Restore whichever agent the session ran on (plugin-level history),
			// falling back to the active tab's agent when unknown.
			const savedSessions = plugin.settingsService.getSavedSessions();
			const saved = savedSessions.find((s) => s.sessionId === sessionId);
			const agentId = saved?.agentId ?? activeTab.agentId;
			const baseLabel = saved?.title ?? "Session";
			// Forks can't earn an AI title (the rubric fires only on a tab's
			// first message and a fork is seeded with the transcript), so they
			// won't diverge on their own — suffix the "Fork: …" title against
			// existing saved-session titles so multiple forks stay distinct.
			const label =
				mode === "fork"
					? suffixOnCollision(
							truncateLabel(`Fork: ${baseLabel}`),
							savedSessions.map((s) => s.title ?? ""),
						)
					: truncateLabel(baseLabel);

			// Load the transcript + context notes from disk — the same storage
			// the reopen/startup-restore paths read.
			const [messages, contextNotes] = await Promise.all([
				persistenceStorage.loadSessionMessages(sessionId),
				persistenceStorage.loadSessionContextNotes(sessionId),
			]);

			const newTabId = tabManager.addTab(agentId, label);
			// RC-1: mark the seeded label custom so ChatPanel's auto-derivation
			// (first-message-derived label / AI-title swap) doesn't clobber it.
			// The restored saved title (already the AI title) and the "Fork: …"
			// prefix must stick. setTabLabel ignores non-custom overwrites of a
			// custom label (useTabManager L194), so this is the protection.
			tabManager.setTabLabel(newTabId, label, true);

			if (mode === "fork") {
				// Seed the original transcript for display; the new tab branches
				// a NEW session on first send (forkFromSessionId). No persisted
				// id — the branch id is minted at fork time.
				setForkPayload((prev) => ({
					...prev,
					[newTabId]: {
						sessionId,
						messages: messages ?? [],
						contextNotes: contextNotes ?? [],
						title: label,
					},
				}));
			} else {
				// Seed transcript + the session id so the tab loads it lazily on
				// first send (and survives a later restart).
				setReopenPayload((prev) => ({
					...prev,
					[newTabId]: {
						sessionId,
						messages: messages ?? [],
						contextNotes: contextNotes ?? [],
					},
				}));
				persistedSessionIdsRef.current.set(newTabId, sessionId);
			}
		},
		[
			findTabBySessionId,
			tabManager,
			plugin.settingsService,
			activeTab.agentId,
			persistenceStorage,
		],
	);

	// ============================================================
	// Register callbacks for IChatViewContainer (active tab only)
	// (activeCallbacksRef / tabHandlesRef are declared earlier so
	// getDraftForTab can read live composer text at save-time.)
	// ============================================================
	useEffect(() => {
		view.setCallbacks({
			getDisplayName: () =>
				activeCallbacksRef.current?.getDisplayName() ?? "Chat",
			getInputState: () =>
				activeCallbacksRef.current?.getInputState() ?? null,
			setInputState: (state) =>
				activeCallbacksRef.current?.setInputState(state),
			canSend: () =>
				activeCallbacksRef.current?.canSend() ?? false,
			sendMessage: async () =>
				(await activeCallbacksRef.current?.sendMessage()) ??
				false,
			cancelOperation: async () =>
				activeCallbacksRef.current?.cancelOperation(),
			hasPendingQueue: () =>
				activeCallbacksRef.current?.hasPendingQueue() ?? false,
			runQuickPrompt: (prompt, opts) =>
				activeCallbacksRef.current?.runQuickPrompt(prompt, opts),
			startQuickPromptSearch: () =>
				activeCallbacksRef.current?.startQuickPromptSearch(),
			saveComposerAsQuickPrompt: () =>
				activeCallbacksRef.current?.saveComposerAsQuickPrompt(),
			getWorkingDirectory: () =>
				activeCallbacksRef.current?.getWorkingDirectory() ?? "",
			openHistory: () =>
				activeCallbacksRef.current?.openHistory(),
		});
		view.setTabHandlesAccessor(() =>
			Array.from(tabHandlesRef.current.entries()).map(
				([tabId, cb]) => ({
					tabId,
					getInputState: cb.getInputState,
					setInputState: cb.setInputState,
					canSend: cb.canSend,
					sendMessage: cb.sendMessage,
					cancelOperation: cb.cancelOperation,
					hasPendingQueue: cb.hasPendingQueue,
				}),
			),
		);
	}, [view]);

	// ============================================================
	// Persist agent ID when active tab changes
	// ============================================================
	useEffect(() => {
		view.setAgentId(activeTab.agentId);
	}, [view, activeTab.agentId]);

	// Expose tabManager to the view class for commands
	useEffect(() => {
		view.setTabManager(tabManager);
	}, [view, tabManager]);

	// Expose F13 reopen + a capture-aware active-tab close to the view class.
	// The close-session-tab COMMAND must route through handleCloseTab (which
	// captures the closed record + removes the client) rather than calling
	// tabManager.removeTab directly, so undo-close works after a command close.
	useEffect(() => {
		view.setReopenClosedTab(() => {
			void reopenClosed();
		});
		view.setCloseActiveTab(() => {
			handleCloseTab(activeTabId);
		});
	}, [view, reopenClosed, handleCloseTab, activeTabId]);

	// Wire the TabBar's "open tab list" capability to the view class so the
	// show-tab-list plugin command (hotkey-bindable) can trigger it.
	const handleRegisterShowTabList = useCallback(
		(fn: () => void) => view.setShowTabList(fn),
		[view],
	);

	// Prune broadcast handles for tabs that have closed (F11)
	useEffect(() => {
		const liveIds = new Set(tabs.map((t) => t.tabId));
		for (const id of tabHandlesRef.current.keys()) {
			if (!liveIds.has(id)) {
				tabHandlesRef.current.delete(id);
			}
		}
	}, [tabs]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<TabBar
				tabs={tabs}
				activeTabId={activeTabId}
				onSelectTab={tabManager.setActiveTab}
				onAddTab={handleAddTab}
				onCloseTab={handleCloseTab}
				onCloseOtherTabs={handleCloseOtherTabs}
				onCloseTabsToRight={handleCloseTabsToRight}
				onRenameTab={handleRenameTab}
				onMoveTab={tabManager.moveTab}
				onAddTabWithAgent={handleAddTabWithAgent}
				onRegisterShowTabList={handleRegisterShowTabList}
			/>
			{tabs.map((tab) => (
				<div
					key={tab.tabId}
					className="agent-client-tab-panel"
					style={{
						display:
							tab.tabId === activeTabId
								? "flex"
								: "none",
						flexDirection: "column" as const,
						flex: 1,
						minHeight: 0,
					}}
				>
					<TabErrorBoundary
						tabId={tab.tabId}
						onError={(tabId) =>
							handleTabStateChange(tabId, "error")
						}
						onRetry={(tabId) => tabManager.resetTab(tabId)}
					>
						<TabPanel
							plugin={plugin}
							acpClient={getOrCreateClient(tab.tabId)}
							vaultService={vaultService}
						>
							<ChatPanel
								viewId={tab.tabId}
								tabLabel={tab.label}
								workingDirectory={restoredCwdByTabId[tab.tabId]}
								initialAgentId={tab.agentId}
								viewHost={view}
								isActive={tab.tabId === activeTabId}
								onRegisterCallbacks={(callbacks) => {
									tabHandlesRef.current.set(
										tab.tabId,
										callbacks,
									);
									if (tab.tabId === activeTabId) {
										activeCallbacksRef.current =
											callbacks;
									}
								}}
								onAgentIdChanged={(agentId) => {
									// Update the persisted source of truth, then
									// mirror to Obsidian view-state (TP-I05 / D1).
									tabManager.setTabAgent(
										tab.tabId,
										agentId,
									);
									view.setAgentId(agentId);
								}}
								onStateChange={(state) =>
									handleTabStateChange(
										tab.tabId,
										state,
									)
								}
								onLabelChange={(label) =>
									handleTabLabelChange(
										tab.tabId,
										label,
									)
								}
								onSessionIdChange={(sessionId) =>
									handleSessionIdChange(
										tab.tabId,
										sessionId,
									)
								}
								findTabBySessionId={findTabBySessionId}
								onSwitchToTab={tabManager.setActiveTab}
								onCloseTab={tabManager.removeTab}
								onOpenSessionInTab={openSessionInTab}
								onSetTabLabelCustom={(tabId, label) =>
									tabManager.setTabLabel(tabId, label, true)
								}
								restoredSessionId={
									reopenPayload[tab.tabId]?.sessionId ??
									persistedSessionIdsRef.current.get(tab.tabId) ??
									null
								}
								restoredForkSessionId={
									forkPayload[tab.tabId]?.sessionId ?? null
								}
								restoredForkTitle={
									forkPayload[tab.tabId]?.title
								}
								restoredMessages={resolveSeededMessages({
									restore: reopenPayload[tab.tabId],
									fork: forkPayload[tab.tabId],
									persistedMessages:
										tabPersistence.restoredMessages[
											tab.tabId
										],
								})}
								restoredContextNotes={resolveSeededContextNotes(
									{
										restore: reopenPayload[tab.tabId],
										fork: forkPayload[tab.tabId],
										persistedContextNotes:
											tabPersistence.restoredContextNotes[
												tab.tabId
											],
									},
								)}
								historyRecoverable={
									!!tabPersistence.recoverableTabs[tab.tabId]
								}
								restoredDraft={
									restoredDraftByTabId[tab.tabId]
								}
								onDraftChange={bumpDraftSignature}
								onOpenInNewTab={handleOpenInNewTab}
								initialPrompt={
									pendingPromptByTab[tab.tabId]
								}
							/>
						</TabPanel>
					</TabErrorBoundary>
				</div>
			))}
		</div>
	);
}

// ============================================================================
// ChatView State
// ============================================================================

/** State stored for view persistence */
interface ChatViewState extends Record<string, unknown> {
	initialAgentId?: string;
}

// ============================================================================
// ChatView Class
// ============================================================================

export class ChatView extends ItemView implements IChatViewContainer {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	/** Unique identifier for this view instance */
	readonly viewId: string;
	/** View type for IChatViewContainer */
	readonly viewType: ChatViewType = "sidebar";
	/** Initial agent ID passed via state */
	private initialAgentId: string | null = null;
	/** Callbacks to notify React when agentId is restored */
	private agentIdRestoredCallbacks: Set<(agentId: string) => void> =
		new Set();

	// Services owned by this class
	/** @internal Exposed to ChatComponent for context creation */
	vaultService!: VaultService;

	// Callbacks from ChatPanel for IChatViewContainer delegation
	private callbacks: ChatPanelCallbacks | null = null;

	// Tab manager reference (set by React component)
	private tabManagerRef: ReturnType<typeof useTabManager> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = getLogger();
		this.navigation = false;
		this.viewId = (leaf as { id?: string }).id ?? crypto.randomUUID();

		// Focus-scoped Cmd+W interception. Obsidian activates this scope only
		// while this view is focused, so it does not affect Cmd+W elsewhere.
		// We always preventDefault (return false) and own the close decision —
		// no reliance on scope fall-through to the global workspace:close.
		// This is the only sanctioned close-interception path: there is no
		// Obsidian API hook to gate WorkspaceLeaf.detach() (pane-menu Close,
		// "Close all", and programmatic detach are not catchable here — undo
		// close tab covers post-hoc recovery for those).
		// See [[ACP Confirm Close With Multiple Tabs]].
		this.scope = new Scope(this.plugin.app.scope);
		this.scope.register(["Mod"], "w", () => {
			this.handleCloseRequest();
			return false;
		});
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "Agent console";
	}

	getIcon() {
		return "agent-console";
	}

	getState(): ChatViewState {
		return {
			initialAgentId: this.initialAgentId ?? undefined,
		};
	}

	async setState(
		state: ChatViewState,
		result: { history: boolean },
	): Promise<void> {
		const previousAgentId = this.initialAgentId;
		this.initialAgentId = state.initialAgentId ?? null;
		await super.setState(state, result);

		if (this.initialAgentId && this.initialAgentId !== previousAgentId) {
			this.agentIdRestoredCallbacks.forEach((cb) =>
				cb(this.initialAgentId!),
			);
		}
	}

	getInitialAgentId(): string | null {
		return this.initialAgentId;
	}

	setAgentId(agentId: string): void {
		this.initialAgentId = agentId;
		this.app.workspace.requestSaveLayout();
	}

	onAgentIdRestored(callback: (agentId: string) => void): () => void {
		this.agentIdRestoredCallbacks.add(callback);
		return () => {
			this.agentIdRestoredCallbacks.delete(callback);
		};
	}

	// ============================================================
	// Tab Manager (set by React component)
	// ============================================================

	setTabManager(
		manager: ReturnType<typeof useTabManager> | null,
	): void {
		this.tabManagerRef = manager;
	}

	// Tab persistence flush (set by React component)
	private flushSaveFn: (() => Promise<void>) | null = null;

	setFlushSave(fn: () => Promise<void>): void {
		this.flushSaveFn = fn;
	}

	/** Add a new tab (for Obsidian commands) */
	addTab(agentId?: string): void {
		if (this.tabManagerRef) {
			this.tabManagerRef.addTab(
				agentId ?? this.plugin.settings.defaultAgentId,
			);
		}
	}

	/** Get the active tab's ID (used as viewId by ChatPanel) */
	getActiveTabId(): string {
		return this.tabManagerRef?.activeTabId ?? this.viewId;
	}

	// F13: reopen-closed + capture-aware close, registered by the React
	// component (ChatComponent) via the effect that also calls setTabManager.
	private reopenClosedTabFn: (() => void) | null = null;
	private closeActiveTabFn: (() => void) | null = null;
	// Opens the tab list (chevron dropdown), registered by the React component.
	// Drives the show-tab-list command. See TabBar.onRegisterShowTabList.
	private showTabListFn: (() => void) | null = null;

	setReopenClosedTab(fn: () => void): void {
		this.reopenClosedTabFn = fn;
	}

	setCloseActiveTab(fn: () => void): void {
		this.closeActiveTabFn = fn;
	}

	/** Reopen the most-recently-closed tab and restore its conversation (F13). */
	reopenClosedTab(): void {
		this.reopenClosedTabFn?.();
	}

	/** Register the tab-list opener (called by the React TabBar on mount). */
	setShowTabList(fn: () => void): void {
		this.showTabListFn = fn;
	}

	/** Open the tab list (for the show-tab-list Obsidian command). */
	showTabList(): void {
		this.showTabListFn?.();
	}

	/** Close the active tab (for Obsidian commands) */
	closeActiveTab(): void {
		// Prefer the React-registered handler so a command-driven close
		// captures a recently-closed record (F13) and removes the ACP client,
		// matching the UI close path. Fall back to the direct tabManager path
		// only before registration completes.
		if (this.closeActiveTabFn) {
			this.closeActiveTabFn();
			return;
		}
		if (this.tabManagerRef) {
			this.tabManagerRef.removeTab(
				this.tabManagerRef.activeTabId,
			);
		}
	}

	/**
	 * Handle a focused Cmd+W on this panel. If the panel has multiple chats
	 * and the setting is on, confirm before tearing them all down; otherwise
	 * close immediately (faithful replication of Cmd+W-closes-this-leaf).
	 * Fails open: if tab state is not yet available, close normally.
	 */
	private handleCloseRequest(): void {
		const tabCount = this.tabManagerRef?.tabs.length ?? 0;
		const enabled = this.plugin.settings.confirmCloseWithMultipleTabs;
		if (!shouldConfirmClose(tabCount, enabled)) {
			this.leaf.detach();
			return;
		}
		new ConfirmCloseModal(this.plugin.app, tabCount, () => {
			this.leaf.detach();
		}).open();
	}

	/** Switch to next tab (for Obsidian commands) */
	nextTab(): void {
		this.tabManagerRef?.nextTab();
	}

	/** Switch to previous tab (for Obsidian commands) */
	prevTab(): void {
		this.tabManagerRef?.prevTab();
	}

	// ============================================================
	// Callbacks from ChatPanel
	// ============================================================

	setCallbacks(callbacks: ChatPanelCallbacks): void {
		this.callbacks = callbacks;
	}

	// All-tabs broadcast handle accessor (set by React component, F11)
	private tabHandlesAccessor: (() => IChatTabHandle[]) | null = null;

	setTabHandlesAccessor(fn: () => IChatTabHandle[]): void {
		this.tabHandlesAccessor = fn;
	}

	getTabHandles(): IChatTabHandle[] {
		return this.tabHandlesAccessor?.() ?? [];
	}

	getDisplayName(): string {
		return this.callbacks?.getDisplayName() ?? "Chat";
	}

	getInputState(): ChatInputState | null {
		return this.callbacks?.getInputState() ?? null;
	}

	setInputState(state: ChatInputState): void {
		this.callbacks?.setInputState(state);
	}

	async sendMessage(): Promise<boolean> {
		return (await this.callbacks?.sendMessage()) ?? false;
	}

	canSend(): boolean {
		return this.callbacks?.canSend() ?? false;
	}

	async cancelOperation(): Promise<void> {
		await this.callbacks?.cancelOperation();
	}

	/** Open the active tab's Session History modal (open-session-history command). */
	openSessionHistory(): void {
		this.callbacks?.openHistory();
	}

	runQuickPrompt(prompt: QuickPrompt, gesture: QuickPromptGesture): void {
		this.callbacks?.runQuickPrompt(prompt, gesture);
	}

	startQuickPromptSearch(): void {
		this.callbacks?.startQuickPromptSearch();
	}

	saveComposerAsQuickPrompt(): void {
		this.callbacks?.saveComposerAsQuickPrompt();
	}

	// ============================================================
	// IChatViewContainer Implementation
	// ============================================================

	onActivate(): void {
		this.logger.log(`Activated: ${this.viewId}`);
	}

	onDeactivate(): void {
		this.logger.log(`Deactivated: ${this.viewId}`);
	}

	focus(): void {
		void this.app.workspace.revealLeaf(this.leaf).then(() => {
			// revealLeaf shows the leaf but does not move keyboard focus to it
			// (I136 H2); setActiveLeaf does. Defer the composer focus one frame
			// so it lands after Obsidian activates the leaf (H3).
			this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
			window.requestAnimationFrame(() =>
				focusActiveTabComposer(this.containerEl),
			);
		});
	}

	hasFocus(): boolean {
		return this.containerEl.contains(activeDocument.activeElement);
	}

	expand(): void {
		// Sidebar views don't have expand/collapse state
	}

	collapse(): void {
		// Sidebar views don't have expand/collapse state
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		// VaultService is shared across all tabs in this view
		this.vaultService = new VaultService(this.plugin);

		this.root = createRoot(container);
		this.root.render(
			<ChatComponent
				plugin={this.plugin}
				view={this}
				viewId={this.viewId}
			/>,
		);

		this.plugin.viewRegistry.register(this);
		return Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.logger.log("onClose() called");

		// Flush tab persistence before unmounting React (U30, T07)
		if (this.flushSaveFn) {
			try {
				await this.flushSaveFn();
			} catch (e) {
				this.logger.error("flushSave error:", e);
			}
		}

		// Reopen-restore: snapshot this leaf's just-saved tab set onto the
		// plugin's recently-closed stack so a fresh ChatView leaf opened later
		// in the same session can adopt it. flushSave above wrote this leaf's
		// entry to settings (updateSettings keeps plugin.settings in sync), so
		// read it back and capture. buildClosedLeafRecord skips a trivial lone
		// idle tab. Gated on the same setting as restart-restore (Decision #1).
		// See [[ACP Restore Tabs on View Reopen]].
		if (this.plugin.settings.restoreTabsOnStartup) {
			const entry = this.plugin.settings.perLeafTabStates?.find(
				(s) => s.leafId === this.viewId,
			);
			if (entry) {
				this.plugin.captureClosedLeaf(buildClosedLeafRecord(entry));
			}
		}

		this.plugin.viewRegistry.unregister(this.viewId);

		// React cleanup handles per-tab AcpClient disconnection
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}

		this.vaultService?.destroy();
		this.tabManagerRef = null;
		this.flushSaveFn = null;
	}
}
