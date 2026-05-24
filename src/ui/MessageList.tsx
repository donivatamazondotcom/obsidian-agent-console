import * as React from "react";
const { useRef, useEffect } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScrollPin } from "./use-auto-scroll-pin";

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
 * Messages container component with virtualized rendering.
 *
 * Uses @tanstack/react-virtual to only render messages visible in the viewport,
 * dramatically improving performance for long conversations.
 *
 * Auto-scroll behavior is owned by the useAutoScrollPin hook — see
 * 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md for the
 * design. MessageList provides the DOM handles (containerRef, virtualizerRef)
 * and renders the appropriate UI affordances (loading indicator, scroll-to-
 * bottom pill); the hook owns the pin-state machine and all transitions.
 *
 * Inactive-tab cost-minimization: when isActive=false, this component
 * renders only the container <div> (no virtualizer mount, no bubbles, no
 * markdown parsing). The hook continues tracking pin state via the existing
 * containerRef but does no DOM-observation work. On reactivation, the
 * virtualizer mounts fresh against a real-height container — no stale
 * zero-height measurements to discard.
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
	const containerRef = useRef<HTMLDivElement>(null);

	// ============================================================
	// Virtualizer
	// ============================================================
	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => 80,
		overscan: 5,
	});

	// Stable ref for the auto-scroll hook (avoids putting the virtualizer
	// object — new every render — in the hook's deps).
	const virtualizerRef = useRef(virtualizer);
	virtualizerRef.current = virtualizer;

	// ============================================================
	// Auto-scroll pin state (single owner)
	// ============================================================
	const { isPinned, shouldAdjust, scrollToBottom } = useAutoScrollPin({
		containerRef,
		virtualizerRef,
		messageCount: messages.length,
		isActive,
		isSending,
		view,
	});

	// Wire Authority A's gate to the hook. The hook's shouldAdjust has
	// stable identity across renders (reads from refs), so this assignment
	// is safe to do every render — the virtualizer sees the same callback.
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = shouldAdjust;

	// ============================================================
	// Render
	// ============================================================

	// Inactive tabs: render only the container (preserves containerRef for
	// the hook's observers but mounts no virtualizer/bubbles/markdown).
	// The parent <TabPanel> already applies display:none, so the user sees
	// nothing different — but the React tree is now negligibly cheap on
	// inactive tabs. See spec § Inactive-tab cost-minimization (T112, T128).
	if (!isActive) {
		return (
			<div
				ref={containerRef}
				className="agent-client-chat-view-messages"
				aria-hidden="true"
			/>
		);
	}

	// Empty state — same container <div>, different children. Unified into
	// a single return path (vs. early return) so containerRef is attached
	// to the same DOM node in both empty and populated states. This
	// guarantees the scroll listener registered by useAutoScrollPin
	// survives the empty→populated transition.
	if (messages.length === 0) {
		return (
			<div ref={containerRef} className="agent-client-chat-view-messages">
				<div className="agent-client-chat-empty-state">
					{isRestoringSession
						? "Restoring session..."
						: !isSessionReady
							? `Connecting to ${agentLabel}...`
							: `Start a conversation with ${agentLabel}...`}
				</div>
			</div>
		);
	}

	const virtualItems = virtualizer.getVirtualItems();

	return (
		<div ref={containerRef} className="agent-client-chat-view-messages">
			{/* Virtualized message list */}
			<div
				className="agent-client-virtual-list-inner"
				style={{
					height: virtualizer.getTotalSize(),
					position: "relative",
				}}
			>
				{virtualItems.map((virtualItem) => {
					const message = messages[virtualItem.index];
					return (
						<div
							key={message.id}
							ref={virtualizer.measureElement}
							data-index={virtualItem.index}
							className="agent-client-virtual-item"
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								transform: `translateY(${virtualItem.start}px)`,
							}}
						>
							<MessageBubble
								message={message}
								plugin={plugin}
								terminalClient={terminalClient}
								onApprovePermission={onApprovePermission}
							/>
						</div>
					);
				})}
			</div>

			{/* Loading indicator — outside virtualizer */}
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
			{!isPinned && (
				<ScrollToBottomButton
					onClick={() =>
						scrollToBottom({ behavior: "smooth" })
					}
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
