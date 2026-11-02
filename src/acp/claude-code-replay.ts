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

const FILE_MENTION = String.raw`\[@([^\]\n]+)\]\((file:\/\/[^)\n]+)\)`;
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

/** True when a session title is only a file mention (Claude's untitled chat). */
export function isFileMentionTitle(title: string): boolean {
	return new RegExp(`^${FILE_MENTION}\\s*$`).test(title.trim());
}
