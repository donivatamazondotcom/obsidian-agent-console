/**
 * Rebuild a settings sub-page without losing its scroll position (I215).
 *
 * Clicking a toggle focuses its hidden checkbox. When the page then redraws
 * (`empty()` + rebuild), the focused element is removed and Chromium resets
 * the page scroller to the top. Capture the nearest scrolling ancestor's
 * position before the rebuild and restore it after — one join point that
 * covers every caller of a sub-page redraw.
 *
 * The scroller is the `.setting-page` that wraps the page's containerEl on
 * Obsidian 1.13+ declarative settings; fall back to the direct parent.
 */
export function redrawPreservingScroll(
	containerEl: HTMLElement,
	redraw: () => void,
): void {
	const scroller =
		containerEl.closest<HTMLElement>(".setting-page") ??
		containerEl.parentElement;
	const scrollTop = scroller?.scrollTop ?? 0;
	redraw();
	if (scroller && scroller.scrollTop !== scrollTop) {
		scroller.scrollTop = scrollTop;
	}
}
