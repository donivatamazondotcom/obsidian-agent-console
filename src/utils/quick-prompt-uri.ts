/**
 * Pure layer for `obsidian://agent-console?...` quick-prompt links: parse the
 * params, sanitize outside text, rate-limit fires, quote outside text, and
 * build a prompt's base link. No Obsidian, no React, no i18n (a utils leaf).
 *
 * Design principle: a link can stage a prompt, but only the vault can
 * authorize a send. The contract deliberately has no `send` and no `open`.
 * A link's own text always arrives quoted as External text, under a prompt
 * that's already in the vault.
 *
 * Spec: [[Agent Console Quick Prompt URIs]]; the `crc` check and the
 * stray-key rule: [[Agent Console Fresh-Session Handoff]].
 */

import { crc32Hex } from "./crc32";

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

/** The params that carry free text, where an unencoded `&` or `#` can cut. */
export const URI_FREE_TEXT_FIELDS = ["selection", "url", "title"] as const;

/**
 * Every key the link contract defines. Built from `URI_CONTEXT_FIELDS`, so a
 * field added later can't make links that use it fail the stray-key rule.
 */
export const URI_CONTRACT_KEYS: readonly string[] = [
	"action",
	"vault",
	"prompt",
	"crc",
	...URI_CONTEXT_FIELDS,
];

/** x-callback-url keys, allowed so Shortcuts and Drafts links keep working. */
export const URI_XCALLBACK_KEYS = [
	"x-success",
	"x-error",
	"x-cancel",
	"x-source",
] as const;

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
	...URI_CONTRACT_KEYS,
	...URI_XCALLBACK_KEYS,
]);

/** Why a link's text was judged cut short or changed. */
export type UriCutShortReason = "hash" | "stray-key" | "crc";

export type QuickPromptUriParse<P extends { id: string }> =
	| { kind: "ok"; prompt: P; context: UriContext }
	| { kind: "unknown-prompt"; promptId: string }
	| { kind: "bad-param"; field: "prompt" | UriContextField }
	| { kind: "cut-short"; reason: UriCutShortReason; key?: string };

export interface ParseQuickPromptUriOptions {
	/**
	 * Fail a free-text link that has a `hash` or a key outside the contract
	 * (rule 1). Default true. plugin.ts turns it off outside macOS until
	 * probe P2 shows Obsidian adds no keys of its own on Windows and Linux;
	 * the `crc` rules run either way.
	 */
	strictKeys?: boolean;
}

const CRC_RE = /^[0-9a-f]{8}$/i;

/**
 * The cut-short rules, in order. They run whenever the link has any
 * free-text key (even blank) or a `crc`, before every other check:
 * 1. a `hash` key or a key outside the contract (when `strictKeys`);
 * 2. a `crc` that isn't eight hex digits;
 * 3. a `crc` with no `selection`;
 * 4. a `crc` that doesn't match the CRC-32 of `selection`, checked on the
 *    text as decoded, before hidden characters are stripped.
 */
function cutShortReason(
	params: Readonly<Record<string, string | undefined>>,
	strictKeys: boolean,
): { reason: UriCutShortReason; key?: string } | null {
	const crc = params.crc;
	const hasFreeText = URI_FREE_TEXT_FIELDS.some((f) => params[f] !== undefined);
	if (!hasFreeText && crc === undefined) return null;

	if (strictKeys) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined) continue;
			if (key === "hash") return { reason: "hash" };
			if (!ALLOWED_KEYS.has(key)) return { reason: "stray-key", key };
		}
	}
	if (crc === undefined) return null;
	const selection = params.selection;
	if (!CRC_RE.test(crc) || selection === undefined) return { reason: "crc" };
	if (crc.toLowerCase() !== crc32Hex(selection)) return { reason: "crc" };
	return null;
}

/**
 * Parse protocol params against the loaded prompts. Total: never throws,
 * never coerces. The cut-short rules run first (see `cutShortReason`). The
 * prompt id must match exactly (ids are filename slugs and stable across
 * re-scans; labels are not addressable). A present-but-blank optional param
 * is `bad-param`, so a malformed link fails loud instead of silently
 * behaving like a different link. A link with no free text and no `crc`
 * ignores keys outside the contract, as it always has.
 */
export function parseQuickPromptUri<P extends { id: string }>(
	params: Readonly<Record<string, string | undefined>>,
	prompts: readonly P[],
	options: ParseQuickPromptUriOptions = {},
): QuickPromptUriParse<P> {
	const cut = cutShortReason(params, options.strictKeys ?? true);
	if (cut) return { kind: "cut-short", ...cut };

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
 * the Egyptian hieroglyph format controls, and control characters other
 * than tab and newline.
 *
 * Kept, because real text needs them and one of each carries no hidden text:
 * - the England, Scotland and Wales flags, the only standard emoji built
 *   from tag characters (any other tag run is removed);
 * - U+FE0F after an ASCII digit, `#` or `*` only inside a keycap (1️⃣), and
 *   one U+FE0E or U+FE0F right after any other emoji base (✔️, ©️);
 * - one zero-width joiner between two emoji (👨‍👩‍👧, 👩🏽‍💻, ❤️‍🔥);
 * - one zero-width joiner right after an Indic or Sinhala virama, or
 *   between a letter and a virama, which shapes conjuncts such as Sinhala
 *   ශ්‍රී, Malayalam chillu letters and Bengali র‍্য (ra + ya-phala);
 * - one ideographic variation selector right after a Han character.
 *
 * The kept alternatives come first, and each lookbehind reads the original
 * text, so a second selector or joiner in a row is always removed.
 * Known limits: standardized variation sequences (U+FE00–FE0D after math
 * symbols, CJK compatibility forms and some scripts) and Mongolian free
 * variation selectors lose their selector. A zero-width joiner anywhere
 * else is removed, including in Arabic letter forms and in Myanmar and
 * Khmer.
 */
const HIDDEN_RE =
	/(\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}|(?<=[#*0-9])\uFE0F(?=\u20E3)|(?<![#*0-9])(?<=\p{Emoji})[\uFE0E\uFE0F]|(?<=[\p{Extended_Pictographic}\p{Emoji_Modifier}]\uFE0F?)\u200D(?=\p{Extended_Pictographic})|(?<=[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D\u0DCA])\u200D|(?<=\p{L})\u200D(?=[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D\u0DCA])|(?<=\p{Unified_Ideograph})[\u{E0100}-\u{E01EF}])|(?![\t\n])\p{Cc}|[\p{Default_Ignorable_Code_Point}\uFFF9-\uFFFB\u{13430}-\u{1343F}]/gu;

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
 * Collapse every run of whitespace, line breaks included, to one space.
 * A link's `url` and `title` are one-line values, and they land outside the
 * quote block (the heading's claimed source and the `{{url}}`/`{{title}}`
 * placeholders), so a line break in either must not start a line that reads
 * like the user's own prompt.
 */
export function toOneLine(s: string): string {
	// `\s` doesn't match NEL (U+0085), so it is listed too.
	return s.replace(/[\s\u0085]+/g, " ").trim();
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
