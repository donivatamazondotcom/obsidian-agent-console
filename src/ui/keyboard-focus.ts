/**
 * Whether an element got focus from the keyboard (`:focus-visible`), not a
 * mouse click. Chromium focuses a native button on mousedown; the vertical
 * tab rail opens its flyout only for keyboard focus, so a click can't pin it
 * open. One helper so tests can stub it (jsdom's `:focus-visible` is a
 * heuristic).
 */
export function isKeyboardFocus(el: Element): boolean {
	try {
		return el.matches(":focus-visible");
	} catch {
		return false;
	}
}
