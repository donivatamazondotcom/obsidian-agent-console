import { migrateContextNoteSettings } from "./services/settings-migration";
import { addIcon, Plugin, WorkspaceLeaf, Notice } from "obsidian";
import * as semver from "semver";
import { AGENT_CONSOLE_SVG } from "./ui/branding";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/ChatView";
import { fetchJson } from "./services/net";
import { ChatViewRegistry } from "./services/view-registry";
import {
	createSettingsService,
	type SettingsService,
} from "./services/settings-service";
import { SessionStorage } from "./services/session-storage";
import { AgentClientSettingTab } from "./ui/SettingsTab";
import { AcpClient } from "./acp/acp-client";
import {
	DEFAULT_SETTINGS,
	normalizeRawSettings,
} from "./services/settings-normalizer";
import { getAvailableAgentsFromSettings } from "./services/session-helpers";
import {
	detectAvailableAgents,
	chooseFirstRunDefault,
	type AgentCandidate,
} from "./services/agent-detection";
import {
	AgentEnvVar,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	CustomAgentSettings,
	KiroAgentSettings,
} from "./types/agent";
import type { SavedSessionInfo } from "./types/session";
import type { PerLeafTabState } from "./types/tab";
import { initializeLogger, getLogger } from "./utils/logger";
import { closeOpenMenus } from "./utils/menu-registry";
import { ImportSettingsModal } from "./ui/ImportSettingsModal";
import { AgentPickerModal } from "./ui/AgentPickerModal";
import {
	computeStartChat,
	isChatCommandAvailable,
} from "./utils/command-palette";
import {
	createImportSources,
	firstDetectedSource,
} from "./services/import/registry";
import type { ImportSource } from "./services/import/ImportSource";

// Re-export for backward compatibility
export type { AgentEnvVar, CustomAgentSettings };

/**
 * Send message shortcut configuration.
 * - 'enter': Enter to send, Shift+Enter for newline (default)
 * - 'cmd-enter': Cmd/Ctrl+Enter to send, Enter for newline
 */
export type SendMessageShortcut = "enter" | "cmd-enter";

/**
 * Chat view location configuration.
 * - 'right': Open in the right sidebar (default)
 * - 'left': Open in the left sidebar
 */
export type ChatViewLocation = "right" | "left";

export interface AgentClientPluginSettings {
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	codex: CodexAgentSettings;
	kiro: KiroAgentSettings;
	customAgents: CustomAgentSettings[];
	/** Default agent ID for new views (renamed from activeAgentId for multi-session) */
	defaultAgentId: string;
	autoAllowPermissions: boolean;
	activeNoteAsDefaultContext: boolean;
	/** One-shot flag: context-note migration notice has been shown */
	migrationNoticeShown: boolean;
	/** Show OS system notifications on response completion and permission requests */
	enableSystemNotifications: boolean;
	debugMode: boolean;
	nodePath: string;
	exportSettings: {
		defaultFolder: string;
		filenameTemplate: string;
		autoExportOnNewChat: boolean;
		autoExportOnCloseChat: boolean;
		openFileAfterExport: boolean;
		includeImages: boolean;
		imageLocation: "obsidian" | "custom" | "base64";
		imageCustomFolder: string;
		frontmatterTag: string;
	};
	// WSL settings (Windows only)
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
	// Input behavior
	sendMessageShortcut: SendMessageShortcut;
	// View settings
	chatViewLocation: ChatViewLocation;
	// Display settings
	displaySettings: {
		showEmojis: boolean;
		fontSize: number | null;
	};
	// Locally saved session metadata (for agents without session/list support)
	savedSessions: SavedSessionInfo[];
	// Last used model per agent (agentId → modelId)
	lastUsedModels: Record<string, string>;
	// Last used mode per agent (agentId → modeId)
	lastUsedModes: Record<string, string>;

	// Tab settings
	/** Restore open tabs on startup (default: true). See [[ACP Tab Persistence Across Restarts]] § Setting. */
	restoreTabsOnStartup: boolean;

	/**
	 * Confirm before closing the panel (focused Cmd+W) when it has 2+ open
	 * chats (default: true). See [[ACP Confirm Close With Multiple Tabs]].
	 */
	confirmCloseWithMultipleTabs: boolean;

	/**
	 * Per-leaf saved tab state for restoration across Obsidian restarts.
	 *
	 * Optional: undefined means no state has been saved yet (first
	 * launch, or after explicit discard via SessionStorage.discardTabState).
	 * An explicit empty array `[]` is also a valid persisted state
	 * (degenerate but lossless under round-trip).
	 *
	 * See [[ACP Tab Persistence Across Restarts]] § Save / § Restore.
	 */
	perLeafTabStates?: PerLeafTabState[];

	/**
	 * One-time guard for the legacy `agent-client` → `agent-console`
	 * session-dir migration. See [[I68 Session storage dir hardcoded to
	 * old agent-client plugin id]].
	 */
	legacySessionsMigrated?: boolean;

	/** One-shot guard for the first-run settings-import offer. */
	settingsImportOfferShown?: boolean;
}

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsService!: SettingsService;

	/** Registry for all chat view containers */
	viewRegistry = new ChatViewRegistry();

	/** Map of viewId to AcpClient for multi-session support */
	private _acpClients: Map<string, AcpClient> = new Map();

	/**
	 * True only on a genuine fresh install (no data.json yet). Gates the
	 * one-time first-run onboarding (Phase B default-selection + Layer 3
	 * auto-open). Self-clears once onboarding saves settings.
	 */
	private isFirstRun = false;

	/**
	 * Session-cached agent-detection result. Detection costs a login-shell
	 * spawn per agent, so it runs at most once per session and is shared by
	 * first-run onboarding and the getting-started empty state. Lazy: never
	 * started in onload.
	 */
	private _detectedAgentsPromise: Promise<Set<string>> | null = null;

	async onload() {
		await this.loadSettings();

		initializeLogger(this.settings);

		// Initialize settings store
		this.settingsService = createSettingsService(this.settings, this);

		// One-time migration of session files from the legacy
		// `agent-client` plugin dir into this plugin's own dir (I68).
		// Must complete before any view reads session history.
		await new SessionStorage(
			this,
			this.settingsService,
		).migrateLegacySessionsDir();

		// Do NOT detach existing chat leaves here. Obsidian restores
		// chat leaves from workspace.json with their original leaf.id,
		// and tab state is keyed on leaf.id (I47). Detaching destroys
		// the restored leaf, so activateView() mints a fresh id and the
		// saved tab state never matches. Obsidian auto-unregisters view
		// types on unload, so registerView does not throw on reload.
		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		// Register the Agent Console brand icon before adding the ribbon button.
		// addIcon takes inner SVG content (no <svg> wrapper) and Obsidian renders
		// it inside a 0 0 100 100 viewBox. See src/ui/branding.ts for the geometry.
		addIcon("agent-console", AGENT_CONSOLE_SVG);

		const ribbonIconEl = this.addRibbonIcon(
			"agent-console",
			"Agent Console",
			(_evt: MouseEvent) => {
				void this.activateView();
			},
		);
		ribbonIconEl.addClass("agent-console-ribbon-icon");

		this.addCommand({
			id: "open-chat-view",
			name: "Open chat",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "focus-next-chat-view",
			name: "Focus next chat view",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.focusChatView("next");
				}
				return true;
			},
		});

		this.addCommand({
			id: "focus-previous-chat-view",
			name: "Focus previous chat view",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.focusChatView("previous");
				}
				return true;
			},
		});

		// Tab commands
		this.addCommand({
			id: "close-session-tab",
			name: "Close session tab",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.getActiveChatView()?.closeActiveTab();
				}
				return true;
			},
		});

		this.addCommand({
			id: "next-session-tab",
			name: "Next session tab",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.getActiveChatView()?.nextTab();
				}
				return true;
			},
		});

		this.addCommand({
			id: "previous-session-tab",
			name: "Previous session tab",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.getActiveChatView()?.prevTab();
				}
				return true;
			},
		});

		this.addCommand({
			id: "reopen-closed-session",
			name: "Reopen closed session tab",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.getActiveChatView()?.reopenClosedTab();
				}
				return true;
			},
		});

		this.addCommand({
			id: "import-settings",
			name: "Import settings from another agent plugin",
			callback: () => {
				this.openImportSettingsModal();
			},
		});

		// Register agent-specific commands
		this.registerAgentCommands();
		this.registerPermissionCommands();
		this.registerBroadcastCommands();

		this.addSettingTab(new AgentClientSettingTab(this.app, this));

		// First-run, one-shot offer to import settings from another agent plugin.
		void this.maybeOfferSettingsImport();

		// First-run onboarding (Phase B default-selection + Layer 3 auto-open),
		// deferred to onLayoutReady so the login-shell agent probes never run on
		// the critical load path. Runs once; self-clears by saving settings.
		this.app.workspace.onLayoutReady(() => {
			void this.maybeFirstRunOnboarding();
		});

		// Clean up all ACP sessions when Obsidian quits
		// Note: We don't wait for disconnect to complete to avoid blocking quit
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				// Fire and forget - don't block Obsidian from quitting
				for (const [viewId, client] of this._acpClients) {
					client.disconnect().catch((error) => {
						getLogger().warn(
							`Quit cleanup error for view ${viewId}:`,
							error,
						);
					});
				}
				this._acpClients.clear();
			}),
		);
	}

	onunload() {
		// I14: close any open dropdown menu so a reload (BRAT update,
		// disable/enable, or the screenshot setup.sh) doesn't leave an orphaned
		// native popup on screen — it would otherwise survive unload, and the
		// next screenshot run would capture it.
		closeOpenMenus();

		// Clear registry (sidebar views are managed by Obsidian workspace)
		this.viewRegistry.clear();

		// Disconnect all ACP clients (kill agent processes)
		for (const [, client] of this._acpClients) {
			client.disconnect().catch(() => {});
		}
		this._acpClients.clear();
	}

	/**
	 * Get or create an AcpClient for a specific view.
	 * Each ChatView has its own AcpClient for independent sessions.
	 */
	getOrCreateAcpClient(viewId: string): AcpClient {
		let client = this._acpClients.get(viewId);
		if (!client) {
			client = new AcpClient(this);
			this._acpClients.set(viewId, client);
		}
		return client;
	}

	/**
	 * Update auto-allow permission setting on all live AcpClient instances.
	 * Called when the setting changes at runtime.
	 */
	updateAllAutoAllow(autoAllow: boolean): void {
		for (const client of this._acpClients.values()) {
			client.updateAutoAllow(autoAllow);
		}
	}

	/**
	 * Remove and disconnect the AcpClient for a specific view.
	 * Called when a ChatView is closed.
	 */
	async removeAcpClient(viewId: string): Promise<void> {
		const client = this._acpClients.get(viewId);
		if (client) {
			try {
				await client.disconnect();
			} catch (error) {
				getLogger().warn(
					`Failed to disconnect client for view ${viewId}:`,
					error,
				);
			}
			this._acpClients.delete(viewId);
		}
		// Note: lastActiveChatViewId is now managed by viewRegistry
		// Clearing happens automatically when view is unregistered
	}

	/**
	 * Get the last active ChatView ID for keybind targeting.
	 */
	get lastActiveChatViewId(): string | null {
		return this.viewRegistry.getFocusedId();
	}

	/**
	 * Set the last active ChatView ID.
	 * Called when a ChatView receives focus or interaction.
	 */
	setLastActiveChatViewId(viewId: string | null): void {
		if (viewId) {
			this.viewRegistry.setFocused(viewId);
		}
	}

	/**
	 * Resolve the registry-stored leaf-level ID to the active tab's
	 * tab.tabId, which is what ChatPanel listeners filter on. For floating
	 * chats (no tabs) the floating viewId is returned unchanged because it
	 * already matches what the registry stores.
	 *
	 * Use this in `addCommand` callbacks instead of `this.lastActiveChatViewId`
	 * to ensure events route to the active tab's ChatPanel listener (I33).
	 */
	private getDispatchTargetId(): string | null {
		const focusedId = this.lastActiveChatViewId;
		if (!focusedId) return null;

		const chatView = this.app.workspace
			.getLeavesOfType(VIEW_TYPE_CHAT)
			.find((l) => (l.view as ChatView)?.viewId === focusedId)?.view as
			| ChatView
			| undefined;

		return chatView?.getActiveTabId() ?? focusedId;
	}

	/**
	 * True when at least one chat view leaf is open (any location, incl.
	 * floating). Used to context-gate navigate / act-on-chat / broadcast
	 * commands so a cold-start palette surfaces only Open chat / New chat /
	 * New chat with agent…. See command-palette rationalization spec (C3).
	 */
	private hasOpenChatView(): boolean {
		return isChatCommandAvailable(
			this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT).length,
		);
	}

	/**
	 * Find an open chat-view leaf to target, preferring the focus-tracked one
	 * and falling back to the first open leaf. Returns null only when no chat
	 * view is open at all. Keyed on existence (not focus) so "New chat" routes
	 * to the right panel even when focus tracking hasn't registered one.
	 */
	private getTargetChatLeaf(): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		if (leaves.length === 0) return null;
		const focusedId = this.lastActiveChatViewId;
		const focused = focusedId
			? leaves.find((l) => (l.view as ChatView)?.viewId === focusedId)
			: undefined;
		return focused ?? leaves[0];
	}

	/**
	 * Start a chat from any state (browser-tab model). When a chat view is
	 * open, open a NEW tab (optionally on a specific agent) in it; when none
	 * is open, open a panel. Either branch always produces a visible chat, so
	 * no start-a-chat command can silently no-op (kills the I82 class). The
	 * decision is existence-based, so it never spawns a duplicate tab from a
	 * null focus target.
	 */
	async startChat(agentId?: string): Promise<void> {
		const leaf = this.getTargetChatLeaf();
		const action = computeStartChat(leaf !== null, agentId);
		if (action.kind === "open-panel") {
			// No chat view open — open one (on a specific agent, else default).
			if (action.agentId) {
				await this.openNewChatViewWithAgent(action.agentId);
			} else {
				await this.activateView();
			}
			return;
		}
		// add-tab: open a new tab on the chosen agent in the existing panel.
		const view = leaf?.view;
		if (view instanceof ChatView) {
			view.addTab(action.agentId);
			await this.app.workspace.revealLeaf(leaf as WorkspaceLeaf);
			this.focusTextarea(leaf as WorkspaceLeaf);
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			// Find the leaf matching lastActiveChatViewId, or fall back to first leaf
			const focusedId = this.lastActiveChatViewId;
			if (focusedId) {
				leaf =
					leaves.find(
						(l) => (l.view as ChatView)?.viewId === focusedId,
					) || leaves[0];
			} else {
				leaf = leaves[0];
			}
		} else {
			leaf = this.createNewChatLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
			this.focusTextarea(leaf);
		}
	}

	/**
	 * Focus the textarea in a ChatView leaf.
	 */
	private focusTextarea(leaf: WorkspaceLeaf): void {
		const viewContainerEl = leaf.view?.containerEl;
		if (viewContainerEl) {
			window.setTimeout(() => {
				const textarea = viewContainerEl.querySelector(
					"textarea.agent-client-chat-input-textarea",
				);
				if (textarea instanceof HTMLTextAreaElement) {
					textarea.focus();
				}
			}, 50);
		}
	}

	/**
	 * Focus the next or previous ChatView in the list.
	 * Uses ChatViewRegistry which includes both sidebar and floating views.
	 */
	private focusChatView(direction: "next" | "previous"): void {
		if (direction === "next") {
			this.viewRegistry.focusNext();
		} else {
			this.viewRegistry.focusPrevious();
		}
	}

	/**
	 * Create a new leaf for ChatView based on the configured location setting.
	 * @param isAdditional - true when opening additional views (e.g., Open New View)
	 */
	private createNewChatLeaf(isAdditional: boolean): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const location = this.settings.chatViewLocation;

		switch (location) {
			case "left":
				return isAdditional
					? this.createSidebarTab("left")
					: workspace.getLeftLeaf(false);
			case "right":
				return isAdditional
					? this.createSidebarTab("right")
					: workspace.getRightLeaf(false);
			default:
				return workspace.getRightLeaf(false);
		}
	}

	/**
	 * Create a new tab within an existing sidebar tab group.
	 * Uses the parent of an existing chat leaf to add a sibling tab,
	 * avoiding the vertical split caused by getRightLeaf(true).
	 */
	private createSidebarTab(side: "right" | "left"): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const split =
			side === "right" ? workspace.rightSplit : workspace.leftSplit;

		// Find an existing chat leaf in this sidebar to get its tab group
		const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		const sidebarLeaf = existingLeaves.find(
			(leaf) => leaf.getRoot() === split,
		);

		if (sidebarLeaf) {
			const tabGroup = sidebarLeaf.parent;
			// Index is clamped by Obsidian, so a large value appends to the end
			return workspace.createLeafInParent(
				tabGroup,
				Number.MAX_SAFE_INTEGER,
			);
		}

		// Fallback: no existing chat leaf in sidebar, create first one
		return side === "right"
			? workspace.getRightLeaf(false)
			: workspace.getLeftLeaf(false);
	}

	/**
	 * Open a new chat view with a specific agent.
	 * Always creates a new view (doesn't reuse existing).
	 */
	async openNewChatViewWithAgent(agentId: string): Promise<void> {
		const leaf = this.createNewChatLeaf(true);
		if (!leaf) {
			getLogger().warn("Failed to create new leaf");
			return;
		}

		await leaf.setViewState({
			type: VIEW_TYPE_CHAT,
			active: true,
			state: { initialAgentId: agentId },
		});

		await this.app.workspace.revealLeaf(leaf);

		// Focus textarea after revealing the leaf
		const viewContainerEl = leaf.view?.containerEl;
		if (viewContainerEl) {
			window.setTimeout(() => {
				const textarea = viewContainerEl.querySelector(
					"textarea.agent-client-chat-input-textarea",
				);
				if (textarea instanceof HTMLTextAreaElement) {
					textarea.focus();
				}
			}, 0);
		}
	}

	/**
	 * Get the active sidebar ChatView (for tab commands).
	 */
	getActiveChatView(): ChatView | null {
		const focusedId = this.lastActiveChatViewId;
		if (!focusedId) return null;
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof ChatView && view.viewId === focusedId) {
				return view;
			}
		}
		return null;
	}

	/**
	 * Get all available agents (claude, codex, gemini, custom)
	 */
	getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return getAvailableAgentsFromSettings(this.settings);
	}

	/**
	 * Register commands for each configured agent
	 */
	private registerAgentCommands(): void {
		this.addCommand({
			id: "new-chat-with-agent",
			name: "New chat with agent…",
			callback: () => {
				new AgentPickerModal(
					this.app,
					this.getAvailableAgents(),
					(agentId) => {
						void this.startChat(agentId);
					},
				).open();
			},
		});
	}

	private registerPermissionCommands(): void {
		this.addCommand({
			id: "approve-active-permission",
			name: "Approve active permission",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.app.workspace.trigger(
						"agent-console:approve-active-permission",
						this.getDispatchTargetId(),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "reject-active-permission",
			name: "Reject active permission",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.app.workspace.trigger(
						"agent-console:reject-active-permission",
						this.getDispatchTargetId(),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "toggle-auto-mention",
			name: "Toggle active note in context",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.app.workspace.trigger(
						"agent-console:toggle-auto-mention",
						this.getDispatchTargetId(),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "new-chat",
			name: "New chat",
			callback: () => {
				void this.startChat();
			},
		});

		this.addCommand({
			id: "cancel-current-message",
			name: "Cancel current message",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.app.workspace.trigger(
						"agent-console:cancel-message",
						this.getDispatchTargetId(),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "export-chat",
			name: "Export chat",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.app.workspace.trigger(
						"agent-console:export-chat",
						this.getDispatchTargetId(),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "reload-session",
			name: "Reload session",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.app.workspace.trigger(
						"agent-console:reload-session",
						this.getDispatchTargetId(),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "hard-reload-session",
			name: "Hard reload session (fresh)",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.app.workspace.trigger(
						"agent-console:hard-reload-session",
						this.getDispatchTargetId(),
					);
				}
				return true;
			},
		});
	}

	/**
	 * Register broadcast commands for multi-view operations
	 */
	private registerBroadcastCommands(): void {
		// Broadcast prompt: Copy prompt from active view to all other views
		this.addCommand({
			id: "broadcast-prompt",
			name: "Broadcast prompt",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.broadcastPrompt();
				}
				return true;
			},
		});

		// Broadcast send: Send message in all views that can send
		this.addCommand({
			id: "broadcast-send",
			name: "Broadcast send",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					void this.broadcastSend();
				}
				return true;
			},
		});

		// Broadcast cancel: Cancel operation in all views
		this.addCommand({
			id: "broadcast-cancel",
			name: "Broadcast cancel",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					void this.broadcastCancel();
				}
				return true;
			},
		});
	}

	/**
	 * Copy the focused tab's prompt to all other tabs across all views.
	 */
	private broadcastPrompt(): void {
		const allTabs = this.viewRegistry.getAllTabHandles();
		if (allTabs.length === 0) {
			new Notice("[Agent Console] No chat tabs open");
			return;
		}

		const inputState = this.viewRegistry.toFocused((v) =>
			v.getInputState(),
		);
		if (
			!inputState ||
			(inputState.text.trim() === "" && inputState.files.length === 0)
		) {
			new Notice("[Agent Console] No prompt to broadcast");
			return;
		}

		const sourceTabId = this.viewRegistry.toFocused((v) =>
			v.getActiveTabId(),
		);
		const targetTabs = allTabs.filter((t) => t.tabId !== sourceTabId);
		if (targetTabs.length === 0) {
			new Notice("[Agent Console] No other chat tabs to broadcast to");
			return;
		}

		for (const tab of targetTabs) {
			tab.setInputState(inputState);
		}
		new Notice(
			`[Agent Console] Prompt broadcast to ${targetTabs.length} tab(s)`,
		);
	}

	/**
	 * Send the message in every tab that can send, across all views.
	 */
	private async broadcastSend(): Promise<void> {
		const allTabs = this.viewRegistry.getAllTabHandles();
		if (allTabs.length === 0) {
			new Notice("[Agent Console] No chat tabs open");
			return;
		}

		const sendableTabs = allTabs.filter((t) => t.canSend());
		if (sendableTabs.length === 0) {
			new Notice("[Agent Console] No tabs ready to send");
			return;
		}

		await Promise.allSettled(sendableTabs.map((t) => t.sendMessage()));
		new Notice(`[Agent Console] Sent in ${sendableTabs.length} tab(s)`);
	}

	/**
	 * Cancel the current operation in every tab, across all views.
	 */
	private async broadcastCancel(): Promise<void> {
		const allTabs = this.viewRegistry.getAllTabHandles();
		if (allTabs.length === 0) {
			new Notice("[Agent Console] No chat tabs open");
			return;
		}

		await Promise.allSettled(allTabs.map((t) => t.cancelOperation()));
		new Notice(
			`[Agent Console] Cancel broadcast to ${allTabs.length} tab(s)`,
		);
	}

	async loadSettings() {
		// A genuine fresh install has no data.json yet → loadData() returns
		// null. This is the trigger for one-time first-run onboarding (Phase B
		// + Layer 3); existing users always have a data.json, so they are never
		// re-onboarded and their default agent is never overridden.
		const loaded = (await this.loadData()) as Record<
			string,
			unknown
		> | null;
		this.isFirstRun = loaded == null;
		const raw = loaded ?? {};
		let migratedSecrets = false;

		// The raw → typed mapping (incl. all legacy-field migrations) lives in
		// the pure normalizeRawSettings (settings-normalizer.ts) so the import
		// adapter can reuse the exact same logic. Secret side-effects are
		// injected via the migrateKey callback so the normalizer stays pure.
		this.settings = normalizeRawSettings(
			raw,
			DEFAULT_SETTINGS,
			(
				defaultSecretId,
				fallbackSecretId,
				currentSecretId,
				legacyApiKey,
				agentLabel,
			) =>
				this.migrateLegacyApiKey(
					defaultSecretId,
					fallbackSecretId,
					currentSecretId,
					legacyApiKey,
					agentLabel,
					() => {
						migratedSecrets = true;
					},
				),
		);

		this.ensureDefaultAgentId();

		// One-shot context-note migration notice (Decision #20). Recomputed
		// here (pure, deterministic on raw) because the notice is a load-time
		// side effect that must NOT fire from the import adapter path.
		const ctxMig = migrateContextNoteSettings(raw, DEFAULT_SETTINGS);
		if (ctxMig.shouldShowNotice) {
			new Notice(
				"Agent Console: the active note no longer follows the chat. Use the new context strip to pin notes into context.",
				10000,
			);
			this.settings.migrationNoticeShown = true;
			await this.saveSettings();
		}

		if (migratedSecrets) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		await this.settingsService.updateSettings(nextSettings);
	}

	/** Build the available settings-import sources with this plugin's deps. */
	private createImportSources(): ImportSource[] {
		return createImportSources({
			app: this.app,
			migrateKey: (
				defaultSecretId,
				fallbackSecretId,
				currentSecretId,
				legacyApiKey,
				agentLabel,
			) =>
				this.migrateLegacyApiKey(
					defaultSecretId,
					fallbackSecretId,
					currentSecretId,
					legacyApiKey,
					agentLabel,
					() => {
						/* import persists via updateSettings; no flag needed */
					},
				),
		});
	}

	/** Open the import-settings dialog (used by the command + settings button). */
	openImportSettingsModal(): void {
		new ImportSettingsModal(
			this.app,
			this.createImportSources(),
			async (slice) => {
				await this.settingsService.updateSettings(slice);
			},
		).open();
	}

	/**
	 * First-run, one-shot offer to import settings from another agent plugin.
	 * Fail-soft; shows a sticky, dismissible Notice only when a source is
	 * detected, and sets the one-shot guard so it is never shown twice.
	 */
	private async maybeOfferSettingsImport(): Promise<void> {
		if (this.settings.settingsImportOfferShown) return;
		try {
			const detected = await firstDetectedSource(
				this.createImportSources(),
			);
			if (!detected) return; // nothing to offer; re-check on a later launch
			const notice = new Notice(
				`Agent Console: found ${detected.displayName} settings — click to import them.`,
				0,
			);
			notice.containerEl.addClass("agent-client-import-notice");
			notice.containerEl.addEventListener("click", () => {
				notice.hide();
				this.openImportSettingsModal();
			});
			this.settings.settingsImportOfferShown = true;
			await this.saveSettings();
		} catch (error) {
			getLogger().warn(
				"settings-import offer failed:",
				error,
			);
		}
	}

	/**
	 * Detect which known built-in agents are installed, login-shell aware
	 * (inherits the I01 shim-resolution fix). Memoized for the session so
	 * the shell spawns happen at most once and onboarding + the
	 * getting-started empty state share one probe. Fail-soft: a probe error
	 * yields an empty set rather than rejecting.
	 */
	detectAgents(): Promise<Set<string>> {
		if (!this._detectedAgentsPromise) {
			const candidates: AgentCandidate[] = [
				{
					id: this.settings.kiro.id,
					command: this.settings.kiro.command,
				},
				{
					id: this.settings.claude.id,
					command: this.settings.claude.command,
				},
				{
					id: this.settings.codex.id,
					command: this.settings.codex.command,
				},
				{
					id: this.settings.gemini.id,
					command: this.settings.gemini.command,
				},
			];
			this._detectedAgentsPromise = detectAvailableAgents(
				candidates,
			).catch(() => new Set<string>());
		}
		return this._detectedAgentsPromise;
	}

	/**
	 * First-run onboarding, run once on a true fresh install (no data.json
	 * yet), deferred to onLayoutReady so the login-shell agent probes stay
	 * off the critical load path.
	 *
	 *  - Phase B: detect which known agents are installed and set the default
	 *    to the highest-priority one that resolves
	 *    (kiro → claude → codex → gemini); keep claude-code-acp when none
	 *    resolve.
	 *  - Layer 3: auto-open the chat panel exactly once so a new user lands
	 *    in the UI without hunting for the ribbon icon.
	 *
	 * Fail-soft and self-clearing: persists settings so isFirstRun is false
	 * on every later launch. Existing users have a data.json, so isFirstRun
	 * is false for them — their default agent is never overridden and the
	 * panel is never force-opened.
	 */
	private async maybeFirstRunOnboarding(): Promise<void> {
		if (!this.isFirstRun) return;
		this.isFirstRun = false; // re-entrancy guard within a session

		try {
			const available = await this.detectAgents();
			this.settings.defaultAgentId = chooseFirstRunDefault(
				available,
				this.settings.defaultAgentId,
			);
			await this.saveSettings();

			// Layer 3 — land the new user in the UI exactly once.
			await this.activateView();
		} catch (error) {
			getLogger().warn(
				"first-run onboarding failed:",
				error,
			);
		}
	}

	/**
	 * Migrate legacy plaintext apiKey (v0.10.x) to secretStorage.
	 *
	 * Returns the secretId to use for this agent.
	 *
	 * Behavior:
	 * - If apiKeySecretId is already set, return it as-is. If a legacy
	 *   plaintext apiKey still lingers in data.json (orphaned from prior
	 *   experimental state), trigger onMigrate to schedule a save that
	 *   cleans it up.
	 * - If legacy apiKey is empty, return empty string (no migration needed).
	 * - Otherwise, migrate to secretStorage:
	 *   - Use defaultSecretId (e.g. "claude-api-key") for cross-plugin sharing.
	 *   - On collision (defaultSecretId exists with a different value, e.g.
	 *     from another plugin), fall back to fallbackSecretId
	 *     (e.g. "agent-client-claude-api-key") to preserve the user's key
	 *     and notify them.
	 *
	 * This method is for upgrading from v0.10.x or experimental builds and
	 * can be removed in a future major version once we're confident no
	 * users have legacy plaintext apiKey fields in data.json.
	 */
	private migrateLegacyApiKey(
		defaultSecretId: string,
		fallbackSecretId: string,
		currentSecretId: string,
		legacyApiKey: string,
		agentLabel: string,
		onMigrate: () => void,
	): string {
		const trimmed = legacyApiKey.trim();

		// Already migrated
		if (currentSecretId.length > 0) {
			// Clean up orphaned plaintext apiKey if still in data.json
			if (trimmed.length > 0) {
				onMigrate();
			}
			return currentSecretId;
		}

		if (trimmed.length === 0) {
			return "";
		}

		const existing = this.app.secretStorage.getSecret(defaultSecretId);

		if (existing === null) {
			// No collision — create the secret with the preferred ID
			this.app.secretStorage.setSecret(defaultSecretId, trimmed);
			new Notice(
				`[Agent Console] Your ${agentLabel} API key has been migrated to Obsidian's Keychain as "${defaultSecretId}".`,
			);
			onMigrate();
			return defaultSecretId;
		}

		if (existing === trimmed) {
			// Idempotent re-migration (same value already stored)
			onMigrate();
			return defaultSecretId;
		}

		// Collision: defaultSecretId exists with a different value (likely
		// another plugin). Fall back to a plugin-prefixed ID to preserve
		// the user's key without overwriting other plugins' secrets.
		this.app.secretStorage.setSecret(fallbackSecretId, trimmed);
		new Notice(
			`[Agent Console] "${defaultSecretId}" was already in use. Your ${agentLabel} API key was migrated to "${fallbackSecretId}". You can rename it in Obsidian's Keychain settings.`,
		);
		onMigrate();
		return fallbackSecretId;
	}

	/**
	 * Fetch the latest stable release version from GitHub.
	 */
	private async fetchLatestStable(): Promise<string | null> {
		const data = await fetchJson<{ tag_name?: string }>(
			"https://api.github.com/repos/donivatamazondotcom/obsidian-agent-console/releases/latest",
		);
		return data.tag_name ? semver.clean(data.tag_name) : null;
	}

	/**
	 * Fetch the latest prerelease version from GitHub.
	 */
	private async fetchLatestPrerelease(): Promise<string | null> {
		const releases = await fetchJson<
			Array<{
				tag_name: string;
				prerelease: boolean;
			}>
		>(
			"https://api.github.com/repos/donivatamazondotcom/obsidian-agent-console/releases",
		);

		// Find the first prerelease (releases are sorted by date descending)
		const latestPrerelease = releases.find((r) => r.prerelease);
		return latestPrerelease
			? semver.clean(latestPrerelease.tag_name)
			: null;
	}

	/**
	 * Check for plugin updates.
	 * - Stable version users: compare with latest stable release
	 * - Prerelease users: compare with both latest stable and latest prerelease
	 */
	async checkForUpdates(): Promise<boolean> {
		const currentVersion =
			semver.clean(this.manifest.version) || this.manifest.version;
		const isCurrentPrerelease = semver.prerelease(currentVersion) !== null;

		if (isCurrentPrerelease) {
			// Prerelease user: check both stable and prerelease
			const [latestStable, latestPrerelease] = await Promise.all([
				this.fetchLatestStable(),
				this.fetchLatestPrerelease(),
			]);

			const hasNewerStable =
				latestStable && semver.gt(latestStable, currentVersion);
			const hasNewerPrerelease =
				latestPrerelease && semver.gt(latestPrerelease, currentVersion);

			if (hasNewerStable || hasNewerPrerelease) {
				// Prefer stable version notification if available
				const newestVersion = hasNewerStable
					? latestStable
					: latestPrerelease;
				new Notice(
					`[Agent Console] Update available: v${newestVersion}`,
				);
				return true;
			}
		} else {
			// Stable version user: check stable only
			const latestStable = await this.fetchLatestStable();
			if (latestStable && semver.gt(latestStable, currentVersion)) {
				new Notice(
					`[Agent Console] Update available: v${latestStable}`,
				);
				return true;
			}
		}

		return false;
	}

	ensureDefaultAgentId(): void {
		const availableIds = this.collectAvailableAgentIds();
		if (availableIds.length === 0) {
			this.settings.defaultAgentId = DEFAULT_SETTINGS.claude.id;
			return;
		}
		if (!availableIds.includes(this.settings.defaultAgentId)) {
			this.settings.defaultAgentId = availableIds[0];
		}
	}

	private collectAvailableAgentIds(): string[] {
		const ids = new Set<string>();
		ids.add(this.settings.claude.id);
		ids.add(this.settings.codex.id);
		ids.add(this.settings.gemini.id);
		ids.add(this.settings.kiro.id);
		for (const agent of this.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				ids.add(agent.id);
			}
		}
		return Array.from(ids);
	}
}
