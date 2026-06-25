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
