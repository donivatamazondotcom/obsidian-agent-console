/**
 * I74: decision logic for the "Toggle active note as default context" command.
 *
 * The command (id `toggle-auto-mention`, kept stable so the user's hotkey
 * survives) flips the per-chat `autoDefaultSuppressed` flag. When suppressed,
 * the active note no longer auto-pins as default context on first send
 * (see useChatActions auto-default block, Decision #26 / I68).
 *
 * Kept as a pure function so the user-facing wording (which direction means
 * "will" vs "won't" auto-pin — easy to invert) is unit-tested.
 */
export function toggleActiveNoteDefault(suppressed: boolean): {
	suppressed: boolean;
	notice: string;
} {
	const next = !suppressed;
	return {
		suppressed: next,
		notice: next
			? "[Agent Console] Active note won't auto-pin as context for this chat"
			: "[Agent Console] Active note will auto-pin as context for this chat",
	};
}
