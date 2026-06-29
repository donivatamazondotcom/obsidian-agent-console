/**
 * Sub-hook for managing chat messages, streaming, and permissions.
 *
 * Handles message state, RAF batching for streaming updates,
 * send/receive operations, and permission approve/reject.
 */

import * as React from "react";
const { useState, useCallback, useMemo, useRef, useEffect } = React;

import type {
	ChatMessage,
	MessageContent,
	ActivePermission,
	ImagePromptContent,
	ResourceLinkPromptContent,
	PromptContent,
} from "../types/chat";
import type { ChatSession, SessionUpdate } from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { IVaultAccess, NoteMetadata } from "../services/vault-service";
import type { ContextNote } from "../types/context";
import type { ISettingsAccess } from "../services/settings-service";
import type { ErrorInfo } from "../types/errors";
import type { IMentionService } from "../utils/mention-parser";
import {
	preparePrompt,
	sendPreparedPrompt,
	DEFAULT_MAX_SELECTION_LENGTH,
} from "../services/message-sender";
import { extractErrorMessage } from "../utils/error-utils";
import { Platform } from "obsidian";
import {
	rebuildToolCallIndex,
	applySingleUpdate,
	findActivePermission,
	selectOption,
} from "../services/message-state";
import { TitleHeadBuffer } from "../utils/titleMarker";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
	/** Currently active note for auto-mention (legacy path) */
	activeNote?: NoteMetadata | null;
	/** Vault base path for mention resolution */
	vaultBasePath: string;
	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;
	/** Attached images (Base64 embedded) */
	images?: ImagePromptContent[];
	/** Attached file references (resource links) */
	resourceLinks?: ResourceLinkPromptContent[];
	/** Whether this is the first message in the session */
	isFirstMessage?: boolean;
	/** Session working directory (cwd) for the host-context briefing. */
	workingDirectory?: string;
	/** Crystallized context notes for this chat (activates the context-note path) */
	contextNotes?: ContextNote[];
	/** Raw selection from the last active markdown editor (0-based lines) */
	selection?: { path: string; fromLine: number; toLine: number } | null;
	/** Carry-over blocks from a prior agent's conversation (cross-agent portability). */
	carryOverBlocks?: PromptContent[];
}

export interface UseAgentMessagesReturn {
	// Message state
	messages: ChatMessage[];
	isSending: boolean;
	lastUserMessage: string | null;

	/**
	 * AI-suggested session title parsed from the head of the agent's first
	 * reply (F03). Null until/unless a `<title>…</title>` marker resolves.
	 * Consumed by ChatPanel to swap the tab label. See [[ACP AI Session Rename]].
	 */
	suggestedTitle: string | null;
	// Message operations
	sendMessage: (
		content: string,
		options: SendMessageOptions,
	) => Promise<void>;
	clearMessages: () => void;
	setInitialMessages: (
		history: Array<{
			role: string;
			content: Array<{ type: string; text: string }>;
			timestamp?: string;
		}>,
	) => void;
	setMessagesFromLocal: (localMessages: ChatMessage[]) => void;
	clearError: () => void;
	setIgnoreUpdates: (ignore: boolean) => void;
	/** Discard any pending RAF updates and reset streaming state (call after stop/cancel). */
	clearPendingUpdates: () => void;
	/**
	 * Discard the in-flight turn's outcome on a user-initiated interrupt
	 * (reload / stop / new chat). Bumps the generation so the pending send's
	 * late result/error is a no-op — prevents an aborted prompt's error (e.g.
	 * Kiro's -32603 "Internal error") from surfacing as the error overlay
	 * (I106). Resets streaming state; leaves the transcript intact.
	 */
	discardPendingTurn: () => void;

	// Permission
	activePermission: ActivePermission | null;
	hasActivePermission: boolean;
	approvePermission: (requestId: string, optionId: string) => Promise<void>;
	approveActivePermission: () => Promise<boolean>;
	rejectActivePermission: () => Promise<boolean>;

	/** Enqueue a message-level update (used by useAgent for unified handler) */
	enqueueUpdate: (update: SessionUpdate) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAgentMessages(
	agentClient: AcpClient,
	settingsAccess: ISettingsAccess,
	vaultAccess: IVaultAccess & IMentionService,
	session: ChatSession,
	setErrorInfo: (error: ErrorInfo | null) => void,
): UseAgentMessagesReturn {
	// ============================================================
	// Message State
	// ============================================================

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);

	// F03 — AI Session Rename. Head buffer for the first reply's leading text;
	// armed in sendMessage when isFirstMessage && titleStrategy === 'agent-suggested'.
	// suggestedTitle surfaces the parsed title to ChatPanel (S4 applies it).
	const titleBufferRef = useRef<TitleHeadBuffer | null>(null);
	const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);

	// Tool call index: toolCallId → message index for O(1) lookup
	const toolCallIndexRef = useRef<Map<string, number>>(new Map());

	// Ignore updates flag (used during session/load to skip history replay)
	const ignoreUpdatesRef = useRef(false);

	// Generation counter to prevent stale async callbacks from overwriting
	// state after cancel/stop followed by a new send. Each sendMessage()
	// increments this; completion handlers only update state if the
	// generation hasn't changed (fixes Issue #200).
	const generationRef = useRef(0);

	// Track the current send promise so a new sendMessage() can wait for
	// the previous one to settle before starting (avoids interleaved sends).
	const sendPromiseRef = useRef<Promise<void> | null>(null);

	// ============================================================
	// Streaming Update Batching
	// ============================================================

	const pendingUpdatesRef = useRef<SessionUpdate[]>([]);
	const flushScheduledRef = useRef(false);

	const flushPendingUpdates = useCallback(() => {
		flushScheduledRef.current = false;
		const updates = pendingUpdatesRef.current;
		if (updates.length === 0) return;
		pendingUpdatesRef.current = [];

		setMessages((prev) => {
			let result = prev;
			for (const update of updates) {
				result = applySingleUpdate(
					result,
					update,
					toolCallIndexRef.current,
				);
			}
			return result;
		});
	}, []);

	const enqueueUpdate = useCallback(
		(update: SessionUpdate) => {
			if (ignoreUpdatesRef.current) return;

			// F03: intercept the LEADING agent-message text while the title
			// head buffer is armed. Hold (emit null) while the head could still
			// be a `<title>…</title>` marker; on resolve, surface the title and
			// emit the stripped remainder; on divergence/cap, release verbatim.
			// Other update types (thoughts, tool calls) pass straight through —
			// the buffer watches only the first agent_message_chunk text (F1/F5).
			let u = update;
			const buf = titleBufferRef.current;
			if (u.type === "agent_message_chunk" && buf?.isActive) {
				const r = buf.push(u.text);
				if (r.title) setSuggestedTitle(r.title);
				if (r.done) titleBufferRef.current = null;
				if (r.emit === null) return; // hold — nothing to render yet
				u = { ...u, text: r.emit };
			}

			pendingUpdatesRef.current.push(u);
			if (!flushScheduledRef.current) {
				flushScheduledRef.current = true;
				window.requestAnimationFrame(flushPendingUpdates);
			}
		},
		[flushPendingUpdates],
	);

	/**
	 * Release any text still held by the title head buffer at turn end (F03).
	 * Covers a never-closed marker that stayed under the cap and got no more
	 * chunks: the held head text would otherwise never render. The buffer is
	 * deactivated first so the released chunk passes straight through
	 * enqueueUpdate's interception.
	 */
	const flushTitleBuffer = useCallback(
		(sessionId: string) => {
			const buf = titleBufferRef.current;
			if (!buf || !buf.isActive) {
				titleBufferRef.current = null;
				return;
			}
			titleBufferRef.current = null; // deactivate before re-enqueue
			const held = buf.flush();
			if (held) {
				enqueueUpdate({
					type: "agent_message_chunk",
					sessionId,
					text: held,
				});
			}
		},
		[enqueueUpdate],
	);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			pendingUpdatesRef.current = [];
			flushScheduledRef.current = false;
			toolCallIndexRef.current.clear();
		};
	}, []);

	// ============================================================
	// Message Operations
	// ============================================================

	const addMessage = useCallback((message: ChatMessage): void => {
		setMessages((prev) => [...prev, message]);
	}, []);

	const setIgnoreUpdates = useCallback((ignore: boolean): void => {
		ignoreUpdatesRef.current = ignore;
	}, []);

	/** Discard any pending RAF updates and reset the streaming flag. */
	const clearPendingUpdates = useCallback((): void => {
		pendingUpdatesRef.current = [];
		flushScheduledRef.current = false;
		setIsSending(false);
		// F03: a cancelled turn discards its pending updates — drop the title
		// head buffer too (held head text belongs to the cancelled turn).
		titleBufferRef.current = null;
	}, []);

	/**
	 * Discard the in-flight turn's outcome on a user-initiated interrupt
	 * (reload / stop / new chat). Bumping the generation makes the pending
	 * send's late result/error a no-op (the result/error handlers early-return
	 * on a generation mismatch), so an aborted prompt's -32603 "Internal error"
	 * never reaches the error overlay (I106). Also resets streaming state; the
	 * on-screen transcript is left intact.
	 *
	 * Clears `sendPromiseRef` too (I107): if the cancelled turn's `sendPromise`
	 * never settles — the in-flight `session/prompt` RPC is left unresolved when
	 * the subprocess is disconnected by the interrupt (observed with Claude
	 * CLI) — a subsequent send would block forever on the prior-send guard
	 * (`await sendPromiseRef.current`) and never reach `addMessage`, silently
	 * dropping the message. The generation bump above already neutralizes the
	 * orphaned promise's late result, so dropping the ref is safe.
	 */
	const discardPendingTurn = useCallback((): void => {
		generationRef.current++;
		pendingUpdatesRef.current = [];
		flushScheduledRef.current = false;
		setIsSending(false);
		titleBufferRef.current = null;
		// I107: drop the (possibly never-settling) prior-send promise so the
		// next send doesn't await a dead turn.
		sendPromiseRef.current = null;
	}, []);

	const clearMessages = useCallback((): void => {
		setMessages([]);
		toolCallIndexRef.current.clear();
		setLastUserMessage(null);
		setIsSending(false);
		setErrorInfo(null);
		// F03: drop any in-flight title head buffer and clear the suggestion
		// so a new chat starts without a stale title.
		titleBufferRef.current = null;
		setSuggestedTitle(null);
	}, [setErrorInfo]);

	const setInitialMessages = useCallback(
		(
			history: Array<{
				role: string;
				content: Array<{ type: string; text: string }>;
				timestamp?: string;
			}>,
		): void => {
			const chatMessages: ChatMessage[] = history.map((msg) => ({
				id: crypto.randomUUID(),
				role: msg.role as "user" | "assistant",
				content: msg.content.map((c) => ({
					type: c.type as "text",
					text: c.text,
				})),
				timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
			}));

			setMessages(chatMessages);
			rebuildToolCallIndex(chatMessages, toolCallIndexRef.current);
			setIsSending(false);
			setErrorInfo(null);
		},
		[setErrorInfo],
	);

	const setMessagesFromLocal = useCallback(
		(localMessages: ChatMessage[]): void => {
			setMessages(localMessages);
			rebuildToolCallIndex(localMessages, toolCallIndexRef.current);
			setIsSending(false);
			setErrorInfo(null);
		},
		[setErrorInfo],
	);

	const clearError = useCallback((): void => {
		setErrorInfo(null);
	}, [setErrorInfo]);

	const shouldConvertToWsl = useMemo(() => {
		const settings = settingsAccess.getSnapshot();
		return Platform.isWin && settings.windowsWslMode;
	}, [settingsAccess]);

	const sendMessage = useCallback(
		async (content: string, options: SendMessageOptions): Promise<void> => {
			if (!session.sessionId) {
				setErrorInfo({
					title: "Cannot Send Message",
					message: "No active session. Please wait for connection.",
				});
				return;
			}

			// Wait for any in-flight send to settle (e.g. after cancel/stop)
			// before starting a new one to avoid interleaved state updates.
			if (sendPromiseRef.current) {
				try { await sendPromiseRef.current; } catch { /* ignore */ }
			}

			const currentSessionId = session.sessionId;
			const generation = ++generationRef.current;

			// F03: arm the title head buffer for the first message under the
			// agent-suggested strategy; otherwise ensure it's disarmed so a
			// later message never strips text. Reset the suggestion per turn.
			const titleStrategy = settingsAccess.getSnapshot().titleStrategy;
			if (
				options.isFirstMessage &&
				titleStrategy === "agent-suggested"
			) {
				titleBufferRef.current = new TitleHeadBuffer();
				setSuggestedTitle(null);
			} else {
				titleBufferRef.current = null;
			}

			// Resolve selection text (Channel 2) from raw selection lines.
			let selectionContext:
				| { path: string; fromLine: number; toLine: number; text: string }
				| null = null;
			if (options.selection) {
				try {
					const noteContent = await vaultAccess.readNote(
						options.selection.path,
					);
					const text = noteContent
						.split("\n")
						.slice(
							options.selection.fromLine,
							options.selection.toLine + 1,
						)
						.join("\n")
						.slice(0, DEFAULT_MAX_SELECTION_LENGTH);
					selectionContext = {
						path: options.selection.path,
						fromLine: options.selection.fromLine + 1,
						toLine: options.selection.toLine + 1,
						text,
					};
				} catch {
					selectionContext = null;
				}
			}

			const prepared = await preparePrompt(
				{
					message: content,
					images: options.images,
					resourceLinks: options.resourceLinks,
					activeNote: options.activeNote,
					vaultBasePath: options.vaultBasePath,
					isAutoMentionDisabled: options.isAutoMentionDisabled,
					convertToWsl: shouldConvertToWsl,
					supportsEmbeddedContext:
						session.promptCapabilities?.embeddedContext ?? false,
					isFirstMessage: options.isFirstMessage,
					titleStrategy: settingsAccess.getSnapshot().titleStrategy,
					hostContextBriefing:
						settingsAccess.getSnapshot().hostContextBriefing,
					workingDirectory: options.workingDirectory,
					contextNotes: options.contextNotes,
					selectionContext,
				},
				vaultAccess,
				vaultAccess, // IMentionService (same object)
			);

			// Cross-agent carry-over: prepend earlier conversation as context
			// blocks on the first send to the new agent ([[Agent-Portable Sessions]]).
			if (options.carryOverBlocks && options.carryOverBlocks.length > 0) {
				prepared.agentContent = [
					...options.carryOverBlocks,
					...prepared.agentContent,
				];
			}

			const userMessageContent: MessageContent[] = [];

			if (prepared.autoMentionContext) {
				userMessageContent.push({
					type: "text_with_context",
					text: content,
					autoMentionContext: prepared.autoMentionContext,
				});
			} else {
				userMessageContent.push({
					type: "text",
					text: content,
				});
			}

			if (options.images && options.images.length > 0) {
				for (const img of options.images) {
					userMessageContent.push({
						type: "image",
						data: img.data,
						mimeType: img.mimeType,
					});
				}
			}

			if (options.resourceLinks && options.resourceLinks.length > 0) {
				for (const link of options.resourceLinks) {
					userMessageContent.push({
						type: "resource_link",
						uri: link.uri,
						name: link.name,
						mimeType: link.mimeType,
						size: link.size,
					});
				}
			}

			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: userMessageContent,
				timestamp: new Date(),
			};
			addMessage(userMessage);

			setIsSending(true);
			setLastUserMessage(content);

			const sendPromise = (async () => {
				try {
					const result = await sendPreparedPrompt(
						{
							sessionId: currentSessionId,
							agentContent: prepared.agentContent,
							displayContent: prepared.displayContent,
							authMethods: session.authMethods,
						},
						agentClient,
					);

					// Discard results if a newer send has started
					if (generationRef.current !== generation) return;

					// F03: turn ended — release any text still held by the
					// title head buffer (e.g. a never-closed marker under cap).
					flushTitleBuffer(currentSessionId);

					if (result.success) {
						setIsSending(false);
						setLastUserMessage(null);
					} else {
						setIsSending(false);
						setErrorInfo(
							result.error
								? {
										title: result.error.title,
										message: result.error.message,
										suggestion: result.error.suggestion,
									}
								: {
										title: "Send Message Failed",
										message: "Failed to send message",
									},
						);
					}
				} catch (error) {
					if (generationRef.current !== generation) return;
					flushTitleBuffer(currentSessionId);
					setIsSending(false);
					setErrorInfo({
						title: "Send Message Failed",
						message: `Failed to send message: ${extractErrorMessage(error)}`,
					});
				}
			})();

			sendPromiseRef.current = sendPromise;
			try {
				await sendPromise;
			} catch {
				// Error already handled inside sendPromise
			} finally {
				sendPromiseRef.current = null;
			}
		},
		[
			agentClient,
			vaultAccess,
			settingsAccess,
			session.sessionId,
			session.authMethods,
			session.promptCapabilities,
			shouldConvertToWsl,
			addMessage,
			setErrorInfo,
			flushTitleBuffer,
		],
	);

	// ============================================================
	// Permission State & Operations
	// ============================================================

	const activePermission = useMemo(
		() => findActivePermission(messages),
		[messages],
	);

	const hasActivePermission = activePermission !== null;

	const approvePermission = useCallback(
		async (requestId: string, optionId: string): Promise<void> => {
			try {
				await agentClient.respondToPermission(requestId, optionId);
			} catch (error) {
				setErrorInfo({
					title: "Permission Error",
					message: `Failed to respond to permission request: ${extractErrorMessage(error)}`,
				});
			}
		},
		[agentClient, setErrorInfo],
	);

	const approveActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0)
			return false;
		const option = selectOption(activePermission.options, [
			"allow_once",
			"allow_always",
		]);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	const rejectActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0)
			return false;
		const option = selectOption(
			activePermission.options,
			["reject_once", "reject_always"],
			(opt) =>
				opt.name.toLowerCase().includes("reject") ||
				opt.name.toLowerCase().includes("deny"),
		);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	// ============================================================
	// Return
	// ============================================================

	return {
		messages,
		isSending,
		lastUserMessage,
		suggestedTitle,
		sendMessage,
		clearMessages,
		setInitialMessages,
		setMessagesFromLocal,
		clearError,
		setIgnoreUpdates,
		clearPendingUpdates,
		discardPendingTurn,
		activePermission,
		hasActivePermission,
		approvePermission,
		approveActivePermission,
		rejectActivePermission,
		enqueueUpdate,
	};
}
