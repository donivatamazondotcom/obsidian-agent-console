/**
 * `deriveTabScrollLeft` — pure resolver for the horizontal `scrollLeft` that
 * keeps the active tab fully within the tab strip's visible area.
 *
 * WHY THIS EXISTS
 * The active tab must stay in view not only when it changes, but whenever the
 * strip resizes — dragging the sidebar narrower must not push the active tab
 * off the right edge (TS-I07). Both the active-tab-change effect and the
 * ResizeObserver in `TabBar` feed the current container/tab geometry through
 * this one function so the scroll behaviour can't drift between them.
 *
 * Contained by design: it only computes THIS strip's `scrollLeft`. (The
 * platform `Element.scrollIntoView({ inline: "nearest" })` was considered but
 * rejected — it scrolls every scrollable ancestor, which could jostle the pane
 * or workspace; adjusting only the strip's own scrollLeft is safer.)
 *
 * All coordinates are viewport px (from `getBoundingClientRect`). Since the
 * active tab is always sized to fit the strip (see `deriveActiveTabLabelMax`),
 * revealing one edge never hides the other. Pure: no React, no Obsidian.
 * Total: never throws; result floored at 0 (the DOM clamps the upper bound).
 */

export interface TabScrollInput {
	/** Left edge of the scroll container, viewport px. */
	containerLeft: number;
	/** Right edge of the scroll container, viewport px. */
	containerRight: number;
	/** Left edge of the active tab, viewport px. */
	tabLeft: number;
	/** Right edge of the active tab, viewport px. */
	tabRight: number;
	/** Current scrollLeft of the container, px. */
	scrollLeft: number;
}

export function deriveTabScrollLeft({
	containerLeft,
	containerRight,
	tabLeft,
	tabRight,
	scrollLeft,
}: TabScrollInput): number {
	// Off the left edge → scroll left to reveal the tab's left edge.
	if (tabLeft < containerLeft) {
		return Math.max(0, scrollLeft - (containerLeft - tabLeft));
	}
	// Off the right edge (e.g. the strip just shrank around it) → scroll right
	// so the tab's right edge meets the strip's right edge.
	if (tabRight > containerRight) {
		return Math.max(0, scrollLeft + (tabRight - containerRight));
	}
	// Already fully visible — don't move.
	return scrollLeft;
}
