/**
 * CSS syntax-validity guard — every tracked .css file.
 *
 * Regression guard for the class of bug where an unclosed `{` (or other CSS
 * syntax error) silently truncates the cascade: a browser CSS parser swallows
 * every rule after the unterminated block, so those rules never apply at
 * runtime. The plugin build never catches it — esbuild only bundles the
 * TypeScript entry graph (`src/main.ts`); CSS files are NOT esbuild inputs
 * (none are `import`ed into the bundle), so esbuild never parses them. And
 * jsdom unit tests don't apply stylesheets. So a malformed CSS file ships
 * green.
 *
 * Root-cause incident (2026-06-28): a missing `}` on
 * `.acp-shared-links-badge--accent` in `styles.css` dropped the entire Quick
 * Prompts launcher/spacer block, re-floating the toolbar ⚡ launcher to the
 * right. See [[Agent Console Quick Prompts and Workflows]] and the I126 RCA.
 *
 * This guard enumerates EVERY tracked `.css` file (`git ls-files`, so it
 * respects .gitignore and auto-covers any CSS added in future) and validates
 * each with:
 *   1. a brace-balance invariant — the smoking gun for the unclosed-block class;
 *   2. postcss (already a dependency, jsdom-safe) — throws CssSyntaxError with a
 *      line number on an unclosed block or other malformed CSS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import postcss from "postcss";

const repoRoot = process.cwd();

/** Every tracked `.css` file, repo-relative. Respects .gitignore; excludes
 *  node_modules / build artifacts. Discovery means new CSS is covered for free. */
const cssFiles = execSync("git ls-files '*.css'", {
	cwd: repoRoot,
	encoding: "utf8",
})
	.split("\n")
	.map((s) => s.trim())
	.filter(Boolean);

describe("tracked CSS files are syntactically valid", () => {
	it("discovery found the shipped plugin stylesheet (sanity check)", () => {
		// Guards against a silently-empty discovery (e.g. git unavailable) that
		// would make the per-file checks vacuously pass.
		expect(cssFiles).toContain("styles.css");
	});

	it.each(cssFiles)(
		"%s — balanced braces + parses (no unclosed blocks)",
		(rel) => {
			const css = readFileSync(resolve(repoRoot, rel), "utf8");

			const open = (css.match(/\{/g) ?? []).length;
			const close = (css.match(/\}/g) ?? []).length;
			expect({ file: rel, open, close }).toEqual({
				file: rel,
				open,
				close: open,
			});

			expect(() =>
				postcss.parse(css, { from: rel }),
			).not.toThrow();
		},
	);
});

/**
 * I179 — Obsidian's automated plugin review lints shipped CSS and flags
 * `:has()`: "Avoid :has — it can cause significant performance issues due to
 * broad selector invalidation." A `:has()` selector shipped in v2.2.0 (the
 * A2UI-I04 action-card alignment fix) and contributed to the store marking
 * the plugin "Caution".
 *
 * The sanctioned alternative is to compute the condition in code and apply a
 * modifier class, then key the CSS off that class — identical specificity, no
 * subtree invalidation. This guard keeps `:has()` from creeping back in, since
 * neither esbuild (CSS is not a bundle input) nor jsdom tests apply stylesheets,
 * so a store-flagged selector would otherwise ship green.
 */
describe("tracked CSS files avoid store-flagged selectors", () => {
	it.each(cssFiles)("%s — no :has() selector", (rel) => {
		const css = readFileSync(resolve(repoRoot, rel), "utf8");

		// Report every offending line so a failure names the fix site directly.
		const offenders = css
			.split("\n")
			.map((line, i) => ({ line: i + 1, text: line.trim() }))
			.filter(({ text }) => /:has\s*\(/.test(text));

		expect({ file: rel, offenders }).toEqual({ file: rel, offenders: [] });
	});
});

/**
 * A2UI-I06 — long A2UI button labels painted OUTSIDE the button's background
 * box. Root cause is a platform-default interaction, not our markup:
 * Obsidian's `button` style sets `white-space: nowrap`, a fixed
 * `height: var(--input-height)` (30px) and `overflow: visible`, while
 * `.agent-client-a2ui-column` uses `align-items: stretch` — so a surface
 * button's width is the CONTAINER width regardless of its content. A label
 * wider than the panel has nowhere to wrap to and overflows the box. In a
 * `Row` the same defaults let a long unbroken label grow the button PAST the
 * surface card's edge.
 *
 * Measured in a real Obsidian window (off-screen replica, 420px panel):
 * clientWidth 420 vs scrollWidth 438 before; 420 vs 420 after (2 lines, 38px).
 *
 * This guard pins the declarations that neutralise those defaults. It is a
 * declaration-presence check by necessity: jsdom has NO layout engine, so no
 * unit test in this suite can assert the geometry. The real-layout assertion
 * lives in the in-Obsidian invariant suite as INV-7, which measures
 * scrollWidth/clientWidth and card containment against the live stylesheet.
 */
describe("A2UI button labels stay inside the button box", () => {
	it("styles.css neutralises the platform button defaults for .agent-client-a2ui-button", () => {
		const css = readFileSync(resolve(repoRoot, "styles.css"), "utf8");
		const root = postcss.parse(css, { from: "styles.css" });

		const decls = new Map<string, string>();
		root.walkRules((rule) => {
			if (rule.selectors.includes(".agent-client-a2ui-button")) {
				rule.walkDecls((d) => {
					decls.set(d.prop, d.value);
				});
			}
		});

		expect(
			decls.size,
			"no .agent-client-a2ui-button rule found in styles.css",
		).toBeGreaterThan(0);

		expect({
			// Let a too-long label wrap instead of overflowing horizontally.
			"white-space": decls.get("white-space"),
			// A single unbroken token must break rather than escape the box.
			"overflow-wrap": decls.get("overflow-wrap"),
			// Release the platform's fixed height so the box grows with the lines,
			// while keeping the one-line button visually identical.
			height: decls.get("height"),
			"min-height": decls.get("min-height"),
			// Row case: never grow past the surface card.
			"max-width": decls.get("max-width"),
		}).toEqual({
			"white-space": "normal",
			"overflow-wrap": "anywhere",
			height: "auto",
			"min-height": "var(--input-height)",
			"max-width": "100%",
		});
	});
});
