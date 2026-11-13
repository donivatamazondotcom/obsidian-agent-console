/**
 * Settings-shot crop: the visible content inside each crop element, not the
 * element's whole box. On Obsidian 1.13+ the settings pane (`.vertical-tab-content`)
 * is far wider than its 700 px content column, and the page wrappers
 * (`.setting-page-titlebar`, `.setting-page-content`) span the pane, so
 * cropping the pane leaves wide empty margins and empty space below.
 *
 * Rules, per crop element (probed against Obsidian 1.15.0, 2026-11-12):
 * - The visible region is the element's box inside the window.
 * - A child as wide as its parent (a wrapper; the crop element counts as
 *   the outermost parent) is stepped through, and
 *   its content is judged on its own: a title bar's button and title never
 *   make a cut content group next to them count as droppable.
 * - A setting row (`.setting-item`) is one unit: kept only when wholly
 *   visible, so the window edge never cuts a row in half.
 * - Any other wholly visible child is kept whole (a group with its rounded
 *   box, the back button, a title).
 * - A partly visible child is dropped when whole units were found at that
 *   level, so a group the window edge cuts never shows a stray heading.
 *   Only when nothing at that level is whole is it stepped through, so a
 *   group taller than the window keeps its wholly visible rows.
 * - A crop element that is itself a setting row is kept as it is.
 * - When nothing qualifies, the visible region is used.
 *
 * Each box also carries `limitTop` / `limitBottom`: the nearest edge of a
 * unit it left out above or below, so crop padding stops short of it.
 *
 * The expression runs where the settings DOM lives (`activeDocument` /
 * `activeWindow`, see Cdp.evaluateInSettings) and returns one rect, or null
 * for a selector that matches nothing, per selector.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Window, DPR and focus.
 * Tests: tools/screenshots/lib/__tests__/settings-crop.test.ts.
 */

/** Fraction of its parent's width (at most the crop element's) at which a child counts as a wrapper. */
const WRAPPER_WIDTH = 0.9;
/** Rounding slack, in CSS px, for "wholly visible". */
const SLACK = 0.5;

export function settingsContentBoxesExpression(selectors: readonly string[]): string {
	return `(() => {
		const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
		const contentBox = (root) => {
			const rr = rect(root);
			const vx = Math.max(rr.x, 0), vy = Math.max(rr.y, 0);
			const vr = Math.min(rr.x + rr.w, activeWindow.innerWidth), vb = Math.min(rr.y + rr.h, activeWindow.innerHeight);
			const visible = { x: vx, y: vy, width: Math.max(0, vr - vx), height: Math.max(0, vb - vy) };
			if (root.matches(".setting-item")) return visible;
			const inside = (r) => r.x >= vx - ${SLACK} && r.y >= vy - ${SLACK} && r.x + r.w <= vr + ${SLACK} && r.y + r.h <= vb + ${SLACK};
			const meets = (r) => r.x < vr && r.x + r.w > vx && r.y < vb && r.y + r.h > vy;
			const dropped = [];
			const collect = (el) => {
				const whole = [], partial = [];
				const pw = Math.min(rr.w, rect(el).w);
				for (const c of el.children) {
					const r = rect(c);
					if (r.w <= 0 || r.h <= 0 || !meets(r)) continue;
					if (c.matches(".setting-item")) { if (inside(r)) whole.push(r); else dropped.push(r); continue; }
					if (r.w >= pw * ${WRAPPER_WIDTH}) {
						if (c.children.length) whole.push(...collect(c));
						else if (inside(r) && (c.textContent || "").trim()) whole.push(r);
						continue;
					}
					if (inside(r)) whole.push(r);
					else if (c.children.length) partial.push(c);
				}
				if (whole.length) {
					for (const p of partial) dropped.push(rect(p));
					return whole;
				}
				return partial.flatMap(collect);
			};
			const units = collect(root);
			if (!units.length) return visible;
			const x = Math.min(...units.map((u) => u.x)), y = Math.min(...units.map((u) => u.y));
			const right = Math.max(...units.map((u) => u.x + u.w)), bottom = Math.max(...units.map((u) => u.y + u.h));
			const box = { x, y, width: right - x, height: bottom - y };
			const below = dropped.filter((d) => d.y >= bottom - ${SLACK}).map((d) => d.y);
			const above = dropped.filter((d) => d.y + d.h <= y + ${SLACK}).map((d) => d.y + d.h);
			if (below.length) box.limitBottom = Math.min(...below);
			if (above.length) box.limitTop = Math.max(...above);
			return box;
		};
		return ${JSON.stringify(selectors)}.map((s) => { const el = activeDocument.querySelector(s); return el ? contentBox(el) : null; });
	})()`;
}
