import {
	ItemView,
	WorkspaceLeaf,
	Menu,
	Notice,
	Scope,
	type MenuItem,
} from "obsidian";
import { registerOpenMenu } from "../utils/menu-registry";
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
import type {
	TabInfo,
	TabState,
	PerLeafTabState,
	PersistedTabInfo,
} from "../types/tab";

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
import { useTabManager, truncateLabel } from "../hooks/useTabManager";
import {
	useTabPersistence,
	type TabPersistenceStorage,
} from "../hooks/useTabPersistence";
import { useRecentlyClosedTabs } from "../hooks/useRecentlyClosedTabs";

// Service imports
import { VaultService } from "../services/vault-service";
import {
	resolveSessionIdForSave,
	resolveRenamedSessionWrite,
} from "../services/session-helpers";
import { buildClosedTabRecord } from "../services/recently-closed-stack";
import type { AcpClient } from "../acp/acp-client";

export const VIEW_TYPE_CHAT = "agent-client-chat-view";

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
		(s) =>
			typeof s === "object" &&
			s !== null &&
			(s as unknown as Record<string, unknown>).leafId === leafId,
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
	const initialAgentId =
		view.getInitialAgentId() ?? plugin.settings.defaultAgentId;

	// ============================================================
	// Tab Persistence — synchronous restore for initial render
	// ============================================================
	// Read persisted leaf state synchronously from plugin.settings
	// (already in memory from loadData). This lets useTabManager
	// initialize with restored tabs on the first render — no async
	// two-phase mount needed.
	const restoredLeaf = useMemo(
		() => readPersistedLeafState(plugin, viewId),
		// plugin and viewId are stable across the component's lifetime.
		[plugin, viewId],
	);
	const restoredTabs = useMemo(
		() =>
			restoredLeaf ? persistedToRuntime(restoredLeaf.tabs) : undefined,
		[restoredLeaf],
	);

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

	// Per-tab persisted session IDs (for lazy session restore on first keystroke)
	const persistedSessionIdsRef = useRef<Map<string, string | null>>(
		new Map(restoredLeaf?.tabs.map((t) => [t.tabId, t.sessionId]) ?? []),
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
					void appAny.plugins
						.disablePlugin(plugin.manifest.id)
						.then(() =>
							appAny.plugins.enablePlugin(plugin.manifest.id),
						);
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
	const vaultService = useMemo(() => view.vaultService, [view.vaultService]);

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

	const tabPersistence = useTabPersistence({
		leafId: viewId,
		tabs,
		activeTabId,
		getSessionId: getSessionIdForTab,
		getScrollPosition: getScrollPositionForTab,
		storage: persistenceStorage,
		restoreEnabled: plugin.settings.restoreTabsOnStartup,
		sessionSignature,
	});

	// Expose flushSave to the view class for onClose
	const flushSaveRef = useRef(tabPersistence.flushSave);
	flushSaveRef.current = tabPersistence.flushSave;
	useEffect(() => {
		view.setFlushSave(() => flushSaveRef.current());
	}, [view]);

	// ============================================================
	// Agent ID restoration from Obsidian setState
	// ============================================================
	useEffect(() => {
		const unsubscribe = view.onAgentIdRestored((agentId) => {
			// Update the active tab's agent
			tabManager.addTab(agentId);
		});
		return unsubscribe;
	}, [view, tabManager.addTab]);

	// ============================================================
	// Tab callbacks
	// ============================================================
	const handleAddTab = useCallback(() => {
		tabManager.addTab(plugin.settings.defaultAgentId);
	}, [tabManager, plugin.settings.defaultAgentId]);

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
			menu.showAtMouseEvent(e.nativeEvent);
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
			} else {
				tabManager.setTabLabel(tabId, label);
			}
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

	// ============================================================
	// Register callbacks for IChatViewContainer (active tab only)
	// ============================================================
	const activeCallbacksRef = useRef<ChatPanelCallbacks | null>(null);
	const tabHandlesRef = useRef<Map<string, ChatPanelCallbacks>>(new Map());

	useEffect(() => {
		view.setCallbacks({
			getDisplayName: () =>
				activeCallbacksRef.current?.getDisplayName() ?? "Chat",
			getInputState: () =>
				activeCallbacksRef.current?.getInputState() ?? null,
			setInputState: (state) =>
				activeCallbacksRef.current?.setInputState(state),
			canSend: () => activeCallbacksRef.current?.canSend() ?? false,
			sendMessage: async () =>
				(await activeCallbacksRef.current?.sendMessage()) ?? false,
			cancelOperation: async () =>
				activeCallbacksRef.current?.cancelOperation(),
		});
		view.setTabHandlesAccessor(() =>
			Array.from(tabHandlesRef.current.entries()).map(([tabId, cb]) => ({
				tabId,
				getInputState: cb.getInputState,
				setInputState: cb.setInputState,
				canSend: cb.canSend,
				sendMessage: cb.sendMessage,
				cancelOperation: cb.cancelOperation,
			})),
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
		<div
			style={{ display: "flex", flexDirection: "column", height: "100%" }}
		>
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
			/>
			{tabs.map((tab) => (
				<div
					key={tab.tabId}
					className="agent-client-tab-panel"
					style={{
						display: tab.tabId === activeTabId ? "flex" : "none",
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
								initialAgentId={tab.agentId}
								viewHost={view}
								isActive={tab.tabId === activeTabId}
								onRegisterCallbacks={(callbacks) => {
									tabHandlesRef.current.set(
										tab.tabId,
										callbacks,
									);
									if (tab.tabId === activeTabId) {
										activeCallbacksRef.current = callbacks;
									}
								}}
								onAgentIdChanged={(agentId) =>
									view.setAgentId(agentId)
								}
								onStateChange={(state) =>
									handleTabStateChange(tab.tabId, state)
								}
								onLabelChange={(label) =>
									handleTabLabelChange(tab.tabId, label)
								}
								onSessionIdChange={(sessionId) =>
									handleSessionIdChange(tab.tabId, sessionId)
								}
								findTabBySessionId={findTabBySessionId}
								onSwitchToTab={tabManager.setActiveTab}
								restoredSessionId={
									reopenPayload[tab.tabId]?.sessionId ??
									persistedSessionIdsRef.current.get(
										tab.tabId,
									) ??
									null
								}
								restoredMessages={
									reopenPayload[tab.tabId]?.messages ??
									tabPersistence.restoredMessages[tab.tabId]
								}
								restoredContextNotes={
									reopenPayload[tab.tabId]?.contextNotes ??
									tabPersistence.restoredContextNotes[
										tab.tabId
									]
								}
								historyRecoverable={
									!!tabPersistence.recoverableTabs[tab.tabId]
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

	setTabManager(manager: ReturnType<typeof useTabManager> | null): void {
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
			this.tabManagerRef.removeTab(this.tabManagerRef.activeTabId);
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
			const textarea = this.containerEl.querySelector(
				"textarea.agent-client-chat-input-textarea",
			);
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus();
			}
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
