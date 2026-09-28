/**
 * F15 — Rename Tab With AI: pure helpers for the side-session title request.
 *
 * The title is generated in a throwaway side session on the tab's existing
 * agent connection (see [[F15 Rename Tab With AI]]). These helpers build the
 * prompt from the LOCAL transcript (local-first) and parse the reply. They
 * never touch React, Obsidian, or ACP — the `acp/` side-title method and the
 * UI wiring consume them.
 */
import type { ChatMessage } from "../types/chat";
import { stripContextBlocks } from "../resolvers/deriveTabLabel";
import { parseLeadingTitle } from "../utils/titleMarker";

/** Default cap on the excerpt sent to the side session. */
export const DEFAULT_EXCERPT_CHARS = 4000;
/** How many of the latest turns to include after the first user message. */
export const DEFAULT_TAIL_TURNS = 6;
/** Hard cap on an applied AI title. */
export const MAX_AI_TITLE_CHARS = 60;

interface ExcerptOptions {
	maxChars?: number;
	tailTurns?: number;
}

/** Visible user/agent text of a message, with injected context removed. */
function messageText(m: ChatMessage): string {
	const parts: string[] = [];
	for (const block of m.content) {
		if (block.type === "text" || block.type === "text_with_context") {
			parts.push(block.text);
		}
	}
	return stripContextBlocks(parts.join("\n")).trim();
}

function line(m: ChatMessage, text: string): string {
	return `${m.role === "user" ? "User" : "Agent"}: ${text}`;
}

/**
 * Build the conversation excerpt for the title request: the first user
 * message plus the latest turns (no duplicates), thoughts / tool calls /
 * pending messages dropped, total length capped. Each line gets an equal
 * share of the budget so one huge message can't crowd out the rest.
 *
 * Returns null when there is nothing to title.
 */
export function buildTitleExcerpt(
	messages: ChatMessage[],
	options: ExcerptOptions = {},
): string | null {
	const maxChars = options.maxChars ?? DEFAULT_EXCERPT_CHARS;
	const tailTurns = options.tailTurns ?? DEFAULT_TAIL_TURNS;

	const usable = messages
		.filter((m) => !m.pending)
		.map((m) => ({ m, text: messageText(m) }))
		.filter((x) => x.text.length > 0);
	if (usable.length === 0) return null;

	const firstUserIdx = usable.findIndex((x) => x.m.role === "user");
	const tailStart = Math.max(0, usable.length - tailTurns);
	const picked = usable.filter(
		(_, i) => i === firstUserIdx || i >= tailStart,
	);

	const separator = "\n\n";
	const budget =
		Math.floor(
			(maxChars - separator.length * (picked.length - 1)) / picked.length,
		) - 1;
	const lines = picked.map(({ m, text }) => {
		const full = line(m, text);
		return full.length > budget
			? `${full.slice(0, Math.max(0, budget - 1))}…`
			: full;
	});
	return lines.join(separator).slice(0, maxChars);
}

/** The single prompt sent to the side session. */
export function buildSideTitlePrompt(excerpt: string): string {
	return (
		"Give a short title for the conversation below. Reply with only the " +
		"title wrapped exactly as <title>your title here</title> — no other " +
		"text, no tool calls. About 20-30 characters, sentence case, starting " +
		"with a strong verb (e.g. Fix, Add, Explain, Debug, Compare). No " +
		'quotes, no trailing punctuation, no phrases like "Conversation with".' +
		"\n\n<conversation>\n" +
		excerpt +
		"\n</conversation>"
	);
}

function cleanTitle(raw: string): string | null {
	let t = raw.replace(/\s+/g, " ").trim();
	t = t.replace(/^["'“‘`]+|["'”’`]+$/g, "").trim();
	t = t.replace(/[.!?:;,]+$/, "").trim();
	if (t.length > MAX_AI_TITLE_CHARS) {
		t = t.slice(0, MAX_AI_TITLE_CHARS - 1).trimEnd() + "…";
	}
	return t ? t : null;
}

/**
 * Parse the side session's reply into a title. Accepts a leading marker, a
 * marker anywhere (models that preface despite instructions), or falls back
 * to the first non-empty line. Returns null when nothing usable came back.
 */
export function parseSideTitleReply(reply: string): string | null {
	const leading = parseLeadingTitle(reply, Number.MAX_SAFE_INTEGER);
	if (leading.status === "resolved") return cleanTitle(leading.title);

	const anywhere = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(reply);
	if (anywhere) return cleanTitle(anywhere[1]);

	const firstLine = reply
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	return firstLine ? cleanTitle(firstLine) : null;
}
