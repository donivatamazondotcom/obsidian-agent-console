/**
 * Session tab keyboard focus ring (TS-I08).
 *
 * The tab is a custom `div role="tab"`. Obsidian's built-in focus ring only
 * lands on native `<button>` / `.clickable-icon` elements, so without an
 * explicit `.agent-client-tab:focus-visible` rule a keyboard user can focus a
 * tab but cannot SEE which tab has focus.
 *
 * The ring must be INSET: the strip `.agent-client-tab-bar-scroll` sets
 * `overflow-y: hidden`, which clips any ring drawn outside the tab's box
 * (top and bottom edges disappear). An inset box-shadow stays inside the box.
 *
 * jsdom does not apply stylesheets, so this parses the shipped CSS directly
 * (same approach as styles-animation-gating.test.ts). Companion check: the
 * (ST) note's CDP probe reads the computed box-shadow in a real Obsidian.
 *
 * Reproduce-first: on `main` @ 4cadbd7 there is no such rule → red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Rule } from "postcss";

const root = postcss.parse(
	readFileSync(resolve(process.cwd(), "styles.css"), "utf8"),
);

function declsFor(selector: string): Record<string, string> {
	const out: Record<string, string> = {};
	root.walkRules((rule: Rule) => {
		if (!rule.selectors.includes(selector)) return;
		rule.walkDecls((d) => {
			out[d.prop] = d.value;
		});
	});
	return out;
}

describe("session tab focus ring (TS-I08)", () => {
	it("draws a visible ring on a keyboard-focused tab", () => {
		const decls = declsFor(".agent-client-tab:focus-visible");
		expect(decls["box-shadow"]).toBeDefined();
		expect(decls["box-shadow"]).not.toBe("none");
		expect(decls["box-shadow"]).toContain(
			"var(--background-modifier-border-focus)",
		);
	});

	it("draws the ring inset so the strip's overflow does not clip it", () => {
		const decls = declsFor(".agent-client-tab:focus-visible");
		expect(decls["box-shadow"]).toMatch(/^inset\b/);
	});

	it("does not also add an outline (one ring, not two)", () => {
		const decls = declsFor(".agent-client-tab:focus-visible");
		expect(decls["outline"]).toBe("none");
	});
});
