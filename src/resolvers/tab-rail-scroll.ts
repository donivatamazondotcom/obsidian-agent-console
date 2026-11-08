/**
 * Vertical tab rail – keep the active key in view by scrolling only the key
 * list. `scrollIntoView` would also scroll every scrollable ancestor; the
 * strip avoids that the same way with `deriveTabScrollLeft`.
 *
 * Pure and total. Inputs are viewport rects plus the list's current
 * `scrollTop`; returns the new `scrollTop` (never negative).
 */
export interface RailScrollInput {
	listTop: number;
	listBottom: number;
	keyTop: number;
	keyBottom: number;
	scrollTop: number;
}

export function deriveRailScrollTop({
	listTop,
	listBottom,
	keyTop,
	keyBottom,
	scrollTop,
}: RailScrollInput): number {
	let next = scrollTop;
	if (keyTop < listTop || keyBottom - keyTop > listBottom - listTop) {
		next = scrollTop + (keyTop - listTop);
	} else if (keyBottom > listBottom) {
		next = scrollTop + (keyBottom - listBottom);
	}
	return Math.max(0, next);
}
