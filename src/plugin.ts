import { migrateContextNoteSettings } from "./services/settings-migration";
import {
	addIcon,
	Menu,
	MenuItem,
	Plugin,
	TFile,
	WorkspaceLeaf,
	Notice,
} from "obsidian";
import * as semver from "semver";
import { AGENT_CONSOLE_SVG } from "./ui/branding";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/ChatView";
import {
	migrateLegacyChatViewType,
	LEGACY_CHAT_VIEW_TYPE,
} from "./services/migrate-legacy-view-type";
import { registerChatViewSafely } from "./services/register-chat-view";
import { runRegistrations } from "./services/run-registrations";
import { focusActiveTabComposer } from "./ui/composer-focus";
import { HOVER_LINK_SOURCE } from "./utils/link-leaf";
import type { ObsidianSystemPromptSettings } from "./utils/obsidian-system-prompt";
import { fetchJson } from "./services/net";
import { ChatViewRegistry } from "./services/view-registry";
import {
	selectBroadcastPromptTargets,
	selectBroadcastSendTargets,
} from "./services/message-queue-logic";
import {
	createSettingsService,
	type SettingsService,
} from "./services/settings-service";
import { SessionStorage } from "./services/session-storage";
import {
	type ClosedLeafRecord,
	RECENTLY_CLOSED_CAP,
	popClosedTab,
	pushClosedTab,
} from "./services/recently-closed-stack";
import { AgentClientSettingTab } from "./ui/SettingsTab";
import { AcpClient } from "./acp/acp-client";
import {
	DEFAULT_SETTINGS,
	normalizeRawSettings,
} from "./services/settings-normalizer";
import { getAvailableAgentsFromSettings } from "./services/session-helpers";
import {
	detectAvailableAgents,
	createDetectionCache,
	resolveFirstRunDefaultAgent,
	type AgentCandidate,
	type DetectionCache,
} from "./services/agent-detection";
import {
	AgentEnvVar,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	CustomAgentSettings,
	KiroAgentSettings,
} from "./types/agent";
import type {
	SavedSessionInfo,
	AgentSessionMetaCacheEntry,
} from "./types/session";
import type { SessionListSource } from "./resolvers/session-history-view";
import type { PerLeafTabState } from "./types/tab";
import type { TitleStrategy } from "./types/title-strategy";
import { initializeLogger, getLogger } from "./utils/logger";
import {
	closeOpenMenus,
	registerOpenMenu,
	showMenuAtEvent,
} from "./utils/menu-registry";
import { ImportSettingsModal } from "./ui/ImportSettingsModal";
import { AgentPickerModal } from "./ui/AgentPickerModal";
import {
	QuickPromptLibrary,
	VaultQuickPromptSource,
	VaultQuickPromptWriter,
	createQuickPrompt,
	renamePromptLabel,
} from "./services/quick-prompts";
import {
	buildChipMenuItems,
	runCreateWithFolderGate,
	type QuickPromptMenuAction,
} from "./services/quick-prompts-logic";
import type { QuickPrompt } from "./types/quick-prompt";
import { RenamePromptModal } from "./ui/RenamePromptModal";
import { ChooseQuickPromptFolderModal } from "./ui/ChooseQuickPromptFolderModal";
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
	/** Directory new chats launch in; blank = vault root. See Configurable Working Directory spec. */
	defaultWorkingDirectory: string;
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
	/**
	 * How a new session's tab label is generated (F03 — AI Session Rename).
	 * Default `agent-suggested`. See [[ACP AI Session Rename]] § Settings.
	 */
	titleStrategy: TitleStrategy;
	/** Obsidian host-context briefing injected on first message (block selection + raw-edit escape). */
	obsidianSystemPrompt: ObsidianSystemPromptSettings;
	// Display settings
	displaySettings: {
		showEmojis: boolean;
		fontSize: number | null;
	};
	// Locally saved session metadata (for agents without session/list support)
	savedSessions: SavedSessionInfo[];
	/**
	 * Persisted Session History source toggle. Defaults to "local" — the
	 * canonical local store is the source of truth for "your history"
	 * (Session History Source Model Decision 3). The last choice is remembered
	 * across opens (Decision 2; global scope).
	 */
	sessionHistorySource: SessionListSource;
	/**
	 * Per-agent cache of server-session metadata (agentId → entry), mirrored
	 * on connect via one `session/list`. Powers the disconnected Agent view
	 * with a "synced N ago — connect to refresh" affordance (Decision 1).
	 */
	agentSessionMetaCache: Record<string, AgentSessionMetaCacheEntry>;
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
	 * Vault folder scanned for Quick Prompts (one markdown note per prompt).
	 * Default `Quick Prompts`. See [[Agent Console Quick Prompts and Workflows]].
	 */
	quickPromptsFolder: string;

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

	/**
	 * One-time forward latch: set true the first time the user sends a
	 * message in any agent or imports settings once. Once true it stays
	 * true. Decides where "Import settings" renders in the settings pane —
	 * Top matter while un-configured, Advanced once set up (D5, see
	 * [[Agent Console Settings Pane Reorganization]]).
	 */
	hasCompletedSetup: boolean;
}

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsService!: SettingsService;

	/** Registry for all chat view containers */
	viewRegistry = new ChatViewRegistry();

	/**
	 * Quick Prompts library — scans the configured folder and watches it for
	 * changes. Assigned in onload (before any ChatView mounts via registerView).
	 * See [[Agent Console Quick Prompts and Workflows]].
	 */
	quickPromptLibrary!: QuickPromptLibrary;

	/**
	 * In-memory LIFO stack of recently-closed ChatView leaf snapshots, for
	 * reopen-restore ([[ACP Restore Tabs on View Reopen]]). Lives on the plugin
	 * so it survives a leaf's unmount (the whole point — restore the tab set
	 * AFTER the panel closes). Session-scoped: never persisted, cleared on
	 * restart, so it can't contend with the leaf.id-keyed restart-restore path
	 * (which is empty-stack on a fresh launch).
	 */
	private recentlyClosedLeaves: ClosedLeafRecord[] = [];

	/**
	 * One-shot intent flag, set immediately before opening a deliberately-fresh
	 * view ("Open new view" menu item / command, or "New chat" with no panel
	 * open) and consumed once by that leaf's mount. A plain open (ribbon /
	 * "Open chat") leaves it false, so by default opening the panel RESTORES the
	 * last-closed tab set when "Restore tabs on startup" is on — resume by
	 * default, fresh only when explicitly asked. Restart goes through the
	 * leaf.id path, not this flag. See [[ACP Restore Tabs on View Reopen]].
	 */
	private forceFreshView = false;

	/** Map of viewId to AcpClient for multi-session support */
	private _acpClients: Map<string, AcpClient> = new Map();

	/**
	 * True only on a genuine fresh install (no data.json yet). Gates the
	 * one-time first-run onboarding (Phase B default-selection + Layer 3
	 * auto-open). Self-clears once onboarding saves settings.
	 */
	private isFirstRun = false;

	/**
	 * Session-cached agent-detection result, **invalidatable**. Detection costs
	 * a login-shell spawn per agent, so it runs at most once per session and is
	 * shared by first-run onboarding and the getting-started empty state. Lazy:
	 * never started in onload. `clear()` (via {@link clearAgentDetectionCache})
	 * forces a re-probe when the user fixes a built-in's command (I-FRO5) or an
	 * in-plugin install succeeds, so the panel clears without a reload.
	 */
	private _agentDetectionCache: DetectionCache = createDetectionCache(() =>
		this.probeInstalledAgents(),
	);

	/**
	 * Create a quick-prompt note (clobber-safe) and open it for editing. Used by
	 * the "Quick prompts: New prompt" command, the ! create-on-no-match row, and
	 * "save composer as a prompt". `body` omitted → a placeholder body (the
	 * author writes the prompt in the opened note); provided → captured text.
	 * On a name collision the filename is disambiguated — an existing note is
	 * never overwritten (No-silent-data-loss).
	 */
	async createQuickPromptNote(opts: {
		label: string;
		body?: string;
	}): Promise<void> {
		const writer = this.makeQuickPromptWriter();
		const doCreate = async (): Promise<void> => {
			try {
				const { path, basename, collided } = await createQuickPrompt(
					writer,
					opts,
				);
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf(true).openFile(file);
				}
				new Notice(
					collided
						? `[Agent Console] A quick prompt with that name already existed — saved as "${basename}".`
						: `[Agent Console] Created quick prompt "${basename}".`,
				);
			} catch (error) {
				getLogger().error("[QuickPrompts] create failed", error);
				new Notice(
					"[Agent Console] Could not create the quick prompt — see the console.",
				);
			}
		};
		// Slice 6: on the very first creation (no prompts yet AND the folder is
		// still the default), ask once where prompts should live, persist the
		// choice, then never ask again. Cancel aborts the whole creation
		// (No-silent-data-loss). The gate self-latches, so power users who set a
		// folder never see it and it never reappears after the first note.
		await runCreateWithFolderGate({
			promptCount: this.quickPromptLibrary.getPrompts().length,
			folder: this.settings.quickPromptsFolder,
			defaultFolder: DEFAULT_SETTINGS.quickPromptsFolder,
			chooseFolder: () =>
				new Promise<string | null>((resolve) => {
					new ChooseQuickPromptFolderModal(
						this.app,
						this.settings.quickPromptsFolder,
						resolve,
					).open();
				}),
			persistFolder: async (folder) => {
				await this.settingsService.updateSettings({
					quickPromptsFolder: folder,
				});
				await this.quickPromptLibrary.rescan();
			},
			create: doCreate,
		});
	}

	/**
	 * Build the quick-prompt note writer (clobber-safe creation + label
	 * rename). Shared by `createQuickPromptNote` and the chip Rename.
	 */
	private makeQuickPromptWriter(): VaultQuickPromptWriter {
		return new VaultQuickPromptWriter(
			this,
			() => this.settings.quickPromptsFolder,
			() =>
				this.quickPromptLibrary
					.getPrompts()
					.map(
						(p) =>
							p.path.split("/").pop()?.replace(/\.md$/i, "") ?? "",
					),
		);
	}

	/**
	 * Right-click (or the context-menu key) on a quick-prompt chip → a menu
	 * to manage the prompt behind it: Edit (open the note in a new tab),
	 * Copy (prompt text → clipboard), Rename (relabel the pill). Built where
	 * `app` is available; the chip just forwards the event. `showMenuAtEvent`
	 * anchors correctly for both mouse and keyboard activation.
	 */
	showQuickPromptChipMenu(
		prompt: QuickPrompt,
		evt: {
			detail: number;
			clientX: number;
			clientY: number;
			currentTarget: Element;
			nativeEvent: MouseEvent;
		},
	): void {
		const menu = new Menu();
		registerOpenMenu(menu);
		for (const entry of buildChipMenuItems()) {
			menu.addItem((item: MenuItem) => {
				item.setTitle(entry.title)
					.setIcon(entry.icon)
					.onClick(() => {
						void this.runQuickPromptChipAction(
							entry.action,
							prompt,
						);
					});
			});
		}
		showMenuAtEvent(menu, evt);
	}

	private async runQuickPromptChipAction(
		action: QuickPromptMenuAction,
		prompt: QuickPrompt,
	): Promise<void> {
		if (action === "edit") {
			const file = this.app.vault.getAbstractFileByPath(prompt.path);
			if (file instanceof TFile) {
				// New foreground tab (getLeaf(true)) — don't clobber the
				// current pane (tab-only per D-3a).
				await this.app.workspace.getLeaf(true).openFile(file);
			} else {
				new Notice(
					`[Agent Console] Could not open "${prompt.label}" — the note was not found.`,
				);
			}
			return;
		}
		if (action === "copy") {
			try {
				await navigator.clipboard.writeText(prompt.body);
				new Notice("[Agent Console] Copied prompt text.");
			} catch (error) {
				getLogger().error("[QuickPrompts] copy failed", error);
				new Notice(
					"[Agent Console] Could not copy the prompt text — see the console.",
				);
			}
			return;
		}
		// action === "rename" — relabel the PILL (`label:` frontmatter); the
		// filename is Obsidian's concern, so the prompt id stays stable.
		const writer = this.makeQuickPromptWriter();
		new RenamePromptModal(this.app, prompt.label, async (raw) => {
			try {
				await renamePromptLabel(writer, prompt, raw);
				// The library reconciles on the metadataCache change, so the
				// chip relabels live — no manual refresh.
			} catch (error) {
				getLogger().error("[QuickPrompts] rename failed", error);
				new Notice(
					"[Agent Console] Could not rename the quick prompt — see the console.",
				);
			}
		}).open();
	}

	async onload() {
		await this.loadSettings();

		initializeLogger(this.settings);

		// Initialize settings store
		this.settingsService = createSettingsService(this.settings, this);

		// Quick Prompts library — scan + watch the configured folder. Created
		// before registerView so any ChatPanel that mounts can read it. The
		// initial scan is async (reads note bodies); prompts populate shortly
		// after and the watch keeps them live.
		this.quickPromptLibrary = new QuickPromptLibrary(
			new VaultQuickPromptSource(
				this,
				() => this.settings.quickPromptsFolder,
			),
		);
		void this.quickPromptLibrary.init();

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
		registerChatViewSafely(
			this,
			(leaf) => new ChatView(leaf, this),
			(message) => new Notice(message),
			(message, error) => getLogger().error(message, error),
		);

		// I157: migrate leaves persisted under the legacy `agent-client-chat-view`
		// type (the string shared with the upstream Agent Client plugin — the
		// registerView collision that broke load when both were enabled).
		// Deferred to onLayoutReady so the restored leaves exist; re-homing them
		// preserves leaf.id, so tab state (keyed on leaf.id, I47) re-associates
		// on remount. Registered before the first-run onboarding onLayoutReady
		// below so it runs first.
		this.app.workspace.onLayoutReady(() => {
			// Only migrate ORPHANED legacy leaves. If the upstream Agent Client
			// is enabled it still registers agent-client-chat-view, so those
			// leaves are ITS live panels — re-homing them would hijack the
			// incumbent (the exact case an existing Agent Client user installing
			// Agent Console would hit). Skip the migration entirely then.
			const legacyTypeRegistered = !!(
				this.app as unknown as {
					viewRegistry?: { viewByType?: Record<string, unknown> };
				}
			).viewRegistry?.viewByType?.[LEGACY_CHAT_VIEW_TYPE];
			const migrated = migrateLegacyChatViewType(this.app.workspace, {
				legacyTypeRegistered,
			});
			if (migrated > 0) {
				getLogger().info(
					`I157: migrated ${migrated} legacy chat view leaf(s) to ${VIEW_TYPE_CHAT}`,
				);
			}
		});

		// I157 (onload resilience): route registrations through a guarded harness
		// so one failing registration (e.g. a colliding view type or command id)
		// degrades to a notice + one missing feature instead of aborting onload.
		runRegistrations(
			[
				{
					label: "note hover preview",
					run: () =>
						this.registerHoverLinkSource(HOVER_LINK_SOURCE, {
							display: "Agent Console",
							defaultMod: true,
						}),
				},
				{
					label: "ribbon button",
					run: () => {
						addIcon("agent-console", AGENT_CONSOLE_SVG);
						const ribbonIconEl = this.addRibbonIcon(
							"agent-console",
							"Agent Console",
							(_evt: MouseEvent) => {
								void this.activateView();
							},
						);
						ribbonIconEl.addClass("agent-console-ribbon-icon");
					},
				},
				{
					label: "commands",
					run: () => {
						this.registerCoreCommands();
						this.registerAgentCommands();
						this.registerPermissionCommands();
						this.registerBroadcastCommands();
					},
				},
				{
					label: "settings tab",
					run: () =>
						this.addSettingTab(
							new AgentClientSettingTab(this.app, this),
						),
				},
			],
			{
				notify: (message) => new Notice(message),
				logError: (message, error) => getLogger().error(message, error),
			},
		);

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

		// Stop watching the Quick Prompts folder.
		this.quickPromptLibrary?.destroy();

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
				// "New chat" with no panel open is an explicit fresh start.
				this.forceFreshView = true;
				await this.activateView();
			}
			return;
		}
		// add-tab: open a new tab on the chosen agent in the existing panel.
		const view = leaf?.view;
		if (view instanceof ChatView) {
			view.addTab(action.agentId);
			await this.app.workspace.revealLeaf(leaf as WorkspaceLeaf);
			this.focusLeafComposer(leaf as WorkspaceLeaf);
		}
	}

	/**
	 * Capture a closed leaf's tab-set snapshot onto the recently-closed stack
	 * for reopen-restore. A null record (leaf not worth restoring — a lone
	 * fresh tab with no session and no draft) is ignored, so callers can pass
	 * buildClosedLeafRecord(...) directly. See [[ACP Restore Tabs on View Reopen]].
	 */
	captureClosedLeaf(record: ClosedLeafRecord | null): void {
		if (!record) return;
		this.recentlyClosedLeaves = pushClosedTab(
			this.recentlyClosedLeaves,
			record,
			RECENTLY_CLOSED_CAP,
		);
	}

	/**
	 * Pop the most-recently-closed leaf snapshot (LIFO) for a freshly-opened
	 * ChatView leaf to adopt. Returns null when the stack is empty (fresh open
	 * → single idle tab). Prunes the popped snapshot's now-orphaned data.json
	 * entry — its old leafId will never match a future leaf, so leaving it
	 * would grow data.json across reopens.
	 */
	adoptClosedLeaf(): ClosedLeafRecord | null {
		const { record, stack } = popClosedTab(this.recentlyClosedLeaves);
		this.recentlyClosedLeaves = stack;
		if (record) {
			void this.settingsService.removeTabStateForLeaf(record.leafId);
		}
		return record;
	}

	/**
	 * Consume the one-shot force-fresh-view intent (read + clear). Returns true
	 * only on the fresh-leaf mount immediately following an explicit "new view"
	 * action ("Open new view" or "New chat" with no panel); a plain ribbon /
	 * "Open chat" open reads false, so it restores the last-closed tab set.
	 */
	consumeForceFreshView(): boolean {
		const fresh = this.forceFreshView;
		this.forceFreshView = false;
		return fresh;
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
			this.focusLeafComposer(leaf);
		}
	}

	/**
	 * Focus the textarea in a ChatView leaf.
	 */
	/**
	 * Make a chat leaf active (moving keyboard focus to it) and drop the caret
	 * into its ACTIVE tab's composer. Used by Open chat / view activation and by
	 * startChat. revealLeaf alone makes a sidebar leaf visible but does NOT move
	 * keyboard focus (I136 H2), so setActiveLeaf({ focus: true }) is required;
	 * the composer focus is deferred one frame so it lands after Obsidian
	 * finishes activating the leaf (H3). focusActiveTabComposer targets the
	 * active tab's composer, never a hidden background tab's (I136 H1).
	 */
	private focusLeafComposer(leaf: WorkspaceLeaf): void {
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		const viewContainerEl = leaf.view?.containerEl;
		if (viewContainerEl) {
			window.requestAnimationFrame(() => {
				focusActiveTabComposer(viewContainerEl);
			});
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
		// Explicit "new view" — do NOT adopt the last-closed tab set.
		this.forceFreshView = true;
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
	private registerCoreCommands(): void {
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
			id: "show-tab-list",
			name: "Show tab list",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.getActiveChatView()?.showTabList();
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
			id: "open-session-history",
			name: "Open session history",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.getActiveChatView()?.openSessionHistory();
				}
				return true;
			},
		});

		this.addCommand({
			id: "open-new-view",
			name: "Open new view",
			callback: () => {
				void this.openNewChatViewWithAgent(
					this.settings.defaultAgentId,
				);
			},
		});

		this.addCommand({
			id: "import-settings",
			name: "Import settings from another agent plugin",
			callback: () => {
				this.openImportSettingsModal();
			},
		});

		this.addCommand({
			id: "quick-prompt-search",
			name: "Quick prompts: Search",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					const prompts = this.quickPromptLibrary.getPrompts();
					if (prompts.length === 0) {
						new Notice(
							`[Agent Console] No quick prompts found. Add markdown notes to your "${this.settings.quickPromptsFolder}" folder.`,
						);
						return true;
					}
					this.viewRegistry.toFocused((view) =>
						view.startQuickPromptSearch(),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "quick-prompt-new",
			name: "Quick prompts: New prompt",
			callback: () => {
				void this.createQuickPromptNote({ label: "New prompt" });
			},
		});

		this.addCommand({
			id: "quick-prompt-save-composer",
			name: "Quick prompts: Save composer as a prompt",
			checkCallback: (checking: boolean) => {
				if (!this.hasOpenChatView()) return false;
				if (!checking) {
					this.viewRegistry.toFocused((view) =>
						view.saveComposerAsQuickPrompt(),
					);
				}
				return true;
			},
		});
	}

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
			name: "Restart session (fresh)",
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
		const { targets: targetTabs, skippedQueued } =
			selectBroadcastPromptTargets(allTabs, sourceTabId ?? "");
		if (targetTabs.length === 0 && skippedQueued.length === 0) {
			new Notice("[Agent Console] No other chat tabs to broadcast to");
			return;
		}

		for (const tab of targetTabs) {
			tab.setInputState(inputState);
		}
		// #82: report tabs skipped because they hold a committed queued message
		// (overwriting their composer would be data loss — narrowly overrides
		// F11 decision #4 for queued, not loose-draft, messages).
		const promptSkipNote =
			skippedQueued.length > 0
				? ` (${skippedQueued.length} skipped — pending queued message)`
				: "";
		new Notice(
			`[Agent Console] Prompt broadcast to ${targetTabs.length} tab(s)${promptSkipNote}`,
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

		const { targets: sendableTabs, skippedQueued } =
			selectBroadcastSendTargets(allTabs);
		if (sendableTabs.length === 0 && skippedQueued.length === 0) {
			new Notice("[Agent Console] No tabs ready to send");
			return;
		}

		await Promise.allSettled(sendableTabs.map((t) => t.sendMessage()));
		// #82: a tab already holding a queued message is skipped (queue-of-one —
		// can't add a second), reported in the summary.
		const sendSkipNote =
			skippedQueued.length > 0
				? ` (${skippedQueued.length} skipped — pending queued message)`
				: "";
		new Notice(
			`[Agent Console] Sent in ${sendableTabs.length} tab(s)${sendSkipNote}`,
		);
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
				// D5: importing settings trips the one-time setup latch, so
				// "Import settings" relocates from Top matter to Advanced.
				await this.settingsService.updateSettings({
					...slice,
					hasCompletedSetup: true,
				});
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
		return this._agentDetectionCache.get();
	}

	/**
	 * Invalidate the session detection cache so the next `detectAgents()`
	 * re-probes. Called when a built-in's command changes in settings (I-FRO5)
	 * or an in-plugin install succeeds, so the getting-started panel clears and
	 * the composer re-enables without a reload. Without this, a once-empty probe
	 * stays empty for the whole session and re-detection silently no-ops.
	 */
	clearAgentDetectionCache(): void {
		this._agentDetectionCache.clear();
	}

	/**
	 * Probe which built-in agents are installed.
	 *
	 * Dev/test affordance: a vault-local marker file (`.force-no-agents` in the
	 * plugin dir) forces an empty result, so the no-agent first-run experience
	 * is smoke-testable on a machine that DOES have agents installed — without
	 * uninstalling anything or hand-editing commands. The marker is inert in
	 * normal installs (the file never exists) and vault-scoped, so it never
	 * affects another vault. Smoke tooling creates it via `--no-agents`.
	 */
	private async probeInstalledAgents(): Promise<Set<string>> {
		const marker = `${this.manifest.dir}/.force-no-agents`;
		try {
			if (await this.app.vault.adapter.exists(marker)) {
				return new Set<string>();
			}
		} catch {
			/* ignore — fall through to real detection */
		}
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
		return detectAvailableAgents(candidates);
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
			this.settings.defaultAgentId = await resolveFirstRunDefaultAgent(
				() => this.detectAgents(),
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
