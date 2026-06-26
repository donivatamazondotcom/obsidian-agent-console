/**
 * F03 — AI Session Rename: head-buffer title-marker parsing.
 *
 * The title rubric (S2) asks the agent to emit `<title>…</title>` as the very
 * first content of its reply. This module extracts that title from the head of
 * the streaming agent-message text and strips the marker before render.
 *
 * Two pieces:
 * - `parseLeadingTitle` — a pure function over an accumulated head buffer.
 * - `TitleHeadBuffer` — a tiny stateful wrapper the streaming consumer feeds
 *   chunk-by-chunk; it holds text while the head could still be a marker,
 *   releases the stripped remainder on resolve, and releases the raw buffer on
 *   divergence/cap (F5: abandon on the first non-`<title` character so
 *   first-paint is never stalled when no marker is coming).
 *
 * Design constraints (see [[ACP AI Session Rename]] § v1 mechanism):
 * - Buffer only the LEADING text; once resolved/abandoned, all later text
 *   passes straight through.
 * - A newline before the close tag is treated as malformed (a title never
 *   spans lines) → release as-is.
 * - A safety cap (N chars) bounds the buffered head so a never-closed marker
 *   degrades to a bounded, intelligible leak rather than swallowing the reply.
 */

/** Open/close marker tags (matched case-insensitively). */
const OPEN = "<title>";
const CLOSE = "</title>";

/**
 * Default char cap on the buffered head. Comfortably fits
 * `<title>` + a ~30-char title + `</title>` with slack, while bounding the
 * I45-class fragility to the first chunk or two.
 */
export const DEFAULT_TITLE_HEAD_CAP = 200;

/**
 * Result of inspecting an accumulated head buffer.
 * - `buffering`: still a viable (possibly partial) marker prefix — keep holding.
 * - `resolved`: a complete `<title>…</title>` was found; `remainder` is the
 *   text after the marker (leading whitespace trimmed) to render.
 * - `passthrough`: not a marker (diverged) or cap exceeded — render `text` as-is.
 */
export type TitleParseResult =
	| { status: "buffering" }
	| { status: "resolved"; title: string; remainder: string }
	| { status: "passthrough"; text: string };

/**
 * Pure inspection of an accumulated leading buffer.
 *
 * Tolerates leading whitespace before the marker. Case-insensitive on the
 * tag names. Never mutates input.
 */
export function parseLeadingTitle(
	buffer: string,
	maxChars: number = DEFAULT_TITLE_HEAD_CAP,
): TitleParseResult {
	const overCap = buffer.length >= maxChars;
	const trimmed = buffer.replace(/^\s+/, "");

	// Only whitespace so far — could still be leading WS before the marker.
	if (trimmed.length === 0) {
		return overCap
			? { status: "passthrough", text: buffer }
			: { status: "buffering" };
	}

	const lower = trimmed.toLowerCase();

	if (!lower.startsWith(OPEN)) {
		// Could the buffer still GROW into the open tag (we only have a prefix)?
		if (OPEN.startsWith(lower)) {
			return overCap
				? { status: "passthrough", text: buffer }
				: { status: "buffering" };
		}
		// Diverged — this reply does not start with a title marker.
		return { status: "passthrough", text: buffer };
	}

	// We have the full "<title>" open tag. Look for the close.
	const afterOpen = trimmed.slice(OPEN.length);
	const closeIdx = afterOpen.toLowerCase().indexOf(CLOSE);
	if (closeIdx === -1) {
		// A newline before the close = malformed (a title never spans lines).
		if (afterOpen.includes("\n")) {
			return { status: "passthrough", text: buffer };
		}
		return overCap
			? { status: "passthrough", text: buffer }
			: { status: "buffering" };
	}

	const title = afterOpen.slice(0, closeIdx).trim();
	const remainder = afterOpen
		.slice(closeIdx + CLOSE.length)
		.replace(/^\s+/, "");
	return { status: "resolved", title, remainder };
}

/** Outcome of pushing one streamed chunk into a {@link TitleHeadBuffer}. */
export interface TitleHeadPushResult {
	/** Text to render now, or `null` to hold (still buffering the head). */
	emit: string | null;
	/** A parsed, non-empty title if the marker just resolved, else `null`. */
	title: string | null;
	/** True once the buffer is finished (resolved or abandoned) — stop feeding it. */
	done: boolean;
}

/**
 * Stateful head buffer fed one streamed agent-message chunk at a time.
 *
 * Lifecycle: arm one per send (first message, agent-suggested strategy), feed
 * every `agent_message_chunk` text through {@link push} until `done`, then stop.
 * Call {@link flush} at turn end to release any text still held (covers a
 * never-closed marker that stayed under the cap and got no more chunks).
 */
export class TitleHeadBuffer {
	private buffer = "";
	private finished = false;

	constructor(private readonly maxChars: number = DEFAULT_TITLE_HEAD_CAP) {}

	/** True while the buffer is still inspecting the head. */
	get isActive(): boolean {
		return !this.finished;
	}

	/**
	 * Feed one streamed chunk. Returns what to render now (or `null` to hold),
	 * the parsed title if it just resolved, and whether the buffer is done.
	 */
	push(chunk: string): TitleHeadPushResult {
		if (this.finished) {
			// Defensive: never called after done, but pass through if it is.
			return { emit: chunk, title: null, done: true };
		}

		this.buffer += chunk;
		const result = parseLeadingTitle(this.buffer, this.maxChars);

		if (result.status === "buffering") {
			return { emit: null, title: null, done: false };
		}

		this.finished = true;

		if (result.status === "resolved") {
			const title =
				result.title.trim().length > 0 ? result.title.trim() : null;
			const emit = result.remainder.length > 0 ? result.remainder : null;
			return { emit, title, done: true };
		}

		// passthrough — release the raw accumulated buffer as-is.
		return { emit: result.text, title: null, done: true };
	}

	/**
	 * Release any held text at turn end. Returns the held text (so the caller
	 * can render it) or `null` if nothing was held / already finished.
	 */
	flush(): string | null {
		if (this.finished) return null;
		this.finished = true;
		const held = this.buffer;
		this.buffer = "";
		return held.length > 0 ? held : null;
	}
}
