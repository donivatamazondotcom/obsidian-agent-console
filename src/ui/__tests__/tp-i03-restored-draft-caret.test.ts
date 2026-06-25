/**
 * TP-I03 — Restored draft cursor lands at start of prompt.
 *
 * Repro for [[TP-I03 Restored draft cursor lands at start of prompt]] (epic
 * [[ACP Preserve Unsent Draft Text Per Tab]], #94).
 *
 * SYMPTOM: when a tab's composer is seeded with a restored unsent draft and
 * focused on mount, the caret lands at index 0 (start of the draft) instead of
 * at the end, so the user can't immediately keep typing.
 *
 * MECHANISM: InputArea's mount auto-focus effect calls `textarea.focus()` but
 * never sets a selection range. A textarea focused with a pre-filled value
 * defaults its caret to 0. `focusComposerAtEnd` is the extracted helper that
 * effect calls; this test pins its caret-placement contract on a real jsdom
 * textarea.
 *
 * Per SDLC § Stack-Trace Patch Anti-Pattern: this test fails against the
 * focus-only baseline (caret at 0) before the fix, and passes after.
 */

import { afterEach, describe, expect, it } from "vitest";
import { focusComposerAtEnd } from "../composer-focus";

afterEach(() => {
	document.body.innerHTML = "";
});

function makeTextarea(value: string): HTMLTextAreaElement {
	const el = document.createElement("textarea");
	el.value = value;
	document.body.appendChild(el);
	// Move the caret to the start to model the buggy default a fresh focus
	// produces on a pre-filled textarea.
	el.setSelectionRange(0, 0);
	return el;
}

describe("focusComposerAtEnd (TP-I03)", () => {
	it("places the caret at the END of a restored draft", () => {
		const draft = "half-typed prompt I have not sent yet";
		const el = makeTextarea(draft);

		focusComposerAtEnd(el);

		expect(document.activeElement).toBe(el);
		expect(el.selectionStart).toBe(draft.length);
		expect(el.selectionEnd).toBe(draft.length);
	});

	it("leaves the caret at 0 for an empty composer (unchanged behaviour)", () => {
		const el = makeTextarea("");

		focusComposerAtEnd(el);

		expect(document.activeElement).toBe(el);
		expect(el.selectionStart).toBe(0);
		expect(el.selectionEnd).toBe(0);
	});

	it("is a no-op when the element is null", () => {
		expect(() => focusComposerAtEnd(null)).not.toThrow();
	});
});
