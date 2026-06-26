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
