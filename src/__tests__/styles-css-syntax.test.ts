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
