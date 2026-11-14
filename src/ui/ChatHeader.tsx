import * as React from "react";
import type { HeaderAgent, HeaderEngine } from "../resolvers/header-agent";
import type { HeaderAgentExtra, HeaderExtras } from "../resolvers/header-extras";
const { useRef, useEffect } = React;
import { setIcon, setTooltip } from "obsidian";
import { SharedLinksButton } from "./SharedLinksButton";
import { useTooltip } from "./shared/useTooltip";
import type { SharedLink } from "../utils/link-extract";
import { t } from "../i18n";

// ============================================================================
// Types
// ============================================================================

/**
 * What the header title row shows: the chat's title, then grey extras
 * (`deriveHeaderExtras`) — only what the composer doesn't already show, plus
 * the "agent didn't load" warning. No lifecycle state: connecting / asleep
 * live in the tab's status icon. The other fields feed the hover tooltip.
 *
 * Spec: [[Session Title in the Chat Header]].
 */
export interface HeaderSegments {
	/** The hosting tab's label — the chat's title. */
	title: string;
	/** The title is still the tab's default "<agent> <time>" name. */
	titleIsDefault: boolean;
	/** Grey text after the title (`deriveHeaderExtras`). */
	extras: HeaderExtras;
	/** Configured agent display name (e.g. "Auto SA"); tooltip Agent line. */
	profile: string;
	/** Engine the tab runs on (`deriveHeaderEngine`); tooltip only. */
	engine: HeaderEngine;
	/** Model display name (`deriveHeaderModelName`); tooltip Model line. */
	model: string | null;
	/** Current effort level name (`deriveHeaderEffort`); tooltip only. */
	effort: string | null;
	/** Current mode name, non-Kiro agents only (`deriveHeaderMode`); tooltip only. */
	mode: string | null;
	/** The tab's folder (`deriveHeaderFolder`); tooltip only. */
	folder: string | null;
	/**
	 * Session acquisition is in flight (lazySession.state === "connecting").
	 * The tooltip's Engine and Model lines read "Connecting…" meanwhile (I80).
	 */
	isConnecting?: boolean;
	/** Which agent is running vs the configured one (I207); tooltip status line. */
	agent?: HeaderAgent;
}

// ============================================================================
// Props Types
// ============================================================================

/**
 * Props for ChatHeader
 */
export interface ChatHeaderProps {
	/** Display name of the active agent (used for OS notifications and tab labels) */
	agentLabel: string;
	/** Title row: the chat title, grey extras, and the tooltip's lines */
	headerSegments: HeaderSegments;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Callback invoked when the "update available" pill is clicked. */
	onUpdateClick: () => void;
	/** Callback to reload the session. `hard` = fresh restart (Shift-click). */
	onReload: (hard: boolean) => void;
	/** True while a reload is in progress — spins the ↻ icon for feedback. */
	isReloading?: boolean;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to show the header menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLElement>) => void;
	/** Callback to open session history */
	onOpenHistory?: () => void;
	/** Links the agent has shared in the active tab (Shared Links Bubble). */
	sharedLinks?: SharedLink[];
	/** Open a shared link; the DOM event carries open-in-new-tab modifiers. */
	onOpenSharedLink?: (
		link: SharedLink,
		evt: MouseEvent | KeyboardEvent,
	) => void;
}

// ============================================================================
// Internal Components
// ============================================================================

/**
 * A single action button matching Obsidian's nav-action-button pattern.
 * Uses setIcon() to render Lucide icons identically to native sidebar buttons.
 */
function NavActionButton({
	icon,
	label,
	onClick,
	spinning,
	focusCluster,
}: {
	icon: string;
	label: string;
	onClick: (e: React.MouseEvent<HTMLElement>) => void;
	spinning?: boolean;
	/** Tag this control as a composer focus-cluster member (data attr). */
	focusCluster?: boolean;
}) {
	const ref = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (ref.current) {
			setIcon(ref.current, icon);
		}
	}, [icon]);

	return (
		<button
			ref={ref}
			type="button"
			{...(focusCluster ? { "data-acp-focus-cluster": "" } : {})}
			className={
				"clickable-icon nav-action-button" +
				(spinning ? " agent-client-reload-spinning" : "")
			}
			aria-label={label}
			onClick={onClick}
		/>
	);
}

/**
 * The update pill. It reads a short "Update" and never shrinks, so it is
 * never cut to a scrap of text in a narrow header; "Plugin update available!"
 * leads its tooltip (Session Title in the Chat Header, Decision 14). Rendered
 * as a real <button> so it gets native focus and Enter/Space activation, and
 * deep-links into Obsidian's own updater (Settings → Community plugins). We
 * do NOT self-update — see the `Agent Console Update Pill Click-Through` spec
 * § Why not self-update (reloading tears down every live ACP session).
 *
 * The tooltip goes through useTooltip so the accessible name starts with the
 * visible word (label-in-name, I199).
 */
function UpdatePill({ onClick }: { onClick: () => void }) {
	const ref = useRef<HTMLButtonElement>(null);
	const label = t("chat.header.updatePill");
	useTooltip(ref, { visibleLabel: label, reason: t("chat.header.updateTooltip") });

	return (
		<button
			ref={ref}
			type="button"
			className="agent-client-chat-view-header-update"
			onClick={onClick}
		>
			{label}
		</button>
	);
}

function Sep({ text }: { text: string }) {
	return (
		<span className="acp-header-branded-sep" aria-hidden="true">
			{text}
		</span>
	);
}

function AgentExtra({ agent }: { agent: HeaderAgentExtra }) {
	switch (agent.kind) {
		case "label":
			return <span className="acp-header-branded-profile">{agent.label}</span>;
		case "switched":
			return (
				<>
					<span className="acp-header-branded-profile">{agent.label}</span>
					<Sep text={" › "} />
					<span className="acp-header-branded-running">{agent.running}</span>
				</>
			);
		case "notLoaded":
			// The requested agent could never be chosen: struck through, then
			// the agent actually running. The tooltip spells it out, so the
			// strikethrough is never the only signal (I207).
			return (
				<>
					<del className="acp-header-branded-profile">{agent.label}</del>
					<Sep text={" "} />
					<span className="acp-header-branded-running">{agent.running}</span>
				</>
			);
	}
}

/**
 * The header title row's text: the chat title, then the grey extras group.
 *
 * Narrow-header order (pure CSS, `styles.css` § header title): the extras
 * group gives up width first, then the title. With the "agent didn't load"
 * warning showing, the title gives way first (down to 3em) so the warning is
 * the last text cut. The root stays shrink-wrapped (inline-flex) so the
 * tooltip hangs off the text, not the whole slot (I247 smoke H4).
 */
function BrandedTitle({
	segments,
	tooltip,
}: {
	segments: HeaderSegments;
	tooltip: string;
}) {
	const textRef = useRef<HTMLSpanElement>(null);

	// The tooltip hangs off the header TEXT, not the full-width title slot,
	// because Obsidian centers a tooltip on its target: on the slot it opened
	// far from the pointer. `acp-header-tooltip` left-aligns its lines
	// (I247 smoke H4). `aria-label` is also set in JSX so the label is there
	// on the first render.
	useEffect(() => {
		if (textRef.current) {
			setTooltip(textRef.current, tooltip, {
				placement: "bottom",
				classes: ["acp-header-tooltip"],
			});
		}
	}, [tooltip]);

	const { agent, model } = segments.extras;
	const warning = agent?.kind === "notLoaded";
	const rootClass = `acp-header-branded${warning ? " acp-header-branded--warning" : ""}`;

	return (
		<span ref={textRef} className={rootClass} aria-label={tooltip}>
			<span className="acp-header-branded-title">{segments.title}</span>
			{(agent || model) && (
				<span className="acp-header-branded-extras">
					<Sep text={" · "} />
					{agent && <AgentExtra agent={agent} />}
					{agent && model && <Sep text={" · "} />}
					{model && <span className="acp-header-branded-model">{model}</span>}
				</span>
			)}
		</span>
	);
}

/**
 * Builds the multi-line tooltip text shown on header hover (I247):
 * Chat (the title), Agent, the I207 status line, Engine, Model, Effort, Mode,
 * Folder. Each line
 * shows only when it applies. Engine and Model read "Connecting…" while the
 * session is genuinely connecting (the I80 gate); Effort and Mode stay hidden
 * until the agent reports them. Plain string, rendered by the native `title`
 * attribute.
 */
function engineLabel(engine: HeaderEngine): string | null {
	switch (engine.kind) {
		case "kiroCli":
			if (engine.reason === "old-cli") {
				return t("chat.header.engineKiroOldCli");
			}
			return t("chat.header.engineKiroCli", {
				engine: t(
					engine.engine === "v3"
						? "settings.kiroEngine.v3"
						: "settings.kiroEngine.v2",
				),
			});
		case "reported":
			return engine.label;
		case "unknown":
			return null;
	}
}

/**
 * One ACP-sourced line that reads "Connecting…" while connecting; once ready,
 * a value the agent never reported is left out.
 */
function connectingLine(
	key: "chat.header.tooltipEngine" | "chat.header.tooltipModel",
	value: string | null,
	segments: HeaderSegments,
): string[] {
	if (value) return [t(key, { value })];
	if (segments.isConnecting) return [t(key, { value: t("chat.header.connecting") })];
	return [];
}

function optionalLine(
	key: "chat.header.tooltipEffort" | "chat.header.tooltipMode" | "chat.header.tooltipFolder",
	value: string | null,
): string[] {
	return value ? [t(key, { value })] : [];
}

function agentStatusLine(agent: HeaderAgent | undefined): string[] {
	if (agent?.kind === "notLoaded") {
		return [
			t("chat.header.tooltipAgentNotLoaded", {
				requested: agent.label,
				running: agent.running,
			}),
		];
	}
	if (agent?.kind === "switched") {
		return [t("chat.header.tooltipAgentSwitched", { running: agent.running })];
	}
	return [];
}

function buildHeaderTooltip(segments: HeaderSegments): string {
	return [
		t("chat.header.tooltipChat", { value: segments.title }),
		t("chat.header.tooltipAgent", { value: segments.profile }),
		...agentStatusLine(segments.agent),
		...connectingLine("chat.header.tooltipEngine", engineLabel(segments.engine), segments),
		...connectingLine("chat.header.tooltipModel", segments.model, segments),
		...optionalLine("chat.header.tooltipEffort", segments.effort),
		...optionalLine("chat.header.tooltipMode", segments.mode),
		...optionalLine("chat.header.tooltipFolder", segments.folder),
	].join("\n");
}

// ============================================================================
// ChatHeader
// ============================================================================

/**
 * Header component for the sidebar chat view.
 *
 * Uses Obsidian's native .nav-header + .nav-buttons-container pattern
 * to match the look of File Explorer, Bookmarks, and other sidebar panes.
 */
export function ChatHeader({
	headerSegments,
	isUpdateAvailable,
	onUpdateClick,
	onReload,
	isReloading,
	onExportChat,
	onShowMenu,
	onOpenHistory,
	sharedLinks,
	onOpenSharedLink,
}: ChatHeaderProps) {
	const tooltip = buildHeaderTooltip(headerSegments);
	return (
		<div className="nav-header agent-client-chat-view-header">
			<div className="nav-buttons-container">
				<span className="agent-client-chat-view-header-title">
					<BrandedTitle segments={headerSegments} tooltip={tooltip} />
				</span>
				{isUpdateAvailable && (
					<UpdatePill onClick={onUpdateClick} />
				)}
				{onOpenSharedLink && (
					<SharedLinksButton
						links={sharedLinks ?? []}
						onOpenLink={onOpenSharedLink}
					/>
				)}
				<NavActionButton
					icon="refresh-cw"
					label={t("chat.header.reloadTooltip")}
					onClick={(e) => onReload(e.shiftKey)}
					spinning={isReloading}
					focusCluster
				/>
				{onOpenHistory && (
					<NavActionButton
						icon="history"
						label={t("chat.header.sessionHistory")}
						onClick={onOpenHistory}
					/>
				)}
				<NavActionButton
					icon="save"
					label={t("chat.header.exportTooltip")}
					onClick={onExportChat}
				/>
				<NavActionButton
					icon="more-vertical"
					label={t("chat.header.more")}
					onClick={onShowMenu}
				/>
			</div>
		</div>
	);
}
