import type { PermissionScopeChoice } from "../types/chat";
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
	TurnEndKind,
} from "../types/chat";
import type {
	ChatSession,
	SessionUpdate,
	TurnEnd,
} from "../types/session";
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
	createStreamContinuity,
	findActivePermission,
	selectOption,
	cancelActivePermissions,
	applyTurnEnd,
} from "../services/message-state";
import { TitleHeadBuffer } from "../utils/titleMarker";
import {
	createDomFlushSchedulerDeps,
	createUpdateFlushScheduler,
	type UpdateFlushScheduler,
} from "../utils/update-flush-scheduler";
import { t, getReplyLanguage } from "../i18n";

/**
 * I203: how long a stop/steer waits for the cancelled prompt's answer before
 * the next turn may start anyway. Agents normally answer within milliseconds;
 * the bound only matters for agents that never answer (I107).
 */
export const CANCEL_SETTLE_TIMEOUT_MS = 2000;

/**
 * Chat Timestamps: live conversation updates that count as the agent doing
 * something (spec Open question 4). Usage, session-info, command, mode and
 * config updates don't, and neither does `user_message_chunk`, which only
 * arrives as a dropped live echo or as replay.
 */
function countsAsActivity(update: SessionUpdate): boolean {
	switch (update.type) {
		case "agent_message_chunk":
		case "agent_thought_chunk":
		case "tool_call":
		case "tool_call_update":
		case "plan":
			return true;
		default:
			return false;
	}
}

/** A batched update with the turn's last-update time from when it arrived. */
interface QueuedUpdate {
	update: SessionUpdate;
	lastUpdateBefore: number | null;
	/**
	 * When the text actually arrived, for a chunk the title head buffer held
	 * and released later. Unset: it arrived in this flush.
	 */
	arrivedAt?: number;
}
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
	/** First message of the chat: title rubric and title head buffer (I265). */
	isFirstMessage?: boolean;
	/**
	 * First message of this agent session: send the system instruction. True
	 * on a new chat and on a fallback's fresh session (I265). Defaults to
	 * `isFirstMessage` when unset.
	 */
	sendsSystemInstruction?: boolean;
	/** Session working directory (cwd) for the host-context briefing. */
	workingDirectory?: string;
	/** True vault root for the host-context vault-collaboration gate. */
	vaultRootPath?: string;
	/** Crystallized context notes for this chat (activates the context-note path) */
	contextNotes?: ContextNote[];
	/** Raw selection from the last active markdown editor (0-based lines) */
	selection?: { path: string; fromLine: number; toLine: number } | null;
	/** Carry-over blocks from a prior agent's conversation (cross-agent portability). */
	carryOverBlocks?: PromptContent[];
	/**
	 * Called with the vault paths whose note body reached the agent, only
	 * after the send succeeds ([[ACP Context Note Hydration]] H6). A failed,
	 * aborted, or superseded send never calls it, so the next send re-hydrates.
	 */
	onContextDelivered?: (paths: string[]) => void;
}

export interface UseAgentMessagesReturn {
	// Message state
	messages: ChatMessage[];
	isSending: boolean;
	/**
	 * How the most recent turn ended, with a counter so two identical
	 * outcomes in a row are still distinct events. `failed` = the send
	 * errored. Null until the first turn ends ([[Tab Attention States]]).
	 */
	lastTurnEnd: TurnEnd | null;
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
	/**
	 * I259: a send was started on this tab (even one still preparing or one
	 * that failed). Cleared by clearMessages and resetSendAttempt.
	 */
	hasAttemptedSend: () => boolean;
	/** I259: forget the send attempt (an idle release discarded the id). */
	resetSendAttempt: () => void;
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
	 *
	 * Also closes the I203 settle gate: until the cancelled prompt answers
	 * (or `settleTimeoutMs` elapses), that session's late text/thought/plan
	 * chunks are dropped and the next `sendMessage` waits.
	 */
	discardPendingTurn: (settleTimeoutMs?: number) => void;

	// Permission
	activePermission: ActivePermission | null;
	hasActivePermission: boolean;
	approvePermission: (
		requestId: string,
		optionId: string,
		choice?: PermissionScopeChoice,
	) => Promise<void>;
	approveActivePermission: () => Promise<boolean>;
	rejectActivePermission: () => Promise<boolean>;

	/** Enqueue a message-level update (used by useAgent for unified handler) */
	enqueueUpdate: (update: SessionUpdate) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export type { TurnEnd } from "../types/session";

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
	const [lastTurnEnd, setLastTurnEnd] = useState<TurnEnd | null>(null);
	const recordTurnEnd = useCallback(
		(outcome: TurnEnd["outcome"], errorInfo?: ErrorInfo) =>
			setLastTurnEnd((prev) => ({
				seq: (prev?.seq ?? 0) + 1,
				outcome,
				...(errorInfo ? { errorInfo } : {}),
			})),
		[],
	);
	const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);

	// F03 — AI Session Rename. Head buffer for the first reply's leading text;
	// armed in sendMessage when isFirstMessage && titleStrategy === 'agent-suggested'.
	// suggestedTitle surfaces the parsed title to ChatPanel (S4 applies it).
	const titleBufferRef = useRef<TitleHeadBuffer | null>(null);
	const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);

	// Tool call index: toolCallId → message index for O(1) lookup
	const toolCallIndexRef = useRef<Map<string, number>>(new Map());

	// Stream continuity for block-boundary detection (I185): mirrors the
	// toolCallIndex lifetime — reset wherever the index is cleared/rebuilt.
	const streamContinuityRef = useRef(createStreamContinuity());

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
	// I259: set on the first line of sendMessage, before any await.
	const sendAttemptedRef = useRef(false);
	// I295: bumped only by clearMessages (New chat, hard reload, agent
	// switch). A send that sees it change before its message is added was
	// meant for a chat that no longer exists, so it is dropped. Separate from
	// generationRef, which newer sends and cancels also bump: a superseded or
	// cancelled send still adds its message and goes out.
	const resetEpochRef = useRef(0);
	const hasAttemptedSend = useCallback(() => sendAttemptedRef.current, []);
	const resetSendAttempt = useCallback(() => {
		sendAttemptedRef.current = false;
	}, []);

	// I203 settle gate. ACP lets an agent keep streaming a cancelled turn's
	// `session/update`s until it answers that turn's `session/prompt` with
	// `stopReason: cancelled`. Chunks carry only a sessionId (no turn id), so
	// the prompt's answer is the only reliable "old turn finished" signal.
	// While the gate is set: text/thought/plan chunks for its session are
	// dropped (they belong to the stopped reply and would otherwise append to
	// the newest assistant message), and sendMessage waits on `settled`.
	// Tool-call updates still apply — they target their block by toolCallId,
	// and the spec says clients SHOULD accept them after cancel.
	const cancelledTurnRef = useRef<{
		sessionId: string | null;
		settled: Promise<void>;
	} | null>(null);

	// I257: set while a prompt this hook sent is in flight. Some agents
	// (Antigravity CLI) echo the live prompt back as `user_message_chunk`
	// before replying; the bubble already shows the user's words, so those
	// echoes are dropped on arrival. History replay (`session/load`) finishes
	// before the load is answered, so before any send, and is never gated.
	// Cleared by the owning send (generation-checked) and by the reset owners
	// (discardPendingTurn, clearMessages) so a never-settling prompt can't
	// leave it armed.
	// Chat Timestamps: `livePromptId` is the prompt whose turn is running.
	// The turn-end write reads and clears it synchronously, so a second end
	// owner (a Stop just after the success write) is a no-op.
	const liveTurnRef = useRef<{
		sessionId: string;
		generation: number;
		livePromptId: string | null;
	} | null>(null);

	// Chat Timestamps: when the turn's last live update arrived (epoch ms).
	// Starts at the prompt's send, so a first reply is measured from it.
	const lastUpdateAtRef = useRef<number | null>(null);
	// The first chunk the title head buffer held: when it arrived and the
	// last-update value before it. The chunk the buffer later releases is
	// stamped and measured from these. Null: none held.
	const heldChunkRef = useRef<{
		arrivedAt: number;
		lastUpdateBefore: number | null;
	} | null>(null);
	// Permission wait: start of the open stretch, and the turn's total so far.
	const waitStartedAtRef = useRef<number | null>(null);
	const turnWaitMsRef = useRef(0);
	// Whether a permission was active at the last render (edge detection).
	const hadPermissionRef = useRef(false);
	// True while the active permission is one restored from disk. It can't
	// be answered (the restarted PermissionManager doesn't know it), so it
	// never counts as waiting (I360). Cleared when it falls.
	const restoredPromptActiveRef = useRef(false);

	// ============================================================
	// Streaming Update Batching
	// ============================================================

	const pendingUpdatesRef = useRef<QueuedUpdate[]>([]);
	const flushSchedulerRef = useRef<UpdateFlushScheduler | null>(null);

	const flushPendingUpdates = useCallback(() => {
		const updates = pendingUpdatesRef.current;
		if (updates.length === 0) return;
		pendingUpdatesRef.current = [];
		// Chat Timestamps: one clock read per flush, passed into the updater
		// (which React may call twice), never read inside it.
		const now = Date.now();

		setMessages((prev) => {
			let result = prev;
			for (const queued of updates) {
				result = applySingleUpdate(
					result,
					queued.update,
					toolCallIndexRef.current,
					streamContinuityRef.current,
					{
						now: queued.arrivedAt ?? now,
						lastUpdateBefore: queued.lastUpdateBefore,
					},
				);
			}
			return result;
		});
	}, []);

	const enqueueUpdate = useCallback(
		(update: SessionUpdate) => {
			if (ignoreUpdatesRef.current) return;
			// I203: drop the cancelled turn's trailing content chunks.
			const gate = cancelledTurnRef.current;
			if (
				gate &&
				(update.type === "agent_message_chunk" ||
					update.type === "agent_thought_chunk" ||
					update.type === "plan" ||
					// I257: a stopped turn's late prompt echo.
					update.type === "user_message_chunk") &&
				(!update.sessionId || update.sessionId === gate.sessionId)
			) {
				return;
			}
			// I257: drop the agent's echo of the prompt in flight.
			const live = liveTurnRef.current;
			if (
				live &&
				update.type === "user_message_chunk" &&
				(!update.sessionId || update.sessionId === live.sessionId)
			) {
				return;
			}

			// Chat Timestamps: count a live update when it arrives, before the
			// title buffer can hold it. Only inside a live turn: between turns
			// (after a turn end, or a Stop's own permission cancel) there is
			// no clock, so nothing gets a gap stamp. Replayed history never
			// counts.
			const inTurn = liveTurnRef.current?.livePromptId != null;
			const lastUpdateBefore = inTurn ? lastUpdateAtRef.current : null;
			const arrivedAt = Date.now();
			if (inTurn && !update.replayed && countsAsActivity(update)) {
				lastUpdateAtRef.current = arrivedAt;
			}
			const queued: QueuedUpdate = { update, lastUpdateBefore };

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
				if (r.emit === null) {
					// Hold — nothing to render yet. Keep the first held chunk's
					// times for the chunk the buffer releases.
					if (heldChunkRef.current === null) {
						heldChunkRef.current = { arrivedAt, lastUpdateBefore };
					}
					return;
				}
				u = { ...u, text: r.emit };
			}
			queued.update = u;
			const held = heldChunkRef.current;
			if (u.type === "agent_message_chunk" && held !== null) {
				queued.arrivedAt = held.arrivedAt;
				queued.lastUpdateBefore = held.lastUpdateBefore;
				heldChunkRef.current = null;
			}

			pendingUpdatesRef.current.push(queued);
			// Visibility-immune scheduling (I168): rAF never fires in a hidden
			// window, which froze permission-request commits until refocus —
			// suppressing their OS notification. The scheduler keeps rAF while
			// visible and falls back to a MessageChannel macrotask while hidden.
			if (!flushSchedulerRef.current) {
				flushSchedulerRef.current = createUpdateFlushScheduler(
					flushPendingUpdates,
					createDomFlushSchedulerDeps(window, document),
				);
			}
			flushSchedulerRef.current.schedule();
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

	/**
	 * Write the live turn's end onto its prompt and close its open tool calls
	 * (Chat Timestamps). Every way a turn ends calls this: the send's success,
	 * failure and catch branches and discardPendingTurn (Stop, steer, reload,
	 * New chat). It reads `livePromptId`, the clock and the wait synchronously,
	 * before any reset, and passes them into the updater, which runs later and
	 * may run twice. A no-op when no turn is live, so a Stop that lands just
	 * after the success write can't turn done into stopped.
	 */
	const writeTurnEnd = useCallback((kind: TurnEndKind): void => {
		// The turn is over: content that arrives between turns is measured
		// from nothing, so it gets no gap stamp.
		lastUpdateAtRef.current = null;
		heldChunkRef.current = null;
		const live = liveTurnRef.current;
		const promptId = live?.livePromptId ?? null;
		if (!live || promptId === null) return;
		live.livePromptId = null;
		const now = Date.now();
		const openStretch = waitStartedAtRef.current;
		// On Stop the permission's falling edge only shows after the turn has
		// ended, so an open stretch is closed here, at this write's clock.
		const waitMs =
			turnWaitMsRef.current +
			(openStretch !== null ? Math.max(0, now - openStretch) : 0);
		waitStartedAtRef.current = null;
		turnWaitMsRef.current = 0;
		setMessages((prev) =>
			applyTurnEnd(prev, { promptId, now, kind, waitMs }),
		);
	}, []);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			pendingUpdatesRef.current = [];
			flushSchedulerRef.current?.dispose();
			flushSchedulerRef.current = null;
			toolCallIndexRef.current.clear();
			streamContinuityRef.current = createStreamContinuity();
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

	/** Discard any pending batched updates and reset the streaming flag. */
	const clearPendingUpdates = useCallback((): void => {
		pendingUpdatesRef.current = [];
		// Scheduler flag intentionally untouched: its parked flush no-ops on
		// the emptied queue and self-resets when it fires (I168 scheduler).
		// I174: wiping the queue may discard PermissionManager.cancelAll()'s
		// in-flight `isActive: false` cancellation — deactivate directly in the
		// source of truth so hasActivePermission deterministically resets.
		setMessages((prev) => cancelActivePermissions(prev));
		setIsSending(false);
		// F03: a cancelled turn discards its pending updates — drop the title
		// head buffer too (held head text belongs to the cancelled turn).
		titleBufferRef.current = null;
		heldChunkRef.current = null;
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
	const discardPendingTurn = useCallback(
		(settleTimeoutMs: number = CANCEL_SETTLE_TIMEOUT_MS): void => {
		generationRef.current++;
		// I203: gate the next turn on the cancelled prompt's answer, bounded
		// by a timeout because some agents never answer it (I107).
		const pending = sendPromiseRef.current;
		if (pending) {
			const gate = {
				sessionId: session.sessionId,
				settled: Promise.resolve(),
			};
			let timer: number | undefined;
			gate.settled = Promise.race([
				pending.then(
					() => undefined,
					() => undefined,
				),
				new Promise<void>((resolve) => {
					timer = window.setTimeout(resolve, settleTimeoutMs);
				}),
			]).then(() => {
				if (timer !== undefined) window.clearTimeout(timer);
				if (cancelledTurnRef.current === gate) {
					cancelledTurnRef.current = null;
				}
			});
			cancelledTurnRef.current = gate;
		}
		pendingUpdatesRef.current = [];
		// I174: same deterministic permission deactivation as clearPendingUpdates.
		setMessages((prev) => cancelActivePermissions(prev));
		// Chat Timestamps: record the stop before liveTurnRef is reset. The
		// queue is discarded, not flushed: Stop is meant to drop it.
		writeTurnEnd("stopped");
		setIsSending(false);
		titleBufferRef.current = null;
		// I257: the stopped turn's echo is now covered by the I203 gate above.
		liveTurnRef.current = null;
		// I107: drop the (possibly never-settling) prior-send promise so the
		// next send doesn't await a dead turn (it waits on the bounded I203
		// gate instead).
		sendPromiseRef.current = null;
		},
		[session.sessionId, writeTurnEnd],
	);

	const clearMessages = useCallback((): void => {
		setMessages([]);
		toolCallIndexRef.current.clear();
		streamContinuityRef.current = createStreamContinuity();
		setLastUserMessage(null);
		setIsSending(false);
		setErrorInfo(null);
		// F03: drop any in-flight title head buffer and clear the suggestion
		// so a new chat starts without a stale title.
		titleBufferRef.current = null;
		setSuggestedTitle(null);
		// I257: a cleared chat has no prompt in flight to echo.
		liveTurnRef.current = null;
		// Chat Timestamps: a cleared chat has no turn clocks.
		lastUpdateAtRef.current = null;
		heldChunkRef.current = null;
		waitStartedAtRef.current = null;
		turnWaitMsRef.current = 0;
		restoredPromptActiveRef.current = false;
		sendAttemptedRef.current = false;
		// I295: drop a send still preparing for the cleared chat, and stop a
		// live turn's late result or error from landing on it.
		resetEpochRef.current++;
		generationRef.current++;
	}, [setErrorInfo]);

	const setMessagesFromLocal = useCallback(
		(localMessages: ChatMessage[]): void => {
			// A restored or forked transcript has no live turn and no clocks.
			lastUpdateAtRef.current = null;
			heldChunkRef.current = null;
			restoredPromptActiveRef.current =
				findActivePermission(localMessages) !== null;
			setMessages(localMessages);
			rebuildToolCallIndex(localMessages, toolCallIndexRef.current);
			streamContinuityRef.current = createStreamContinuity();
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
			sendAttemptedRef.current = true;
			const resetEpoch = resetEpochRef.current;
			const chatWasReset = () => resetEpochRef.current !== resetEpoch;
			if (!session.sessionId) {
				setErrorInfo({
					title: t("chat.acpErrors.cannotSendTitle"),
					message: t("chat.acpErrors.noActiveSession"),
				});
				return;
			}

			// Wait for any in-flight send to settle (e.g. after cancel/stop)
			// before starting a new one to avoid interleaved state updates.
			if (sendPromiseRef.current) {
				try { await sendPromiseRef.current; } catch { /* ignore */ }
			}
			// I203: after a stop/steer, let the cancelled turn finish
			// streaming before this turn starts, so its late chunks can't
			// land in this turn's reply.
			if (cancelledTurnRef.current) {
				await cancelledTurnRef.current.settled;
			}
			if (chatWasReset()) return;

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
				if (chatWasReset()) return;
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
					sendsSystemInstruction: options.sendsSystemInstruction,
					// Earlier conversation for a session that doesn't have it
					// (agent switch, fallback): preparePrompt places it after
					// the system instruction (I265, [[Agent-Portable Sessions]]).
					carryOverBlocks:
						options.carryOverBlocks && options.carryOverBlocks.length > 0
							? options.carryOverBlocks
							: undefined,
					titleStrategy: settingsAccess.getSnapshot().titleStrategy,
					replyLanguageName: getReplyLanguage()?.englishName ?? null,
					obsidianSystemPrompt:
						settingsAccess.getSnapshot().obsidianSystemPrompt,
					workingDirectory: options.workingDirectory,
					vaultRootPath: options.vaultRootPath,
					contextNotes: options.contextNotes,
					selectionContext,
				},
				vaultAccess,
				vaultAccess, // IMentionService (same object)
			);
			if (chatWasReset()) return;

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

			// Chat Timestamps: stamped when it is actually sent, so a prompt
			// queued while the agent connected gets its real send time.
			const sentAt = Date.now();
			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: userMessageContent,
				timestamp: new Date(sentAt),
				sentAt,
			};
			// I228: commit any batched updates already received BEFORE the new
			// message. A restored agent-only tab loads on first send; the
			// session/load replay is still waiting for the next frame when the
			// queued send flushes, so without this the new message lands first
			// and the replayed history is appended under it.
			flushPendingUpdates();
			addMessage(userMessage);
			// Chat Timestamps: the turn's clocks start at the send; the
			// previous turn's last update never carries over.
			lastUpdateAtRef.current = sentAt;
			heldChunkRef.current = null;
			// A permission already on screen at the send (left open by the
			// last turn, or asked between turns) counts from the send: there
			// is no rising edge to start it. A restored one never counts.
			waitStartedAtRef.current =
				hadPermissionRef.current && !restoredPromptActiveRef.current
					? sentAt
					: null;
			turnWaitMsRef.current = 0;
			// I257: arm before the prompt goes out, so no echo can precede it.
			liveTurnRef.current = {
				sessionId: currentSessionId,
				generation,
				livePromptId: userMessage.id,
			};

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
					// Chat Timestamps: apply what already arrived before the
					// turn is closed. The answer lands in a microtask, ahead of
					// the next frame, so a final `completed` still queued would
					// otherwise be closed as interrupted (flush before close).
					flushPendingUpdates();

					if (result.success) {
						setIsSending(false);
						setLastUserMessage(null);
						writeTurnEnd(
							result.stopKind === "cancelled" ? "stopped" : "done",
						);
						recordTurnEnd(result.stopKind ?? "unknown");
						if (prepared.hydratedPaths?.length) {
							options.onContextDelivered?.(prepared.hydratedPaths);
						}
					} else {
						setIsSending(false);
						writeTurnEnd("failed");
						// I316: one object for both, so the tab can tell this
						// turn's banner from any later error by identity.
						const info: ErrorInfo = result.error
							? {
									title: result.error.title,
									message: result.error.message,
									suggestion: result.error.suggestion,
								}
							: {
									title: t("chat.acpErrors.sendFailedTitle"),
									message: t("chat.acpErrors.sendFailed"),
								};
						recordTurnEnd("failed", info);
						setErrorInfo(info);
					}
				} catch (error) {
					if (generationRef.current !== generation) return;
					flushTitleBuffer(currentSessionId);
					flushPendingUpdates();
					setIsSending(false);
					writeTurnEnd("failed");
					const info: ErrorInfo = {
						title: "Send Message Failed",
						message: `Failed to send message: ${extractErrorMessage(error)}`,
					};
					recordTurnEnd("failed", info);
					setErrorInfo(info);
				}
			})();

			sendPromiseRef.current = sendPromise;
			try {
				await sendPromise;
			} catch {
				// Error already handled inside sendPromise
			} finally {
				// Only clear our own promise: a cancelled turn settling late
				// must not wipe the redirect turn's ref (I203).
				if (sendPromiseRef.current === sendPromise) {
					sendPromiseRef.current = null;
				}
				// I257: only this send's gate; a newer send's stays armed.
				if (liveTurnRef.current?.generation === generation) {
					liveTurnRef.current = null;
				}
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
			flushPendingUpdates,
			recordTurnEnd,
			writeTurnEnd,
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

	// Chat Timestamps: time with a permission pending is left out of the
	// turn's working time. Only the head request is active, so stretches
	// never overlap. Edges outside a live turn are ignored.
	useEffect(() => {
		const had = hadPermissionRef.current;
		hadPermissionRef.current = hasActivePermission;
		if (hasActivePermission && !had) {
			if (liveTurnRef.current?.livePromptId) {
				waitStartedAtRef.current = Date.now();
			}
		} else if (!hasActivePermission && had) {
			restoredPromptActiveRef.current = false;
			const started = waitStartedAtRef.current;
			if (started !== null) {
				turnWaitMsRef.current += Math.max(0, Date.now() - started);
				waitStartedAtRef.current = null;
			}
		}
	}, [hasActivePermission]);

	const approvePermission = useCallback(
		async (
			requestId: string,
			optionId: string,
			choice?: PermissionScopeChoice,
		): Promise<void> => {
			try {
				await agentClient.respondToPermission(requestId, optionId, choice);
			} catch (error) {
				setErrorInfo({
					title: t("chat.acpErrors.permissionErrorTitle"),
					message: t("chat.acpErrors.permissionRespondFailed", {
						message: extractErrorMessage(error),
					}),
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
		lastTurnEnd,
		lastUserMessage,
		suggestedTitle,
		sendMessage,
		clearMessages,
		hasAttemptedSend,
		resetSendAttempt,
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
