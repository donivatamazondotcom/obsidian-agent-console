/**
 * Brand identity assets for Agent Console.
 *
 * The ribbon icon is registered via Obsidian's `addIcon(name, svgContent)` API,
 * which takes the inner SVG content (without the wrapping <svg> element). The
 * outer SVG is injected by Obsidian with viewBox="0 0 100 100".
 *
 * Geometry iterated 2026-05-23 (v0, dot eye) → 2026-05-24 (v0.1, dash eye).
 * See 04-initiatives/Agent Console/Agent Console Ribbon Icon.md in the vault
 * for the full design history.
 *
 * - Head: rounded rect, 6u margin, 88x88 inside the 100x100 viewBox
 * - Open eye: ">" chevron, 24u tall (eye-shaped, not arrow-shaped)
 * - Closed eye: horizontal dash from x=61 to x=73 with the same 10u stroke
 *   and round caps as the chevron. Mid-blink rather than fully shut — reads
 *   as a slightly more awake/active wink than the original dot.
 *
 * Uses currentColor throughout so the icon adapts to light/dark/high-contrast
 * Obsidian themes.
 */
/** Shared face geometry (viewBox 0 0 100 100): the ribbon icon and the
 * working face are drawn from the same numbers so they can't drift. */
export const FACE_GEOMETRY = {
	head: { x: 6, y: 6, size: 88, radius: 14, stroke: 10 },
	/** Open eye: the ">" chevron. */
	chevron: "M 30 38 L 44 50 L 30 62",
	/** Closed eye: the dash, stroke 10 with round caps. */
	rightDash: { x1: 61, x2: 73, y: 50 },
	/** The left eye closed: a dash of the same weight as the right one. */
	leftDash: { x1: 31, x2: 43, y: 50 },
	stroke: 10,
} as const;

const G = FACE_GEOMETRY;

export const AGENT_CONSOLE_SVG = `<rect x="${G.head.x}" y="${G.head.y}" width="${G.head.size}" height="${G.head.size}" rx="${G.head.radius}" ry="${G.head.radius}" fill="none" stroke="currentColor" stroke-width="${G.head.stroke}" />
<path d="${G.chevron}" fill="none" stroke="currentColor" stroke-width="${G.stroke}" stroke-linecap="round" stroke-linejoin="round" />
<line x1="${G.rightDash.x1}" y1="${G.rightDash.y}" x2="${G.rightDash.x2}" y2="${G.rightDash.y}" stroke="currentColor" stroke-width="${G.stroke}" stroke-linecap="round" />`;
