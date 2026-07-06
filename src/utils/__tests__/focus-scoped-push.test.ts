import { describe, it, expect, vi } from "vitest";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { pushScopeWhileFocused } from "../focus-scoped-push";
import type { IChatViewHost } from "../../ui/view-host";

/**
 * I161 regression guard at the dispatch-invariant level (the layer the prior
 * unit tests never modeled): a chat-UI scope pushed onto the GLOBAL keymap must
 * be live ONLY while the panel has focus, so a Cmd+W in another leaf can't fall
 * through it to ChatView's confirm-close guard.
 */
function harness(focused: boolean) {
	const pushScope = vi.fn();
	const popScope = vi.fn();
	const offref = vi.fn();
	let leafCb: (() => void) | null = null;
	const on = vi.fn((evt: string, cb: () => void) => {
		if (evt === "active-leaf-change") leafCb = cb;
		return { evt } as never;
	});
	const app = {
		keymap: { pushScope, popScope },
		scope: new Scope(),
		workspace: { on, offref },
	} as unknown as App;
	const focus = { value: focused };
	const viewHost = {
		scope: new Scope(),
		hasFocus: () => focus.value,
	} as unknown as IChatViewHost;
	const register = vi.fn((s: Scope) =>
		s.register(["Mod"], "Enter", () => false),
	);
	return {
		app,
		viewHost,
		register,
		pushScope,
		popScope,
		offref,
		focus,
		fireLeaf: () => leafCb?.(),
	};
}

describe("pushScopeWhileFocused (I161)", () => {
	it("pushes immediately when the panel is focused", () => {
		const h = harness(true);
		pushScopeWhileFocused(h.app, h.viewHost, h.register);
		expect(h.pushScope).toHaveBeenCalledTimes(1);
		expect(h.register).toHaveBeenCalledTimes(1);
	});

	it("does NOT push when the panel is unfocused (the leak invariant)", () => {
		const h = harness(false);
		pushScopeWhileFocused(h.app, h.viewHost, h.register);
		expect(h.pushScope).not.toHaveBeenCalled();
	});

	it("pushes on focus gain and pops on focus loss", () => {
		const h = harness(false);
		pushScopeWhileFocused(h.app, h.viewHost, h.register);
		expect(h.pushScope).not.toHaveBeenCalled();
		h.focus.value = true;
		h.fireLeaf();
		expect(h.pushScope).toHaveBeenCalledTimes(1);
		h.focus.value = false;
		h.fireLeaf();
		expect(h.popScope).toHaveBeenCalledTimes(1);
	});

	it("does not double-push while already focused", () => {
		const h = harness(true);
		pushScopeWhileFocused(h.app, h.viewHost, h.register);
		h.fireLeaf(); // still focused
		expect(h.pushScope).toHaveBeenCalledTimes(1);
	});

	it("cleanup pops a live scope and unsubscribes", () => {
		const h = harness(true);
		const cleanup = pushScopeWhileFocused(h.app, h.viewHost, h.register);
		cleanup();
		expect(h.popScope).toHaveBeenCalledTimes(1);
		expect(h.offref).toHaveBeenCalledTimes(1);
	});
});
