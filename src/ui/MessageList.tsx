import * as React from "react";
const { memo, useDeferredValue, useEffect, useRef } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";
import { useAutoScrollPin } from "./use-auto-scroll-pin";

/**
 * Stable empty array used as the deferred-value source when the tab is
 * inactive. Module-level so the reference is stable across renders —
 * required for `useDeferredValue` to detect the inactive → active
 * transition as a value change and schedule a deferred render.
 *
 * See [[ACP Scroll Architecture Rework]] § I-S10 § Round-2 fix.
 */
const EMPTY_MESSAGES: ChatMessage[] = [];

/**
 * Memoized wrapper around MessageBubble. Required by `useDeferredValue`'s
 * optimization pattern (per the React docs):
 *
 *   "This optimization requires SlowList to be wrapped in memo. This is
 *    because whenever the text changes, React needs to be able to re-render
 *    the parent component quickly. During that re-render, deferredText
 *    still has its previous value, so SlowList is able to skip re-rendering
 *    (its props have not changed). Without memo, it would have to
 *    re-render anyway, defeating the point of the optimization."
 *
 *   — https://react.dev/reference/react/useDeferredValue § "Deferring re-rendering"
 *
 * Default shallow-prop comparison is sufficient: `message`, `plugin`,
 * `terminalClient`, and `onApprovePermission` are all stable references
 * across renders that don't actually change the bubble.
 */
const MemoMessageBubble = memo(MessageBubble);

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
 *
 * I-S10 round-2 fix (chunked mount via useDeferredValue):
 *   When `isActive` flips false → true, the click handler must not pay
 *   the cost of synchronously mounting all bubbles. Round 1 attempted this
 *   via a useEffect-driven state machine, which produced three commits
 *   per activation and a visible scrollbar jump (see § I-S10 § Round-1
 *   regression in the spec). Round 2 uses `useDeferredValue` — the
 *   canonical React 18 primitive for "render expensive thing now, lower
 *   priority", per https://react.dev/reference/react/useDeferredValue.
 *
 *   The mechanism: when inactive, the deferred-value source is
 *   EMPTY_MESSAGES. When active, it switches to the real `messages` prop.
 *   On the activation render, `useDeferredValue` returns the PREVIOUS
 *   value (EMPTY_MESSAGES), so the active branch renders zero bubbles
 *   inside the click handler. React schedules a background re-render
 *   that uses the new value (full set), which mounts the bubbles in a
 *   separate task — the click handler is already done.
 *
 *   `MemoMessageBubble` (above) is required for this to work — without
 *   it, every parent re-render would re-render every bubble, defeating
 *   the deferral.
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
	// Chunked mount on activation (I-S10 round-2)
	// ============================================================
	//
	// useDeferredValue must be called on every render so React tracks the
	// deferred state across activation transitions. When inactive, the
	// source is EMPTY_MESSAGES (stable module-level reference); when
	// active, the source is the real messages prop. The transition from
	// EMPTY_MESSAGES (when inactive) to messages (when activating) is
	// what triggers the deferred render.
	//
	// On the activation render: deferredMessages returns EMPTY_MESSAGES
	// (the previous value). The bubble map renders zero bubbles. React
	// schedules a background render with the full set; that re-render
	// commits the bubbles in a separate task.
	//
	// Per the React docs:
	//   "There is no fixed delay caused by useDeferredValue itself. As
	//    soon as React finishes the original re-render, React will
	//    immediately start working on the background re-render with the
	//    new deferred value. Any updates caused by events (like typing)
	//    will interrupt the background re-render and get prioritized
	//    over it."
	//
	// — https://react.dev/reference/react/useDeferredValue
	const messagesForRender = isActive ? messages : EMPTY_MESSAGES;
	const deferredMessages = useDeferredValue(messagesForRender);

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
	//
	// We check `messages.length` (the actual prop) rather than
	// `deferredMessages.length` so the empty-state UI shows immediately
	// on a fresh empty session, not after a deferred-value catch-up.
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
				{deferredMessages.map((message) => (
					<div key={message.id} className="agent-client-message-row">
						<MemoMessageBubble
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
