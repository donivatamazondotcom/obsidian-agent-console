import * as React from "react";
const { useEffect, useRef, useState } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";
import { useAutoScrollPin } from "./use-auto-scroll-pin";

/**
 * Number of messages mounted synchronously on the first commit after a
 * tab activation. Sized to comfortably cover one viewport plus overscan;
 * the rest stream in via MessageChannel on the next task. Closes I-S10
 * (synchronous mass-mount) — see [[ACP Scroll Architecture Rework]] § I-S10.
 *
 * Tunable: smaller values reduce the initial click-handler cost but
 * increase the chance the user sees a brief "content shorter than expected"
 * frame. 30 is empirically a single-screen-plus-overscan on a 14" laptop.
 */
const FIRST_BATCH_SIZE = 30;

/**
 * Props for MessageList component
 */
export interface MessageListProps {
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Whether a session is being restored (load/resume/fork) */
	isRestoringSession: boolean;
	/** Display name of the active agent */
	agentLabel: string;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: IChatViewHost;
	/** Terminal client for output polling */
	terminalClient?: AcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	/** Whether a permission request is currently pending */
	hasActivePermission: boolean;
	/** Whether this tab is currently active (visible) */
	isActive?: boolean;
}

/**
 * Messages container component (Phase 2 native-scroll architecture).
 *
 * Auto-scroll behavior is owned entirely by useAutoScrollPin — the hook
 * owns both pin state and scroll position. There is no virtualizer; all
 * message bubbles render directly. Off-screen render-skipping is achieved
 * via CSS `content-visibility: auto` on each bubble (no JavaScript
 * measurement cost, unlike the prior @tanstack/react-virtual integration).
 *
 * See 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md
 * § Phase 2 architecture for the design rationale and § Decisions #16,
 * #17, #21, #22 for the substantive choices.
 *
 * Inactive-tab cost-minimization (preserved from Phase 1): when
 * isActive=false, this component renders only a placeholder div carrying
 * the scrollRef. No bubbles mount, no markdown parses. The hook detects
 * the deactivation and stops doing work.
 */
export function MessageList({
	messages,
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	plugin,
	view,
	terminalClient,
	onApprovePermission,
	hasActivePermission,
	isActive = true,
}: MessageListProps) {
	// ============================================================
	// Auto-scroll (single owner)
	// ============================================================
	const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
		useAutoScrollPin({ isActive, isSending, view });

	// ============================================================
	// Chunked mount on activation (I-S10)
	// ============================================================
	//
	// Closes I-S10 — synchronous mass-mount of all bubbles inside the
	// activation click task. See [[ACP Scroll Architecture Rework]] § I-S10
	// for the trace-evidence root cause and fix-candidates table.
	//
	// On the first render after isActive flips false → true with a session
	// larger than FIRST_BATCH_SIZE, render only the last N messages
	// synchronously. Schedule a follow-up render via MessageChannel that
	// mounts the rest. MessageChannel — not rAF — for the same reason as
	// the I-S9 fix: rAF can be folded into the same task on tab activation
	// (Chromium frame-update cycle), but a posted MessageChannel message
	// always queues a fresh task that escapes the click handler.
	//
	// When the deferred render lands, contentEl height grows and
	// useAutoScrollPin's contentRef ResizeObserver fires the `grew` branch
	// with `previous` defined (the first batch already fired once), which
	// writes scrollTop synchronously to anchor at the bottom. Net visual:
	// last ~30 messages visible immediately, the rest "fill in above" over
	// the next few frames with the scroll position correct throughout.
	//
	// Trigger condition: only on the inactive → active transition AND when
	// messages.length > FIRST_BATCH_SIZE. Subsequent length changes (e.g.
	// streaming a new message) do NOT re-defer — `mountedAll` stays true
	// for the duration of this active session. The next inactive → active
	// transition resets it.
	const [mountedAll, setMountedAll] = useState(
		!isActive || messages.length <= FIRST_BATCH_SIZE,
	);
	const prevIsActiveRef = useRef(isActive);
	const deferralChannelRef = useRef<MessageChannel | null>(null);
	const pendingDeferralRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		const wasInactive = !prevIsActiveRef.current;
		prevIsActiveRef.current = isActive;

		// Reset to "all mounted" whenever we transition to inactive — the
		// next activation gets a fresh chunked-mount cycle.
		if (!isActive) {
			setMountedAll(true);
			return;
		}

		// Only chunk on the inactive → active transition with a heavy session.
		if (!wasInactive) return;
		if (messages.length <= FIRST_BATCH_SIZE) {
			setMountedAll(true);
			return;
		}

		// Stage the deferred mount.
		setMountedAll(false);

		// Lazy-create the channel; reuse across activations within this
		// component instance.
		if (deferralChannelRef.current === null) {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => {
				const cb = pendingDeferralRef.current;
				pendingDeferralRef.current = null;
				if (cb) cb();
			};
			deferralChannelRef.current = channel;
		}

		pendingDeferralRef.current = () => {
			setMountedAll(true);
		};
		deferralChannelRef.current.port2.postMessage(null);
	}, [isActive, messages.length]);

	useEffect(() => {
		// Cleanup on unmount: cancel any pending deferral, close ports.
		return () => {
			pendingDeferralRef.current = null;
			if (deferralChannelRef.current) {
				deferralChannelRef.current.port1.close();
				deferralChannelRef.current.port2.close();
				deferralChannelRef.current = null;
			}
		};
	}, []);

	const visibleMessages = mountedAll
		? messages
		: messages.slice(-FIRST_BATCH_SIZE);

	// ============================================================
	// Render
	// ============================================================

	// Inactive tabs: placeholder div carrying the scrollRef. The parent
	// <TabPanel> already applies display:none, so the user sees nothing
	// different — but the React tree is now negligibly cheap on inactive
	// tabs. The hook will detect the deactivation via the isActive prop.
	if (!isActive) {
		return (
			<div
				ref={scrollRef}
				className="agent-client-chat-view-messages"
				aria-hidden="true"
			/>
		);
	}

	// Empty state — same container, different children. Unified into a
	// single return path (vs. early return) so scrollRef is attached to
	// the same DOM node in both empty and populated states.
	if (messages.length === 0) {
		return (
			<div ref={scrollRef} className="agent-client-chat-view-messages">
				<div ref={contentRef} className="agent-client-chat-content">
					<div className="agent-client-chat-empty-state">
						{isRestoringSession
							? "Restoring session..."
							: !isSessionReady
								? `Connecting to ${agentLabel}...`
								: `Start a conversation with ${agentLabel}...`}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className="agent-client-chat-view-messages">
			<div ref={contentRef} className="agent-client-chat-content">
				{visibleMessages.map((message) => (
					<div key={message.id} className="agent-client-message-row">
						<MessageBubble
							message={message}
							plugin={plugin}
							terminalClient={terminalClient}
							onApprovePermission={onApprovePermission}
						/>
					</div>
				))}
			</div>

			{/* Loading indicator */}
			<div
				className={`agent-client-loading-indicator ${!isSending ? "agent-client-hidden" : ""}`}
			>
				<div className="agent-client-loading-dots">
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
				</div>
				{hasActivePermission && (
					<span className="agent-client-loading-status">
						Waiting for permission...
					</span>
				)}
			</div>

			{/* Scroll to bottom button */}
			{!isAtBottom && (
				<ScrollToBottomButton
					onClick={() => scrollToBottom({ behavior: "smooth" })}
				/>
			)}
		</div>
	);
}

/**
 * Extracted scroll-to-bottom button with a stable ref for setIcon.
 * Avoids the inline callback ref cycling that swallows click events
 * (same fix as I7).
 *
 * Click handler is provided by the parent via the useAutoScrollPin hook's
 * scrollToBottom callback — keeps scroll concerns in one place.
 */
function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
	const btnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (btnRef.current) {
			setIcon(btnRef.current, "chevron-down");
		}
	}, []);

	return (
		<button
			ref={btnRef}
			className="agent-client-scroll-to-bottom"
			onClick={onClick}
		/>
	);
}
