import * as React from "react";
const { memo, useEffect, useRef } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";
import { useAutoScrollPin } from "./use-auto-scroll-pin";

/**
 * Memoized wrapper around MessageBubble. Skips re-rendering when the
 * bubble's props are unchanged — important during streaming (a new
 * message append triggers a parent re-render, but already-rendered
 * bubbles should not pay the markdown-parse cost again). Default
 * shallow-prop comparison is sufficient because `message`, `plugin`,
 * `terminalClient`, and `onApprovePermission` are all stable references.
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
 * I-S10 round-3 fix (deferred mount via useTransition at the trigger site):
 *   When `isActive` flips false → true, the click handler must not pay
 *   the cost of synchronously mounting all bubbles. Round-1 attempted this
 *   via a useEffect-driven state machine (regressed). Round-2 used
 *   `useDeferredValue` here in MessageList (won the cost-axis but produced
 *   a visible empty-paint flash, see § I-S10 § Round-2). Round-3 moves the
 *   deferral up the call chain to TabBar, where the click handler wraps
 *   `setActiveTabId` in `startTransition`. React then schedules the entire
 *   downstream re-render (including this MessageList's mount) as a
 *   low-priority Transition — and per the React docs:
 *
 *     "Transitions only 'wait' long enough to avoid hiding *already
 *      revealed* content (like the tab container)."
 *
 *     — https://react.dev/reference/react/useTransition § "Preventing unwanted loading indicators"
 *
 *   So the previously-active tab's content stays painted on screen until
 *   the new tab's mount completes; both the `display:flex/none` swap AND
 *   the bubble mount commit together. No empty intermediate paint.
 *
 *   This MessageList no longer needs any local deferral mechanism — the
 *   transition is handled at the trigger. `MemoMessageBubble` (above) is
 *   retained because it's still the right optimization for streaming:
 *   when a single new message appends, already-rendered bubbles skip
 *   re-render via memo equality.
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
	// (I-S10 round-3) No local deferral here — the deferral is at the
	// TabBar click-handler trigger via useTransition. See JSDoc above
	// and src/ui/TabBar.tsx § I-S10 round-3 fix.
	// ============================================================

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
				{messages.map((message) => (
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
