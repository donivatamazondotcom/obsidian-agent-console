/**
 * Shared Links extraction (pure).
 *
 * Derives the per-tab "shared links" set from a tab's message history — the
 * data behind the Shared Links Bubble in the chat header. There is no separate
 * persisted state: because per-tab messages already persist and replay across
 * restart/fork, deriving from them keeps the bubble correct for free.
 *
 * See [[Shared Links Bubble]] spec § Design Principle ("derive, don't store").
 *
 * What counts as a link (collected from ASSISTANT messages only — "links the
 * agent shared"):
 *   - `[[wikilinks]]` (with optional `|alias` and `#section`) in text blocks
 *   - `[label](target)` markdown links in text blocks
 *   - bare `http(s)://` URLs in text blocks
 *   - `resource_link` content blocks (explicit file references: uri + name)
 *
 * New vs old:
 *   - NEW  = the link's target is a file the agent CREATED this session,
 *            detected via a `tool_call` -> `diff` content block whose `oldText`
 *            is null/undefined (the DiffContent type documents null/undefined
 *            oldText as the new-file signal).
 *   - OLD  = everything else (pre-existing vault files, external URLs, and
 *            files the agent only read or edited).
 *   "New" is creation-based and does not decay once opened. External URLs are
 *   never "new" (you cannot create a URL).
 */

import type { ChatMessage, MessageContent } from "../types/chat";

export type SharedLinkKind = "internal" | "external";

export interface SharedLink {
	/** Stable dedup key (kind + normalized target). */
	key: string;
	/** Vault file reference vs external URL. */
	kind: SharedLinkKind;
	/** Display label (alias / markdown label / file name / the URL itself). */
	label: string;
	/**
	 * Open target. For `internal`, the linktext to hand to
	 * `Workspace.openLinkText` (may include `#section`). For `external`, the URL.
	 */
	target: string;
	/** True when `target` is a file the agent created this session. */
	isNew: boolean;
	/** Message index of the most-recent mention (drives recency ordering). */
	order: number;
}

// `[[target|alias]]` or `[[target]]`. Group 1 = target (may carry #section),
// group 2 = optional alias.
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
// `[label](target)` — target up to first whitespace or closing paren.
const MD_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
// bare http(s) URL. Excludes backtick so a URL wrapped in inline code
// (`https://x`) isn't captured with a trailing ` and rendered unopenable.
const BARE_URL_RE = /https?:\/\/[^\s)<>"'`]+/g;
// Protocol detector for "is this target an external URL?".
const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

interface RawLink {
	kind: SharedLinkKind;
	label: string;
	target: string;
	order: number;
}

/**
 * Public entry point: extract the deduped, recency-ordered shared-link set from
 * a tab's messages, with new/old classification.
 *
 * Output is sorted most-recent-first. Grouping into "New this session" /
 * "Earlier" is the UI's responsibility (so the same array serves both the count
 * badge and the popover).
 */
export interface ExtractLinksOptions {
	/**
	 * Resolve an internal link's linkpath (section stripped) to whether it
	 * exists as a vault note. When supplied, internal links that do NOT resolve
	 * are dropped (SLB-I8) — illustrative/abbreviated wikilinks the agent typed
	 * in prose (e.g. `[[file]]`, `[[TP-I05 …]]`) are noise, not shared files.
	 * External URLs are never resolved (you cannot resolve a URL against the
	 * vault). When omitted, all internal links are kept (pure / back-compat).
	 * Wire to Obsidian's `metadataCache.getFirstLinkpathDest(linkpath, "")`.
	 */
	resolveInternal?: (linkpath: string) => boolean;
}

export function extractLinks(
	messages: ChatMessage[],
	options?: ExtractLinksOptions,
): SharedLink[] {
	const createdPaths = collectCreatedFilePaths(messages);

	// Dedup by key, keeping the most-recent order and merging the label from the
	// most-recent mention.
	const byKey = new Map<string, RawLink>();

	messages.forEach((message, index) => {
		if (message.role !== "assistant") return;
		for (const block of message.content) {
			for (const raw of rawLinksFromBlock(block, index)) {
				const key = `${raw.kind}:${normalizeTarget(raw.target)}`;
				const existing = byKey.get(key);
				if (!existing || raw.order >= existing.order) {
					byKey.set(key, raw);
				}
			}
		}
	});

	const resolveInternal = options?.resolveInternal;
	const links: SharedLink[] = [];
	for (const [key, raw] of byKey) {
		const isNew =
			raw.kind === "internal" &&
			isCreatedTarget(raw.target, createdPaths);
		// SLB-I8: when a resolver is supplied, drop internal links whose target
		// does not resolve to an existing vault note. External URLs are never
		// resolved. A file the agent created THIS session is always kept (isNew)
		// — it exists by definition even before the metadata cache indexes it.
		if (raw.kind === "internal" && resolveInternal && !isNew) {
			const linkpath = raw.target.split("#")[0].trim();
			if (!resolveInternal(linkpath)) continue;
		}
		links.push({
			key,
			kind: raw.kind,
			label: raw.label,
			target: raw.target,
			isNew,
			order: raw.order,
		});
	}

	// Most-recent first; stable tiebreak on label for determinism.
	links.sort((a, b) =>
		b.order !== a.order
			? b.order - a.order
			: a.label.localeCompare(b.label),
	);
	return links;
}

/**
 * Pass 1: collect the set of file paths the agent CREATED across the whole
 * conversation (a `diff` block with null/undefined `oldText`). Returns both the
 * normalized full paths and their basenames (without extension) so internal
 * links can match whether they reference a path or just a note name.
 */
function collectCreatedFilePaths(messages: ChatMessage[]): {
	paths: Set<string>;
	basenames: Set<string>;
} {
	const paths = new Set<string>();
	const basenames = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type !== "tool_call" || !block.content) continue;
			for (const c of block.content) {
				if (
					c.type === "diff" &&
					(c.oldText === null || c.oldText === undefined) &&
					c.path
				) {
					paths.add(normalizeTarget(c.path));
					basenames.add(baseNameNoExt(c.path));
				}
			}
		}
	}
	return { paths, basenames };
}

/** Extract raw links from a single content block at message index `order`. */
function rawLinksFromBlock(block: MessageContent, order: number): RawLink[] {
	if (block.type === "resource_link") {
		const target = fileUriToPath(block.uri);
		const external =
			PROTOCOL_RE.test(target) && !target.startsWith("file:");
		return [
			{
				kind: external ? "external" : "internal",
				label: block.name || baseName(target),
				target,
				order,
			},
		];
	}
	if (block.type === "text" || block.type === "text_with_context") {
		return rawLinksFromText(block.text, order);
	}
	return [];
}

/**
 * Extract wikilinks, markdown links, and bare URLs from a text body.
 *
 * Markdown links are matched first and blanked out of a working copy so the
 * bare-URL pass does not double-count a URL already captured as `[label](url)`.
 * Wikilinks are matched against the original text (they never overlap URLs).
 */
function rawLinksFromText(text: string, order: number): RawLink[] {
	const out: RawLink[] = [];
	let urlScan = text;

	for (const m of text.matchAll(MD_LINK_RE)) {
		const label = m[1].trim();
		const target = m[2].trim();
		const external = PROTOCOL_RE.test(target);
		out.push({
			kind: external ? "external" : "internal",
			label: label || baseName(target),
			target,
			order,
		});
		// Blank the matched span so BARE_URL_RE won't re-match the same URL.
		urlScan = urlScan.replace(m[0], " ".repeat(m[0].length));
	}

	for (const m of urlScan.matchAll(BARE_URL_RE)) {
		// Strip trailing sentence punctuation, inline-code backtick, and
		// markdown emphasis markers (`*`). A bare URL wrapped in **bold** or
		// *italic* (e.g. `**https://…/pull/131**`) otherwise swallows the
		// closing markers into the href and 404s (SLB-I9). Leading markers are
		// never captured (the match anchors on `https?://`); only the trailing
		// run needs stripping. `*` is a legal URL sub-delim, so this strips it
		// only at the END — an internal `*` (e.g. `/a*b`) is preserved.
		const url = m[0].replace(/[.,;:`*]+$/, "");
		out.push({ kind: "external", label: url, target: url, order });
	}

	for (const m of text.matchAll(WIKILINK_RE)) {
		const rawTarget = m[1].trim();
		const alias = m[2]?.trim();
		out.push({
			kind: "internal",
			label: alias || rawTarget,
			target: rawTarget,
			order,
		});
	}

	return out;
}

/** True when an internal link target resolves to an agent-created file. */
function isCreatedTarget(
	target: string,
	created: { paths: Set<string>; basenames: Set<string> },
): boolean {
	if (created.paths.has(normalizeTarget(target))) return true;
	return created.basenames.has(baseNameNoExt(target));
}

// ---- path/target normalization helpers (pure) ----

/** Lowercased, forward-slashed, section-stripped target for matching/dedup. */
function normalizeTarget(target: string): string {
	let t = fileUriToPath(target).replace(/\\/g, "/").trim();
	const hash = t.indexOf("#");
	if (hash !== -1) t = t.slice(0, hash);
	return t.replace(/\/+$/, "").toLowerCase();
}

/** Strip a `file://` URI down to a filesystem path. */
function fileUriToPath(uri: string): string {
	if (uri.startsWith("file://")) {
		try {
			return decodeURIComponent(uri.replace(/^file:\/\//, ""));
		} catch {
			return uri.replace(/^file:\/\//, "");
		}
	}
	return uri;
}

/** Last path segment (with extension), section stripped. */
function baseName(target: string): string {
	let t = fileUriToPath(target).replace(/\\/g, "/");
	const hash = t.indexOf("#");
	if (hash !== -1) t = t.slice(0, hash);
	const seg = t.split("/").filter(Boolean).pop() ?? t;
	return seg;
}

/** Last path segment without extension, lowercased — the wikilink match key. */
function baseNameNoExt(target: string): string {
	const seg = baseName(target);
	return seg.replace(/\.[^.]+$/, "").toLowerCase();
}
