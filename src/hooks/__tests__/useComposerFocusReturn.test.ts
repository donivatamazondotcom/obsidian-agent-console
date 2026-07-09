/**
 * useComposerFocusReturn — hook wiring tests.
 *
 * Spec: [[Composer Focus Return After State Change]] (T1/T3/T6 at the hook
 * level; the pure truth table is pinned in composer-focus-tracker.test.ts T8).
 *
 * Exercises the document focusin listener + the rAF-deferred refocus. rAF is
 * stubbed to run synchronously so the assertion is deterministic in jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useComposerFocusReturn } from "../useComposerFocusReturn";
import { FOCUS_CLUSTER_ATTR } from "../../ui/composer-focus-tracker";

function makeComposer(value: string): HTMLTextAreaElement {
	const el = document.createElement("textarea");
	el.value = value;
	document.body.appendChild(el);
	el.setSelectionRange(0, 0);
	return el;
}

function focusInOn(node: HTMLElement) {
	node.dispatchEvent(new Event("focusin", { bubbles: true }));
}

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

describe("useComposerFocusReturn", () => {
	it("returns focus to the composer at end when the composer had focus (T1/T6)", () => {
		const composer = makeComposer("half-typed prompt");
		const { result } = renderHook(() => useComposerFocusReturn());
		result.current.composerElRef.current = composer;

		// User focuses the composer (arms the guardrail).
		focusInOn(composer);
		// User picks from a tagged trigger control, then its menu.
		const trigger = document.createElement("button");
		trigger.setAttribute(FOCUS_CLUSTER_ATTR, "");
		document.body.appendChild(trigger);
		focusInOn(trigger);

		result.current.returnFocusToComposer();

		expect(document.activeElement).toBe(composer);
		expect(composer.selectionStart).toBe("half-typed prompt".length);
		expect(composer.selectionEnd).toBe("half-typed prompt".length);
	});

	it("does NOT steal focus when focus was outside the composer cluster (T3)", () => {
		const composer = makeComposer("draft");
		const note = document.createElement("div");
		note.tabIndex = 0;
		document.body.appendChild(note);

		const { result } = renderHook(() => useComposerFocusReturn());
		result.current.composerElRef.current = composer;

		// Focus lands on an unrelated note, then a trigger control is clicked.
		focusInOn(note);
		const trigger = document.createElement("button");
		trigger.setAttribute(FOCUS_CLUSTER_ATTR, "");
		document.body.appendChild(trigger);
		focusInOn(trigger);
		note.focus();

		result.current.returnFocusToComposer();

		expect(document.activeElement).toBe(note);
		expect(document.activeElement).not.toBe(composer);
	});

	it("is a no-op when the composer was never focused", () => {
		const composer = makeComposer("draft");
		const { result } = renderHook(() => useComposerFocusReturn());
		result.current.composerElRef.current = composer;

		// No focusin on the composer at all.
		result.current.returnFocusToComposer();

		expect(document.activeElement).not.toBe(composer);
	});

	it("is a no-op when no composer element is registered", () => {
		const { result } = renderHook(() => useComposerFocusReturn());
		expect(() => result.current.returnFocusToComposer()).not.toThrow();
	});
});

describe("focusAfter — contract-routed focus return (I166)", () => {
	it("send refocuses the composer even when it NEVER had focus (button-click case)", () => {
		// The I166 crux: a mouse click on the Send button parks focus on the
		// button (outside the composer cluster), so composerHadFocus stays false.
		// A guarded return would no-op here — send must refocus unconditionally.
		const composer = makeComposer("");
		const button = document.createElement("button");
		document.body.appendChild(button);

		const { result } = renderHook(() => useComposerFocusReturn());
		result.current.composerElRef.current = composer;

		// Focus lands on the button (the click target), NOT the composer.
		button.focus();
		focusInOn(button);
		expect(document.activeElement).toBe(button);

		result.current.focusAfter("send");

		expect(document.activeElement).toBe(composer);
	});

	it("stop refocuses the composer unconditionally too", () => {
		const composer = makeComposer("");
		const button = document.createElement("button");
		document.body.appendChild(button);
		const { result } = renderHook(() => useComposerFocusReturn());
		result.current.composerElRef.current = composer;

		button.focus();
		focusInOn(button);
		result.current.focusAfter("stop");

		expect(document.activeElement).toBe(composer);
	});

	it("guarded action (set-model) does NOT refocus when the composer never had focus", () => {
		const composer = makeComposer("draft");
		const note = document.createElement("div");
		note.tabIndex = 0;
		document.body.appendChild(note);
		const { result } = renderHook(() => useComposerFocusReturn());
		result.current.composerElRef.current = composer;

		note.focus();
		focusInOn(note);
		result.current.focusAfter("set-model");

		expect(document.activeElement).toBe(note);
		expect(document.activeElement).not.toBe(composer);
	});

	it("guarded action (set-model) refocuses when the user was in the composer", () => {
		const composer = makeComposer("half-typed");
		const trigger = document.createElement("button");
		trigger.setAttribute(FOCUS_CLUSTER_ATTR, "");
		document.body.appendChild(trigger);
		const { result } = renderHook(() => useComposerFocusReturn());
		result.current.composerElRef.current = composer;

		// User was in the composer, then activated a tagged trigger control.
		focusInOn(composer);
		focusInOn(trigger);
		result.current.focusAfter("set-model");

		expect(document.activeElement).toBe(composer);
		expect(composer.selectionStart).toBe("half-typed".length);
	});
});
