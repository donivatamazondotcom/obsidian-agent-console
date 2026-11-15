/**
 * I357: the CSS half of "scroll anchoring on while scrolled up".
 *
 * useAutoScrollPin sets SCROLL_ANCHORING_ATTR on the chat scroller while
 * the tab isn't pinned to the bottom; styles.css turns native scroll
 * anchoring back on under it. If the attribute name drifts, or an override
 * goes missing, the fix silently stops working while every hook test stays
 * green. jsdom has no layout engine, so the outcome itself is measured in a
 * running Obsidian by INV-11; this pins the contract between the two files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { SCROLL_ANCHORING_ATTR } from "../ui/use-auto-scroll-pin.types";

const root = postcss.parse(
	readFileSync(resolve(process.cwd(), "styles.css"), "utf8"),
	{ from: "styles.css" },
);

/** Every overflow-anchor value set for an exact selector, in file order. */
function anchorValues(selector: string): string[] {
	const out: string[] = [];
	root.walkRules((rule) => {
		const normalized = rule.selectors.map((s) => s.replace(/\s+/g, " ").trim());
		if (!normalized.includes(selector)) return;
		rule.walkDecls("overflow-anchor", (d) => {
			out.push(d.value);
		});
	});
	return out;
}

const SCROLLER = ".agent-client-chat-view-messages";
const UNDER = `${SCROLLER}[${SCROLL_ANCHORING_ATTR}]`;

describe("I357 scroll anchoring CSS", () => {
	it("keeps anchoring off by default on the scroller, the content and its children", () => {
		expect(anchorValues(SCROLLER)).toEqual(["none"]);
		expect(anchorValues(".agent-client-chat-content")).toEqual(["none"]);
		expect(anchorValues(".agent-client-chat-content > *")).toEqual(["none"]);
	});

	it("turns it on under the attribute for the scroller, the content and the rows", () => {
		expect(anchorValues(UNDER)).toEqual(["auto"]);
		expect(anchorValues(`${UNDER} .agent-client-chat-content`)).toEqual(["auto"]);
		// Rows by class: a universal `> *` subject restyles the whole
		// transcript on every pin change (21 ms vs 1.6 ms on 478 rows).
		expect(
			anchorValues(`${UNDER} .agent-client-chat-content > .agent-client-message-row`),
		).toEqual(["auto"]);
		expect(anchorValues(`${UNDER} .agent-client-chat-content > *`)).toEqual([]);
	});

	it("excludes everything that sits below a message's growing content", () => {
		for (const sel of [
			".agent-client-message-actions",
			".agent-client-loading-indicator",
			".agent-client-scroll-to-bottom",
			".agent-client-jump-to-reply-start-anchor",
			// Chat Timestamps: prompt, end and gap stamps sit below or between
			// growing content.
			".agent-client-stamp",
		]) {
			expect(anchorValues(sel), sel).toEqual(["none"]);
		}
		// Nothing under the attribute may turn them back on.
		const overridden: string[] = [];
		root.walkRules((rule) => {
			if (!rule.selector.includes(`[${SCROLL_ANCHORING_ATTR}]`)) return;
			const turnsOn = rule.nodes.some(
				(n) => n.type === "decl" && n.prop === "overflow-anchor" && n.value !== "none",
			);
			if (!turnsOn) return;
			for (const s of rule.selectors) {
				if (/message-actions|loading-indicator|scroll-to-bottom|jump-to-reply-start-anchor|agent-client-stamp/.test(s)) overridden.push(s);
			}
		});
		expect(overridden).toEqual([]);
	});
});
