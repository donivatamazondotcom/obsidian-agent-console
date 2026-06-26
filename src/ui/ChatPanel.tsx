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

import { registerOpenMenu } from "../utils/menu-registry";
import type { AttachedFile, ChatInputState, ChatMessage } from "../types/chat";
import { isSameDirectory } from "../utils/platform";
import { deriveNewLeaf } from "../utils/link-leaf";
import { extractLinks, type SharedLink } from "../utils/link-extract";
import {
	decideSessionIntent,
	selectAcquisitionAgent,
	type SessionIntent,
} from "../utils/agent-switch";
import { useHistoryModal } from "../hooks/useHistoryModal";
import { useChatActions } from "../hooks/useChatActions";
import { ChangeDirectoryModal } from "./ChangeDirectoryModal";

// Service imports
import { getLogger } from "../utils/logger";
import { deriveTabLabel } from "../utils/deriveTabLabel";
import { decideGrabToggle } from "../utils/activeNoteGrabToggle";
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
import { useMessageQueue } from "../hooks/useMessageQueue";
import {
	shouldFlushQueue,
	shouldFlushOnReady,
	executeFlush,
} from "../services/message-queue-logic";

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
import { MessageList, type GettingStartedInfo } from "./MessageList";
import { shouldShowGettingStarted } from "../services/agent-detection";
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
	/** True when this tab holds a pending queued message (#82 broadcast skip-guard). */
	hasPendingQueue: () => boolean;
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
	/** Close a specific tab by ID (used when its session is deleted) */
	onCloseTab?: (tabId: string) => void;
	/** Persisted session ID for this tab (from tab persistence). Passed to useLazySession for session/load on first keystroke. */
	restoredSessionId?: string | null;
	/** Restored message history for this tab (from tab persistence). Seeded into the message list on async arrival while idle (I43). */
	restoredMessages?: ChatMessage[];
	/** Restored context notes for this tab (from tab persistence). Rehydrates the context strip on async arrival while idle (I61). */
	restoredContextNotes?: ContextNote[];
	/**
	 * True when this restored tab has a persisted sessionId but no local
	 * message file (I72). Drives the "history not stored locally — reload
	 * from agent" affordance so the tab shows a recoverable state instead of
	 * a silent blank panel.
	 */
	historyRecoverable?: boolean;
	/**
	 * Restored unsent draft text for this tab (from tab persistence). Seeds the
	 * composer's initial value at mount so a half-typed prompt survives panel
	 * close/reopen and restart. Undefined / "" means no draft.
	 * See [[ACP Preserve Unsent Draft Text Per Tab]].
	 */
	restoredDraft?: string;
	/**
	 * Called (after mount) whenever the composer's text changes, so the parent
	 * can debounce-persist the draft. Fires on user typing and on send-clear;
	 * not on the initial restore-seed. (Draft persistence — restart fix.)
	 */
	onDraftChange?: () => void;
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
/**
 * Raise the Obsidian window that owns this renderer to the OS foreground.
 *
 * Used by the system-notification onclick handlers (I52). DOM `window.focus()`
 * is a no-op for cross-window foregrounding in Electron
 * (electron/electron#25578), so a click landed on the most-recently-active
 * window — the wrong vault in a multi-vault setup. The native
 * `BrowserWindow.focus()` does raise the window, and `remote.getCurrentWindow()`
 * returns the window owning this renderer. Obsidian exposes no public API to
 * foreground an OS window, so we use the Electron `remote` bridge — the same
 * runtime-require pattern as ChangeDirectoryModal.
 */
function focusOwningWindow(): void {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a runtime-only module provided by Obsidian's host environment
		const { remote } = require("electron") as {
			remote: { getCurrentWindow: () => { focus: () => void } };
		};
		remote.getCurrentWindow().focus();
	} catch {
		// Non-Electron host (e.g. mobile) — best-effort DOM focus.
		window.focus();
	}
}

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
	onCloseTab,
	restoredSessionId,
	restoredMessages,
	restoredContextNotes,
	historyRecoverable,
	restoredDraft,
	onDraftChange,
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

	// Input state (for broadcast commands). Seeded from the restored draft so a
	// half-typed prompt survives panel close/reopen and restart (initializer
	// runs once at mount; later draft changes never re-seed, so live typing is
	// never clobbered). See [[ACP Preserve Unsent Draft Text Per Tab]].
	const [inputValue, setInputValue] = useState(restoredDraft ?? "");
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

	// Notify the parent (which debounces) whenever the composer text changes,
	// so the draft is persisted shortly after typing. The active tab's draft
	// has no other reliable save trigger before quit/restart. Skip the initial
	// mount so the restore-seed doesn't spuriously trigger a save.
	const onDraftChangeRef = useRef(onDraftChange);
	onDraftChangeRef.current = onDraftChange;
	const draftChangeMountedRef = useRef(false);
	useEffect(() => {
		if (!draftChangeMountedRef.current) {
			draftChangeMountedRef.current = true;
			return;
		}
		onDraftChangeRef.current?.();
	}, [inputValue]);

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
		handleExportChat,
		handleRestartAgent,
		handleReload,
		isReloading,
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
			// Right-click (button 2) arrives via onAuxClick on the pill; ignore
			// it so the default menu survives. Left-click and middle-click route
			// through the shared deriveNewLeaf for parity with chat-panel links.
			if (event.button !== 0 && event.button !== 1) return;
			void plugin.app.workspace.openLinkText(
				path,
				plugin.app.workspace.getActiveFile()?.path ?? "",
				deriveNewLeaf(event.nativeEvent),
			);
		},
		[plugin.app.workspace],
	);

	// Shared Links Bubble: derive the per-tab link set from the active tab's
	// messages (spec [[Shared Links Bubble]] § "derive, don't store").
	// Resolve internal links against the vault so illustrative/abbreviated
	// wikilinks the agent typed in prose (e.g. [[file]]) are excluded (SLB-I8);
	// external URLs are unaffected.
	const resolveInternalLink = useCallback(
		(linkpath: string): boolean =>
			plugin.app.metadataCache.getFirstLinkpathDest(linkpath, "") !== null,
		[plugin.app.metadataCache],
	);
	const sharedLinks = useMemo(
		() => extractLinks(messages, { resolveInternal: resolveInternalLink }),
		[messages, resolveInternalLink],
	);

	const handleOpenSharedLink = useCallback(
		(link: SharedLink, evt: MouseEvent | KeyboardEvent) => {
			if (link.kind === "external") {
				window.open(link.target, "_blank");
				return;
			}
			// Internal vault file — honor open-in-new-tab modifiers via the
			// same sanctioned resolver the chat-panel links use.
			const newLeaf =
				evt instanceof MouseEvent ? deriveNewLeaf(evt) : false;
			void plugin.app.workspace.openLinkText(
				link.target,
				plugin.app.workspace.getActiveFile()?.path ?? "",
				newLeaf,
			);
		},
		[plugin.app.workspace],
	);

	// Track whether tab label has been reported (reset on new chat / restore)
	const labelReportedRef = useRef(false);

	// Forward ref to useLazySession.reset — handleNewChatWithPersist (declared
	// above the lazySession hook) drives the lazy machine back to idle on a
	// recreate-lazy/swap-idle intent. Assigned right after useLazySession runs.
	const lazyResetRef = useRef<(() => void) | null>(null);

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
		onCloseTab,
	);

	// ============================================================
	// Sidebar-specific: agent switch / new-chat dispatcher.
	// ============================================================
	// Intent dispatcher for switch-agent / new-chat against the CURRENT tab
	// ([[Tab Agent Identity and Session Acquisition Unification]] design #1).
	// No path here calls agent.createSession: a switch/new-chat either swaps
	// the idle agent in place (swap-idle) or tears down the transcript and
	// RESETS the lazy machine (recreate-lazy), deferring acquisition to the
	// next send. useLazySession is the sole owner of session/new, so the first
	// message connects to the just-selected agent — no eager session to clobber
	// and no second session/new (the I53 flicker for this trigger).
	const handleNewChatWithPersist = useCallback(
		async (requestedAgentId?: string) => {
			try {
				const decision = decideSessionIntent({
					intent: (requestedAgentId
						? "switch-agent"
						: "new-chat") satisfies SessionIntent,
					currentAgentId: session.agentId,
					requestedAgentId,
					hasSession: !!session.sessionId,
					messageCount: messages.length,
				});

				if (decision.kind === "noop") return;

				// This dispatcher only issues switch-agent / new-chat intents,
				// which resolve to swap-idle or recreate-lazy. respawn-lazy and
				// resume come from restart/reload (Slice 3), never here — guard
				// so the decision.agentId access below is type-safe.
				if (
					decision.kind !== "swap-idle" &&
					decision.kind !== "recreate-lazy"
				) {
					return;
				}

				// recreate-lazy: genuine teardown of an existing
				// session/transcript before rebinding (auto-export first).
				if (decision.kind === "recreate-lazy") {
					if (agent.isSending) {
						await agent.cancelOperation();
					}
					if (messages.length > 0) {
						await autoExportIfEnabled("newChat", messages, session);
					}
					suggestions.mentions.toggleAutoMention(false);
					agent.clearMessages();
					sessionHistory.invalidateCache();
				}

				// swap-idle | recreate-lazy: rebind the tab's agent WITHOUT
				// creating a session and reset the lazy machine to idle. The
				// next send acquires (via useLazySession) against decision.agentId,
				// the now-current source of truth (session.agentId).
				agent.setAgentWithoutSession(decision.agentId);
				lazyResetRef.current?.();
				labelReportedRef.current = false;
				onLabelChangeRef.current?.("");
				// Persist agent ID for this view (survives Obsidian restart).
				onAgentIdChanged?.(decision.agentId);
			} catch (error) {
				console.error("[Agent Console] New chat error:", error);
			}
		},
		[
			session,
			session.agentId,
			session.sessionId,
			messages,
			agent.isSending,
			agent.cancelOperation,
			agent.clearMessages,
			agent.setAgentWithoutSession,
			autoExportIfEnabled,
			suggestions.mentions.toggleAutoMention,
			sessionHistory.invalidateCache,
			onAgentIdChanged,
		],
	);

	// ============================================================
	// Sidebar-specific: Header Menu (Obsidian native Menu API)
	// ============================================================
	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	// Deep-link into Obsidian's own updater (Settings → Community plugins) when
	// the "update available" pill is clicked. We hand off to the sanctioned
	// updater rather than self-updating — see the `Agent Console Update Pill
	// Click-Through` spec. The "community-plugins" core tab id was verified
	// against the running Obsidian (app.setting.settingTabs).
	const handleOpenCommunityPlugins = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById("community-plugins");
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
			registerOpenMenu(menu);

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
	}, []);

	// Queue-next-message (#82). Runtime-only queue-of-one shared by BOTH the
	// streaming case (send while a turn runs) and the pre-ready case (send
	// while session acquisition is in flight — Decision 9). The composer text
	// is the single source of truth; `isQueued` is never persisted. Declared
	// here (above lazySession + the flush effect + the send wrapper) so those
	// can reference it.
	const messageQueue = useMessageQueue();

	// Tracks whether the in-flight turn was cancelled by the user so the
	// turn-end flush HOLDS (does not auto-fire) per Decision 5. Reset at turn
	// start.
	const cancelledRef = useRef(false);

	const lazySession = useLazySession({
		// Restored sessionId from tab persistence. When non-null, the
		// hook calls loadExistingSession on first keystroke instead of
		// acquireNewSession.
		restoredSessionId: restoredSessionId ?? null,

		acquireNewSession: useCallback(async () => {
			try {
				const effectiveAgent = selectAcquisitionAgent(
					agent.session.agentId,
					config?.agent || initialAgentId,
				);
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
			agent.session.agentId,
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
			// Queue flush is owned by ChatPanel's connect-flush effect
			// (below) — not by the hook's internal sendPrompt. Owning
			// the flush at the ChatPanel level lets us read
			// agent.session.sessionId from a post-render closure when
			// the user message threads through handleSendMessage.
		}, []),
	});

	// Wire the forward ref so the (earlier-declared) switch/new-chat dispatcher
	// can reset the lazy machine to idle. lazySession.reset is a stable
	// useCallback identity, so reassigning each render is a no-op cost.
	lazyResetRef.current = lazySession.reset;

	// Connect-flush effect (#82 Decision 9): when session acquisition completes
	// — the (connecting|idle)→ready transition — flush the pending queued
	// message through the normal send path. Keyed on the transition (not
	// "ready && !sending") so it stays disjoint from the turn-end flush: a turn
	// ending is busy→ready, owned by the gated turn-end flush, so this never
	// double-fires nor bypasses the hold-on-error/cancel gate. The
	// ready+sessionId guard is the I69 invariant (sessionId must be committed
	// before handleSendMessage reads it).
	const prevLazyStateRef = useRef<string>(lazySession.state);
	useEffect(() => {
		const prevState = prevLazyStateRef.current;
		prevLazyStateRef.current = lazySession.state;
		if (
			shouldFlushOnReady({
				prevState,
				state: lazySession.state,
				hasSessionId: !!agent.session.sessionId,
				isQueued: messageQueue.isQueued,
			})
		) {
			const payload = messageQueue.consume();
			if (payload) {
				setInputValue("");
				setAttachedFiles([]);
				void handleSendMessage(payload.content, payload.attachments);
			}
		}
	}, [
		lazySession.state,
		agent.session.sessionId,
		messageQueue,
		handleSendMessage,
	]);

	// Send wrapper: ready → handleSendMessage directly. Not-ready → enqueue the
	// message (queue-of-one) and trigger lazy acquisition; the connect-flush
	// effect above sends it once the session is ready. The normal UI routes
	// not-ready sends through handleQueueMessage (no composer clear); this
	// branch is the safety net for direct/broadcast callers.
	const handleSendWithLazyAcquisition = useCallback(
		async (content: string, attachments?: AttachedFile[]) => {
			if (lazySession.state === "ready" && agent.session.sessionId) {
				await handleSendMessage(content, attachments);
				return;
			}
			if (messageQueue.enqueue({ content, attachments })) {
				lazySession.onSendClick(content);
			}
		},
		[
			lazySession.state,
			lazySession.onSendClick,
			agent.session.sessionId,
			handleSendMessage,
			messageQueue,
		],
	);

	// ============================================================
	// Queue Next Message (#82) — handlers
	// ============================================================
	// (messageQueue + cancelledRef are declared earlier, above lazySession.)

	// Queue the composer's current content. Used for BOTH streaming (flushes on
	// turn-end) and pre-ready/connecting (flushes on connect — Decision 9). The
	// composer text stays put (locked by InputArea via isQueued) — it remains
	// the single source of truth. enqueue returning false (queue full) is the
	// queue-of-one guard that blocks a silent 2nd-message overwrite.
	const handleQueueMessage = useCallback(
		(content: string, attachments?: AttachedFile[]) => {
			const trimmed = content.trim();
			if (!trimmed && (attachments?.length ?? 0) === 0) return;
			const accepted = messageQueue.enqueue({ content: trimmed, attachments });
			if (!accepted) return; // queue-of-one — already holding one
			// Pre-ready: kick off session acquisition so the queued message
			// flushes when the session connects. (Streaming: the turn-end flush
			// handles it; no acquisition needed.)
			if (lazySession.state !== "ready") {
				lazySession.onSendClick(trimmed);
			}
		},
		[messageQueue, lazySession.state, lazySession.onSendClick],
	);

	// Edit: unlock the composer (clear the queued flag) but KEEP the text so
	// the user can modify it and re-queue on the next send.
	const handleEditQueued = useCallback(() => {
		messageQueue.clear();
	}, [messageQueue]);

	// Delete: clear the slot AND empty the composer (discard the message).
	// (Edit keeps the text; Delete removes it — the label distinction the user
	// flagged: "Cancel" wrongly implied the text returns to the composer.)
	const handleDeleteQueued = useCallback(() => {
		messageQueue.clear();
		setInputValue("");
		setAttachedFiles([]);
	}, [messageQueue]);

	// Stop wrapper: mark the in-flight turn as user-cancelled so the flush
	// effect HOLDS any queued message (Decision 5) instead of firing it into
	// the cancelled turn. Used by every stop entry point (button, hotkey,
	// broadcast-cancel) via handleStopGenerationRef.
	const handleStopWithCancelFlag = useCallback(async () => {
		cancelledRef.current = true;
		await handleStopGeneration();
	}, [handleStopGeneration]);

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
				// I52: bind onclick so a click focuses the vault window that owns
				// this panel, not Electron's most-recently-active window (which is
				// the wrong vault entirely in a multi-vault setup).
				const completionNotification = new Notification("Agent Console", {
					body: `${activeAgentLabel} has completed the response.`,
				});
				completionNotification.onclick = () => focusOwningWindow();
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
			// I52: bind onclick so a click focuses the vault window that owns
			// this panel, not Electron's most-recently-active window.
			const permissionNotification = new Notification("Agent Console", {
				body: `${activeAgentLabel} is requesting permission.`,
			});
			permissionNotification.onclick = () => focusOwningWindow();
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
		// Report the live session id, or fall back to the restored (persisted)
		// id for an inert tab that hasn't lazily connected yet — so history
		// operations (I20 restore-switch, TS-I01 delete-close) can match the tab
		// before connection. Without this, a restored-but-unconnected tab is
		// absent from the tab→session map and delete/restore can't find it.
		onSessionIdChange?.(session.sessionId ?? restoredSessionId ?? null);
	}, [onSessionIdChange, session.sessionId, restoredSessionId]);

	// ============================================================
	// Auto-default context crystallizes on FIRST SEND in useChatActions
	// (Decision #26, I68) — not seeded at mount. The provisional dashed pill
	// is derived in ContextStrip from the live active note.
	// ============================================================

	// ============================================================
	// Effects - Workspace Events (Hotkeys)
	// ============================================================

	// I74: grab/ungrab the active editor note (active-note-scoped membership toggle).
	const handleToggleActiveNoteGrab = useCallback(() => {
		const path = selectionTracker.activeNotePath;
		// Count the provisional auto-default pill as present so a fresh
		// session's first press removes it instead of committing it (I74).
		const provisionalPath = computeProvisionalPath({
			settingOn: settings.activeNoteAsDefaultContext,
			suppressed: autoDefaultSuppressed,
			messageCount: messages.length,
			activeNotePath: path,
			committed: contextNotes.notes,
		});
		const action = decideGrabToggle({
			activeNotePath: path,
			activeNoteName: selectionTracker.activeNoteName,
			committed: contextNotes.notes,
			provisionalPath,
		});
		if (action.kind === "grab") {
			contextNotes.add(action.path, "user");
		} else if (action.kind === "ungrab") {
			contextNotes.remove(action.path);
			// Ungrab also suppresses the per-chat auto-default so it sticks.
			setAutoDefaultSuppressed(true);
		}
		new Notice(action.notice);
	}, [
		selectionTracker.activeNotePath,
		selectionTracker.activeNoteName,
		contextNotes,
		settings.activeNoteAsDefaultContext,
		autoDefaultSuppressed,
		messages.length,
		setAutoDefaultSuppressed,
	]);
	const handleToggleActiveNoteGrabRef = useRef(handleToggleActiveNoteGrab);
	handleToggleActiveNoteGrabRef.current = handleToggleActiveNoteGrab;

	// Refs for workspace event handlers (avoids re-registering on every render)
	const handleNewChatWithPersistRef = useRef(handleNewChatWithPersist);
	const approveActivePermissionRef = useRef(agent.approveActivePermission);
	const rejectActivePermissionRef = useRef(agent.rejectActivePermission);
	const handleStopGenerationRef = useRef(handleStopWithCancelFlag);
	const handleExportChatRef = useRef(handleExportChat);
	const handleReloadRef = useRef(handleReload);
	handleNewChatWithPersistRef.current = handleNewChatWithPersist;
	approveActivePermissionRef.current = agent.approveActivePermission;
	rejectActivePermissionRef.current = agent.rejectActivePermission;
	handleStopGenerationRef.current = handleStopWithCancelFlag;
	handleExportChatRef.current = handleExportChat;
	handleReloadRef.current = handleReload;

	useEffect(() => {
		const workspace = plugin.app.workspace;
		const ws = workspace as unknown as {
			on: (
				name: string,
				callback: (...args: never[]) => void,
			) => ReturnType<typeof workspace.on>;
		};

		const refs = [
			// Toggle active note in context: grab / ungrab (I74)
			ws.on(
				"agent-console:toggle-auto-mention",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					handleToggleActiveNoteGrabRef.current();
				},
			),

			// New chat requested (from "New chat" or "Switch agent to" commands)
			ws.on(
				"agent-console:new-chat-requested",
				(targetViewId?: string, agentId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void handleNewChatWithPersistRef.current(agentId);
				},
			),

			// Approve active permission
			ws.on(
				"agent-console:approve-active-permission",
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
				"agent-console:reject-active-permission",
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
			ws.on("agent-console:cancel-message", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleStopGenerationRef.current();
			}),

			// Export chat
			ws.on("agent-console:export-chat", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleExportChatRef.current();
			}),

			// Reload session (soft — resume same session under fresh harness)
			ws.on("agent-console:reload-session", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleReloadRef.current(false);
			}),

			// Hard reload session (fresh session under fresh harness)
			ws.on(
				"agent-console:hard-reload-session",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void handleReloadRef.current(true);
				},
			),
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

	// Queue refs (#82) — read latest queue state from the once-registered
	// broadcast/send callbacks (same ref pattern as the values above).
	const isQueuedRef = useRef(messageQueue.isQueued);
	const handleQueueMessageRef = useRef(handleQueueMessage);
	isQueuedRef.current = messageQueue.isQueued;
	handleQueueMessageRef.current = handleQueueMessage;

	// ============================================================
	// Effects - Flush queued message on turn completion (#82)
	// ============================================================
	// Auto-send the queued message ONLY when the turn it was queued behind
	// completed normally. Reset the cancel flag at turn start; on turn end
	// (isSending true -> false) consult shouldFlushQueue, which holds on
	// error/cancel (Decision 5). The flush routes through the normal send path
	// (handleSendWithLazyAcquisition) AFTER clearing the composer, so
	// draft-preservation observes the emptied composer and persists "" — no
	// stale-draft resurrection.
	const prevIsSendingForQueueRef = useRef(false);
	useEffect(() => {
		const wasSending = prevIsSendingForQueueRef.current;
		prevIsSendingForQueueRef.current = isSending;

		// Turn start: clear the cancel flag for the new turn.
		if (!wasSending && isSending) {
			cancelledRef.current = false;
			return;
		}

		// Turn end: decide flush vs hold.
		const turnEnded = wasSending && !isSending;
		if (
			shouldFlushQueue({
				turnEnded,
				isQueued: messageQueue.isQueued,
				hadError: errorInfo !== null,
				wasCancelled: cancelledRef.current,
			})
		) {
			executeFlush({
				consume: messageQueue.consume,
				clearComposer: () => {
					// Clear first so the cleared value persists (mirrors a
					// normal send, which clears on dispatch).
					setInputValue("");
					setAttachedFiles([]);
				},
				// Dispatch via the RAW send, NOT handleSendWithLazyAcquisition
				// (I-Q-FLUSH): at the isSending true→false commit, lazySession
				// hasn't re-rendered busy→ready yet, so the wrapper would see
				// "busy", re-enqueue the just-consumed message, and the
				// connect-flush (gated to connecting/idle→ready) would never
				// pick it up → silent drop. The session is established at
				// turn-end, so handleSendMessage sends directly. Matches the
				// connect-flush, which already dispatches raw.
				dispatch: (content, attachments) =>
					void handleSendMessage(content, attachments),
			});
		}
	}, [isSending, errorInfo, messageQueue, handleSendMessage]);

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

				const messageToSend = currentInput.trim();
				const filesToSend =
					currentFiles.length > 0 ? [...currentFiles] : undefined;

				// QUEUE instead of dispatching when a turn is streaming OR the
				// session isn't ready yet (#82 Decision 9 — one pending message
				// for both states). Broadcast-send inherits this for free. Keep
				// the composer text in place (it's the queued message, locked by
				// InputArea); handleQueueMessage enqueues and, when pre-ready,
				// triggers acquisition so it flushes on connect. A tab already
				// holding a queued message is skipped upstream by broadcast; the
				// queue-of-one cap is the defensive backstop here.
				if (isSendingRef.current || !isSessionReadyRef.current) {
					if (isQueuedRef.current) return false;
					handleQueueMessageRef.current(messageToSend, filesToSend);
					return true;
				}

				// Ready + idle → normal dispatch (clears the composer).
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
			hasPendingQueue: () => isQueuedRef.current,
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
			headerSegments={{
				...headerSegments,
				isLazyIdle: lazySession.state === "idle",
				isConnecting: lazySession.state === "connecting",
			}}
			isUpdateAvailable={isUpdateAvailable}
			onUpdateClick={handleOpenCommunityPlugins}
			onReload={(hard) => void handleReload(hard)}
			isReloading={isReloading}
			onExportChat={() => void handleExportChat()}
			onShowMenu={handleShowSidebarMenu}
			onOpenHistory={handleOpenHistory}
			sharedLinks={sharedLinks}
			onOpenSharedLink={handleOpenSharedLink}
		/>
	);

	const cwdBanner =
		agentCwd !== vaultPath && !isSameDirectory(agentCwd, vaultPath) ? (
			<div className="agent-client-cwd-banner" aria-label={agentCwd}>
				<span
					className="agent-client-cwd-banner-icon"
					ref={(el) => {
						if (el) setIcon(el, "folder-open");
					}}
				/>
				<span className="agent-client-cwd-banner-path">{agentCwd}</span>
			</div>
		) : null;

	// Layer 2 — getting-started empty state. Lazily detect installed agents
	// the first time an empty, not-yet-ready panel renders; if the current
	// agent is not among them, surface one-click picks + open-settings instead
	// of a dead-end "Connecting..." that never resolves. Detection is the
	// session-cached, login-shell-aware plugin probe (never on the load path).
	const [detectedAgentIds, setDetectedAgentIds] = useState<
		Set<string> | null
	>(null);

	const isEmptyAndIdle =
		messages.length === 0 && !isSessionReady && !sessionHistory.loading;

	useEffect(() => {
		if (!isEmptyAndIdle || detectedAgentIds !== null) return;
		let cancelled = false;
		void plugin.detectAgents().then((ids) => {
			if (!cancelled) setDetectedAgentIds(ids);
		});
		return () => {
			cancelled = true;
		};
	}, [isEmptyAndIdle, detectedAgentIds, plugin]);

	const gettingStarted = useMemo<GettingStartedInfo | undefined>(() => {
		const currentAgentId =
			session.agentId || plugin.settings.defaultAgentId;
		// Only built-in agents drive the getting-started dead-end state.
		// A custom agent the user configured is never treated as a dead end
		// (I-FRO2): detection covers only the built-ins, so membership alone
		// would wrongly flag every custom-agent default.
		const builtInIds = new Set([
			plugin.settings.claude.id,
			plugin.settings.codex.id,
			plugin.settings.gemini.id,
			plugin.settings.kiro.id,
		]);
		if (
			!shouldShowGettingStarted({
				messageCount: messages.length,
				currentAgentId,
				builtInIds,
				detectedIds: detectedAgentIds,
			})
		) {
			return undefined;
		}
		const installed = detectedAgentIds ?? new Set<string>();
		return {
			detectedAgents: availableAgents.filter((a) =>
				installed.has(a.id),
			),
			onPickAgent: (agentId: string) => {
				void handleNewChatWithPersist(agentId);
			},
			onOpenSettings: handleOpenSettings,
		};
	}, [
		messages.length,
		detectedAgentIds,
		session.agentId,
		plugin,
		availableAgents,
		handleNewChatWithPersist,
		handleOpenSettings,
	]);

	// The optimistic pre-ready "Sending…" bubble (pendingMessage) was retired in
	// #82 Decision 9 — a pre-ready message now shows in the locked composer, not
	// the transcript. The transcript is just the real messages.
	const displayMessages = messages;

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
			gettingStarted={gettingStarted}
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

	// I72 — restored tab whose local message file was missing. Offer
	// on-demand history recovery (agent replay) instead of a silent blank.
	// Auto-hides once a session goes live or any message is shown (recovery
	// succeeded, or the user started typing a fresh conversation).
	const showRecoverableHistory =
		!!historyRecoverable &&
		messages.length === 0 &&
		lazySession.sessionId === null;

	const recoverableHistoryBanner = showRecoverableHistory ? (
		<div className="agent-client-recoverable-history" role="status">
			<span className="agent-client-recoverable-history-text">
				History for this tab is not stored locally.
			</span>
			<button
				type="button"
				className="agent-client-recoverable-history-button"
				onClick={() => lazySession.recoverHistory()}
				disabled={lazySession.state === "connecting"}
			>
				{lazySession.state === "connecting"
					? "Reloading…"
					: "Reload from agent"}
			</button>
		</div>
	) : null;

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
			onStopGeneration={handleStopWithCancelFlag}
			onRestoredMessageConsumed={handleRestoredMessageConsumed}
			// Queue Next Message (#82)
			isStreaming={isSending}
			isQueued={messageQueue.isQueued}
			onQueueMessage={handleQueueMessage}
			onEditQueued={handleEditQueued}
			onDeleteQueued={handleDeleteQueued}
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
			imageCapabilityKnown={session.promptCapabilities !== undefined}
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
			{recoverableHistoryBanner}
			{messageListElement}
			{contextStripElement}
			{inputAreaElement}
		</div>
	);
}
