/**
 * The fixtures theme leaves the chat header's text alone
 * ([[Session Title in the Chat Header]] § Screenshots, Test 9 theme half).
 *
 * Three capture-time rules used to hide the "· Not connected" suffix and the
 * separator before it, then redraw " · " before a trailing model. The header
 * no longer shows a connection state (Decision 6), so in the new DOM those
 * rules only hide real separators in captures ("· · gpt-5",
 * "Auto SAkiro_default"). A header shot must show the header as users see it,
 * so the theme may not target any `.acp-header-branded` element.
 *
 * Reproduce-first: on `d2662152` the theme still has the three rules → red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Rule } from "postcss";

const THEME = resolve(
	process.cwd(),
	"tools/screenshots/fixtures/studio/.obsidian/themes/Fixture/theme.css",
);

describe("fixtures theme and the chat header", () => {
	it("has no rule targeting the header's text", () => {
		const root = postcss.parse(readFileSync(THEME, "utf8"));
		const hits: string[] = [];
		root.walkRules((rule: Rule) => {
			if (/\.acp-header-branded/.test(rule.selector)) hits.push(rule.selector);
		});
		expect(hits).toEqual([]);
	});
});
