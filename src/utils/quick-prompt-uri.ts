/**
 * Pure layer for `obsidian://agent-console?...` quick-prompt links: parse the
 * params, sanitize outside text, rate-limit fires, quote outside text, and
 * build a prompt's base link. No Obsidian, no React, no i18n (a utils leaf).
 *
 * Design principle: a link can stage a prompt, but only the vault can
 * authorize a send. The contract deliberately has no `send`, no `open`, and
 * no free-text body — a link can only name a prompt that already exists.
 *
 * Spec: [[Agent Console Quick Prompt URIs]].
 */

/** The protocol action registered with `registerObsidianProtocolHandler`. */
export const QUICK_PROMPT_URI_ACTION = "agent-console";

/** At most one URI fire per this many ms. */
export const URI_RATE_LIMIT_MS = 2_000;
/** An exact repeat of the last fire within this many ms is dropped. */
export const URI_DUPLICATE_WINDOW_MS = 10_000;

/** Optional outside-context params, in contract order. */
export const URI_CONTEXT_FIELDS = [
	"selection",
	"url",
	"title",
	"agent",
	"mode",
] as const;
export type UriContextField = (typeof URI_CONTEXT_FIELDS)[number];

/** Outside context a link carries. Only keys the link set are present. */
export type UriContext = Partial<Record<UriContextField, string>>;

export type QuickPromptUriParse<P extends { id: string }> =
	| { kind: "ok"; prompt: P; context: UriContext }
	| { kind: "unknown-prompt"; promptId: string }
	| { kind: "bad-param"; field: "prompt" | UriContextField };

/**
 * Parse protocol params against the loaded prompts. Total: never throws,
 * never coerces. The prompt id must match exactly (ids are filename slugs and
 * stable across re-scans; labels are not addressable). A present-but-blank
 * optional param is `bad-param`, so a malformed link fails loud instead of
 * silently behaving like a different link. Params outside the contract
 * (`vault`, `action`, and anything else) are ignored.
 */
export function parseQuickPromptUri<P extends { id: string }>(
	params: Readonly<Record<string, string | undefined>>,
	prompts: readonly P[],
): QuickPromptUriParse<P> {
	const id = params.prompt;
	if (id === undefined || id.trim() === "") {
		return { kind: "bad-param", field: "prompt" };
	}
	const context: UriContext = {};
	for (const field of URI_CONTEXT_FIELDS) {
		const v = params[field];
		if (v === undefined) continue;
		if (v.trim() === "") return { kind: "bad-param", field };
		context[field] = v;
	}
	const prompt = prompts.find((p) => p.id === id);
	if (!prompt) return { kind: "unknown-prompt", promptId: id };
	return { kind: "ok", prompt, context };
}

/** Line breaks other than `\n`, normalized to `\n` and not counted. */
const LINE_BREAK_RE = /\r\n?|[\u0085\u2028\u2029]/g;

/**
 * Characters that render as nothing but that an agent still reads, so
 * outside text is stripped of them before it is staged (I329, I330).
 *
 * Removed: every Default_Ignorable_Code_Point (zero-width characters,
 * U+200C included, bidi marks and overrides, BOM, soft hyphen, fillers,
 * variation selectors, tag characters), the interlinear annotation marks,
 * and control characters other than tab and newline.
 *
 * Kept, because real text needs them and one of each carries no hidden text:
 * - the England, Scotland and Wales flags, the only standard emoji built
 *   from tag characters (any other tag run is removed);
 * - one U+FE0E or U+FE0F right after an emoji base (keycaps like 1️⃣, ✔️);
 * - one zero-width joiner between two emoji (👨‍👩‍👧, 👩🏽‍💻, ❤️‍🔥);
 * - one ideographic variation selector right after a Han character.
 *
 * The kept alternatives come first, and each lookbehind reads the original
 * text, so a second selector or joiner in a row is always removed.
 * Known limit: Mongolian free variation selectors are removed too.
 */
const HIDDEN_RE =
	/(\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}|(?<=\p{Emoji})[\uFE0E\uFE0F]|(?<=[\p{Extended_Pictographic}\p{Emoji_Modifier}]\uFE0F?)\u200D(?=\p{Extended_Pictographic})|(?<=\p{Unified_Ideograph})[\u{E0100}-\u{E01EF}])|(?![\t\n])\p{Cc}|[\p{Default_Ignorable_Code_Point}\uFFF9-\uFFFB]/gu;

export interface SanitizedText {
	text: string;
	/** How many invisible characters were removed. */
	removed: number;
}

export function sanitizeExternalText(s: string): SanitizedText {
	let removed = 0;
	const text = s
		.replace(LINE_BREAK_RE, "\n")
		.replace(HIDDEN_RE, (match: string, kept: string | undefined) => {
			if (kept !== undefined) return match;
			removed += [...match].length;
			return "";
		});
	return { text, removed };
}

export interface UriRateLimitState {
	lastAt?: number;
	lastKey?: string;
}

export type UriRateLimitResult =
	| { ok: true; state: UriRateLimitState }
	| { ok: false; reason: "rate-limit" | "duplicate" };

/**
 * Accept or reject a fire. A duplicate (same key within 10 s) is reported in
 * preference to a plain rate limit. A rejected fire does NOT move the window,
 * so a redirect loop can't keep itself alive; the caller keeps the old state.
 */
export function checkUriRateLimit(
	state: UriRateLimitState,
	key: string,
	now: number,
): UriRateLimitResult {
	if (state.lastAt !== undefined) {
		const elapsed = now - state.lastAt;
		if (key === state.lastKey && elapsed < URI_DUPLICATE_WINDOW_MS) {
			return { ok: false, reason: "duplicate" };
		}
		if (elapsed < URI_RATE_LIMIT_MS) {
			return { ok: false, reason: "rate-limit" };
		}
	}
	return { ok: true, state: { lastAt: now, lastKey: key } };
}

/** A stable identity for "the same fire": sorted params, JSON-encoded. */
export function uriFireKey(
	params: Readonly<Record<string, string | undefined>>,
): string {
	const entries = Object.entries(params)
		.filter((e): e is [string, string] => e[1] !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return JSON.stringify(entries);
}

/**
 * Quote outside text under a heading. Every line — including blank lines and
 * lines that already start with `>` — gets a quote marker, so the text can't
 * close the block and pose as the user's own prompt.
 */
export function formatExternalBlock(text: string, heading: string): string {
	const quoted = text
		.split("\n")
		.map((line) => (line === "" ? ">" : `> ${line}`))
		.join("\n");
	return `${heading}\n${quoted}`;
}

/**
 * The "claimed source" shown in the heading: the url's host when it parses,
 * else the raw url, else the title. Undefined when the link named neither.
 */
export function claimedSourceLabel(
	url: string | undefined,
	title: string | undefined,
): string | undefined {
	if (url) {
		try {
			const host = new URL(url).hostname;
			return host || url;
		} catch {
			return url;
		}
	}
	return title;
}

/** The base link for a prompt (what "Copy link" puts on the clipboard). */
export function buildPromptUri(vault: string, promptId: string): string {
	return (
		`obsidian://${QUICK_PROMPT_URI_ACTION}` +
		`?vault=${encodeURIComponent(vault)}` +
		`&prompt=${encodeURIComponent(promptId)}`
	);
}
