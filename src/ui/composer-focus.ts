/**
 * Focus helper for the composer textarea.
 *
 * Extracted from InputArea's mount auto-focus effect so the caret-placement
 * behaviour is unit-testable without mounting the full InputArea (which has
 * ~40 props and heavy plugin/AcpClient/view dependencies).
 *
 * Places the caret at the END of the textarea's current value. A textarea
 * focused with a pre-filled value (a restored unsent draft, #94) otherwise
 * defaults its caret to index 0, leaving the user at the START of their draft
 * (TP-I03). For an empty composer, end === 0, so behaviour is unchanged.
 */
export function focusComposerAtEnd(el: HTMLTextAreaElement | null): void {
	if (!el) return;
	el.focus();
	const end = el.value.length;
	el.setSelectionRange(end, end);
}


/** CSS selector for a chat composer textarea. */
const COMPOSER_SELECTOR = "textarea.agent-client-chat-input-textarea";

/**
 * Focus the composer for the ACTIVE tab within a chat view container, caret at
 * end.
 *
 * Why this exists (I136): the view-activate / Open-chat path focused the
 * composer with `containerEl.querySelector(COMPOSER_SELECTOR)`, which returns
 * the FIRST match in the DOM. Tabs are kept mounted with inactive ones hidden
 * via an inline `display:none` on the per-tab wrapper (I19), so first-match
 * focuses a BACKGROUND tab's composer and the user is never dropped into the
 * active composer. This selects the composer with no `display:none` ancestor
 * (the active tab), falling back to the first match when none is clearly
 * visible (e.g. a single freshly-mounted tab), then reuses focusComposerAtEnd.
 */
export function focusActiveTabComposer(container: HTMLElement): void {
	const composers = Array.from(
		container.querySelectorAll<HTMLTextAreaElement>(COMPOSER_SELECTOR),
	);
	const active =
		composers.find((el) => !isHiddenByDisplay(el)) ?? composers[0] ?? null;
	focusComposerAtEnd(active);
}

/** True when the element or any ancestor is hidden via an inline display:none. */
function isHiddenByDisplay(el: HTMLElement): boolean {
	let node: HTMLElement | null = el;
	while (node) {
		if (node.style?.display === "none") return true;
		node = node.parentElement;
	}
	return false;
}
