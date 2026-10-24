/**
 * `insertTranscript` — puts dictated text into the composer draft at the
 * cursor (spec: the voice-input feature spec § Core loop, step 3).
 *
 * RULES
 *  - Insert at the cursor; never replace existing text. With a selection, the
 *    text goes after its far end and the selected text stays.
 *  - Trim the spaces and newlines speech engines put around their output.
 *  - Keep words apart: add a space before the new text if it would touch a
 *    word, and after it if the next character is a word character.
 *  - Leave the cursor right after the new words.
 *  - A blank transcript changes nothing.
 *
 * Pure — operates on a plain draft snapshot, no DOM.
 */

export interface ComposerDraft {
	text: string;
	selectionStart: number;
	selectionEnd: number;
}

export type InsertResult =
	| { kind: "inserted"; text: string; cursor: number }
	| { kind: "unchanged" };

export function insertTranscript(
	draft: ComposerDraft,
	transcript: string,
): InsertResult {
	const words = transcript.trim();
	if (words.length === 0) return { kind: "unchanged" };

	const { text } = draft;
	const at = clamp(
		Math.max(draft.selectionStart, draft.selectionEnd),
		0,
		text.length,
	);
	const before = text.slice(0, at);
	const after = text.slice(at);

	const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const trail = after.length > 0 && /^[\p{L}\p{N}]/u.test(after) ? " " : "";

	const inserted = lead + words;
	return {
		kind: "inserted",
		text: before + inserted + trail + after,
		cursor: before.length + inserted.length,
	};
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), hi);
}
