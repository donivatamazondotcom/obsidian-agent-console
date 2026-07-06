import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Scope } from "obsidian";
import { usePillOpenScope } from "../use-pill-open-scope";
import type { IChatViewHost } from "../view-host";

/**
 * I156: only the ACTIVE tab's ChatPanel may push the context-pill open scope.
 * Every tab's ChatPanel stays mounted (inactive ones are display:none), so an
 * unconditional push produced one redundant scope per tab on app.keymap.
 *
 * I161: the push must ALSO be gated on the panel actually having focus, and
 * popped the moment focus leaves. The pushed scope is parented to the view
 * scope (I155), so if it lingers on the global keymap stack while a different
 * leaf is focused, a Cmd+W in that leaf (e.g. a markdown editor) falls through
 * to ChatView's confirm-close guard and pops the modal in the wrong context.
 * These tests pin both gates: push iff (active AND focused); pop on blur.
 */
function makeHarness(focused = true) {
	const pushScope = vi.fn();
	const popScope = vi.fn();
	let leafChangeCb: (() => void) | null = null;
	const offref = vi.fn();
	const on = vi.fn((evt: string, cb: () => void) => {
		if (evt === "active-leaf-change") leafChangeCb = cb;
		return { evt } as never;
	});
	const focusState = { value: focused };
	const plugin = {
		app: {
			keymap: { pushScope, popScope },
			scope: new Scope(),
			workspace: { on, offref },
		},
	} as unknown as Parameters<typeof usePillOpenScope>[0];
	const viewHost = {
		scope: new Scope(),
		hasFocus: () => focusState.value,
	} as unknown as IChatViewHost;
	const openContextNote = vi.fn();
	return {
		pushScope,
		popScope,
		offref,
		plugin,
		viewHost,
		openContextNote,
		focusState,
		fireLeafChange: () => leafChangeCb?.(),
	};
}

describe("usePillOpenScope (I156 + I161)", () => {
	it("pushes exactly one scope when the tab is active AND focused", () => {
		const h = makeHarness(true);
		renderHook(() =>
			usePillOpenScope(h.plugin, h.viewHost, true, h.openContextNote),
		);
		expect(h.pushScope).toHaveBeenCalledTimes(1);
		expect(h.popScope).not.toHaveBeenCalled();
	});

	it("does NOT push a scope when the tab is inactive", () => {
		const h = makeHarness(true);
		renderHook(() =>
			usePillOpenScope(h.plugin, h.viewHost, false, h.openContextNote),
		);
		expect(h.pushScope).not.toHaveBeenCalled();
	});

	// I161 reproduce-first: active tab but panel NOT focused must not push a
	// scope onto the global keymap — otherwise Cmd+W leaks to the view guard
	// from other leaves. Fails against the pre-fix code, which pushed on
	// isActive alone regardless of focus.
	it("does NOT push when the tab is active but the panel is unfocused (I161)", () => {
		const h = makeHarness(false);
		renderHook(() =>
			usePillOpenScope(h.plugin, h.viewHost, true, h.openContextNote),
		);
		expect(h.pushScope).not.toHaveBeenCalled();
	});

	// I161: focus leaving the panel pops the pushed scope so it can't linger on
	// the global stack and route Cmd+W to the guard.
	it("pops the scope when focus leaves the panel (I161)", () => {
		const h = makeHarness(true);
		renderHook(() =>
			usePillOpenScope(h.plugin, h.viewHost, true, h.openContextNote),
		);
		expect(h.pushScope).toHaveBeenCalledTimes(1);
		h.focusState.value = false;
		h.fireLeafChange();
		expect(h.popScope).toHaveBeenCalledTimes(1);
	});

	// I161: focus returning to the panel re-pushes the scope so the I155
	// confirm-close fall-through still works while the panel is focused.
	it("re-pushes when focus returns to the panel (I161)", () => {
		const h = makeHarness(false);
		renderHook(() =>
			usePillOpenScope(h.plugin, h.viewHost, true, h.openContextNote),
		);
		expect(h.pushScope).not.toHaveBeenCalled();
		h.focusState.value = true;
		h.fireLeafChange();
		expect(h.pushScope).toHaveBeenCalledTimes(1);
	});

	it("pops the scope and unsubscribes when the tab goes inactive/unmounts", () => {
		const h = makeHarness(true);
		const { rerender, unmount } = renderHook(
			({ active }: { active: boolean }) =>
				usePillOpenScope(h.plugin, h.viewHost, active, h.openContextNote),
			{ initialProps: { active: true } },
		);
		expect(h.pushScope).toHaveBeenCalledTimes(1);
		rerender({ active: false });
		expect(h.popScope).toHaveBeenCalledTimes(1);
		unmount();
		// offref called on every effect teardown that subscribed.
		expect(h.offref).toHaveBeenCalled();
	});
});
