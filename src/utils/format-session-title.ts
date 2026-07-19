/**
 * `formatSessionTitle` — pure display-formatter for a session title shown in
 * the Session History UI.
 *
 * WHY THIS EXISTS
 * Sessions whose title is the raw first user message — notably the Agent /
 * server view, which has no AI-generated title — can contain markdown link
 * syntax and newlines. Rendered verbatim they read as broken (e.g.
 * `[@Note.md](file:///Users/…)` or a multi-line instruction prompt). This
 * normalizes such titles to a readable single line for display. The local
 * (AI-titled) view passes through unchanged.
 *
 * Carries forward into `HistoryRow` when the modal becomes the History tab
 * (see [[Agent Console History Tab]] — findings folded into HistoryRow).
 *
 * Transforms (display-only — never mutates the stored title):
 *  - Markdown link   `[label](url)`     → `label`
 *  - Wikilink alias  `[[target|alias]]` → `alias`
 *  - Wikilink        `[[target]]`       → `target`
 *  - Embed/mention prefixes (`!`, leading `@` kept as part of a label)
 *  - Collapses all whitespace / newlines to single spaces, trims.
 *  - Empty / whitespace-only / null / undefined → the fallback.
 *
 * Pure: no React, no Obsidian. Total: never throws. Does NOT truncate —
 * width is owned by CSS ellipsis (see the Session History truncation fix).
 */

import { t } from "../i18n";

export function defaultSessionTitle(): string {
	return t("chat.history.untitled");
}

export function formatSessionTitle(
	raw: string | null | undefined,
	fallback: string = defaultSessionTitle(),
): string {
	if (raw == null) return fallback;

	let s = raw;
	// Wikilink with alias: [[target|alias]] / ![[target|alias]] → alias
	s = s.replace(/!?\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1");
	// Wikilink without alias: [[target]] / ![[target]] → target
	s = s.replace(/!?\[\[([^\]]+)\]\]/g, "$1");
	// Markdown link: [label](url) → label
	s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	// Collapse all whitespace (incl. newlines/tabs) to single spaces.
	s = s.replace(/\s+/g, " ").trim();

	return s.length > 0 ? s : fallback;
}
