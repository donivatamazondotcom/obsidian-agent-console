/**
 * Chat header title color ([[Session Title in the Chat Header]] Decision 15).
 *
 * The chat's title reads in the normal text color, and only the extras after
 * it (agent, model, the "agent didn't load" warning) are grey. Before this,
 * the title inherited the header slot's `--nav-item-color`, which equals
 * `--text-muted` in the default dark theme, so the title and the agent name
 * read as one string (UX review row 4, code review L1).
 *
 * jsdom does not apply stylesheets, so this parses the shipped CSS directly
 * (same approach as styles-tab-focus-ring.test.ts). The (ST) note's CDP check
 * reads the computed colors in a real Obsidian.
 *
 * Reproduce-first: on `6b346ab` the title rule sets no color → red.
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

describe("chat header title color (Decision 15)", () => {
	it("shows the title in the normal text color", () => {
		expect(declsFor(".acp-header-branded-title").color).toBe(
			"var(--text-normal)",
		);
	});

	it("keeps the extras grey", () => {
		expect(declsFor(".acp-header-branded-extras").color).toBe(
			"var(--text-muted)",
		);
	});
});
