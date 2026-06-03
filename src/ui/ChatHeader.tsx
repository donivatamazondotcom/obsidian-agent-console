import * as React from "react";
const { useRef, useEffect, useState } = React;
import { setIcon } from "obsidian";

// ============================================================================
// Types
// ============================================================================

/**
 * Layered branding segments rendered in the header title row.
 *
 * See `Agent Console Header Branding` spec. Plugin and profile are always
 * present (client-sourced); runtime and model are null while the session is
 * connecting (ACP-sourced, populated after `initialize` and `session/new`
 * respectively). When both are null, the renderer shows a single
 * "Connecting…" placeholder in the secondary slot.
 */
export interface HeaderSegments {
	/** Plugin name from manifest (e.g. "Agent Console"); rendered in literal brackets. */
	plugin: string;
	/** Profile display name (e.g. "Auto-SA"); the which-configuration signal. */
	profile: string;
	/** Runtime title + version (e.g. "Kiro CLI Agent 2.4.0"); null while connecting. */
	runtime: string | null;
	/** Active model display name (e.g. "claude-opus-4.7"); null while connecting. */
	model: string | null;
	/** Whether the tab is in lazy-idle state (no connection attempted yet) */
	isLazyIdle?: boolean;
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
	/** Layered branding segments for the title row (Plugin · Profile · Runtime · Model) */
	headerSegments: HeaderSegments;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to show the header menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
	/** Callback to open session history */
	onOpenHistory?: () => void;
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
}: {
	icon: string;
	label: string;
	onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (ref.current) {
			setIcon(ref.current, icon);
		}
	}, [icon]);

	return (
		<div
			ref={ref}
			className="clickable-icon nav-action-button"
			aria-label={label}
			onClick={onClick}
		/>
	);
}

/**
 * Maps measured container width to a truncation tier.
 *
 * Thresholds correspond to the truncation order documented in the
 * `Agent Console Header Branding` spec § Truncation behavior. Sized for the
 * REAL available space in the title row — which is `sidebar_width - update_pill -
 * 4_buttons - paddings`, not the sidebar width itself. With four nav buttons
 * and an optional "Plugin update available" pill, the title typically gets
 * 100-260px even at full sidebar width.
 *
 *   wide   (≥280px): `[Plugin] Profile · Model`
 *   medium (≥180px): `Profile · Model`            (drop plugin prefix)
 *   narrow (≥120px): `Profile · Model`            (model truncates via ellipsis)
 *   tight  (<120px): `Profile · Model`            (model harder-truncated)
 *
 * The renderer uses CSS to gate visibility per tier (display: none on the
 * dropped segments) so layout stays purely declarative. Runtime segment is
 * not in v0 — it lives in the hover tooltip only (see spec § Decisions #11).
 */
function widthToTier(width: number): "wide" | "medium" | "narrow" | "tight" {
	if (width >= 280) return "wide";
	if (width >= 180) return "medium";
	if (width >= 120) return "narrow";
	return "tight";
}

/**
 * Hook: observes a container's width via ResizeObserver and returns the
 * matching truncation tier. Tier changes trigger a render so the parent
 * can swap a CSS class on the container.
 *
 * Important: the ref must point at the FLEX-SHRINKING parent (the title
 * slot), not the inner BrandedTitle span. The parent's contentRect.width
 * reflects what's actually available after sibling buttons and the update
 * pill take their share — which is what truncation needs to react to.
 *
 * Defaults to "wide" before the first observation so the initial paint
 * shows the full layout when there's room for it.
 */
function useHeaderWidthTier(
	ref: React.RefObject<HTMLElement>,
): "wide" | "medium" | "narrow" | "tight" {
	const [tier, setTier] = useState<
		"wide" | "medium" | "narrow" | "tight"
	>("wide");

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const width = entry.contentRect.width;
			setTier((prev) => {
				const next = widthToTier(width);
				return prev === next ? prev : next;
			});
		});

		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);

	return tier;
}

/**
 * Renders the three-segment branded header title (v0 scope).
 *
 * Layout: [Plugin] Profile · Model
 *
 * Visual treatment:
 *   - Primary segments (plugin prefix, profile) use default text color
 *   - Secondary segment (model) uses --text-muted
 *   - When `model` is null (session connecting), shows a single "Connecting…"
 *     placeholder in the secondary slot
 *
 * Truncation: the parent slot (passed via `widthRef`) is observed for width;
 * a CSS class `.acp-header-branded--{tier}` on this element toggles visibility
 * of the plugin prefix and tightens the model ellipsis. Profile name is
 * always visible — the only signal that distinguishes one configured profile
 * from another.
 *
 * Runtime version (e.g. "Kiro CLI Agent 2.4.0") is intentionally NOT in the
 * visible header for v0 — it's surfaced via the `title` tooltip on the
 * outer span. See spec § Decisions #10 (v0 / v0.1 split) and #11 (runtime
 * deferred to tooltip).
 *
 * Model segment reads the optimistic `currentModelId` value via the parent's
 * `headerSegments`. v0.1 will plumb a `confirmedModelId` so the header
 * becomes a true post-ack confirmation surface (see spec Decisions #8 and #10).
 */
function BrandedTitle({
	segments,
	widthRef,
}: {
	segments: HeaderSegments;
	widthRef: React.RefObject<HTMLElement>;
}) {
	const tier = useHeaderWidthTier(widthRef);

	const showPlugin = tier === "wide";
	const showModel = !!segments.model;
	const showConnectingPlaceholder = !segments.model && !segments.isLazyIdle;
	const showIdlePlaceholder = !segments.model && !!segments.isLazyIdle;

	const rootClass = `acp-header-branded acp-header-branded--${tier}`;

	return (
		<span className={rootClass}>
			{showPlugin && (
				<span className="acp-header-branded-plugin">
					[{segments.plugin}]
				</span>
			)}
			<span className="acp-header-branded-profile">
				{segments.profile}
			</span>
			{showModel && segments.model && (
				<>
					<span
						className="acp-header-branded-sep"
						aria-hidden="true"
					>
						{" · "}
					</span>
					<span className="acp-header-branded-model">
						{segments.model}
					</span>
				</>
			)}
			{showConnectingPlaceholder && (
				<>
					<span
						className="acp-header-branded-sep"
						aria-hidden="true"
					>
						{" · "}
					</span>
					<span className="acp-header-branded-connecting">
						Connecting…
					</span>
				</>
			)}
			{showIdlePlaceholder && (
				<>
					<span
						className="acp-header-branded-sep"
						aria-hidden="true"
					>
						{" · "}
					</span>
					<span className="acp-header-branded-connecting">
						Not connected
					</span>
				</>
			)}
		</span>
	);
}

/**
 * Builds the multi-line tooltip text shown on header hover.
 *
 * Surfaces all four segments (plugin, profile, runtime, model) plus version
 * info. Returns a plain string so the browser renders it via the native
 * `title` attribute — no popover, no positioning, no extra DOM. Lines marked
 * "Connecting…" appear when the corresponding ACP segment isn't ready yet.
 */
function buildHeaderTooltip(segments: HeaderSegments): string {
	const lines = [
		`Plugin:  ${segments.plugin}`,
		`Profile: ${segments.profile}`,
		`Runtime: ${segments.runtime ?? "Connecting…"}`,
		`Model:   ${segments.model ?? "Connecting…"}`,
	];
	return lines.join("\n");
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
	onNewChat,
	onExportChat,
	onShowMenu,
	onOpenHistory,
}: ChatHeaderProps) {
	const titleSlotRef = useRef<HTMLSpanElement>(null);
	const tooltip = buildHeaderTooltip(headerSegments);
	return (
		<div className="nav-header agent-client-chat-view-header">
			<div className="nav-buttons-container">
				<span
					ref={titleSlotRef}
					className="agent-client-chat-view-header-title"
					title={tooltip}
				>
					<BrandedTitle
						segments={headerSegments}
						widthRef={titleSlotRef}
					/>
				</span>
				{isUpdateAvailable && (
					<span className="agent-client-chat-view-header-update">
						Plugin update available!
					</span>
				)}
				<NavActionButton
					icon="refresh-cw"
					label="New chat"
					onClick={onNewChat}
				/>
				{onOpenHistory && (
					<NavActionButton
						icon="history"
						label="Session history"
						onClick={onOpenHistory}
					/>
				)}
				<NavActionButton
					icon="save"
					label="Export chat to Markdown"
					onClick={onExportChat}
				/>
				<NavActionButton
					icon="more-vertical"
					label="More"
					onClick={onShowMenu}
				/>
			</div>
		</div>
	);
}
