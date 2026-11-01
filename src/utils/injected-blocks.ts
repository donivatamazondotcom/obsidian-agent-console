/**
 * Primitives for removing plugin-injected prompt blocks from the head of a
 * replayed user message (I222 / I228).
 *
 * On `session/load` an agent replays the prompt it received, including every
 * block the plugin wrapped around the user's words. The builders that inject
 * those blocks each export a matching "take one leading block" function built
 * on these primitives, next to the builder, so a builder and its stripper can
 * not drift. `services/message-sender.ts` `stripInjectedPromptText` composes
 * them at the trust boundary (message-state's `user_message_chunk` case).
 *
 * Every primitive matches a COMPLETE block at the very start of the text and
 * returns the remainder, or null when nothing matched. An incomplete block
 * (a chunk boundary inside it) never matches, so a block split across chunks
 * is removed once its closing half arrives. Pure and total.
 */

/** Text after one leading separator run (the "\n" Kiro V3 joins blocks with). */
function afterSeparator(text: string): string {
	return text.replace(/^[ \t]*(?:\r?\n)*/, "");
}

/**
 * Remove one leading `<tag …>…</tag>` block whose tag is in `tags`.
 * Returns the remainder, or null when the head is not such a complete block.
 */
export function takeLeadingWrappedBlock(
	text: string,
	tags: readonly string[],
): string | null {
	const head = text.trimStart();
	const open = /^<([A-Za-z_][\w-]*)(?=[\s>])[^>]*>/.exec(head);
	if (!open || !tags.includes(open[1])) return null;
	const close = `</${open[1]}>`;
	const end = head.indexOf(close, open[0].length);
	if (end < 0) return null;
	return afterSeparator(head.slice(end + close.length));
}

/**
 * Remove one leading sentence matched by `pattern` (which must be anchored
 * with `^`). Returns the remainder, or null when the head does not match.
 */
export function takeLeadingSentence(
	text: string,
	pattern: RegExp,
): string | null {
	const head = text.trimStart();
	const m = pattern.exec(head);
	if (!m || m.index !== 0 || m[0].length === 0) return null;
	return afterSeparator(head.slice(m[0].length));
}

/** Escape a literal string for use inside a RegExp. */
export function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
