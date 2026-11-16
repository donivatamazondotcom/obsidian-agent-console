import type { PermissionScopeChoice } from "../types/chat";
import * as React from "react";
const { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { Notice, setIcon } from "obsidian";
import { MessageBubble, type A2uiBubbleContext } from "./MessageBubble";
import { TimeStamp, useStampHoverAges } from "./TimeStamp";
import { deriveTurnEndStamp } from "../resolvers/turn-end-stamp";
import type { ToolRunState } from "../resolvers/turn-activity";
import { useTurnActivitySlice } from "./turn-activity-context";
import type { TurnActivitySnapshot } from "../services/turn-activity-store";
import { LossyFallbackNotice } from "./LossyFallbackNotice";
import type { SessionFallbackReason } from "../resolvers/session-engine";
import { McpFailureNotice } from "./McpFailureNotice";
import { KiroUpdateTip } from "./KiroUpdateTip";
import type { KiroEngineFallback } from "../types/session";
import { deriveConversationEmptyState } from "../resolvers/conversation-empty-state";
import {
	deriveEmptyStateView,
	type EmptyStateLocation,
} from "../resolvers/empty-state-view";
import type { TabSessionState } from "../hooks/useTabSessionState";
import { useAutoScrollPin } from "./use-auto-scroll-pin";
import {
	deriveJumpButtonVisible,
	deriveReplyStartTarget,
	replyStartTargetFromParts,
	replyStartTargetKey,
	type ReplyStartTarget,
	type ReplyStartTargetKind,
} from "../resolvers/reply-start-target";
import {
	BUILTIN_AGENT_INSTALLS,
	buildInstallCommand,
	docsSetupUrl,
	type BuiltInAgentInstall,
} from "../services/agent-packages";
import type { InstallResult } from "../services/agent-installer";
import { t } from "../i18n";
import { scheduleViewRefocus } from "./composer-focus";

/**
 * Memoized wrapper around MessageBubble. Skips re-rendering when the
 * bubble's props are unchanged — important during streaming (a new
 * message append triggers a parent re-render, but already-rendered
 * bubbles should not pay the markdown-parse cost again). Default
 * shallow-prop comparison is sufficient because `message`, `plugin`,
 * `terminalClient`, and `onApprovePermission` are all stable references.
 */
const MemoMessageBubble = memo(MessageBubble);

const selectLine = (s: TurnActivitySnapshot) => s.line;

/**
 * The live status line (Chat Timestamps PR 3, Decision 3): `Waiting on
 * you` from the permission itself, in the same render as the prompt, else
 * the per-second ticker's facts (`Working 4m · last update 10s ago`).
 * The only part of the list that re-renders on a tick.
 */
const TurnStatusLine = memo(function TurnStatusLine({
	hasActivePermission,
}: {
	hasActivePermission: boolean;
}) {
	const line = useTurnActivitySlice(selectLine);
	const text = hasActivePermission ? t("chat.activity.waitingOnYou") : line;
	if (text === null) return null;
	return <span className="agent-client-loading-status">{text}</span>;
});

/** Whether a message holds a tool call (each tool call is its own message). */
function holdsToolCall(message: ChatMessage): boolean {
	return message.content.some((c) => c.type === "tool_call");
}

/**
 * Workspace event fired by the "Jump to start of latest reply" command
 * (plugin.ts) and handled by the focused view's active tab here.
 */
export const JUMP_TO_REPLY_START_EVENT = "agent-console:jump-to-reply-start";
const NO_REPLY_START: ReplyStartTarget = { kind: "none" };

/**
 * The element "Jump to start of latest reply" lands on: the target row's
 * marked text group (MessageBubble's `data-reply-text-start`), or the row
 * itself for a text-free turn or if the text group hasn't rendered yet.
 * Walks this tab's content element only, from the end, because the target
 * is always in the latest turn. No message id goes into a selector, and
 * child combinators keep markdown inside a reply from matching.
 */
function findReplyStartElement(
	contentEl: Element | null | undefined,
	target: ReplyStartTarget,
): HTMLElement | null {
	if (!contentEl) return null;
	switch (target.kind) {
		case "none":
			return null;
		case "text":
		case "row": {
			const rows = contentEl.children;
			for (let i = rows.length - 1; i >= 0; i--) {
				const row = rows[i] as HTMLElement;
				if (row.dataset.messageId !== target.messageId) continue;
				if (target.kind === "row") return row;
				return (
					row.querySelector<HTMLElement>(
						":scope > .agent-client-message-renderer > [data-reply-text-start]",
					) ?? row
				);
			}
			return null;
		}
	}
}

/**
 * Data for the Layer 2 getting-started empty state — shown when the chat is
 * empty and the current agent is not connectable (fresh install or
 * misconfiguration), so the panel is never a dead end. See
 * [[Agent Console Command Palette Rationalization]] § First-run / onboarding.
 */
export interface GettingStartedInfo {
	/**
	 * Where this empty-state panel renders. Drives affordance gating via
	 * deriveEmptyStateView. Defaults to "in-tab" (the first-run dead-end
	 * panel); the zero-tab landing passes "no-tabs".
	 */
	location?: EmptyStateLocation;
	/** Agents detected as installed on the machine, shown as one-click picks. */
	detectedAgents: { id: string; displayName: string }[];
	/** Switch the panel to the chosen agent and start a fresh chat. */
	onPickAgent: (agentId: string) => void;
	/** Open the plugin settings tab. */
	onOpenSettings: () => void;
	/** Re-run agent detection (clears the cached probe). Clears a stale
	 * getting-started dead end when an agent was installed outside the plugin
	 * or configured via env only, so its command never changed (I-FRO6). */
	onRedetect: () => void;
	/**
	 * Run the one-line install for an npm-backed built-in agent, streaming
	 * output to `onOutput`. Resolves with a structured result (never throws).
	 */
	onInstall: (
		npmPackage: string,
		onOutput: (chunk: string) => void,
	) => Promise<InstallResult>;
}

/**
 * Getting-started panel content: a heading, detected-agent one-click picks
 * (or an honest "none detected" line), an always-present open-settings escape
 * hatch, and a manual-path hint. Built from elements + CSS classes only
 * (no inline styles), sentence case per Obsidian plugin guidelines.
 */
function InstallRow({
	agent,
	onInstall,
}: {
	agent: BuiltInAgentInstall;
	onInstall: GettingStartedInfo["onInstall"];
}) {
	const [installing, setInstalling] = useState(false);
	const [output, setOutput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Kiro has no npm one-liner — offer its setup guide, no Install button.
	if (!agent.npmPackage) {
		return (
			<div className="agent-client-install-row">
				<span className="agent-client-install-name">
					{agent.displayName}
				</span>
				<a
					className="agent-client-install-guide"
					href={docsSetupUrl(agent.docsSlug)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{t("chat.landing.setupGuide")}
				</a>
			</div>
		);
	}

	const npmPackage = agent.npmPackage;
	const command = buildInstallCommand(npmPackage);

	const runInstall = async () => {
		setInstalling(true);
		setError(null);
		setOutput("");
		const result = await onInstall(npmPackage, (chunk) =>
			setOutput((prev) => prev + chunk),
		);
		setInstalling(false);
		if (!result.ok) {
			setError(result.message ?? t("chat.landing.installDidntFinish"));
		}
		// On success the agent is detected on re-probe and this whole panel
		// unmounts — nothing else to do here.
	};

	const copyCommand = () => {
		void navigator.clipboard.writeText(command).then(
			() => {
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1500);
			},
			() => undefined,
		);
	};

	return (
		<div className="agent-client-install-row">
			<span className="agent-client-install-name">{agent.displayName}</span>
			<button
				type="button"
				className="agent-client-install-run"
				disabled={installing}
				onClick={() => void runInstall()}
			>
				{installing
					? t("chat.landing.installing")
					: t("chat.landing.install")}
			</button>
			<button
				type="button"
				className="agent-client-install-copy"
				onClick={copyCommand}
			>
				{copied
					? t("chat.landing.copied")
					: t("chat.landing.copyCommand")}
			</button>
			{(error || output) && (
				<pre className="agent-client-install-output">
					{error ? `${error}\n\n${command}` : output}
				</pre>
			)}
		</div>
	);
}

export function GettingStarted({ info }: { info: GettingStartedInfo }) {
	const { detectedAgents, onPickAgent, onOpenSettings, onRedetect, onInstall } = info;
	// Single source of truth for which affordances this empty state shows
	// (deriveEmptyStateView / § Harmonization with I-FRO6). The in-tab
	// first-run panel passes location "in-tab" (default); the zero-tab landing
	// passes "no-tabs". Re-detect, install rows, picks, settings, and the hint
	// are all gated by the resolver so the two surfaces cannot drift.
	const view = deriveEmptyStateView({
		location: info.location ?? "in-tab",
		hasDetectedAgent: detectedAgents.length > 0,
	});
	return (
		<div className="agent-client-chat-empty-state agent-client-getting-started">
			<div className="agent-client-getting-started-heading">
				{t("chat.landing.pickAgent")}
			</div>
			{view.showAgentPicks && (
				<>
					<div className="agent-client-getting-started-subtext">
						{t("chat.landing.detected")}
					</div>
					<div className="agent-client-getting-started-picks">
						{detectedAgents.map((agent) => (
							<button
								key={agent.id}
								type="button"
								className="agent-client-getting-started-pick"
								onClick={() => onPickAgent(agent.id)}
							>
								{agent.displayName}
							</button>
						))}
					</div>
				</>
			)}
			{view.showInstallRows && (
				<>
					<div className="agent-client-getting-started-subtext">
						{t("chat.landing.needAgentPrefix")}
						{BUILTIN_AGENT_INSTALLS.map((agent, i) => (
							<React.Fragment key={agent.id}>
								{i > 0 &&
									(i === BUILTIN_AGENT_INSTALLS.length - 1
										? t("chat.landing.orSeparator")
										: t("chat.landing.listSeparator"))}
								<a
									href={docsSetupUrl(agent.docsSlug)}
									target="_blank"
									rel="noopener noreferrer"
								>
									{agent.displayName}
								</a>
							</React.Fragment>
						))}
						.
					</div>
					<div className="agent-client-getting-started-installs">
						{BUILTIN_AGENT_INSTALLS.map((agent) => (
							<InstallRow
								key={agent.id}
								agent={agent}
								onInstall={onInstall}
							/>
						))}
					</div>
				</>
			)}
			{view.showSettings && (
				<button
					type="button"
					className="agent-client-getting-started-settings"
					onClick={onOpenSettings}
				>
					{t("chat.landing.openSettings")}
				</button>
			)}
			{view.showRedetect && (
				<button
					type="button"
					className="agent-client-getting-started-redetect"
					onClick={onRedetect}
				>
					{t("chat.landing.redetect")}
				</button>
			)}
			{view.showManualPathHint && (
				<div className="agent-client-getting-started-hint">
					{t("chat.landing.pathHint")}
				</div>
			)}
		</div>
	);
}

/**
 * Props for MessageList component
 */
export interface MessageListProps {
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Per-tab lazy session state (canonical readiness signal for empty-state copy) */
	lazyState: TabSessionState;
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
	choice?: PermissionScopeChoice,
) => Promise<void>;
	/** Whether a permission request is currently pending */
	hasActivePermission: boolean;
	/**
	 * a2ui wiring for agent-emitted interactive prompts (optional — absent
	 * renders a2ui fences as plain markdown).
	 */
	a2ui?: A2uiBubbleContext;
	/** Whether this tab is currently active (visible) */
	isActive?: boolean;
	/**
	 * True when the active session was recovered via client-side replay
	 * (the `session/load` failure → `session/new` fallback path). Drives
	 * the LossyFallbackNotice rendered above the conversation.
	 *
	 * In Commit A of the integration phase the restored-tab path is not
	 * yet wired, so this flag never goes true in practice — the prop is
	 * plumbed so Commit D's restored-tab integration can flow through
	 * without further plumbing changes.
	 */
	isFallbackRecovery?: boolean;
	/** Why the fallback happened (D2); picks the notice copy. */
	fallbackReason?: SessionFallbackReason | null;
	/** Why this tab's Kiro process runs V2 instead of Default V3 (I302). */
	kiroEngineFallback?: KiroEngineFallback;
	/** I282: the agent no longer has this tab's session. */
	sessionGone?: boolean;
	/** I282: close this tab (the gone notice's Close button). */
	onCloseSessionGone?: () => void;
	/**
	 * The tab's view id. When present, MCP servers that failed to connect
	 * (Kiro V3 status snapshots) are listed above the conversation.
	 */
	viewId?: string;
	/**
	 * When present, the empty state renders the Layer 2 getting-started block
	 * (detected-agent picks + open-settings) instead of the plain connecting
	 * text — used when the current agent is not connectable.
	 */
	gettingStarted?: GettingStartedInfo;
}

/**
 * Messages container component (Phase 2 native-scroll architecture).
 *
 * Auto-scroll behavior is owned entirely by useAutoScrollPin — the hook
 * owns both pin state and scroll position. There is no virtualizer; all
 * message bubbles render directly. (`content-visibility: auto` on bubbles
 * was tried and removed; see the note in styles.css.)
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
 * I-S10 round-4 (synchronous activation; no in-component deferral):
 *   When `isActive` flips false → true, all bubbles render synchronously
 *   from the `messages` prop in the same render. There is no deferral
 *   mechanism inside this component.
 *
 *   History:
 *   - Round-1 (regressed): useEffect-driven chunked state machine produced
 *     three commits per activation and a visible scrollbar jump.
 *   - Round-2 (regressed): `useDeferredValue` + `EMPTY_MESSAGES` here in
 *     MessageList won the click-handler cost-axis but produced an
 *     intermediate empty paint (the chat content area went fully blank
 *     for one or more frames during activation).
 *   - Round-3 (regressed differently): removed the in-component deferral
 *     and moved it to TabBar via `useTransition`. Empty paint went away,
 *     replaced by a smaller scrollbar-pill flicker during the post-commit
 *     markdown-render cascade. The flicker is visible because
 *     `useTransition` lets the click handler return early, opening a
 *     paint window between React commit and the post-commit `useEffect`
 *     callbacks that populate each MessageBubble's content via
 *     Obsidian's MarkdownRenderer.
 *   - Round-4 (current): reverted the TabBar `useTransition` wrapper.
 *     Click handler now runs render + commit + effects synchronously
 *     before returning, blocking the main thread for ~250 ms on a
 *     200-bubble session but producing a single final paint with no
 *     flicker (matching the keyboard-hotkey path's behavior, which
 *     never had the wrapper).
 *
 *   `MemoMessageBubble` (above) is retained as the streaming
 *   optimization: when a new message appends, already-rendered bubbles
 *   skip re-render via memo equality.
 *
 *   Mechanism proven in src/ui/__tests__/post-commit-effect-mechanism.test.tsx.
 *   See [[ACP Scroll Architecture Rework]] § I-S10 § Round-3 verification
 *   for full empirical analysis.
 */
export function MessageList({
	messages,
	isSending,
	lazyState,
	isRestoringSession,
	agentLabel,
	plugin,
	view,
	terminalClient,
	onApprovePermission,
	hasActivePermission,
	a2ui,
	isActive = true,
	isFallbackRecovery = false,
	fallbackReason = null,
	kiroEngineFallback,
	sessionGone = false,
	onCloseSessionGone,
	viewId,
	gettingStarted,
}: MessageListProps) {
	// ============================================================
	// Auto-scroll (single owner)
	// ============================================================
	const { scrollRef, contentRef, isAtBottom, scrollToBottom, jumpToElement } =
		useAutoScrollPin({ isActive, isSending, view });

	// Chat Timestamps: ages on hover, one delegated listener pair per list,
	// on the same container as the scroll pin's listeners.
	const stampRef = useStampHoverAges(isActive);
	const listRef = useCallback(
		(el: HTMLDivElement | null) => {
			scrollRef(el);
			stampRef(el);
		},
		[scrollRef, stampRef],
	);

	// ============================================================
	// Jump to start of latest reply. Every hook here sits above the
	// `!isActive` early return below (a hook after it breaks on a tab
	// switch). See [[Jump to Start of Latest Reply]].
	// ============================================================
	/** The anchor's sticky wrapper; its next sibling is the content element. */
	const wrapperRef = useRef<HTMLDivElement>(null);
	const isActiveRef = useRef(isActive);
	isActiveRef.current = isActive;
	const messagesRef = useRef(messages);
	messagesRef.current = messages;
	const commandTimerRef = useRef<number | null>(null);

	/**
	 * Jump, then on keyboard activation move focus to the target, skip-link
	 * style: the button disappears after the jump, and in the composer
	 * PageDown and the arrows would edit the draft instead of scrolling the
	 * reply. `preventScroll` keeps the hook the only writer of scrollTop.
	 */
	const onJump = useCallback(
		(el: HTMLElement, viaKeyboard: boolean) => {
			jumpToElement(el);
			if (!viaKeyboard) return;
			if (!el.hasAttribute("tabindex")) {
				el.tabIndex = -1;
				el.addEventListener("blur", () => el.removeAttribute("tabindex"), {
					once: true,
				});
			}
			el.focus({ preventScroll: true });
		},
		[jumpToElement],
	);

	// The command: dispatched to the focused view's active tab. Deferred a
	// task so the hotkey's own keydown has finished dispatching before the
	// hold starts (the chat-view keydown listener would otherwise end it).
	useEffect(() => {
		const workspace = plugin.app.workspace;
		const ws = workspace as unknown as {
			on: (
				name: string,
				callback: (...args: never[]) => void,
			) => ReturnType<typeof workspace.on>;
		};
		const clearPending = () => {
			if (commandTimerRef.current !== null) {
				window.clearTimeout(commandTimerRef.current);
				commandTimerRef.current = null;
			}
		};
		const ref = ws.on(JUMP_TO_REPLY_START_EVENT, (targetViewId?: string) => {
			if (targetViewId && targetViewId !== viewId) return;
			clearPending();
			commandTimerRef.current = window.setTimeout(() => {
				commandTimerRef.current = null;
				if (!isActiveRef.current) return;
				// Not gated on isSending: the command works mid-stream.
				const target = deriveReplyStartTarget(messagesRef.current);
				if (target.kind === "none") {
					new Notice(t("notices.noReplyToJumpTo"));
					return;
				}
				const el = findReplyStartElement(
					wrapperRef.current?.nextElementSibling,
					target,
				);
				if (el) jumpToElement(el);
			}, 0);
		});
		return () => {
			workspace.offref(ref);
			clearPending();
		};
	}, [plugin.app.workspace, viewId, jumpToElement]);

	// ============================================================
	// (I-S10 round-4) No deferral. Bubbles render synchronously from
	// the `messages` prop. See JSDoc above for round 1-4 history.
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
				ref={listRef}
				className="agent-client-chat-view-messages"
				aria-hidden="true"
			/>
		);
	}

	// Jump to start of latest reply: the button's target. Skipped per
	// streamed chunk and per replay flush; the anchor's memo bails on the
	// other renders (composer keystrokes) because its props don't change.
	const isAcquiring = lazyState === "connecting";
	const replyStart =
		isSending || isAcquiring ? NO_REPLY_START : deriveReplyStartTarget(messages);

	// I302: the update tip, in both branches. Mounted only for a fallback
	// tab, so other tabs pay nothing.
	const kiroUpdateTip =
		kiroEngineFallback && plugin.settingsService ? (
			<KiroUpdateTip
				store={plugin.settingsService}
				fallback={kiroEngineFallback}
				agentName={agentLabel}
			/>
		) : null;

	// Empty state — same container, different children. Unified into a
	// single return path (vs. early return) so scrollRef is attached to
	// the same DOM node in both empty and populated states.
	if (messages.length === 0) {
		const emptyState = deriveConversationEmptyState({
			isRestoringSession,
			lazyState,
			sessionGone,
		});
		return (
			<div ref={listRef} className="agent-client-chat-view-messages">
				{/* Same first child as the populated branch, so the content
				    element keeps its slot and DOM node across empty ↔
				    populated (the hook's content ResizeObserver stays). */}
				<JumpToReplyStartAnchor
					targetKind="none"
					targetMessageId={null}
					isSending={isSending}
					isAcquiring={isAcquiring}
					onJump={onJump}
					wrapperRef={wrapperRef}
				/>
				<div ref={contentRef} className="agent-client-chat-content">
					{kiroUpdateTip}
					{viewId && plugin.mcpAuthManager && (
						<McpFailureNotice manager={plugin.mcpAuthManager} viewId={viewId} />
					)}
					{emptyState.kind === "session-gone" ? (
						<div
							className="agent-client-chat-empty-state agent-client-session-gone"
							role="status"
						>
							<span>{t("chat.sessionGone.body", { agent: agentLabel })}</span>
							<button
								type="button"
								className="mod-cta agent-client-session-gone-close"
								onClick={() => onCloseSessionGone?.()}
							>
								{t("chat.sessionGone.close")}
							</button>
						</div>
					) : gettingStarted ? (
						<GettingStarted info={gettingStarted} />
					) : (
						<div className="agent-client-chat-empty-state">
							{emptyState.kind === "restoring"
								? t("chat.messages.restoringSession")
								: emptyState.kind === "send-to-connect"
									? t("chat.messages.sendToConnectTo", {
											agent: agentLabel,
										})
									: emptyState.kind === "connect-failed"
										? t("chat.messages.connectFailed", {
												agent: agentLabel,
											})
										: emptyState.kind === "connecting"
											? t("chat.messages.connectingTo", {
													agent: agentLabel,
												})
											: t("chat.messages.startConversation", {
													agent: agentLabel,
												})}
						</div>
					)}
				</div>
			</div>
		);
	}

	// Chat Timestamps: a turn's end stamp goes under its last agent message,
	// or under the prompt when the turn produced none. Found in this one pass:
	// carry the current prompt, and check the next message's role.
	let currentPrompt: ChatMessage | null = null;
	// Chat Timestamps PR 3: the latest prompt's turn is live while sending,
	// so its tool rows tick. Found by one backward scan before the pass.
	let lastPromptIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			lastPromptIndex = i;
			break;
		}
	}

	return (
		<div ref={listRef} className="agent-client-chat-view-messages">
			<JumpToReplyStartAnchor
				targetKind={replyStart.kind}
				targetMessageId={replyStart.kind === "none" ? null : replyStart.messageId}
				isSending={isSending}
				isAcquiring={isAcquiring}
				onJump={onJump}
				wrapperRef={wrapperRef}
			/>
			<div ref={contentRef} className="agent-client-chat-content">
				<LossyFallbackNotice
					isFallbackRecovery={isFallbackRecovery}
					reason={fallbackReason ?? undefined}
				/>
				{kiroUpdateTip}
				{viewId && plugin.mcpAuthManager && (
					<McpFailureNotice manager={plugin.mcpAuthManager} viewId={viewId} />
				)}
				{messages.map((message, messageIndex) => {
					if (message.role === "user") currentPrompt = message;
					const toolRunState: ToolRunState =
						message.role === "assistant" && holdsToolCall(message)
							? isSending && messageIndex > lastPromptIndex
								? "live"
								: (currentPrompt?.turnEndKind ?? undefined)
							: undefined;
					const next = messages[messageIndex + 1];
					const endStamp =
						currentPrompt !== null && (next === undefined || next.role === "user")
							? deriveTurnEndStamp(currentPrompt)
							: null;
					return (
					<div key={message.id} data-message-id={message.id} className={`agent-client-message-row${message.pending ? " agent-client-message-pending" : ""}`}>
						<MemoMessageBubble
							message={message}
							plugin={plugin}
							terminalClient={terminalClient}
							onApprovePermission={onApprovePermission}
							a2ui={a2ui}
							a2uiIsStreamingTurn={
								isSending &&
								messageIndex === messages.length - 1 &&
								message.role === "assistant"
							}
							a2uiMessageIndex={messageIndex}
							toolRunState={toolRunState}
						/>
						{message.pending && (
							<span className="agent-client-pending-label">
								{t("chat.messages.sending")}
							</span>
						)}
						{endStamp !== null && endStamp.kind !== "none" && (
							<TimeStamp
								at={endStamp.at}
								variant="end"
								endKind={endStamp.kind}
								durationMs={endStamp.kind === "failed" ? null : endStamp.durationMs}
							/>
						)}
					</div>
					);
				})}
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
				<TurnStatusLine hasActivePermission={hasActivePermission} />
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
 *
 * I358: the pill renders only while the view isn't at the bottom, so it
 * unmounts while focused whenever a keyboard user activates it (Enter,
 * Space), scrolls to the bottom from it (End, PageDown), or a send or a
 * re-pin reaches the bottom. Its unmount hands focus to this tab's composer
 * instead of letting it fall to the body. React runs this layout cleanup
 * before it removes the button, so the focus check sees real focus.
 */
function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
	const btnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (btnRef.current) {
			setIcon(btnRef.current, "chevron-down");
		}
	}, []);

	useLayoutEffect(() => {
		const btn = btnRef.current;
		return () => {
			if (!btn || btn.ownerDocument.activeElement !== btn) return;
			scheduleViewRefocus(
				btn.closest<HTMLElement>(".agent-client-chat-view-container"),
			);
		};
	}, []);

	return (
		<button
			ref={btnRef}
			type="button"
			className="clickable-icon agent-client-scroll-to-bottom"
			aria-label={t("chat.messages.jumpToLatest")}
			// A pointer press keeps focus where it was (usually the composer):
			// Chromium would focus the button, which unmounts on the click's
			// re-render (scrollToBottom sets isAtBottom synchronously).
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
		/>
	);
}

interface JumpToReplyStartAnchorProps {
	targetKind: ReplyStartTargetKind;
	targetMessageId: string | null;
	isSending: boolean;
	isAcquiring: boolean;
	/** Stable: jump to `el`; `viaKeyboard` moves focus to it too. */
	onJump: (el: HTMLElement, viaKeyboard: boolean) => void;
	/** Stable ref object owned by MessageList (its command path reads it). */
	wrapperRef: React.RefObject<HTMLDivElement>;
}

/**
 * Jump to start of latest reply: a zero-height sticky wrapper at the top
 * of the scroll element, holding the up button. Owns the visibility
 * observer and its state, so an observer report or a button toggle
 * re-renders only this component, never MessageList's rows. Rendered
 * first in both the empty and the populated branch; the wrapper always
 * renders, only the button is conditional.
 *
 * Visibility: one IntersectionObserver on the target, with a root that is
 * the half-plane above the list's top edge, so `isIntersecting` means "the
 * target's top is above the edge" and every crossing reports. It observes
 * only while idle and not acquiring the session; the cleanup resets the
 * observation, so a value can't carry over a send, a tab switch or a new
 * target. The `live` flag drops entries an old observer had queued.
 */
const JumpToReplyStartAnchor = memo(function JumpToReplyStartAnchor({
	targetKind,
	targetMessageId,
	isSending,
	isAcquiring,
	onJump,
	wrapperRef,
}: JumpToReplyStartAnchorProps) {
	const target = replyStartTargetFromParts(targetKind, targetMessageId);
	const [observed, setObserved] = useState<{
		key: string;
		above: boolean;
	} | null>(null);

	useEffect(() => {
		if (isSending || isAcquiring) return;
		const current = replyStartTargetFromParts(targetKind, targetMessageId);
		if (current.kind === "none") return;
		const key = replyStartTargetKey(current);
		const wrapper = wrapperRef.current;
		const scrollEl = wrapper?.parentElement;
		const el = findReplyStartElement(wrapper?.nextElementSibling, current);
		if (!scrollEl || !el) return;
		let live = true;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!live) return;
				const entry = entries[entries.length - 1];
				if (!entry) return;
				const above = entry.isIntersecting;
				setObserved((prev) =>
					prev !== null && prev.key === key && prev.above === above
						? prev
						: { key, above },
				);
			},
			{ root: scrollEl, rootMargin: "100000px 0px -100% 0px", threshold: 0 },
		);
		observer.observe(el);
		return () => {
			live = false;
			observer.disconnect();
			setObserved(null);
		};
	}, [isSending, isAcquiring, targetKind, targetMessageId, wrapperRef]);

	const visible = deriveJumpButtonVisible({
		isSending,
		isAcquiring,
		target,
		observed,
	});

	const onActivate = useCallback(
		(viaKeyboard: boolean) => {
			const el = findReplyStartElement(
				wrapperRef.current?.nextElementSibling,
				replyStartTargetFromParts(targetKind, targetMessageId),
			);
			if (el) onJump(el, viaKeyboard);
		},
		[onJump, targetKind, targetMessageId, wrapperRef],
	);

	return (
		<div ref={wrapperRef} className="agent-client-jump-to-reply-start-anchor">
			{visible && <JumpToReplyStartButton onActivate={onActivate} />}
		</div>
	);
});

/**
 * The up chevron. Its own component with a stable ref for setIcon, like
 * ScrollToBottomButton (inline callback refs with setIcon swallow clicks,
 * I7). A pointer press keeps focus where it was (usually the composer);
 * keyboard activation is reported so focus can follow the jump.
 */
function JumpToReplyStartButton({
	onActivate,
}: {
	onActivate: (viaKeyboard: boolean) => void;
}) {
	const btnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (btnRef.current) {
			setIcon(btnRef.current, "chevron-up");
		}
	}, []);

	return (
		<button
			ref={btnRef}
			type="button"
			className="clickable-icon agent-client-jump-to-reply-start"
			aria-label={t("chat.messages.jumpToReplyStart")}
			onMouseDown={(event) => event.preventDefault()}
			// Keyboard path: Enter/Space (detail 0), or a click on a button
			// Tab had focused (a pointer press never focuses it, see above).
			// Either way focus would fall to the body when it unmounts, so it
			// moves to the reply instead.
			onClick={(event) =>
				onActivate(
					event.detail === 0 ||
						event.currentTarget.ownerDocument.activeElement ===
							event.currentTarget,
				)
			}
		/>
	);
}
