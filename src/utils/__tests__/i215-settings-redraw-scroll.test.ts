/**
 * I215: toggling a setting that rebuilds its settings sub-page jumps the
 * page to the top (related to upstream RAIT-09 50853fe, which fixed the same
 * bug class in upstream's imperative settings tab).
 *
 * Root cause (measured live, Obsidian 1.14.5): clicking a toggle focuses its
 * hidden checkbox. When the sub-page then redraws (`empty()` + rebuild), the
 * focused element is removed and Chromium resets the page scroller's
 * scrollTop. A redraw with nothing focused keeps its scroll; a redraw with a
 * toggle focused drops 400 → 38.5.
 *
 * jsdom does no layout, so the scroller below models that platform behavior:
 * removing the focused element zeroes the scroller's scrollTop. The test
 * asserts the user-visible outcome — the page's scroll position after a
 * redraw — not that any helper was called.
 */

import { describe, expect, it } from "vitest";

import { redrawPreservingScroll } from "../preserve-scroll";

/** A page scroller (`.setting-page`) wrapping the sub-page's containerEl. */
function makePage() {
	const scroller = document.createElement("div");
	scroller.className = "setting-page vertical-tab-content";
	let top = 0;
	Object.defineProperty(scroller, "scrollTop", {
		configurable: true,
		get: () => top,
		set: (v: number) => {
			top = v;
		},
	});
	const content = document.createElement("div");
	content.className = "setting-page-content";
	scroller.appendChild(content);
	document.body.appendChild(scroller);

	const render = () => {
		for (let i = 0; i < 20; i++) {
			const row = document.createElement("div");
			row.className = "setting-item";
			const input = document.createElement("input");
			input.type = "checkbox";
			row.appendChild(input);
			content.appendChild(row);
		}
	};
	// Platform model: removing the focused element resets the scroll.
	const empty = () => {
		if (content.contains(document.activeElement)) top = 0;
		content.replaceChildren();
	};
	render();
	return { scroller, content, render, empty };
}

describe("I215: rebuilding a settings sub-page keeps its scroll position", () => {
	it("keeps the scroll position when a focused toggle is rebuilt", () => {
		const { scroller, content, render, empty } = makePage();
		scroller.scrollTop = 400;
		content.querySelectorAll("input")[10].focus();
		expect(document.activeElement?.tagName).toBe("INPUT");

		redrawPreservingScroll(content, () => {
			empty();
			render();
		});

		expect(scroller.scrollTop).toBe(400);
		scroller.remove();
	});

	it("leaves a page at the top where it was", () => {
		const { scroller, content, render, empty } = makePage();
		redrawPreservingScroll(content, () => {
			empty();
			render();
		});
		expect(scroller.scrollTop).toBe(0);
		scroller.remove();
	});

	it("still redraws when there is no scrolling ancestor", () => {
		const orphan = document.createElement("div");
		let rendered = false;
		redrawPreservingScroll(orphan, () => {
			rendered = true;
		});
		expect(rendered).toBe(true);
	});
});
