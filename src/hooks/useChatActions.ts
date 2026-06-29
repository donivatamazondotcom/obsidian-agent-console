/**
 * Hook for ChatPanel business callbacks.
 *
 * Encapsulates message sending, new chat, export, agent switching/restart,
 * config changes, and related UI state (restoredMessage, agentUpdateNotification).
 */

import { useState, useCallback, useRef } from "react";
import { Notice, Platform } from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { UseAgentReturn } from "./useAgent";
import type { UseSessionHistoryReturn } from "./useSessionHistory";
import type { UseSuggestionsReturn } from "./useSuggestions";
import type { UseContextNotesReturn } from "./useContextNotes";
import { extractMentionedPaths } from "./useContextVaultEvents";
import { MAX_CONTEXT_NOTES } from "../types/context";
import type { ChatSession } from "../types/session";
import type {
	ChatMessage,
	AttachedFile,
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../types/chat";
import type { AgentClientPluginSettings } from "../plugin";
import type { AgentUpdateNotification } from "../services/update-checker";
import { ChatExporter } from "../services/chat-exporter";
import { getLogger } from "../utils/logger";
import { buildFileUri } from "../utils/paths";
import { convertWindowsPathToWsl } from "../utils/platform";
import { confirmSessionIntent } from "../ui/ConfirmSessionIntentModal";
import { buildCarryOverBlocks } from "../services/carry-over-builder";

// ============================================================================
// Types
// ============================================================================

export interface UseChatActionsReturn {
	// Message actions
	handleSendMessage: (
		content: string,
		attachments?: AttachedFile[],
	) => Promise<void>;
	handleStopGeneration: () => Promise<void>;
	handleNewChat: (requestedAgentId?: string) => Promise<void>;
	handleExportChat: () => Promise<void>;
	handleSwitchAgent: (agentId: string) => Promise<void>;
	/**
	 * Reload the current session (header ↻ button / commands). `hard === false`
	 * = soft reload (resume same session under a fresh harness, transcript
	 * preserved); `hard === true` = hard reload (fresh session, transcript
	 * cleared). See `Agent Console Reload Control` spec.
	 */
	handleReload: (hard: boolean) => Promise<void>;
	/** True while a reload (soft or hard) is in progress — drives the header ↻ spinner. */
	isReloading: boolean;

	// Config actions
	handleSetMode: (modeId: string) => Promise<void>;
	handleSetModel: (modelId: string) => Promise<void>;
	handleSetConfigOption: (configId: string, value: string) => Promise<void>;

	// UI state actions
	handleClearError: () => void;
	handleClearAgentUpdate: () => void;
	handleRestoredMessageConsumed: () => void;

	// State (moved from ChatPanel)
	restoredMessage: string | null;
	agentUpdateNotification: AgentUpdateNotification | null;
	setAgentUpdateNotification: (n: AgentUpdateNotification | null) => void;

	// Auto-export (needed by ChatPanel cleanup)
	autoExportIfEnabled: (
		trigger: "newChat" | "closeChat",
		triggerMessages: ChatMessage[],
		triggerSession: ChatSession,
	) => Promise<void>;

	// Carry-over (needed by ChatPanel agent-switch dispatcher)
	setCarryOverBlocks: (blocks: import("../types/chat").PromptContent[] | null) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useChatActions(
	plugin: AgentClientPlugin,
	agent: UseAgentReturn,
	sessionHistory: UseSessionHistoryReturn,
	suggestions: UseSuggestionsReturn,
	session: ChatSession,
	messages: ChatMessage[],
	settings: AgentClientPluginSettings,
	vaultPath: string,
	contextNotes: UseContextNotesReturn,
	selection: { path: string; fromLine: number; toLine: number } | null,
	activeNotePath: string | null,
	autoDefaultSuppressed: boolean,
	/**
	 * Ref to useLazySession.acquireNow — restart-agent and hard-reload route
	 * their re-acquisition through the single session/new owner (design D3)
	 * instead of calling createSession directly. A ref because useChatActions
	 * is created before useLazySession in ChatPanel; assigned post-mount.
	 */
	lazyAcquireNowRef: { current: (() => Promise<void>) | null },
): UseChatActionsReturn {
	const logger = getLogger();

	// ============================================================
	// State (moved from ChatPanel)
	// ============================================================

	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
	const [agentUpdateNotification, setAgentUpdateNotification] =
		useState<AgentUpdateNotification | null>(null);
	// Drives the header ↻ spinner while a reload runs (soft reload can take a
	// few seconds to respawn the subprocess). See `Agent Console Reload Control`.
	const [isReloading, setIsReloading] = useState(false);
	// Carry-over blocks from an agent switch — injected on the first send to
	// the new agent, then cleared. See [[Agent-Portable Sessions]].
	// Uses a ref (not state) to avoid stale-closure in handleSendMessage after
	// the lazy-session acquire + re-render cycle.
	const carryOverBlocksRef = useRef<import("../types/chat").PromptContent[] | null>(null);
	const setCarryOverBlocks = useCallback((blocks: import("../types/chat").PromptContent[] | null) => {
		carryOverBlocksRef.current = blocks;
	}, []);

	// ============================================================
	// Auto-export
	// ============================================================

	const autoExportIfEnabled = useCallback(
		async (
			trigger: "newChat" | "closeChat",
			triggerMessages: ChatMessage[],
			triggerSession: ChatSession,
		): Promise<void> => {
			const isEnabled =
				trigger === "newChat"
					? plugin.settings.exportSettings.autoExportOnNewChat
					: plugin.settings.exportSettings.autoExportOnCloseChat;
			if (!isEnabled) return;
			if (triggerMessages.length === 0) return;
			if (!triggerSession.sessionId) return;

			try {
				const exporter = new ChatExporter(plugin);
				const openFile =
					plugin.settings.exportSettings.openFileAfterExport;
				const filePath = await exporter.exportToMarkdown(
					triggerMessages,
					triggerSession.agentDisplayName,
					triggerSession.agentId,
					triggerSession.sessionId,
					triggerSession.createdAt,
					openFile,
				);
				if (filePath) {
					const context =
						trigger === "newChat" ? "new session" : "closing chat";
					new Notice(`[Agent Console] Chat exported to ${filePath}`);
					logger.log(`Chat auto-exported before ${context}`);
				}
			} catch {
				new Notice("[Agent Console] Failed to export chat");
			}
		},
		[plugin, logger],
	);

	// ============================================================
	// Message Actions
	// ============================================================

	const shouldConvertToWsl = Platform.isWin && settings.windowsWslMode;

	const handleSendMessage = useCallback(
		async (content: string, attachments?: AttachedFile[]) => {
			// Dismiss overlays on send
			agent.clearError();
			setAgentUpdateNotification(null);

			const isFirstMessage = messages.length === 0;

			// Split attachments by kind
			const images: ImagePromptContent[] = [];
			const resourceLinks: ResourceLinkPromptContent[] = [];

			if (attachments) {
				for (const file of attachments) {
					if (file.kind === "image" && file.data) {
						images.push({
							type: "image",
							data: file.data,
							mimeType: file.mimeType,
						});
					} else if (file.kind === "file" && file.path) {
						let filePath = file.path;
						if (shouldConvertToWsl) {
							filePath = convertWindowsPathToWsl(filePath);
						}
						resourceLinks.push({
							type: "resource_link",
							uri: buildFileUri(filePath),
							name:
								file.name ??
								file.path.split("/").pop() ??
								"file",
							mimeType: file.mimeType || undefined,
							size: file.size,
						});
					}
				}
			}

			try {
				// Effective send-set: contextNotes.add() schedules an async
				// setState, so contextNotes.notes is stale within this
				// callback (I73). Seed from current notes; the auto-default
				// note has no inlined representation, so it is added below to
				// reach the agent on THIS turn.
				const notesToSend = [...contextNotes.notes];

				// --- Carry-over injection (cross-agent portability) ---
				// If carry-over blocks are pending (from an agent switch),
				// consume them on this send regardless of message count.
				let carryOverForThisSend: import("../types/chat").PromptContent[] | undefined;
				if (carryOverBlocksRef.current) {
					carryOverForThisSend = carryOverBlocksRef.current;
					carryOverBlocksRef.current = null; // consume once
				}

				// Auto-crystallize @[[mentions]] at send time (Decision #11,
				// I66) so pills appear immediately — not after the turn ends.
				// State update is async, so this turn's prompt still inlines
				// the mention via @[[...]]; the pill lands for subsequent turns.
				for (const path of extractMentionedPaths(content, (name) =>
					plugin.app.metadataCache.getFirstLinkpathDest(name, "")
						?.path ?? null,
				)) {
					contextNotes.add(path, "mention");
				}

				// Auto-default (I68, Decision #26): on the first message,
				// crystallize the then-active note as default context. Capture
				// happens at send — not tab creation — so navigating before the
				// first send picks the right note. `add` enforces dedup + cap.
				if (
					isFirstMessage &&
					settings.activeNoteAsDefaultContext &&
					!autoDefaultSuppressed &&
					activeNotePath
				) {
					contextNotes.add(activeNotePath, "auto-default");
					// I73: include the just-crystallized auto-default note in
					// THIS turn's payload (contextNotes.notes is stale here).
					if (
						!notesToSend.some((n) => n.path === activeNotePath) &&
						notesToSend.length < MAX_CONTEXT_NOTES
					) {
						notesToSend.push({
							path: activeNotePath,
							source: "auto-default",
							seen: false,
						});
					}
				}

				await agent.sendMessage(content, {
					vaultBasePath: vaultPath,
					contextNotes: notesToSend,
					selection,
					images: images.length > 0 ? images : undefined,
					resourceLinks:
						resourceLinks.length > 0 ? resourceLinks : undefined,
					isFirstMessage,
					carryOverBlocks: carryOverForThisSend,
				});

				// Save session metadata locally on first message
				if (isFirstMessage && session.sessionId) {
					await sessionHistory.saveSessionLocally(
						session.sessionId,
						content,
					);
					logger.log(
						`[ChatPanel] Session saved locally: ${session.sessionId}`,
					);
				}

				// D5 (Settings Pane Reorganization): the first real send trips
				// the one-time setup latch (forward-only; guarded so we write
				// once), relocating "Import settings" from Top matter to
				// Advanced. Routed through settingsService — the single writer
				// of record for data.json.
				if (!plugin.settings.hasCompletedSetup) {
					await plugin.settingsService.updateSettings({
						hasCompletedSetup: true,
					});
				}
			} catch (error) {
				logger.error("[ChatPanel] Send message error:", error);
			}
		},
		[
			agent.clearError,
			agent.sendMessage,
			messages.length,
			session.sessionId,
			sessionHistory.saveSessionLocally,
			logger,
			plugin,
			contextNotes,
			selection,
			settings.activeNoteAsDefaultContext,
			autoDefaultSuppressed,
			activeNotePath,
			shouldConvertToWsl,
			vaultPath,
		],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		const lastMessage = agent.lastUserMessage;
		try {
			await agent.cancelOperation();
		} catch (error) {
			logger.error("[ChatPanel] Cancel operation error:", error);
		}
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agent.cancelOperation, agent.lastUserMessage]);

	const handleNewChat = useCallback(
		async (requestedAgentId?: string) => {
			const isAgentSwitch =
				requestedAgentId && requestedAgentId !== session.agentId;

			// Skip if already empty AND not switching agents
			if (messages.length === 0 && !isAgentSwitch) {
				new Notice("[Agent Console] Already a new session");
				return;
			}

			// --- No silent data loss guard ---
			// Agent switch is handled by handleSwitchAgent (with carry-over);
			// plain new-chat over a non-empty tab requires confirmation.
			if (messages.length > 0 && !isAgentSwitch) {
				const decision = await confirmSessionIntent(
					plugin.app,
					{ kind: "new-chat", canCarryOver: false },
				);
				if (decision === "cancel") return;
			}

			try {
				// Cancel ongoing generation before starting new chat
				if (agent.isSending) {
					await agent.cancelOperation();
				}

				logger.log(
					`Creating new session${isAgentSwitch ? ` with agent: ${requestedAgentId}` : ""}...`,
				);

				// Auto-export current chat before starting new one (if has messages)
				if (messages.length > 0) {
					await autoExportIfEnabled("newChat", messages, session);
				}

				suggestions.mentions.toggleAutoMention(false);
				agent.clearMessages();

				const newAgentId = isAgentSwitch
					? requestedAgentId
					: session.agentId;
				await agent.restartSession(newAgentId);

				// Invalidate session history cache when creating new session
				sessionHistory.invalidateCache();
			} catch (error) {
				logger.error("[ChatPanel] New chat error:", error);
				new Notice("[Agent Console] Failed to create new session");
			}
		},
		[
			messages,
			session,
			logger,
			autoExportIfEnabled,
			agent.isSending,
			agent.cancelOperation,
			agent.clearMessages,
			agent.restartSession,
			suggestions.mentions.toggleAutoMention,
			sessionHistory.invalidateCache,
			plugin.app,
		],
	);

	const handleExportChat = useCallback(async () => {
		if (messages.length === 0) {
			new Notice("[Agent Console] No messages to export");
			return;
		}

		try {
			const exporter = new ChatExporter(plugin);
			const openFile = plugin.settings.exportSettings.openFileAfterExport;
			const filePath = await exporter.exportToMarkdown(
				messages,
				session.agentDisplayName,
				session.agentId,
				session.sessionId || "unknown",
				session.createdAt,
				openFile,
			);
			new Notice(`[Agent Console] Chat exported to ${filePath}`);
		} catch (error) {
			new Notice("[Agent Console] Failed to export chat");
			logger.error("Export error:", error);
		}
	}, [messages, session, plugin, logger]);

	const handleSwitchAgent = useCallback(
		async (agentId: string) => {
			if (agentId === session.agentId) return;

			// --- No silent data loss guard ---
			// If there are messages, confirm before switching + carry over.
			if (messages.length > 0) {
				const agents = agent.getAvailableAgents();
				const agentName =
					agents.find((a) => a.id === agentId)?.displayName || agentId;
				const decision = await confirmSessionIntent(
					plugin.app,
					{ kind: "switch-agent", canCarryOver: true },
					agentName,
				);
				if (decision === "cancel") return;
				// decision === "carry-over": stash messages for injection on next send
				if (decision === "carry-over") {
					const supportsEmbedded = session.promptCapabilities?.embeddedContext ?? false;
					const blocks = buildCarryOverBlocks(messages, supportsEmbedded);
					setCarryOverBlocks(blocks);
				}
			}

			await handleNewChat(agentId);
		},
		[session.agentId, session.promptCapabilities, handleNewChat, messages, plugin.app, agent.getAvailableAgents],
	);

	const handleReload = useCallback(
		async (hard: boolean) => {
			// Spinner on for the whole reload so the user sees the click
			// registered even when the resume takes a few seconds.
			setIsReloading(true);
			try {
				// Cancel any in-flight generation first (mirrors handleNewChat).
				if (agent.isSending) {
					await agent.cancelOperation();
				}

				if (hard) {
					// --- No silent data loss guard ---
					// Hard reload clears the transcript; confirm first.
					if (messages.length > 0) {
						const agentName = session.agentDisplayName || session.agentId;
						const decision = await confirmSessionIntent(
							plugin.app,
							{ kind: "reload", canCarryOver: false },
							agentName,
						);
						if (decision === "cancel") {
							return;
						}
					}

					// Hard reload (⌘⇧R analog): fresh session under a fresh
					// harness. Auto-export, tear down, re-acquire via the single
					// owner (acquireNow), clear transcript.
					if (messages.length > 0) {
						await autoExportIfEnabled("newChat", messages, session);
					}
					agent.clearMessages();
					await agent.closeSession();
					await lazyAcquireNowRef.current?.();
					sessionHistory.invalidateCache();
					new Notice("[Agent Console] Session restarted (fresh)");
					return;
				}

				// Soft reload (⌘R analog): resume the same session under a
				// fresh harness. Transcript is never cleared. Announce up front
				// because the resume is async (subprocess respawn) and otherwise
				// gives no feedback until it completes.
				new Notice("[Agent Console] Reloading session…");
				const { resumed } = await agent.reloadSession();
				if (resumed) {
					new Notice("[Agent Console] Session reloaded");
				} else {
					sessionHistory.invalidateCache();
					new Notice(
						"[Agent Console] This agent can't resume — reloaded as a fresh session (history shown is local)",
					);
				}
			} catch (error) {
				logger.error("[ChatPanel] Reload error:", error);
				new Notice("[Agent Console] Failed to reload session");
			} finally {
				setIsReloading(false);
			}
		},
		[
			agent.isSending,
			agent.cancelOperation,
			agent.clearMessages,
			agent.closeSession,
			lazyAcquireNowRef,
			agent.reloadSession,
			messages,
			session,
			autoExportIfEnabled,
			sessionHistory.invalidateCache,
			logger,
			plugin.app,
		],
	);

	// ============================================================
	// Config Actions
	// ============================================================

	const handleSetMode = useCallback(
		async (modeId: string) => {
			await agent.setMode(modeId);
		},
		[agent.setMode],
	);

	const handleSetModel = useCallback(
		async (modelId: string) => {
			await agent.setModel(modelId);
		},
		[agent.setModel],
	);

	const handleSetConfigOption = useCallback(
		async (configId: string, value: string) => {
			await agent.setConfigOption(configId, value);
		},
		[agent.setConfigOption],
	);

	// ============================================================
	// UI State Actions
	// ============================================================

	const handleClearError = useCallback(() => {
		agent.clearError();
	}, [agent.clearError]);

	const handleClearAgentUpdate = useCallback(() => {
		setAgentUpdateNotification(null);
	}, []);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// ============================================================
	// Return
	// ============================================================

	return {
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
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
		setCarryOverBlocks,
	};
}
