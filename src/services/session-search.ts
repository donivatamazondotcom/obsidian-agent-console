/**
 * Session Search Engine (pure)
 *
 * Container-agnostic full-text search over the local session library. No React,
 * no Obsidian, no SDK imports — this is the `services/` layer. The same engine
 * powers the v1 modal mount and the future History tab (see
 * [[ACP Session History Search]] / [[Agent Console History Tab]]).
 *
 * Two tiers:
 *  - Title: matched synchronously against in-memory SessionInfo[]. Zero I/O.
 *  - Content: matched against a lazily-built index of message text per session.
 *
 * Ranking (v1): title matches before content-only matches; within each tier the
 * caller's session order is preserved (useSessionHistory already sorts by
 * updatedAt desc, so this yields recency order).
 */

import type { ChatMessage, MessageContent, Role } from "../types/chat";
import type { SessionInfo } from "../types/session";

// ============================================================================
// Options
// ============================================================================

export interface SessionSearchOptions {
	/** Include tool-call text (titles, rawInput/rawOutput, diffs). Default false. */
	includeToolCalls?: boolean;
	/** Include agent_thought (internal reasoning) text. Default true. */
	includeThoughts?: boolean;
}

const DEFAULT_OPTIONS: Required<SessionSearchOptions> = {
	includeToolCalls: false,
	includeThoughts: true,
};

// ============================================================================
// Text extraction
// ============================================================================

/**
 * Stable, JSON-safe stringify of an arbitrary tool input/output bag for search.
 * Best-effort: circular structures fall back to an empty string.
 */
function safeStringify(value: unknown): string {
	if (value == null) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return "";
	}
}

/**
 * Extract searchable plain text from a single content block.
 * Returns "" for non-textual blocks (image, terminal, etc.).
 */
function extractBlockText(
	block: MessageContent,
	opts: Required<SessionSearchOptions>,
): string {
	switch (block.type) {
		case "text":
		case "text_with_context":
			return block.text;
		case "agent_thought":
			return opts.includeThoughts ? block.text : "";
		case "resource_link":
			// Human-readable filename is useful and cheap to index.
			return block.name ?? "";
		case "plan":
			return block.entries.map((e) => e.content).join(" ");
		case "tool_call": {
			if (!opts.includeToolCalls) return "";
			const parts: string[] = [];
			if (block.title) parts.push(block.title);
			parts.push(safeStringify(block.rawInput));
			parts.push(safeStringify(block.rawOutput));
			for (const c of block.content ?? []) {
				if (c.type === "diff") {
					if (c.oldText) parts.push(c.oldText);
					parts.push(c.newText);
				}
			}
			return parts.filter(Boolean).join(" ");
		}
		// Non-textual / not-useful-for-search blocks.
		case "image":
		case "permission_request":
		case "terminal":
		default:
			return "";
	}
}

/**
 * Extract searchable plain text from one message (all content blocks joined).
 */
export function extractMessageText(
	msg: ChatMessage,
	options?: SessionSearchOptions,
): string {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	return msg.content
		.map((b) => extractBlockText(b, opts))
		.filter(Boolean)
		.join(" ")
		.trim();
}

// ============================================================================
// Index
// ============================================================================

/** Per-message searchable text, retained for snippet extraction. */
export interface IndexedMessage {
	role: Role;
	text: string;
}

/** A built content-index entry for one session. */
export interface SessionIndexEntry {
	sessionId: string;
	/** Lowercased concatenation of all message text — fast substring haystack. */
	haystack: string;
	/** Per-message text (original case) for snippet extraction. */
	messages: IndexedMessage[];
}

/**
 * Build a content-index entry for a single session from its messages.
 */
export function buildIndexEntry(
	sessionId: string,
	messages: ChatMessage[],
	options?: SessionSearchOptions,
): SessionIndexEntry {
	const indexed: IndexedMessage[] = [];
	for (const msg of messages) {
		const text = extractMessageText(msg, options);
		if (text) indexed.push({ role: msg.role, text });
	}
	const haystack = indexed
		.map((m) => m.text)
		.join("\n")
		.toLowerCase();
	return { sessionId, haystack, messages: indexed };
}

// ============================================================================
// Snippet
// ============================================================================

export interface SearchSnippet {
	/** The windowed text around the first match. */
	text: string;
	/** Offset of the match within `text` (for highlight). */
	matchStart: number;
	/** Length of the matched substring. */
	matchLength: number;
}

/**
 * Produce a snippet centered on the first case-insensitive occurrence of
 * `query` within `text`, with up to `window` chars of context on each side.
 * Returns null if the query is not present.
 */
export function makeSnippet(
	text: string,
	query: string,
	window = 40,
): SearchSnippet | null {
	if (!query) return null;
	const idx = text.toLowerCase().indexOf(query.toLowerCase());
	if (idx === -1) return null;

	const rawStart = Math.max(0, idx - window);
	const rawEnd = Math.min(text.length, idx + query.length + window);

	const prefix = rawStart > 0 ? "…" : "";
	const suffix = rawEnd < text.length ? "…" : "";
	const slice = text.slice(rawStart, rawEnd);

	return {
		text: prefix + slice + suffix,
		matchStart: prefix.length + (idx - rawStart),
		matchLength: query.length,
	};
}

// ============================================================================
// Search
// ============================================================================

export type MatchKind = "title" | "content";

export interface SearchMatch {
	sessionId: string;
	matchKind: MatchKind;
	/** Present only for content matches (title matches need no preview). */
	snippet?: SearchSnippet;
}

/**
 * Search the session library.
 *
 * - Empty/whitespace query → returns every session as a `title` match in input
 *   order (caller renders the full, unfiltered list).
 * - Non-empty query → title matches first (input order), then content-only
 *   matches (input order). A session that matches on title is never duplicated
 *   as a content match.
 *
 * `index` may be partial or empty (content tier simply contributes nothing for
 * sessions not yet indexed) — this is what lets title search work instantly
 * while the content index is still building.
 */
export function searchSessions(
	query: string,
	sessions: SessionInfo[],
	index: Map<string, SessionIndexEntry>,
): SearchMatch[] {
	const q = query.trim();
	if (!q) {
		return sessions.map((s) => ({
			sessionId: s.sessionId,
			matchKind: "title" as const,
		}));
	}

	const lower = q.toLowerCase();
	const titleMatches: SearchMatch[] = [];
	const contentMatches: SearchMatch[] = [];
	const titleMatched = new Set<string>();

	for (const s of sessions) {
		if ((s.title ?? "").toLowerCase().includes(lower)) {
			titleMatches.push({ sessionId: s.sessionId, matchKind: "title" });
			titleMatched.add(s.sessionId);
		}
	}

	for (const s of sessions) {
		if (titleMatched.has(s.sessionId)) continue;
		const entry = index.get(s.sessionId);
		if (!entry || !entry.haystack.includes(lower)) continue;

		// Find the first message that contains the query for the snippet.
		let snippet: SearchSnippet | undefined;
		for (const m of entry.messages) {
			const snip = makeSnippet(m.text, q);
			if (snip) {
				snippet = snip;
				break;
			}
		}
		contentMatches.push({
			sessionId: s.sessionId,
			matchKind: "content",
			snippet,
		});
	}

	return [...titleMatches, ...contentMatches];
}
