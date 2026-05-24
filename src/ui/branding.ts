/**
 * Brand identity assets for Agent Console.
 *
 * The ribbon icon is registered via Obsidian's `addIcon(name, svgContent)` API,
 * which takes the inner SVG content (without the wrapping <svg> element). The
 * outer SVG is injected by Obsidian with viewBox="0 0 100 100".
 *
 * Geometry locked 2026-05-23 after iterative eyeball testing — see
 * 04-initiatives/Agent Console/Agent Console Ribbon Icon.md in the vault for
 * the design history (Decisions §6).
 *
 * - Head: rounded rect, 6u margin, 88x88 inside the 100x100 viewBox
 * - Open eye: ">" chevron, 24u tall (eye-shaped, not arrow-shaped)
 * - Closed eye: filled dot at r=7 (visually balanced against the chevron's
 *   10u stroke width)
 *
 * Uses currentColor throughout so the icon adapts to light/dark/high-contrast
 * Obsidian themes.
 */
export const AGENT_CONSOLE_SVG = `<rect x="6" y="6" width="88" height="88" rx="14" ry="14" fill="none" stroke="currentColor" stroke-width="10" />
<path d="M 30 38 L 44 50 L 30 62" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
<circle cx="67" cy="50" r="7" fill="currentColor" />`;
