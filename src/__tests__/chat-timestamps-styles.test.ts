/**
 * Chat Timestamps PR 2 — the CSS contract for stamps.
 *
 * jsdom applies no layout, so these pin the rules whose loss would only show
 * in a running Obsidian: the hover-row time is hidden until its row shows, so a
 * selection across replies must not copy it; and only that one-line time stays
 * on one line, so a long end stamp can wrap in a narrow pane.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Per-output times on hover.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";

const root = postcss.parse(readFileSync(resolve(process.cwd(), "styles.css"), "utf8"), {
	from: "styles.css",
});

function decls(selector: string, prop: string): string[] {
	const out: string[] = [];
	root.walkRules((rule) => {
		if (!rule.selectors.map((s) => s.trim()).includes(selector)) return;
		rule.walkDecls(prop, (d) => {
			out.push(d.value);
		});
	});
	return out;
}

describe("stamp styles", () => {
	it("the hover-row time can't be selected and stays on one line", () => {
		expect(decls(".agent-client-stamp-hover", "user-select")).toEqual(["none"]);
		expect(decls(".agent-client-stamp-hover", "white-space")).toEqual(["nowrap"]);
	});

	it("other stamps may wrap", () => {
		for (const sel of [
			".agent-client-stamp",
			".agent-client-stamp-prompt",
			".agent-client-stamp-end",
			".agent-client-stamp-gap",
		]) {
			expect(decls(sel, "white-space"), sel).toEqual([]);
		}
	});

	it("stamps use the theme's faint text color, not a fixed color", () => {
		expect(decls(".agent-client-stamp", "color")).toEqual(["var(--text-faint)"]);
	});

	it("block stamps shrink to their text, so only the time is a hover target", () => {
		for (const sel of [".agent-client-stamp-prompt", ".agent-client-stamp-end", ".agent-client-stamp-gap"]) {
			expect(decls(sel, "display"), sel).toEqual(["block"]);
			expect(decls(sel, "width"), sel).toEqual(["fit-content"]);
			// Spacing is margin, never horizontal padding, which would widen the target.
			expect(decls(sel, "padding"), sel).toEqual([]);
			expect(decls(sel, "padding-left"), sel).toEqual([]);
			expect(decls(sel, "padding-right"), sel).toEqual([]);
			expect(decls(sel, "padding-inline"), sel).toEqual([]);
		}
	});

	it("a prompt stamp sits at the bubble's right edge, and its wrapped lines align right", () => {
		expect(decls(".agent-client-stamp-prompt", "margin")).toEqual(["0 var(--size-4-3) 0 auto"]);
		expect(decls(".agent-client-stamp-prompt", "text-align")).toEqual(["right"]);
		// Room for the margin on each side in a very narrow pane.
		expect(decls(".agent-client-stamp-prompt", "max-width")).toEqual(["calc(100% - 2 * var(--size-4-3))"]);
	});

	it("prompt and end stamps keep their 2px gap below the bubble (padding doesn't collapse)", () => {
		for (const sel of [".agent-client-stamp-prompt", ".agent-client-stamp-end"]) {
			expect(decls(sel, "padding-top"), sel).toEqual(["2px"]);
		}
	});
});

describe("tool-row time and live line styles (PR 3)", () => {
	it("a row's time stays on one line in tabular figures and never shrinks, so a tick can't re-wrap the row", () => {
		expect(decls(".agent-client-tool-call-time", "white-space")).toEqual(["nowrap"]);
		expect(decls(".agent-client-tool-call-time", "font-variant-numeric")).toEqual(["tabular-nums"]);
		expect(decls(".agent-client-tool-call-time", "flex-shrink")).toEqual(["0"]);
	});

	it("a row's time uses the theme's faint text color and is never selected into a copy", () => {
		expect(decls(".agent-client-tool-call-time", "color")).toEqual(["var(--text-faint)"]);
		expect(decls(".agent-client-tool-call-time", "user-select")).toEqual(["none"]);
	});

	it("a long tool title shrinks before the facts do", () => {
		expect(decls(".agent-client-loading-status", "display")).toEqual(["flex"]);
		expect(decls(".agent-client-loading-status-title", "overflow")).toEqual(["hidden"]);
		expect(decls(".agent-client-loading-status-title", "text-overflow")).toEqual(["ellipsis"]);
		expect(decls(".agent-client-loading-status-title", "min-width")).toEqual(["0"]);
		const titleShrink = Number(decls(".agent-client-loading-status-title", "flex-shrink")[0]);
		const factsShrink = Number(decls(".agent-client-loading-status-facts", "flex-shrink")[0]);
		expect(titleShrink).toBeGreaterThan(100 * factsShrink);
	});

	it("the status line stays one line", () => {
		expect(decls(".agent-client-loading-status", "white-space")).toEqual(["nowrap"]);
		expect(decls(".agent-client-loading-status", "text-overflow")).toEqual(["ellipsis"]);
	});

	it("the status line ticks in tabular figures, so a cut title's ellipsis doesn't move each second", () => {
		expect(decls(".agent-client-loading-status", "font-variant-numeric")).toEqual(["tabular-nums"]);
	});

	it("nothing in PR 3 adds a warning tone (the Signals tenet)", () => {
		const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");
		expect(css).not.toMatch(/-stall|tool-call-time[a-z-]*warn|loading-status[a-z-]*warn/);
	});
});
