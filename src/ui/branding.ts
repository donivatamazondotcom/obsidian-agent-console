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
export const AGENT_CONSOLE_SVG = `<rect x="6" y="6" width="88" height="88" rx="14" ry="14" fill="none" stroke="currentColor" stroke-width="10" />
<path d="M 30 38 L 44 50 L 30 62" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
<line x1="61" y1="50" x2="73" y2="50" stroke="currentColor" stroke-width="10" stroke-linecap="round" />`;
