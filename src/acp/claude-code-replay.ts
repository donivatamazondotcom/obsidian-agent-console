/**
 * Claude Code replay shape for resource links (ACP boundary, I242).
 *
 * Claude Code stores each `resource_link` block it receives as the text
 * `[@<file basename>](<uri>)` and replays that text as its own
 * `user_message_chunk` on `session/load`, in prompt order (traced live against
 * claude-agent-acp, 2026-11-01). Its `session/list` title for a chat that
 * opened with a link is that same text.
 *
 * These are the inverse, the counterpart of `takeLeadingAttachedFile` in
 * `kiro-v3.ts`: take ONE complete leading or trailing file mention and return
 * it as the `resource_link` it started as, so the replay strip can continue
 * past it and the transcript shows a file chip again. Only `file://` URIs
 * match. Pure and total; null when nothing matched.
 */
import type { ResourceLinkPromptContent } from "../types/chat";
import { FILE_MENTION } from "../utils/file-mention";

const LEADING_FILE_MENTION = new RegExp(`^${FILE_MENTION}`);
const TRAILING_FILE_MENTION = new RegExp(`\\s*${FILE_MENTION}\\s*$`);

function toLink(m: RegExpExecArray): ResourceLinkPromptContent {
	return { type: "resource_link", name: m[1], uri: m[2] };
}

/** Take one leading `[@name](file://…)` mention, or null. */
export function takeLeadingFileMention(
	text: string,
): { rest: string; link: ResourceLinkPromptContent } | null {
	const head = text.trimStart();
	const m = LEADING_FILE_MENTION.exec(head);
	if (!m) return null;
	return {
		rest: head.slice(m[0].length).replace(/^[ \t]*(?:\r?\n)*/, ""),
		link: toLink(m),
	};
}

/** Tail counterpart of {@link takeLeadingFileMention}. */
export function takeTrailingFileMention(
	text: string,
): { rest: string; link: ResourceLinkPromptContent } | null {
	const m = TRAILING_FILE_MENTION.exec(text);
	if (!m) return null;
	return { rest: text.slice(0, m.index), link: toLink(m) };
}

/**
 * Claude Code replay shape for an embedded `resource` block (I268).
 *
 * Claude stores a `resource` as two text pieces: a `[@name](uri)` mention in
 * prompt order (taken above) and `\n<context ref="<uri>">\n<text>\n</context>`
 * appended after all other content, one block per resource, in order.
 *
 * Take ONE complete trailing block whose ref is a `file://` URI in
 * `knownUris`, and return the text before it. The guard is what keeps the
 * user's own text safe: Claude always writes a mention for every resource,
 * so a real block always has a chip with the same URI, while typed text
 * containing `<context` has none (or is not a complete trailing block).
 * The opener must start the text or a line. Pure and total; null when
 * nothing matched.
 */
const CONTEXT_OPEN = /(^|\n)<context ref="(file:\/\/[^"\n]+)">/g;

export function takeTrailingContextBlock(
	text: string,
	knownUris: ReadonlySet<string>,
): string | null {
	const body = text.replace(/\s+$/, "");
	if (!body.endsWith("</context>")) return null;
	let start = -1;
	for (const m of body.matchAll(CONTEXT_OPEN)) {
		if (knownUris.has(m[2])) start = m.index + m[1].length;
	}
	if (start < 0) return null;
	return body.slice(0, start).replace(/\s+$/, "");
}

/** URIs of every `[@name](file://…)` mention in `text`. */
export function fileMentionUris(text: string): string[] {
	return [...text.matchAll(new RegExp(FILE_MENTION, "g"))].map((m) => m[2]);
}

export { isFileMentionTitle } from "../utils/file-mention";
