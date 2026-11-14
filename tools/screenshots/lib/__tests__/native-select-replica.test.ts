/**
 * The native <select> replica: a DOM copy of the open option list, built in
 * the settings page so the shot never needs the OS popup (which needs the
 * real screen). Runs the real page expression against jsdom.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Capture modes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { nativeSelectReplicaExpression, NATIVE_SELECT_REPLICA_ID } from "../native-select-replica";

type Rect = { x: number; y: number; width: number; height: number };

function mount(selectRect: Rect, options: string[], selected: number): HTMLSelectElement {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	const row = document.createElement("div");
	row.className = "setting-item lang";
	const sel = document.createElement("select");
	options.forEach((label, i) => {
		const o = document.createElement("option");
		o.value = `v${i}`;
		o.textContent = label;
		sel.appendChild(o);
	});
	sel.selectedIndex = selected;
	sel.style.fontFamily = "Inter";
	sel.style.fontSize = "14px";
	sel.style.color = "rgb(220, 221, 222)";
	sel.style.paddingLeft = "12px";
	const { x, y, width, height } = selectRect;
	sel.getBoundingClientRect = () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect;
	row.appendChild(sel);
	document.body.appendChild(row);
	return sel;
}

function run(selector: string, inner: [number, number] = [1200, 900]): unknown {
	const win = { innerWidth: inner[0], innerHeight: inner[1], getComputedStyle: (el: Element) => window.getComputedStyle(el) };
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	return new Function("activeDocument", "activeWindow", `return (${nativeSelectReplicaExpression(selector)});`)(document, win);
}

const replica = () => document.getElementById(NATIVE_SELECT_REPLICA_ID) as HTMLElement;
const px = (v: string) => parseFloat(v);

describe("nativeSelectReplicaExpression", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("lists every option in order, marking only the selected one", () => {
		mount({ x: 800, y: 300, width: 200, height: 30 }, ["Auto (match Obsidian)", "English", "日本語"], 0);
		expect(run(".lang select")).toBe("ok");
		const rows = Array.from(replica().children) as HTMLElement[];
		expect(rows.map((r) => r.textContent)).toEqual(["Auto (match Obsidian)", "English", "日本語"]);
		expect(rows.map((r) => r.classList.contains("is-selected"))).toEqual([true, false, false]);
		// Rows hold text only, so the settings crop keeps each row whole.
		expect(rows.every((r) => r.children.length === 0)).toBe(true);
	});

	it("is a fixed overlay in the page body that screen readers skip", () => {
		mount({ x: 800, y: 300, width: 200, height: 30 }, ["a", "b"], 1);
		run(".lang select");
		const el = replica();
		expect(el.parentElement).toBe(document.body);
		expect(el.style.position).toBe("fixed");
		expect(el.getAttribute("aria-hidden")).toBe("true");
	});

	it("takes its font and text color from the select's computed style", () => {
		mount({ x: 800, y: 300, width: 200, height: 30 }, ["a", "b"], 0);
		run(".lang select");
		expect(replica().style.fontFamily).toBe("Inter");
		expect(replica().style.fontSize).toBe("14px");
		expect(replica().style.color).toBe("rgb(220, 221, 222)");
	});

	it("draws the selected option over the select, as the macOS popup does", () => {
		mount({ x: 800, y: 300, width: 200, height: 30 }, ["a", "b", "c", "d"], 2);
		run(".lang select");
		const el = replica();
		const rows = Array.from(el.children) as HTMLElement[];
		const rowH = px(rows[0].style.height);
		const selectedCenter = px(el.style.top) + px(el.style.borderTopWidth) + px(el.style.paddingTop) + 2 * rowH + rowH / 2;
		expect(selectedCenter).toBeCloseTo(315, 5);
		// Option text starts where the select's own text starts.
		const textStart = px(el.style.left) + px(el.style.borderLeftWidth) + px(el.style.paddingLeft) + px(rows[0].style.paddingLeft);
		expect(textStart).toBeCloseTo(812, 5);
	});

	it("stays inside the window when the select sits near its top edge", () => {
		mount({ x: 800, y: 10, width: 200, height: 30 }, ["a", "b", "c", "d", "e"], 4);
		run(".lang select");
		expect(px(replica().style.top)).toBeGreaterThanOrEqual(4);
	});

	it("stays inside the window when the select sits near its bottom edge", () => {
		mount({ x: 800, y: 860, width: 200, height: 30 }, ["a", "b", "c", "d", "e"], 0);
		run(".lang select", [1200, 900]);
		const el = replica();
		const rows = Array.from(el.children) as HTMLElement[];
		const height = 2 * px(el.style.borderTopWidth) + 2 * px(el.style.paddingTop) + rows.length * px(rows[0].style.height);
		expect(px(el.style.top) + height).toBeLessThanOrEqual(900 - 4);
	});

	it("replaces a replica left by an earlier run", () => {
		mount({ x: 800, y: 300, width: 200, height: 30 }, ["a", "b"], 0);
		run(".lang select");
		run(".lang select");
		expect(document.querySelectorAll(`#${NATIVE_SELECT_REPLICA_ID}`)).toHaveLength(1);
	});

	it("names the problem when the selector matches nothing, or not a select", () => {
		mount({ x: 800, y: 300, width: 200, height: 30 }, ["a"], 0);
		expect(run(".missing select")).toBe("no <select> matches .missing select");
		expect(run(".lang")).toBe(".lang is not a <select>");
		expect(replica()).toBeNull();
	});
});
