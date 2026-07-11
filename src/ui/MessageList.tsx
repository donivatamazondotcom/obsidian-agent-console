import * as React from "react";
const { memo, useEffect, useRef, useState } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";
import { LossyFallbackNotice } from "./LossyFallbackNotice";
import { isSessionLive } from "../resolvers/send-affordance";
import {
	deriveEmptyStateView,
	type EmptyStateLocation,
} from "../resolvers/empty-state-view";
import type { TabSessionState } from "../hooks/useTabSessionState";
import { useAutoScrollPin } from "./use-auto-scroll-pin";
import {
	BUILTIN_AGENT_INSTALLS,
	buildInstallCommand,
	docsSetupUrl,
	type BuiltInAgentInstall,
} from "../services/agent-packages";
import type { InstallResult } from "../services/agent-installer";

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
					Setup guide
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
			setError(result.message ?? "The install didn't finish.");
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
				{installing ? "Installing…" : "Install"}
			</button>
			<button
				type="button"
				className="agent-client-install-copy"
				onClick={copyCommand}
			>
				{copied ? "Copied!" : "Copy command"}
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
				Pick an agent to get started
			</div>
			{view.showAgentPicks && (
				<>
					<div className="agent-client-getting-started-subtext">
						Detected on your machine:
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
						No agent is installed yet. Agent Console needs an AI agent
						on your computer –{" "}
						{BUILTIN_AGENT_INSTALLS.map((agent, i) => (
							<React.Fragment key={agent.id}>
								{i > 0 &&
									(i === BUILTIN_AGENT_INSTALLS.length - 1
										? ", or "
										: ", ")}
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
					Open settings
				</button>
			)}
			{view.showRedetect && (
				<button
					type="button"
					className="agent-client-getting-started-redetect"
					onClick={onRedetect}
				>
					Re-detect
				</button>
			)}
			{view.showManualPathHint && (
				<div className="agent-client-getting-started-hint">
					Already have one installed elsewhere? Set its path in settings.
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
	) => Promise<void>;
	/** Whether a permission request is currently pending */
	hasActivePermission: boolean;
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
	isActive = true,
	isFallbackRecovery = false,
	gettingStarted,
}: MessageListProps) {
	// ============================================================
	// Auto-scroll (single owner)
	// ============================================================
	const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
		useAutoScrollPin({ isActive, isSending, view });

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
					{gettingStarted ? (
						<GettingStarted info={gettingStarted} />
					) : (
						<div className="agent-client-chat-empty-state">
							{isRestoringSession
								? "Restoring session..."
								: lazyState === "idle"
									? `Send a message to connect to ${agentLabel}...`
									: !isSessionLive(lazyState)
										? `Connecting to ${agentLabel}...`
										: `Start a conversation with ${agentLabel}...`}
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className="agent-client-chat-view-messages">
			<div ref={contentRef} className="agent-client-chat-content">
				<LossyFallbackNotice
					isFallbackRecovery={isFallbackRecovery}
				/>
				{messages.map((message) => (
					<div key={message.id} className={`agent-client-message-row${message.pending ? " agent-client-message-pending" : ""}`}>
						<MemoMessageBubble
							message={message}
							plugin={plugin}
							terminalClient={terminalClient}
							onApprovePermission={onApprovePermission}
						/>
						{message.pending && (
							<span className="agent-client-pending-label">Sending…</span>
						)}
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
			className="clickable-icon agent-client-scroll-to-bottom"
			onClick={onClick}
		/>
	);
}
