/**
 * Vertical tab rail – width rules ([[Agent Console Vertical Tab Rail]]
 * § Width resolver).
 *
 * One pure module for the live drag preview, the committed value and the
 * per-render clamp, so the three can never disagree. Widths are whole pixels:
 * a drag's fractional `clientX` is rounded here, so the stored value passes
 * the settings validator on the next load.
 *
 * Pure and total: no React, no Obsidian, never throws.
 */

/** Icon-only rail width. */
export const RAIL_ICON_WIDTH = 32;
/** Released below this, the rail snaps back to icon-only. */
export const RAIL_SNAP_BELOW = 46;
/** Narrowest width that shows names. */
export const RAIL_NAMED_MIN = 60;
/** Widest the rail gets. */
export const RAIL_NAMED_MAX = 260;
/** The chat beside the rail never gets narrower than this. */
export const CHAT_MIN_WIDTH = 160;
/** Arrow-key step on the resize handle. */
export const RAIL_KEY_STEP = 10;
/** Default width the toggle returns to before the user picks one. */
export const RAIL_DEFAULT_NAMED_WIDTH = 160;

/**
 * Close button (I301): named keys this wide or wider show a hover-only ×,
 * overlaid on the end of the name. Below this the label would be squeezed to
 * almost nothing, so the key stays label-only (and icon-only rails never get one).
 */
export const RAIL_CLOSE_MIN = 100;
/** The × button's size. */
export const RAIL_CLOSE_BUTTON_PX = 24;
/** Gap between the × and the row's trailing edge. */
export const RAIL_CLOSE_INSET_PX = 4;
/** Width of the fade drawn left of the ×, over the end of the name. */
export const RAIL_CLOSE_FADE_PX = 12;
/** The key's own trailing padding (`styles.css`, `.agent-client-tab-rail-key`). */
const RAIL_KEY_PAD_END_PX = 6;
/**
 * How much of the label's box the overlay (inset + × + fade) covers while it
 * shows. The truncation check subtracts it, so a name that ends under the ×
 * still gets its flyout. TabRail writes the fade width to CSS from the same
 * constants, so the check and the drawing can't drift.
 */
export const RAIL_CLOSE_OVERLAY_PX =
	RAIL_CLOSE_INSET_PX + RAIL_CLOSE_BUTTON_PX + RAIL_CLOSE_FADE_PX - RAIL_KEY_PAD_END_PX;

/** Whether a rail rendered at `width` shows the close button on hover. */
export function showsCloseButton(width: number): boolean {
	return Number.isFinite(width) && width >= RAIL_CLOSE_MIN;
}

export type RailWidth =
	| { mode: "icons"; width: typeof RAIL_ICON_WIDTH }
	| { mode: "names"; width: number };

const ICONS: RailWidth = { mode: "icons", width: RAIL_ICON_WIDTH };

/** Widest named width that still leaves the chat its minimum. */
export function maxNamedWidth(viewWidth: number): number {
	if (!Number.isFinite(viewWidth)) return RAIL_NAMED_MIN - 1;
	return Math.min(RAIL_NAMED_MAX, Math.floor(viewWidth - CHAT_MIN_WIDTH));
}

/** Snap and clamp a requested width against the current view width. */
export function resolveRailWidth({
	requested,
	viewWidth,
}: {
	requested: number;
	viewWidth: number;
}): RailWidth {
	if (!Number.isFinite(requested) || !Number.isFinite(viewWidth)) {
		return ICONS;
	}
	const max = maxNamedWidth(viewWidth);
	if (max < RAIL_NAMED_MIN) return ICONS;
	if (requested < RAIL_SNAP_BELOW) return ICONS;
	const width = Math.min(max, Math.max(RAIL_NAMED_MIN, Math.round(requested)));
	return { mode: "names", width };
}

export type RailKeyResult = { kind: "set"; width: number } | { kind: "none" };

const NONE: RailKeyResult = { kind: "none" };

/**
 * Resize-handle arrow keys. Steps start from the RENDERED width, so every
 * press visibly moves the rail. ← widens (the handle sits on the rail's left
 * edge and moves left), → narrows. Icons ↔ 60 are explicit jumps: a plain
 * ±10 from 32 would snap straight back to icons.
 */
export function nextRailWidthFromKey({
	rendered,
	key,
	viewWidth,
}: {
	rendered: number;
	key: string;
	viewWidth: number;
}): RailKeyResult {
	const current = resolveRailWidth({ requested: rendered, viewWidth });
	if (key === "ArrowLeft") {
		if (maxNamedWidth(viewWidth) < RAIL_NAMED_MIN) return NONE;
		const target =
			current.mode === "icons" ? RAIL_NAMED_MIN : current.width + RAIL_KEY_STEP;
		const next = resolveRailWidth({ requested: target, viewWidth });
		return next.width === current.width ? NONE : { kind: "set", width: next.width };
	}
	if (key === "ArrowRight") {
		if (current.mode === "icons") return NONE;
		if (current.width <= RAIL_NAMED_MIN) {
			return { kind: "set", width: RAIL_ICON_WIDTH };
		}
		const next = resolveRailWidth({
			requested: current.width - RAIL_KEY_STEP,
			viewWidth,
		});
		return { kind: "set", width: next.width };
	}
	return NONE;
}

/**
 * Double-click / Enter on the handle. Leaving names records the STORED width
 * (not the clamped one on screen), so a narrow sidebar today never shrinks the
 * width the user picked. Both keys are returned for one settings write.
 */
export function toggleRailWidth({
	stored,
	namedWidth,
}: {
	stored: number;
	namedWidth: number;
	viewWidth: number;
}): { tabRailWidth: number; tabRailNamedWidth: number } {
	if (stored >= RAIL_NAMED_MIN) {
		return { tabRailWidth: RAIL_ICON_WIDTH, tabRailNamedWidth: stored };
	}
	return { tabRailWidth: namedWidth, tabRailNamedWidth: namedWidth };
}
