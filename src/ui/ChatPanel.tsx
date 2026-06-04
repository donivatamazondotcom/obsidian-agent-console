import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import {
	Notice,
	FileSystemAdapter,
	Platform,
	Menu,
	setIcon,
	type MenuItem,
} from "obsidian";

import type { AttachedFile, ChatInputState, ChatMessage } from "../types/chat";
import { isSameDirectory } from "../utils/platform";
import { useHistoryModal } from "../hooks/useHistoryModal";
import { useChatActions } from "../hooks/useChatActions";
import { ChangeDirectoryModal } from "./ChangeDirectoryModal";

// Service imports
import { getLogger } from "../utils/logger";
import { deriveTabLabel } from "../utils/deriveTabLabel";
import { useRestoredMessages } from "../hooks/useRestoredMessages";
import { loadExistingSessionFlow } from "../hooks/loadExistingSessionFlow";

// Adapter imports
import type { AcpClient } from "../acp/acp-client";

// Context imports
import { useChatContext } from "./ChatContext";

// Hooks imports
import { useSettings } from "../hooks/useSettings";
import { useSuggestions } from "../hooks/useSuggestions";
import { useContextNotes } from "../hooks/useContextNotes";
import type { ContextNote } from "../types/context";
import { useSelectionTracker } from "../hooks/useSelectionTracker";
import {
	useContextVaultEvents,
	type VaultEventSource,
} from "../hooks/useContextVaultEvents";
import { useAgent } from "../hooks/useAgent";
import { useSessionHistory } from "../hooks/useSessionHistory";
import { useLazySession } from "../hooks/useLazySession";
import { useDebouncedSessionSave } from "../hooks/useDebouncedSessionSave";

// Domain model imports
import {
	flattenConfigSelectOptions,
	type SlashCommand,
	type SessionModeState,
	type SessionModelState,
	type SessionConfigOption,
} from "../types/session";
import { checkAgentUpdate } from "../services/update-checker";

/** Stable empty array for useSuggestions when no commands available */
const EMPTY_COMMANDS: SlashCommand[] = [];

// Component imports
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { ContextStrip } from "./ContextStrip";
import { computeProvisionalPath } from "../utils/provisional-context";
import type { IChatViewHost } from "./view-host";

// ============================================================================
// ChatPanelCallbacks - interface for class-level delegation
// ============================================================================

/**
 * Callbacks that ChatPanel registers with its parent container class.
 * Used by ChatView to implement IChatViewContainer
 * by delegating to the React component's state and handlers.
 */
export interface ChatPanelCallbacks {
	getDisplayName: () => string;
	getInputState: () => ChatInputState | null;
	setInputState: (state: ChatInputState) => void;
	canSend: () => boolean;
	sendMessage: () => Promise<boolean>;
	cancelOperation: () => Promise<void>;
}

// ============================================================================
// ChatPanelProps
// ============================================================================

export interface ChatPanelProps {
	viewId: string;
	workingDirectory?: string;
	initialAgentId?: string;
	config?: { agent?: string; model?: string };
	onRegisterCallbacks?: (callbacks: ChatPanelCallbacks) => void;
	/** Called when agent ID changes (sidebar only — persists in Obsidian state) */
	onAgentIdChanged?: (agentId: string) => void;
	/** Obsidian view host for DOM event registration */
	viewHost: IChatViewHost;
	/** Called when session state changes (for tab icon updates) */
	onStateChange?: (state: import("../types/tab").TabState) => void;
	/** Called when a suitable tab label is available (session title or first message) */
	onLabelChange?: (label: string) => void;
	/** Called when the session ID changes (for tab rename persistence) */
	onSessionIdChange?: (sessionId: string | null) => void;
	/** Whether this tab is the currently active tab (controls focus on activation) */
	isActive?: boolean;
	/** Look up whether a session is already open in another tab (I20) */
	findTabBySessionId?: (sessionId: string) => { tabId: string; label: string } | null;
	/** Switch to a specific tab by ID (I20) */
	onSwitchToTab?: (tabId: string) => void;
	/** Persisted session ID for this tab (from tab persistence). Passed to useLazySession for session/load on first keystroke. */
	restoredSessionId?: string | null;
	/** Restored message history for this tab (from tab persistence). Seeded into the message list on async arrival while idle (I43). */
	restoredMessages?: ChatMessage[];
	/** Restored context notes for this tab (from tab persistence). Rehydrates the context strip on async arrival while idle (I61). */
	restoredContextNotes?: ContextNote[];
}

// ============================================================================
// State Definitions
// ============================================================================

// Type definitions for Obsidian internal APIs (sidebar menu)
interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

// ============================================================================
// ChatPanel Component
// ============================================================================

/**
 * Core chat panel component that encapsulates all chat logic.
 *
 * This is the single source of truth for chat state and behavior,
 * for the sidebar chat view. It is a 1:1 migration of useChatController
 * into a React component.
 */
export function ChatPanel({
	viewId,
	workingDirectory,
	initialAgentId,
	config,
	onRegisterCallbacks,
	onAgentIdChanged,
	viewHost,
	onStateChange,
	onLabelChange,
	onSessionIdChange,
	isActive,
	findTabBySessionId,
	onSwitchToTab,
	restoredSessionId,
	restoredMessages,
	restoredContextNotes,
}: ChatPanelProps) {
	// ============================================================
	// Platform Check
	// ============================================================
	if (!Platform.isDesktopApp) {
		throw new Error("Agent Client is only available on desktop");
	}

	// ============================================================
	// Context
	// ============================================================
	const { plugin, acpClient, vaultService } = useChatContext();

	// ============================================================
	// Memoized Services & Adapters
	// ============================================================
	const logger = getLogger();

	const vaultPath = useMemo(() => {
		if (workingDirectory) {
			return workingDirectory;
		}
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		// Fallback for non-FileSystemAdapter (e.g., mobile)
		return process.cwd();
	}, [plugin, workingDirectory]);

	// Agent working directory — defaults to vault path.
	// Can be changed independently via "New chat in directory..." action.
	const [agentCwd, setAgentCwd] = useState(vaultPath);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	const agent = useAgent(
		acpClient,
		plugin.settingsService,
		vaultService,
		agentCwd,
		initialAgentId,
	);

	const {
		session,
		isReady: isSessionReady,
		messages,
		isSending,
		errorInfo,
	} = agent;

	const suggestions = useSuggestions(
		vaultService,
		plugin,
		session.availableCommands || EMPTY_COMMANDS,
		settings.activeNoteAsDefaultContext,
	);

	// ============================================================
	// Context Note Lifecycle (crystallized notes + selection)
	// ============================================================
	const contextNotes = useContextNotes();
	const selectionTracker = useSelectionTracker(vaultService);

	const vaultEventSource = useMemo<VaultEventSource>(
		() => ({
			onRename: (cb) => {
				const ref = plugin.app.vault.on("rename", (file, oldPath) =>
					cb(oldPath, file.path),
				);
				return () => plugin.app.vault.offref(ref);
			},
			onDelete: (cb) => {
				const ref = plugin.app.vault.on("delete", (file) =>
					cb(file.path),
				);
				return () => plugin.app.vault.offref(ref);
			},
		}),
		[plugin.app.vault],
	);

	const crystallizedPaths = useMemo(
		() => new Set(contextNotes.notes.map((n) => n.path)),
		[contextNotes.notes],
	);

	// Auto-default provisional suppress (Decision #26, I68): `×` on the
	// provisional pill sets this sticky flag so it won't re-arm for this tab.
	const [autoDefaultSuppressed, setAutoDefaultSuppressed] = useState(false);

	useContextVaultEvents({
		vault: vaultEventSource,
		crystallizedPaths,
		onRename: contextNotes.rename,
		onRemove: (path) => {
			contextNotes.remove(path);
			const name = (path.split("/").pop() ?? path).replace(
				/\.md$/,
				"",
			);
			new Notice(
				`[Agent Console] Context note "${name}" was deleted and removed from chat context.`,
			);
		},
	});

	const selectionForSend = useMemo(
		() =>
			selectionTracker.activeNotePath && selectionTracker.selection
				? {
						path: selectionTracker.activeNotePath,
						fromLine: selectionTracker.selection.fromLine,
						toLine: selectionTracker.selection.toLine,
					}
				: null,
		[selectionTracker.activeNotePath, selectionTracker.selection],
	);

	// Session history hook with callback for session load
	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
			configOptions?: SessionConfigOption[],
		) => {
			logger.log(
				`[ChatPanel] Session loaded/resumed/forked: ${sessionId}`,
				{
					modes,
					models,
					configOptions,
				},
			);
			void agent.updateSessionFromLoad(
				sessionId,
				modes,
				models,
				configOptions,
			);
		},
		[logger, agent.updateSessionFromLoad],
	);

	const sessionHistory = useSessionHistory({
		agentClient: acpClient,
		session,
		settingsAccess: plugin.settingsService,
		cwd: vaultPath,
		agentCwd,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: agent.setMessagesFromLocal,
		onIgnoreUpdates: agent.setIgnoreUpdates,
		onClearMessages: agent.clearMessages,
		onContextNotesRestore: contextNotes.replace,
	});

	// Seed restored history into the message list when the async disk read
	// resolves, but only while idle (no live session) so it never clobbers
	// an active conversation (I43, spec Decision #12).
	useRestoredMessages({
		restoredMessages,
		restoredContextNotes,
		hasSession: !!session.sessionId,
		apply: agent.setMessagesFromLocal,
		applyContextNotes: contextNotes.replace,
	});

	// ============================================================
	// Local State
	// ============================================================
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);

	// Input state (for broadcast commands)
	const [inputValue, setInputValue] = useState("");
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

	// ============================================================
	// Refs
	// ============================================================
	const terminalClientRef = useRef<AcpClient>(acpClient);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => {
		const activeId = session.agentId;
		if (activeId === plugin.settings.claude.id) {
			return (
				plugin.settings.claude.displayName || plugin.settings.claude.id
			);
		}
		if (activeId === plugin.settings.codex.id) {
			return (
				plugin.settings.codex.displayName || plugin.settings.codex.id
			);
		}
		if (activeId === plugin.settings.gemini.id) {
			return (
				plugin.settings.gemini.displayName || plugin.settings.gemini.id
			);
		}
		if (activeId === plugin.settings.kiro.id) {
			return (
				plugin.settings.kiro.displayName || plugin.settings.kiro.id
			);
		}
		const custom = plugin.settings.customAgents.find(
			(agent) => agent.id === activeId,
		);
		return custom?.displayName || custom?.id || activeId;
	}, [session.agentId, plugin.settings]);

	/**
	 * Header branding segments — see Agent Console Header Branding spec.
	 *
	 * Layered as: Plugin → Profile → Runtime → Model.
	 * - plugin: client-sourced (manifest), shown in literal brackets
	 * - profile: client-sourced (settings.displayName), the "which configuration" signal
	 * - runtime: ACP-sourced (session.agentInfo), null while connecting
	 * - model:   ACP-sourced (session.models), null while connecting
	 *
	 * Both ACP segments null = "Connecting…" placeholder rendered by ChatHeader.
	 */
	const headerSegments = useMemo(() => {
		const pluginName = plugin.manifest.name;
		const profile = activeAgentLabel;

		const info = session.agentInfo;
		const runtime = info
			? `${info.title || info.name}${info.version ? ` ${info.version}` : ""}`
			: null;

		const models = session.models;
		const currentModel = models?.availableModels.find(
			(m) => m.modelId === models.currentModelId,
		);
		const model = currentModel?.name ?? null;

		return { plugin: pluginName, profile, runtime, model };
	}, [
		plugin.manifest.name,
		activeAgentLabel,
		session.agentInfo,
		session.models,
	]);

	const availableAgents = useMemo(() => {
		return plugin.getAvailableAgents();
	}, [plugin]);

	// ============================================================
	// Chat Actions
	// ============================================================
	const actions = useChatActions(
		plugin,
		agent,
		sessionHistory,
		suggestions,
		session,
		messages,
		settings,
		vaultPath,
		contextNotes,
		selectionForSend,
		selectionTracker.activeNotePath,
		autoDefaultSuppressed,
	);

	const {
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleRestartAgent,
		handleSetMode,
		handleSetModel,
		handleSetConfigOption,
		handleClearError,
		handleClearAgentUpdate,
		handleRestoredMessageConsumed,
		restoredMessage,
		agentUpdateNotification,
		setAgentUpdateNotification,
		autoExportIfEnabled,
	} = actions;

	const handleContextPillClick = useCallback(
		(path: string, event: React.MouseEvent) => {
			let newLeaf: boolean | "tab" | "split" | "window" = false;
			if (event.metaKey || event.ctrlKey) {
				newLeaf = event.altKey
					? "window"
					: event.shiftKey
						? "split"
						: "tab";
			}
			void plugin.app.workspace.openLinkText(path, "", newLeaf);
		},
		[plugin.app.workspace],
	);

	// Track whether tab label has been reported (reset on new chat / restore)
	const labelReportedRef = useRef(false);

	// Stable refs for tab callbacks (avoid re-render loops from inline arrow props)
	const onStateChangeRef = useRef(onStateChange);
	onStateChangeRef.current = onStateChange;
	const onLabelChangeRef = useRef(onLabelChange);
	onLabelChangeRef.current = onLabelChange;

	const handleLabelChangeFromRestore = useCallback(
		(label: string) => {
			onLabelChangeRef.current?.(label);
			labelReportedRef.current = true;
		},
		[],
	);

	const { handleOpenHistory } = useHistoryModal(
		plugin,
		agent,
		sessionHistory,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		setAgentCwd,
		handleLabelChangeFromRestore,
		session.sessionId ?? undefined,
		findTabBySessionId,
		onSwitchToTab,
	);

	// ============================================================
	// Sidebar-specific: handleNewChat wrapper that persists agent ID
	// ============================================================
	const handleNewChatWithPersist = useCallback(
		async (requestedAgentId?: string) => {
			try {
				await handleNewChat(requestedAgentId);
				labelReportedRef.current = false;
				onLabelChangeRef.current?.("");
				// Persist agent ID for this view (survives Obsidian restart)
				if (requestedAgentId) {
					onAgentIdChanged?.(requestedAgentId);
				}
			} catch (error) {
				console.error("[Agent Console] New chat error:", error);
			}
		},
		[handleNewChat, onAgentIdChanged],
	);

	// ============================================================
	// Sidebar-specific: Header Menu (Obsidian native Menu API)
	// ============================================================
	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	const handleNewChatInDirectory = useCallback(
		async (directory: string) => {
			try {
				// Auto-export current chat before switching
				if (messages.length > 0) {
					await autoExportIfEnabled("newChat", messages, session);
				}
				agent.clearMessages();
				setAgentCwd(directory);
				await agent.restartSession(undefined, directory);
				sessionHistory.invalidateCache();
			} catch (error) {
				console.error("[Agent Console] New chat in directory error:", error);
			}
		},
		[
			messages,
			session,
			autoExportIfEnabled,
			agent.clearMessages,
			agent.restartSession,
			sessionHistory.invalidateCache,
		],
	);

	const handleShowSidebarMenu = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const menu = new Menu();

			// -- Switch agent section --
			menu.addItem((item: MenuItem) => {
				item.setTitle("Switch agent").setIsLabel(true);
			});

			for (const agent of availableAgents) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(agent.displayName)
						.setChecked(agent.id === (session.agentId || ""))
						.onClick(() => {
							void handleNewChatWithPersist(agent.id);
						});
				});
			}

			menu.addSeparator();

			// -- Actions section --
			menu.addItem((item: MenuItem) => {
				item.setTitle("Open new view")
					.setIcon("copy-plus")
					.onClick(() => {
						void plugin.openNewChatViewWithAgent(
							plugin.settings.defaultAgentId,
						);
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("Restart agent")
					.setIcon("refresh-cw")
					.onClick(() => {
						void handleRestartAgent();
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("New chat in directory...")
					.setIcon("folder-open")
					.onClick(() => {
						const modal = new ChangeDirectoryModal(
							plugin.app,
							agentCwd,
							(directory) => {
								void handleNewChatInDirectory(directory);
							},
						);
						modal.open();
					});
			});

			menu.addSeparator();

			menu.addItem((item: MenuItem) => {
				item.setTitle("Plugin settings")
					.setIcon("settings")
					.onClick(() => {
						handleOpenSettings();
					});
			});

			menu.showAtMouseEvent(e.nativeEvent);
		},
		[
			availableAgents,
			session.agentId,
			handleNewChatWithPersist,
			plugin,
			handleRestartAgent,
			agentCwd,
			handleNewChatInDirectory,
			handleOpenSettings,
		],
	);

	// ============================================================
	// Effects - Session Lifecycle
	// ============================================================

	// Lazy session lifecycle — Decisions #2, #6, #7, #8 of
	// [[ACP Tab Persistence Across Restarts]]. No eager `session/new`
	// fires on mount. Agent initialize + session creation defer until
	// the user signals intent (typing in the composer with 200ms
	// debounce, or clicking send).
	//
	// Decision #10: Eager initialize on mount for composer affordances.
	// Spawns the agent process so that slash commands, model list, and
	// mode list are available before the user types. The subsequent
	// createSession call (on first keystroke) sees isInitialized()=true
	// and skips re-initialization, going straight to newSession.
	useEffect(() => {
		if (acpClient.isInitialized()) return;
		const agentId = config?.agent || initialAgentId;
		if (!agentId) return;

		void (async () => {
			try {
				const { findAgentSettings, buildAgentConfigWithApiKey } =
					await import("../services/session-helpers");
				const agentSettings = findAgentSettings(
					plugin.settings,
					agentId,
				);
				if (!agentSettings) return;
				const agentConfig = buildAgentConfigWithApiKey(
					plugin.settings,
					agentSettings,
					agentId,
					vaultPath,
				);
				await acpClient.initialize(agentConfig);
				// I54: propagate the just-fetched capabilities into session
				// state so image paste works on a fresh tab before connecting.
				agent.applyInitCapabilities();
				logger.log("[ChatPanel] Eager initialize complete for:", agentId);
			} catch (e) {
				// Non-fatal: lazy path will retry on first keystroke
				logger.log("[ChatPanel] Eager initialize failed (non-fatal):", e);
			}
		})();
		// Run once on mount only. agentId/vaultPath are stable.
		// eslint-disable-next-line
	}, []);

	// Queued send for the case where the user clicks send while
	// session acquisition is still in flight. Cleared by the flush
	// effect below.
	const [queuedSend, setQueuedSend] = useState<{
		content: string;
		attachments?: AttachedFile[];
	} | null>(null);

	// Optimistic user message shown while session acquisition is in flight.
	const [pendingMessage, setPendingMessage] = useState<ChatMessage | null>(null);

	const lazySession = useLazySession({
		// Restored sessionId from tab persistence. When non-null, the
		// hook calls loadExistingSession on first keystroke instead of
		// acquireNewSession.
		restoredSessionId: restoredSessionId ?? null,

		acquireNewSession: useCallback(async () => {
			try {
				const effectiveAgent = config?.agent || initialAgentId;
				logger.log(
					"[Lazy] Acquiring new session for agent:",
					effectiveAgent,
				);
				// I53 guard: if a session already exists (e.g. from a prior
				// acquisition that completed during a re-render cycle before
				// the lazy hook's setSessionId propagated), reuse it instead
				// of creating a duplicate.
				const existingSid = agent.session.sessionId;
				if (existingSid) {
					logger.log(
						"[Lazy] Session already exists, reusing:",
						existingSid,
					);
					return { ok: true as const, sessionId: existingSid };
				}
				// I55: use the sessionId RETURNED by createSession instead
				// of reading agent.session.sessionId from a stale closure.
				// The setState inside createSession has not propagated to
				// this closure's `agent` reference yet, so the old read
				// returned null and left the message stuck in "Sending…".
				const sid = await agent.createSession(effectiveAgent);
				if (!sid) {
					return {
						ok: false as const,
						error: new Error(
							"Session creation produced no sessionId",
						),
					};
				}
				return { ok: true as const, sessionId: sid };
			} catch (err) {
				return {
					ok: false as const,
					error:
						err instanceof Error ? err : new Error(String(err)),
				};
			}
		}, [
			agent.createSession,
			agent.session.sessionId,
			config?.agent,
			initialAgentId,
			logger,
		]),

		loadExistingSession: useCallback(async (sessionId: string) => {
			logger.log("[Lazy] Loading existing session:", sessionId);
			const result = await loadExistingSessionFlow({
				sessionId,
				cwd: agentCwd,
				// Suppress the agent's replay only when local history is
				// already displayed; otherwise let it through (I43 #12).
				haveLocalHistory:
					!!restoredMessages && restoredMessages.length > 0,
				loadSession: (id, cwd) => acpClient.loadSession(id, cwd),
				onLoaded: (r) =>
					void agent.updateSessionFromLoad(
						r.sessionId,
						r.modes,
						r.models,
						r.configOptions,
					),
				setIgnoreUpdates: agent.setIgnoreUpdates,
			});
			if (!result.ok) {
				logger.log(
					"[Lazy] loadSession failed, falling through to new session:",
					result.error,
				);
			}
			return result;
		}, [
			restoredMessages,
			acpClient,
			agentCwd,
			agent.updateSessionFromLoad,
			agent.setIgnoreUpdates,
			logger,
		]),

		sendPrompt: useCallback(async () => {
			// Queue flush is owned by ChatPanel's `queuedSend` effect
			// (below) — not by the hook's internal sendPrompt. Owning
			// the flush at the ChatPanel level lets us read
			// agent.session.sessionId from a post-render closure when
			// the user message threads through handleSendMessage.
		}, []),
	});

	// Queue-flush effect: fires when the lazy session reaches `ready`
	// AND agent state has committed the new sessionId. Only then is it
	// safe to call handleSendMessage, which reads
	// agent.session.sessionId from its closure.
	useEffect(() => {
		if (
			lazySession.state === "ready" &&
			queuedSend !== null &&
			agent.session.sessionId
		) {
			const { content, attachments } = queuedSend;
			setQueuedSend(null);
			setPendingMessage(null);
			void handleSendMessage(content, attachments);
		}
	}, [
		lazySession.state,
		queuedSend,
		agent.session.sessionId,
		handleSendMessage,
	]);

	// Send wrapper: sticky path → handleSendMessage directly when the
	// session is already `ready`; non-ready path → queue + trigger lazy
	// acquisition. The queue-flush effect above runs handleSendMessage
	// once both lazy state and agent.session.sessionId have settled.
	const handleSendWithLazyAcquisition = useCallback(
		async (content: string, attachments?: AttachedFile[]) => {
			if (lazySession.state === "ready" && agent.session.sessionId) {
				await handleSendMessage(content, attachments);
				return;
			}
			setQueuedSend({ content, attachments });
			setPendingMessage({
				id: `pending-${Date.now()}`,
				role: "user",
				content: [
					{ type: "text", text: content },
					// I55 Defect B: surface image attachments in the optimistic
					// "Sending…" bubble so the user can see the screenshot they
					// queued (previously text-only, implying nothing was attached).
					...(attachments ?? [])
						.filter((f) => f.kind === "image" && f.data)
						.map((f) => ({
							type: "image" as const,
							data: f.data as string,
							mimeType: f.mimeType,
						})),
				],
				timestamp: new Date(),
				pending: true,
			});
			lazySession.onSendClick(content);
		},
		[
			lazySession.state,
			lazySession.onSendClick,
			agent.session.sessionId,
			handleSendMessage,
		],
	);

	// Apply configured model when session is ready
	useEffect(() => {
		if (!config?.model || !isSessionReady) return;

		// Prefer configOptions if available
		if (session.configOptions) {
			const modelOption = session.configOptions.find(
				(o) => o.category === "model",
			);
			if (modelOption && modelOption.currentValue !== config.model) {
				const valueExists = flattenConfigSelectOptions(
					modelOption.options,
				).some((o) => o.value === config.model);
				if (valueExists) {
					logger.log(
						"[ChatPanel] Applying configured model via configOptions:",
						config.model,
					);
					void agent.setConfigOption(modelOption.id, config.model);
				}
			}
			return;
		}

		// Fallback to legacy models
		if (session.models) {
			const modelExists = session.models.availableModels.some(
				(m) => m.modelId === config.model,
			);
			if (modelExists && session.models.currentModelId !== config.model) {
				logger.log(
					"[ChatPanel] Applying configured model:",
					config.model,
				);
				void agent.setModel(config.model);
			}
		}
	}, [
		config?.model,
		isSessionReady,
		session.configOptions,
		session.models,
		agent.setConfigOption,
		agent.setModel,
		logger,
	]);

	// Refs for cleanup (to access latest values in cleanup function)
	const messagesRef = useRef(messages);
	const sessionRef = useRef(session);
	const autoExportRef = useRef(autoExportIfEnabled);
	const closeSessionRef = useRef(agent.closeSession);
	messagesRef.current = messages;
	sessionRef.current = session;
	autoExportRef.current = autoExportIfEnabled;
	closeSessionRef.current = agent.closeSession;

	// Persist context notes when they change mid-session (T13 persistence).
	// Refs keep the dep list to notes only — avoids a write on every
	// streamed message update.
	useEffect(() => {
		const sid = sessionRef.current.sessionId;
		if (sid && messagesRef.current.length > 0) {
			sessionHistory.saveSessionMessages(
				sid,
				messagesRef.current,
				contextNotes.notes,
			);
		}
	}, [contextNotes.notes, sessionHistory.saveSessionMessages]);

	// Cleanup on unmount only - auto-export and close session
	useEffect(() => {
		return () => {
			logger.log("[ChatPanel] Cleanup: auto-export and close session");
			void (async () => {
				try {
					await autoExportRef.current(
						"closeChat",
						messagesRef.current,
						sessionRef.current,
					);
					await closeSessionRef.current();
				} catch (error) {
					logger.error("[ChatPanel] Cleanup error:", error);
				}
			})();
		};
	}, [logger]);

	// ============================================================
	// Effects - Update Check
	// ============================================================
	useEffect(() => {
		plugin
			.checkForUpdates()
			.then(setIsUpdateAvailable)
			.catch((error) => {
				logger.error("Failed to check for updates:", error);
			});
	}, [plugin, logger]);

	// ============================================================
	// Effects - Agent Update Check
	// ============================================================
	useEffect(() => {
		if (!isSessionReady || !session.agentInfo?.name) {
			return;
		}

		checkAgentUpdate(
			session.agentInfo as { name: string; version?: string },
		)
			.then(setAgentUpdateNotification)
			.catch((error) => {
				logger.error("Failed to check agent update:", error);
			});
	}, [isSessionReady, session.agentInfo, logger]);

	// ============================================================
	// Effects - Save Session Messages on Turn End
	// ============================================================
	const prevIsSendingRef = useRef<boolean>(false);

	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;

		// Save when turn ends (isSending: true -> false) and has messages
		if (
			wasSending &&
			!isSending &&
			session.sessionId &&
			messages.length > 0
		) {
			sessionHistory.saveSessionMessages(
				session.sessionId,
				messages,
				contextNotes.notes,
			);
			logger.log(
				`[ChatPanel] Session messages saved: ${session.sessionId}`,
			);

			// System notification on response completion
			if (settings.enableSystemNotifications && !activeDocument.hasFocus()) {
				new Notification("Agent Console", {
					body: `${activeAgentLabel} has completed the response.`,
				});
			}
		}
	}, [
		isSending,
		session.sessionId,
		messages,
		sessionHistory.saveSessionMessages,
		settings.enableSystemNotifications,
		activeAgentLabel,
		logger,
	]);

	// Debounced incremental save so the message tail survives reload/quit
	// even mid-stream or before a turn ends (I48). Extracted to a hook with
	// an unmount-flush + max-wait so a mid-stream reload does not lose the
	// in-flight turn. The turn-end save above is kept for the notification.
	useDebouncedSessionSave(
		session.sessionId,
		messages,
		contextNotes.notes,
		sessionHistory.saveSessionMessages,
	);

	// ============================================================
	// Effects - System Notification on Permission Request
	// ============================================================
	const prevHasActivePermissionRef = useRef<boolean>(false);

	useEffect(() => {
		const wasActive = prevHasActivePermissionRef.current;
		prevHasActivePermissionRef.current = agent.hasActivePermission;

		// Notify when permission transitions from inactive to active
		if (
			!wasActive &&
			agent.hasActivePermission &&
			settings.enableSystemNotifications &&
			!activeDocument.hasFocus()
		) {
			new Notification("Agent Console", {
				body: `${activeAgentLabel} is requesting permission.`,
			});
		}
	}, [
		agent.hasActivePermission,
		settings.enableSystemNotifications,
		activeAgentLabel,
	]);

	// ============================================================
	// Effects - Tab State & Label Reporting
	// ============================================================
	// Drive busy/permission transitions on the lazy session state machine
	// from agent events. The state machine is the single source of truth
	// (spec § Tab Session State Machine); these effects keep it in sync
	// with the agent's response lifecycle.
	const prevIsSendingForStateRef = useRef(false);
	useEffect(() => {
		const was = prevIsSendingForStateRef.current;
		prevIsSendingForStateRef.current = isSending;
		if (!was && isSending && lazySession.state === "ready") {
			lazySession.startBusy();
		} else if (was && !isSending && lazySession.state === "busy") {
			lazySession.endBusy();
		}
	}, [isSending, lazySession.state, lazySession.startBusy, lazySession.endBusy]);

	const prevHasPermissionForStateRef = useRef(false);
	useEffect(() => {
		const was = prevHasPermissionForStateRef.current;
		prevHasPermissionForStateRef.current = agent.hasActivePermission;
		if (!was && agent.hasActivePermission) {
			lazySession.requestPermission();
		} else if (was && !agent.hasActivePermission && lazySession.state === "permission") {
			lazySession.resolvePermission();
		}
	}, [agent.hasActivePermission, lazySession.state, lazySession.requestPermission, lazySession.resolvePermission]);

	// Report lazySession.state to the parent (tab icon) via onStateChange.
	// Maps TabSessionState → TabState for the existing TabBar contract.
	useEffect(() => {
		if (!onStateChangeRef.current) return;
		const s = lazySession.state;
		if (s === "idle" || s === "connecting") {
			onStateChangeRef.current("disconnected");
		} else if (s === "error") {
			onStateChangeRef.current("error");
		} else if (s === "permission") {
			onStateChangeRef.current("permission");
		} else if (s === "busy") {
			onStateChangeRef.current("busy");
		} else {
			onStateChangeRef.current("ready");
		}
	}, [lazySession.state]);

	// Report label from first user message
	useEffect(() => {
		if (!onLabelChangeRef.current || labelReportedRef.current) return;
		const label = deriveTabLabel(messages);
		if (label) {
			onLabelChangeRef.current(label);
			labelReportedRef.current = true;
		}
	}, [messages]);

	// Report session ID changes to parent (for tab rename persistence)
	useEffect(() => {
		onSessionIdChange?.(session.sessionId);
	}, [onSessionIdChange, session.sessionId]);

	// ============================================================
	// Auto-default context crystallizes on FIRST SEND in useChatActions
	// (Decision #26, I68) — not seeded at mount. The provisional dashed pill
	// is derived in ContextStrip from the live active note.
	// ============================================================

	// ============================================================
	// Effects - Workspace Events (Hotkeys)
	// ============================================================

	// Refs for workspace event handlers (avoids re-registering on every render)
	const handleNewChatWithPersistRef = useRef(handleNewChatWithPersist);
	const approveActivePermissionRef = useRef(agent.approveActivePermission);
	const rejectActivePermissionRef = useRef(agent.rejectActivePermission);
	const handleStopGenerationRef = useRef(handleStopGeneration);
	const handleExportChatRef = useRef(handleExportChat);
	handleNewChatWithPersistRef.current = handleNewChatWithPersist;
	approveActivePermissionRef.current = agent.approveActivePermission;
	rejectActivePermissionRef.current = agent.rejectActivePermission;
	handleStopGenerationRef.current = handleStopGeneration;
	handleExportChatRef.current = handleExportChat;

	useEffect(() => {
		const workspace = plugin.app.workspace;
		const ws = workspace as unknown as {
			on: (
				name: string,
				callback: (...args: never[]) => void,
			) => ReturnType<typeof workspace.on>;
		};

		const refs = [
			// Toggle auto-mention
			ws.on(
				"agent-client:toggle-auto-mention",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					suggestions.mentions.toggleAutoMention();
				},
			),

			// New chat requested (from "New chat" or "Switch agent to" commands)
			ws.on(
				"agent-client:new-chat-requested",
				(targetViewId?: string, agentId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void handleNewChatWithPersistRef.current(agentId);
				},
			),

			// Approve active permission
			ws.on(
				"agent-client:approve-active-permission",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void (async () => {
						try {
							const success =
								await approveActivePermissionRef.current();
							if (!success) {
								new Notice(
									"[Agent Console] No active permission request",
								);
							}
						} catch (error) {
							console.error("[Agent Console] Approve permission error:", error);
						}
					})();
				},
			),

			// Reject active permission
			ws.on(
				"agent-client:reject-active-permission",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void (async () => {
						try {
							const success =
								await rejectActivePermissionRef.current();
							if (!success) {
								new Notice(
									"[Agent Console] No active permission request",
								);
							}
						} catch (error) {
							console.error("[Agent Console] Reject permission error:", error);
						}
					})();
				},
			),

			// Cancel current message
			ws.on("agent-client:cancel-message", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleStopGenerationRef.current();
			}),

			// Export chat
			ws.on("agent-client:export-chat", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleExportChatRef.current();
			}),
		];

		return () => {
			for (const ref of refs) {
				workspace.offref(ref);
			}
		};
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		viewId,
		suggestions.mentions.toggleAutoMention,
	]);

	// ============================================================
	// Effects - Focus Tracking
	// ============================================================
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const handleFocus = () => {
			// Use viewHost.viewId (the registry-recognized container ID).
			// Writing the bare `viewId` prop would be tab.tabId on sidebar
			// tabs and silently rejected by ViewRegistry.setFocused (I34).
			plugin.setLastActiveChatViewId(viewHost.viewId);
		};

		const container = containerRef.current;
		if (!container) return;

		container.addEventListener("focus", handleFocus, true);
		container.addEventListener("click", handleFocus);

		return () => {
			container.removeEventListener("focus", handleFocus, true);
			container.removeEventListener("click", handleFocus);
		};
	}, [plugin, viewHost]);

	// ============================================================
	// Callback Registration for IChatViewContainer
	// ============================================================
	// Use refs so callbacks always access latest values
	const inputValueRef = useRef(inputValue);
	const attachedFilesRef = useRef(attachedFiles);
	const isSessionReadyRef = useRef(isSessionReady);
	const isSendingRef = useRef(isSending);
	const sessionHistoryLoadingRef = useRef(sessionHistory.loading);
	const handleSendMessageRef = useRef(handleSendWithLazyAcquisition);
	inputValueRef.current = inputValue;
	attachedFilesRef.current = attachedFiles;
	isSessionReadyRef.current = isSessionReady;
	isSendingRef.current = isSending;
	sessionHistoryLoadingRef.current = sessionHistory.loading;
	handleSendMessageRef.current = handleSendWithLazyAcquisition;

	useEffect(() => {
		onRegisterCallbacks?.({
			getDisplayName: () => activeAgentLabel,
			getInputState: () => ({
				text: inputValueRef.current,
				files: attachedFilesRef.current,
			}),
			setInputState: (state) => {
				setInputValue(state.text);
				setAttachedFiles(state.files);
			},
			canSend: () => {
				const hasContent =
					inputValueRef.current.trim() !== "" ||
					attachedFilesRef.current.length > 0;
				const lazyState = lazySession.state;
				const canAcceptSend =
					isSessionReadyRef.current ||
					lazyState === "connecting" ||
					lazyState === "idle";
				return (
					hasContent &&
					canAcceptSend &&
					!sessionHistoryLoadingRef.current &&
					!isSendingRef.current
				);
			},
			sendMessage: async () => {
				const currentInput = inputValueRef.current;
				const currentFiles = attachedFilesRef.current;
				// Allow sending if there's text OR attachments
				if (!currentInput.trim() && currentFiles.length === 0) {
					return false;
				}
				// Don't require an already-ready session: defer to
				// handleSendWithLazyAcquisition, which queues the message and
				// acquires the session for idle/connecting tabs (matches the
				// send button). Only an in-flight history load blocks. (I70)
				if (sessionHistoryLoadingRef.current) {
					return false;
				}
				if (isSendingRef.current) {
					return false;
				}

				// Clear input before sending
				const messageToSend = currentInput.trim();
				const filesToSend =
					currentFiles.length > 0 ? [...currentFiles] : undefined;
				setInputValue("");
				setAttachedFiles([]);

				try {
					await handleSendMessageRef.current(messageToSend, filesToSend);
				} catch (error) {
					console.error("[Agent Console] Send message error:", error);
				}
				return true;
			},
			cancelOperation: async () => {
				if (isSendingRef.current) {
					try {
						await handleStopGenerationRef.current();
					} catch (error) {
						console.error("[Agent Console] Cancel operation error:", error);
					}
				}
			},
		});
	}, [onRegisterCallbacks, activeAgentLabel]);

	// ============================================================
	// Render
	// ============================================================
	const chatFontSizeStyle =
		settings.displaySettings.fontSize !== null
			? ({
					"--ac-chat-font-size": `${settings.displaySettings.fontSize}px`,
				} as React.CSSProperties)
			: undefined;

	const headerElement = (
		<ChatHeader
			agentLabel={activeAgentLabel}
			headerSegments={{...headerSegments, isLazyIdle: lazySession.state === "idle"}}
			isUpdateAvailable={isUpdateAvailable}
			onNewChat={() => void handleNewChatWithPersist()}
			onExportChat={() => void handleExportChat()}
			onShowMenu={handleShowSidebarMenu}
			onOpenHistory={handleOpenHistory}
		/>
	);

	const cwdBanner =
		agentCwd !== vaultPath && !isSameDirectory(agentCwd, vaultPath) ? (
			<div className="agent-client-cwd-banner" title={agentCwd}>
				<span
					className="agent-client-cwd-banner-icon"
					ref={(el) => {
						if (el) setIcon(el, "folder-open");
					}}
				/>
				<span className="agent-client-cwd-banner-path">{agentCwd}</span>
			</div>
		) : null;

	// Combine real messages with the optimistic pending message for display.
	const displayMessages = useMemo(
		() => pendingMessage ? [...messages, pendingMessage] : messages,
		[messages, pendingMessage],
	);

	const messageListElement = (
		<MessageList
			messages={displayMessages}
			isSending={isSending}
			isSessionReady={isSessionReady}
			isLazyIdle={lazySession.state === "idle"}
			isRestoringSession={sessionHistory.loading}
			agentLabel={activeAgentLabel}
			plugin={plugin}
			view={viewHost}
			terminalClient={terminalClientRef.current}
			onApprovePermission={agent.approvePermission}
			hasActivePermission={agent.hasActivePermission}
			isActive={isActive}
			isFallbackRecovery={lazySession.isFallbackRecovery}
		/>
	);

	const contextStripElement = (
		<ContextStrip
			notes={contextNotes.notes}
			isFull={contextNotes.isFull}
			activeNotePath={selectionTracker.activeNotePath}
			activeNoteName={selectionTracker.activeNoteName}
			onAdd={contextNotes.add}
			onRemove={contextNotes.remove}
			onPillClick={handleContextPillClick}
			provisionalPath={computeProvisionalPath({
				settingOn: settings.activeNoteAsDefaultContext,
				suppressed: autoDefaultSuppressed,
				messageCount: messages.length,
				activeNotePath: selectionTracker.activeNotePath,
				committed: contextNotes.notes,
			})}
			onSuppressProvisional={() => setAutoDefaultSuppressed(true)}
		/>
	);

	const inputAreaElement = (
		<InputArea
			isSending={isSending}
			isSessionReady={isSessionReady}
			isLazyIdle={lazySession.state === "idle"}
			isLazyConnecting={lazySession.state === "connecting"}
			isRestoringSession={sessionHistory.loading}
			agentLabel={activeAgentLabel}
			availableCommands={session.availableCommands || []}
			restoredMessage={restoredMessage}
			suggestions={suggestions}
			plugin={plugin}
			view={viewHost}
			onSendMessage={handleSendWithLazyAcquisition}
			onStopGeneration={handleStopGeneration}
			onRestoredMessageConsumed={handleRestoredMessageConsumed}
			modes={session.modes}
			onModeChange={(modeId) => void handleSetMode(modeId)}
			models={session.models}
			onModelChange={(modelId) => void handleSetModel(modelId)}
			configOptions={session.configOptions}
			onConfigOptionChange={(configId, value) =>
				void handleSetConfigOption(configId, value)
			}
			usage={session.usage}
			supportsImages={session.promptCapabilities?.image ?? false}
			agentId={session.agentId}
			// Controlled component props (for broadcast commands)
			inputValue={inputValue}
			onInputChange={(value) => {
				setInputValue(value);
				// Typing-as-intent: feed every keystroke to the lazy
				// session so it can debounce-trigger session acquisition.
				// The hook short-circuits when sessionId is already set
				// (sticky session) so this is cheap on the steady-state
				// path.
				lazySession.onComposerChange(value);
			}}
			attachedFiles={attachedFiles}
			onAttachedFilesChange={setAttachedFiles}
			// Error overlay props
			errorInfo={errorInfo}
			onClearError={handleClearError}
			// Agent update notification props
			agentUpdateNotification={agentUpdateNotification}
			onClearAgentUpdate={handleClearAgentUpdate}
			messages={messages}
			isActive={isActive}
		/>
	);


	return (
		<div
			ref={containerRef}
			className="agent-client-chat-view-container"
			style={chatFontSizeStyle}
		>
			{headerElement}
			{cwdBanner}
			{messageListElement}
			{contextStripElement}
			{inputAreaElement}
		</div>
	);
}
