/**
 * Composer focus-return guardrail — reducer + classifier unit tests.
 *
 * Spec: [[Composer Focus Return After State Change]] T8 / Decision D5.
 *
 * Pins the `composerHadFocus` truth table without a live Obsidian or a mounted
 * React tree. The scenarios mirror the spec's table: focus moving composer →
 * cluster → menu keeps the flag set (so a keyboard or mouse pick returns
 * focus), while focus landing outside the cluster disarms it.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	classifyFocusTarget,
	composerFocusReducer,
	FOCUS_CLUSTER_ATTR,
	INITIAL_COMPOSER_FOCUS_STATE,
	type FocusZone,
} from "../composer-focus-tracker";

afterEach(() => {
	document.body.innerHTML = "";
});

/** Replay a sequence of zones through the reducer from the initial state. */
function run(zones: FocusZone[]): boolean {
	let state = INITIAL_COMPOSER_FOCUS_STATE;
	for (const z of zones) state = composerFocusReducer(state, z);
	return state.composerHadFocus;
}

describe("composerFocusReducer (guardrail truth table)", () => {
	it("arms when focus enters the composer", () => {
		expect(run(["composer"])).toBe(true);
	});

	it("Typing → mouse-pick a model: composer → cluster (button) → cluster (menu) stays armed", () => {
		expect(run(["composer", "cluster", "cluster"])).toBe(true);
	});

	it("Typing → Tab to dropdown → Enter-pick: composer → cluster stays armed (keyboard too)", () => {
		expect(run(["composer", "cluster"])).toBe(true);
	});

	it("Focus in a note → click dropdown: outside then cluster stays disarmed", () => {
		expect(run(["outside", "cluster"])).toBe(false);
	});

	it("Panel open, composer never focused → cluster pick stays disarmed", () => {
		expect(run(["cluster"])).toBe(false);
	});

	it("leaving the cluster disarms a previously-armed composer", () => {
		expect(run(["composer", "outside"])).toBe(false);
	});

	it("re-entering the composer re-arms after leaving", () => {
		expect(run(["composer", "outside", "composer"])).toBe(true);
	});

	it("is referentially stable when the zone does not change the flag", () => {
		const armed = { composerHadFocus: true };
		expect(composerFocusReducer(armed, "cluster")).toBe(armed);
		expect(composerFocusReducer(armed, "composer")).toBe(armed);
		const disarmed = { composerHadFocus: false };
		expect(composerFocusReducer(disarmed, "outside")).toBe(disarmed);
		expect(composerFocusReducer(disarmed, "cluster")).toBe(disarmed);
	});
});

describe("classifyFocusTarget", () => {
	function el(tag: string): HTMLElement {
		const e = document.createElement(tag);
		document.body.appendChild(e);
		return e;
	}

	it("classifies the composer textarea as 'composer'", () => {
		const composer = el("textarea");
		expect(classifyFocusTarget(composer, composer)).toBe("composer");
	});

	it("classifies a tagged trigger control as 'cluster'", () => {
		const composer = el("textarea");
		const btn = el("button");
		btn.setAttribute(FOCUS_CLUSTER_ATTR, "");
		expect(classifyFocusTarget(btn, composer)).toBe("cluster");
	});

	it("classifies a child of a tagged control as 'cluster' (closest)", () => {
		const composer = el("textarea");
		const wrap = el("div");
		wrap.setAttribute(FOCUS_CLUSTER_ATTR, "");
		const inner = document.createElement("span");
		wrap.appendChild(inner);
		expect(classifyFocusTarget(inner, composer)).toBe("cluster");
	});

	it("classifies an Obsidian .menu item as 'cluster'", () => {
		const composer = el("textarea");
		const menu = el("div");
		menu.className = "menu";
		const item = document.createElement("div");
		menu.appendChild(item);
		expect(classifyFocusTarget(item, composer)).toBe("cluster");
	});

	it("classifies an unrelated element (a note) as 'outside'", () => {
		const composer = el("textarea");
		const note = el("div");
		expect(classifyFocusTarget(note, composer)).toBe("outside");
	});

	it("classifies null / non-HTMLElement targets as 'outside'", () => {
		expect(classifyFocusTarget(null, null)).toBe("outside");
	});

	it("does not treat the composer as cluster-only when composerEl is null", () => {
		// Before the composer mounts, a focusin on a plain element is outside.
		const note = el("div");
		expect(classifyFocusTarget(note, null)).toBe("outside");
	});
});
