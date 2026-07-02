import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Scope } from "obsidian";
import { usePillOpenScope } from "../use-pill-open-scope";
import type { IChatViewHost } from "../view-host";

/**
 * I156: only the ACTIVE tab's ChatPanel may push the context-pill open scope.
 * Every tab's ChatPanel stays mounted (inactive ones are display:none), so an
 * unconditional push produced one redundant scope per tab on app.keymap. These
 * tests pin the gate: push iff active, pop when deactivated/unmounted.
 */
function makeHarness() {
	const pushScope = vi.fn();
	const popScope = vi.fn();
	const plugin = {
		app: { keymap: { pushScope, popScope }, scope: new Scope() },
	} as unknown as Parameters<typeof usePillOpenScope>[0];
	const viewHost = { scope: new Scope() } as unknown as IChatViewHost;
	const openContextNote = vi.fn();
	return { pushScope, popScope, plugin, viewHost, openContextNote };
}

describe("usePillOpenScope (I156)", () => {
	it("pushes exactly one scope when the tab is active", () => {
		const h = makeHarness();
		renderHook(() =>
			usePillOpenScope(h.plugin, h.viewHost, true, h.openContextNote),
		);
		expect(h.pushScope).toHaveBeenCalledTimes(1);
		expect(h.popScope).not.toHaveBeenCalled();
	});

	it("does NOT push a scope when the tab is inactive", () => {
		const h = makeHarness();
		renderHook(() =>
			usePillOpenScope(h.plugin, h.viewHost, false, h.openContextNote),
		);
		expect(h.pushScope).not.toHaveBeenCalled();
	});

	it("pops the scope when the tab goes from active to inactive", () => {
		const h = makeHarness();
		const { rerender } = renderHook(
			({ active }: { active: boolean }) =>
				usePillOpenScope(h.plugin, h.viewHost, active, h.openContextNote),
			{ initialProps: { active: true } },
		);
		expect(h.pushScope).toHaveBeenCalledTimes(1);
		rerender({ active: false });
		expect(h.popScope).toHaveBeenCalledTimes(1);
	});

	it("pushes when a tab becomes active after being inactive", () => {
		const h = makeHarness();
		const { rerender } = renderHook(
			({ active }: { active: boolean }) =>
				usePillOpenScope(h.plugin, h.viewHost, active, h.openContextNote),
			{ initialProps: { active: false } },
		);
		expect(h.pushScope).not.toHaveBeenCalled();
		rerender({ active: true });
		expect(h.pushScope).toHaveBeenCalledTimes(1);
	});
});
