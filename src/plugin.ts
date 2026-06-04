import { addIcon, Plugin, WorkspaceLeaf, Notice, requestUrl } from "obsidian";
import * as semver from "semver";
import { AGENT_CONSOLE_SVG } from "./ui/branding";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/ChatView";
import { ChatViewRegistry } from "./services/view-registry";
import {
	createSettingsService,
	type SettingsService,
} from "./services/settings-service";
import { SessionStorage } from "./services/session-storage";
import { AgentClientSettingTab } from "./ui/SettingsTab";
import { AcpClient } from "./acp/acp-client";
import {
	sanitizeArgs,
	normalizeEnvVars,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
	parseChatFontSize,
	str,
	bool,
	num,
	enumVal,
	obj,
	strRecord,
} from "./services/settings-normalizer";
import { getAvailableAgentsFromSettings } from "./services/session-helpers";
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
	autoMentionActiveNote: boolean;
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
		maxNoteLength: number;
		maxSelectionLength: number;
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
	/** Maximum number of session tabs per view (default: 10) */
	maxSessionTabs: number;
	/** Restore open tabs on startup (default: true). See [[ACP Tab Persistence Across Restarts]] § Setting. */
	restoreTabsOnStartup: boolean;

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
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKeySecretId: "",
		command: "claude-agent-acp",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKeySecretId: "",
		command: "codex-acp",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKeySecretId: "",
		command: "gemini",
		args: ["--experimental-acp"],
		env: [],
	},
	kiro: {
		id: "kiro-cli",
		displayName: "Kiro CLI",
		command: "kiro-cli",
		args: ["acp"],
		env: [],
	},
	customAgents: [],
	defaultAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	enableSystemNotifications: true,
	debugMode: false,
	nodePath: "",
	exportSettings: {
		defaultFolder: "Agent Console",
		filenameTemplate: "agent_console_{date}_{time}",
		autoExportOnNewChat: false,
		autoExportOnCloseChat: false,
		openFileAfterExport: true,
		includeImages: true,
		imageLocation: "obsidian",
		imageCustomFolder: "Agent Console",
		frontmatterTag: "agent-client",
	},
	windowsWslMode: false,
	windowsWslDistribution: undefined,
	sendMessageShortcut: "enter",
	chatViewLocation: "right",
	displaySettings: {
		maxNoteLength: 10000,
		maxSelectionLength: 10000,
		showEmojis: true,
		fontSize: null,
	},
	savedSessions: [],
	lastUsedModels: {},
	lastUsedModes: {},
	maxSessionTabs: 10,
	restoreTabsOnStartup: true,
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsService!: SettingsService;

	/** Registry for all chat view containers */
	viewRegistry = new ChatViewRegistry();

	/** Map of viewId to AcpClient for multi-session support */
	private _acpClients: Map<string, AcpClient> = new Map();

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
			name: "Open chat view",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "focus-next-chat-view",
			name: "Focus next chat view",
			callback: () => {
				this.focusChatView("next");
			},
		});

		this.addCommand({
			id: "focus-previous-chat-view",
			name: "Focus previous chat view",
			callback: () => {
				this.focusChatView("previous");
			},
		});

		this.addCommand({
			id: "open-new-chat-view",
			name: "Open new chat view",
			callback: () => {
				void this.openNewChatViewWithAgent(
					this.settings.defaultAgentId,
				);
			},
		});

		// Tab commands
		this.addCommand({
			id: "new-session-tab",
			name: "New session tab",
			callback: () => {
				this.getActiveChatView()?.addTab();
			},
		});

		this.addCommand({
			id: "close-session-tab",
			name: "Close session tab",
			callback: () => {
				this.getActiveChatView()?.closeActiveTab();
			},
		});

		this.addCommand({
			id: "next-session-tab",
			name: "Next session tab",
			callback: () => {
				this.getActiveChatView()?.nextTab();
			},
		});

		this.addCommand({
			id: "previous-session-tab",
			name: "Previous session tab",
			callback: () => {
				this.getActiveChatView()?.prevTab();
			},
		});

		// Register agent-specific commands
		this.registerAgentCommands();
		this.registerPermissionCommands();
		this.registerBroadcastCommands();

		this.addSettingTab(new AgentClientSettingTab(this.app, this));

		// Clean up all ACP sessions when Obsidian quits
		// Note: We don't wait for disconnect to complete to avoid blocking quit
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				// Fire and forget - don't block Obsidian from quitting
				for (const [viewId, client] of this._acpClients) {
					client.disconnect().catch((error) => {
						getLogger().warn(
							`[AgentClient] Quit cleanup error for view ${viewId}:`,
							error,
						);
					});
				}
				this._acpClients.clear();
			}),
		);
	}

	onunload() {
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
					`[AgentClient] Failed to disconnect client for view ${viewId}:`,
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
			getLogger().warn("[AgentClient] Failed to create new leaf");
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
		const agents = this.getAvailableAgents();

		for (const agent of agents) {
			this.addCommand({
				id: `switch-agent-to-${agent.id}`,
				name: `Switch agent to ${agent.displayName}`,
				callback: () => {
					this.app.workspace.trigger(
						"agent-client:new-chat-requested",
						this.getDispatchTargetId(),
						agent.id,
					);
				},
			});
		}
	}

	private registerPermissionCommands(): void {
		this.addCommand({
			id: "approve-active-permission",
			name: "Approve active permission",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:approve-active-permission",
					this.getDispatchTargetId(),
				);
			},
		});

		this.addCommand({
			id: "reject-active-permission",
			name: "Reject active permission",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:reject-active-permission",
					this.getDispatchTargetId(),
				);
			},
		});

		this.addCommand({
			id: "toggle-auto-mention",
			name: "Toggle auto-mention",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:toggle-auto-mention",
					this.getDispatchTargetId(),
				);
			},
		});

		this.addCommand({
			id: "new-chat",
			name: "New chat",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:new-chat-requested",
					this.getDispatchTargetId(),
				);
			},
		});

		this.addCommand({
			id: "cancel-current-message",
			name: "Cancel current message",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:cancel-message",
					this.getDispatchTargetId(),
				);
			},
		});

		this.addCommand({
			id: "export-chat",
			name: "Export chat",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:export-chat",
					this.getDispatchTargetId(),
				);
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
			callback: () => {
				this.broadcastPrompt();
			},
		});

		// Broadcast send: Send message in all views that can send
		this.addCommand({
			id: "broadcast-send",
			name: "Broadcast send",
			callback: () => {
				void this.broadcastSend();
			},
		});

		// Broadcast cancel: Cancel operation in all views
		this.addCommand({
			id: "broadcast-cancel",
			name: "Broadcast cancel",
			callback: () => {
				void this.broadcastCancel();
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
			new Notice(
				"[Agent Console] No other chat tabs to broadcast to",
			);
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
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const D = DEFAULT_SETTINGS;
		let migratedSecrets = false;

		// Extract agent sub-objects
		const rc = obj(raw.claude) ?? {};
		const rk = obj(raw.codex) ?? {};
		const rg = obj(raw.gemini) ?? {};
		const rki = obj(raw.kiro) ?? {};
		const re = obj(raw.exportSettings) ?? {};
		const rd = obj(raw.displaySettings) ?? {};

		// Normalize custom agents
		const customAgents = Array.isArray(raw.customAgents)
			? ensureUniqueCustomAgentIds(
					raw.customAgents.map((a: unknown) =>
						normalizeCustomAgent(obj(a) ?? {}),
					),
				)
			: [];

		// Migration: defaultAgentId ← activeAgentId (old name)
		const availableAgentIds = [
			D.claude.id,
			D.codex.id,
			D.gemini.id,
			D.kiro.id,
			...customAgents.map((a) => a.id),
		];
		const rawDefaultId =
			str(raw.defaultAgentId, "") || str(raw.activeAgentId, "");
		const defaultAgentId =
			rawDefaultId && availableAgentIds.includes(rawDefaultId)
				? rawDefaultId
				: availableAgentIds[0] || D.claude.id;

		this.settings = {
			claude: {
				id: D.claude.id, // Fixed — never from raw
				displayName: str(rc.displayName, D.claude.displayName),
				apiKeySecretId: this.migrateLegacyApiKey(
					"claude-api-key",
					"agent-client-claude-api-key",
					str(rc.apiKeySecretId, D.claude.apiKeySecretId),
					str(rc.apiKey, ""),
					"Claude",
					() => {
						migratedSecrets = true;
					},
				),
				// Migration: claude.command ← claudeCodeAcpCommandPath (old name)
				command:
					str(rc.command, "") ||
					str(raw.claudeCodeAcpCommandPath, "") ||
					D.claude.command,
				args: sanitizeArgs(rc.args),
				env: normalizeEnvVars(rc.env),
			},
			codex: {
				id: D.codex.id,
				displayName: str(rk.displayName, D.codex.displayName),
				apiKeySecretId: this.migrateLegacyApiKey(
					"openai-api-key",
					"agent-client-openai-api-key",
					str(rk.apiKeySecretId, D.codex.apiKeySecretId),
					str(rk.apiKey, ""),
					"Codex",
					() => {
						migratedSecrets = true;
					},
				),
				command: str(rk.command, "") || D.codex.command,
				args: sanitizeArgs(rk.args),
				env: normalizeEnvVars(rk.env),
			},
			gemini: {
				id: D.gemini.id,
				displayName: str(rg.displayName, D.gemini.displayName),
				apiKeySecretId: this.migrateLegacyApiKey(
					"gemini-api-key",
					"agent-client-gemini-api-key",
					str(rg.apiKeySecretId, D.gemini.apiKeySecretId),
					str(rg.apiKey, ""),
					"Gemini",
					() => {
						migratedSecrets = true;
					},
				),
				// Migration: gemini.command ← geminiCommandPath (old name)
				command:
					str(rg.command, "") ||
					str(raw.geminiCommandPath, "") ||
					D.gemini.command,
				args:
					sanitizeArgs(rg.args).length > 0
						? sanitizeArgs(rg.args)
						: D.gemini.args,
				env: normalizeEnvVars(rg.env),
			},
			kiro: {
				id: D.kiro.id,
				displayName: str(rki.displayName, D.kiro.displayName),
				command: str(rki.command, "") || D.kiro.command,
				args:
					sanitizeArgs(rki.args).length > 0
						? sanitizeArgs(rki.args)
						: D.kiro.args,
				env: normalizeEnvVars(rki.env),
			},
			customAgents,
			defaultAgentId,
			autoAllowPermissions: bool(
				raw.autoAllowPermissions,
				D.autoAllowPermissions,
			),
			autoMentionActiveNote: bool(
				raw.autoMentionActiveNote,
				D.autoMentionActiveNote,
			),
			enableSystemNotifications: bool(
				raw.enableSystemNotifications,
				D.enableSystemNotifications,
			),
			debugMode: bool(raw.debugMode, D.debugMode),
			nodePath: str(raw.nodePath, D.nodePath),
			exportSettings: {
				defaultFolder: str(
					re.defaultFolder,
					D.exportSettings.defaultFolder,
				),
				filenameTemplate: str(
					re.filenameTemplate,
					D.exportSettings.filenameTemplate,
				),
				autoExportOnNewChat: bool(
					re.autoExportOnNewChat,
					D.exportSettings.autoExportOnNewChat,
				),
				autoExportOnCloseChat: bool(
					re.autoExportOnCloseChat,
					D.exportSettings.autoExportOnCloseChat,
				),
				openFileAfterExport: bool(
					re.openFileAfterExport,
					D.exportSettings.openFileAfterExport,
				),
				includeImages: bool(
					re.includeImages,
					D.exportSettings.includeImages,
				),
				imageLocation: enumVal(
					re.imageLocation,
					["obsidian", "custom", "base64"],
					D.exportSettings.imageLocation,
				),
				imageCustomFolder: str(
					re.imageCustomFolder,
					D.exportSettings.imageCustomFolder,
				),
				frontmatterTag: str(
					re.frontmatterTag,
					D.exportSettings.frontmatterTag,
				),
			},
			windowsWslMode: bool(raw.windowsWslMode, D.windowsWslMode),
			windowsWslDistribution: str(
				raw.windowsWslDistribution,
				D.windowsWslDistribution as string,
			),
			sendMessageShortcut: enumVal(
				raw.sendMessageShortcut,
				["enter", "cmd-enter"],
				D.sendMessageShortcut,
			),
			chatViewLocation: enumVal(
				raw.chatViewLocation,
				["right", "left"],
				D.chatViewLocation,
			),
			displaySettings: {
				maxNoteLength: num(
					rd.maxNoteLength,
					D.displaySettings.maxNoteLength,
					1,
				),
				maxSelectionLength: num(
					rd.maxSelectionLength,
					D.displaySettings.maxSelectionLength,
					1,
				),
				showEmojis: bool(rd.showEmojis, D.displaySettings.showEmojis),
				fontSize: parseChatFontSize(rd.fontSize),
			},
			savedSessions: Array.isArray(raw.savedSessions)
				? (raw.savedSessions as SavedSessionInfo[])
				: D.savedSessions,
			lastUsedModels: strRecord(raw.lastUsedModels),
			lastUsedModes: strRecord(raw.lastUsedModes),
			maxSessionTabs: num(raw.maxSessionTabs, D.maxSessionTabs, 1),
			restoreTabsOnStartup:
				typeof raw.restoreTabsOnStartup === "boolean"
					? raw.restoreTabsOnStartup
					: D.restoreTabsOnStartup,
			// Type-level coercion only — record-level validation
			// happens inside SessionStorage.loadTabState (so the
			// service can return null on corruption rather than
			// silently dropping malformed records here).
			perLeafTabStates: Array.isArray(raw.perLeafTabStates)
				? (raw.perLeafTabStates as PerLeafTabState[])
				: undefined,
			legacySessionsMigrated: bool(raw.legacySessionsMigrated, false),
		};

		this.ensureDefaultAgentId();

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
		const response = await requestUrl({
			url: "https://api.github.com/repos/donivatamazondotcom/obsidian-agent-console/releases/latest",
		});
		const data = response.json as { tag_name?: string };
		return data.tag_name ? semver.clean(data.tag_name) : null;
	}

	/**
	 * Fetch the latest prerelease version from GitHub.
	 */
	private async fetchLatestPrerelease(): Promise<string | null> {
		const response = await requestUrl({
			url: "https://api.github.com/repos/donivatamazondotcom/obsidian-agent-console/releases",
		});
		const releases = response.json as Array<{
			tag_name: string;
			prerelease: boolean;
		}>;

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
