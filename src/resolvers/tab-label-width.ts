/**
 * `deriveActiveTabLabelMax` — pure resolver for the max-width (px) of the
 * ACTIVE tab's label, so the whole active tab (state glyph + label + close
 * button + padding) stays fully visible inside the tab strip.
 *
 * WHY THIS EXISTS
 * The tab strip is content-sized + horizontal-scroll; every tab's label is
 * capped at a fixed width (160px) and truncates with an ellipsis, so the tab
 * the user is actively working in shows a truncated title reachable only via
 * the hover tooltip. The active tab should show its FULL title without a
 * hover — but "full" must be bounded by what the strip can actually show, or
 * a long title in a narrow leaf produces an active tab wider than the whole
 * strip (title + close button can't both be on screen even scrolled into
 * view).
 *
 * This caps the active label to the visible container width minus the tab's
 * fixed chrome and a small peek of the neighboring tabs, floored at the
 * inactive-tab width for readability — except when the panel is too narrow to
 * fit that floor plus the chrome, where the label shrinks below the floor so
 * the close button (part of the chrome) never clips off the strip edge
 * (TS-I06). Titles longer than the leaf can hold fall back to ellipsis + the
 * existing hover tooltip.
 *
 * Pure: no React, no Obsidian. Total: never throws. See
 * [[Greedy active tab label]].
 */

/**
 * Fixed chrome around the label in one tab, in px: padding 16 + glyph 14 +
 * gaps 8 + close button 24 + border-right 1 = 63, plus 1px safety so the close
 * button never sits flush against (or 1px past) the strip edge (TS-I06). All
 * fixed px in styles.css — not theme variables — so this is deterministic
 * across themes.
 */
export const TAB_CHROME_WIDTH = 64;

/**
 * Sliver of the neighboring tabs kept visible for orientation: enough to
 * reveal a neighbor's leading chrome (padding 8 + glyph 14 + gap 4 ≈ 26px)
 * plus a few characters of its label (~20px).
 */
export const TAB_NEIGHBOR_PEEK = 48;

/** Lower bound — the active label is never narrower than the inactive-tab cap. */
export const ACTIVE_LABEL_FLOOR = 160;

export interface ActiveTabLabelMaxInput {
	/** Visible width of the tab-strip scroll container, in px. */
	containerWidth: number;
	/** Fixed chrome around the label in one tab, in px. */
	chromeWidth: number;
	/** Reserved sliver of neighbor tabs kept visible for orientation, in px. */
	peek: number;
	/** Lower bound — the active label is never narrower than this, in px. */
	floor: number;
}

export function deriveActiveTabLabelMax({
	containerWidth,
	chromeWidth,
	peek,
	floor,
}: ActiveTabLabelMaxInput): number {
	// A pre-layout container reports 0 (or a non-finite width in exotic cases);
	// fall back to the floor so the active label is never sized to garbage.
	if (!Number.isFinite(containerWidth)) return floor;
	const available = containerWidth - chromeWidth - peek;
	// Greedy up to the available width, floored for readability — but never so
	// wide that label + chrome exceeds the strip, or the close button (part of
	// the chrome) would clip off the right edge (TS-I06). Chrome visibility wins
	// over both the floor and the neighbor peek: in a panel too narrow to fit
	// floor + chrome, the label shrinks below the floor (more ellipsis) so the
	// whole tab still fits. Never negative.
	const greedy = Math.max(floor, available);
	return Math.max(0, Math.min(greedy, containerWidth - chromeWidth));
}
