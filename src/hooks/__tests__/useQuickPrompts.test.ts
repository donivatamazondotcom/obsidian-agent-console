/**
 * Unit tests for useQuickPrompts (T18).
 *
 * The picker/chip surfaces are out-of-band but the fire outcome obeys the
 * engine: fire into an empty idle composer, insert (degrade) into a non-empty
 * one with the draft notice, no-op while queued, and the {{selection}}
 * no-selection fallback. Also covers the live prompt list reconcile.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Test Cases T18.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuickPrompts, type QuickPromptComposerBridge } from "../useQuickPrompts";
import type { QuickPromptLibrary } from "../../services/quick-prompts";
import type { QuickPrompt } from "../../types/quick-prompt";

function prompt(overrides: Partial<QuickPrompt> = {}): QuickPrompt {
	return {
		id: "debrief",
		label: "Debrief",
		body: "Debrief this meeting.",
		path: "Quick Prompts/Debrief.md",
		usesSelection: false,
		...overrides,
	};
}

/** Minimal fake library with a controllable prompt set + subscriber. */
function makeFakeLibrary(initial: QuickPrompt[]) {
	let prompts = initial;
	const subs = new Set<() => void>();
	const lib = {
		getPrompts: () => prompts,
		subscribe: (cb: () => void) => {
			subs.add(cb);
			return () => subs.delete(cb);
		},
	} as unknown as QuickPromptLibrary;
	return {
		lib,
		setPrompts: (next: QuickPrompt[]) => {
			prompts = next;
			subs.forEach((cb) => cb());
		},
	};
}

function makeBridge(
	overrides: Partial<QuickPromptComposerBridge> = {},
): QuickPromptComposerBridge {
	return {
		getComposerText: () => "",
		getSelectionText: () => null,
		isStreaming: () => false,
		isQueued: () => false,
		fireOrQueue: vi.fn(),
		insertAtCursor: vi.fn(),
		notify: vi.fn(),
		...overrides,
	};
}

describe("useQuickPrompts — T18", () => {
	let bridge: QuickPromptComposerBridge;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("plain activate into an empty idle composer → fireOrQueue with resolved text", () => {
		bridge = makeBridge();
		const { lib } = makeFakeLibrary([prompt()]);
		const { result } = renderHook(() => useQuickPrompts(lib, bridge));

		act(() => result.current.runQuickPrompt(prompt(), { modifier: false }));

		expect(bridge.fireOrQueue).toHaveBeenCalledWith("Debrief this meeting.");
		expect(bridge.insertAtCursor).not.toHaveBeenCalled();
	});

	it("plain activate into a non-empty composer → insert + 'Added to your draft' notice (never fires)", () => {
		bridge = makeBridge({ getComposerText: () => "half typed" });
		const { lib } = makeFakeLibrary([prompt()]);
		const { result } = renderHook(() => useQuickPrompts(lib, bridge));

		act(() => result.current.runQuickPrompt(prompt(), { modifier: false }));

		expect(bridge.insertAtCursor).toHaveBeenCalledWith("Debrief this meeting.");
		expect(bridge.fireOrQueue).not.toHaveBeenCalled();
		expect(bridge.notify).toHaveBeenCalledWith(
			"Added to your draft — review and send",
		);
	});

	it("while queued → no-op (composer locked)", () => {
		bridge = makeBridge({ isQueued: () => true });
		const { lib } = makeFakeLibrary([prompt()]);
		const { result } = renderHook(() => useQuickPrompts(lib, bridge));

		act(() => result.current.runQuickPrompt(prompt(), { modifier: false }));

		expect(bridge.fireOrQueue).not.toHaveBeenCalled();
		expect(bridge.insertAtCursor).not.toHaveBeenCalled();
		expect(bridge.notify).not.toHaveBeenCalled();
	});

	it("{{selection}} prompt with no selection → insert + needs-a-selection notice", () => {
		bridge = makeBridge();
		const sel = prompt({ body: "Summarize:\n\n{{selection}}", usesSelection: true });
		const { lib } = makeFakeLibrary([sel]);
		const { result } = renderHook(() => useQuickPrompts(lib, bridge));

		act(() => result.current.runQuickPrompt(sel, { modifier: false }));

		expect(bridge.insertAtCursor).toHaveBeenCalledWith("Summarize:\n\n");
		expect(bridge.fireOrQueue).not.toHaveBeenCalled();
		expect(bridge.notify).toHaveBeenCalledWith(
			'"Debrief" needs a selection — dropped into the composer instead.',
		);
	});

	it("{{selection}} prompt with a selection on an empty idle composer → fires with resolved text", () => {
		bridge = makeBridge({ getSelectionText: () => "selected body" });
		const sel = prompt({ body: "Summarize:\n\n{{selection}}", usesSelection: true });
		const { lib } = makeFakeLibrary([sel]);
		const { result } = renderHook(() => useQuickPrompts(lib, bridge));

		act(() => result.current.runQuickPrompt(sel, { modifier: false }));

		expect(bridge.fireOrQueue).toHaveBeenCalledWith("Summarize:\n\nselected body");
	});

	it("modifier activate → insert (tweak), no notice", () => {
		bridge = makeBridge();
		const { lib } = makeFakeLibrary([prompt()]);
		const { result } = renderHook(() => useQuickPrompts(lib, bridge));

		act(() => result.current.runQuickPrompt(prompt(), { modifier: true }));

		expect(bridge.insertAtCursor).toHaveBeenCalledWith("Debrief this meeting.");
		expect(bridge.fireOrQueue).not.toHaveBeenCalled();
		expect(bridge.notify).not.toHaveBeenCalled();
	});

	it("exposes the live prompt list and updates on library reconcile", () => {
		bridge = makeBridge();
		const fake = makeFakeLibrary([prompt({ id: "a", label: "A" })]);
		const { result } = renderHook(() => useQuickPrompts(fake.lib, bridge));
		expect(result.current.prompts.map((p) => p.label)).toEqual(["A"]);

		act(() =>
			fake.setPrompts([
				prompt({ id: "a", label: "A" }),
				prompt({ id: "b", label: "B" }),
			]),
		);
		expect(result.current.prompts.map((p) => p.label)).toEqual(["A", "B"]);
	});
});
