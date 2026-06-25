/**
 * F11 — tab-aware broadcast.
 *
 * Covers the new registry seam (`getAllTabHandles`) that lets broadcast
 * commands fan out across every tab in every view (decision: scope (b)),
 * plus the selection predicates the three broadcast commands use:
 *   - prompt:  targets = all tabs EXCEPT the focused view's active tab (T53)
 *   - send:    targets = all tabs where canSend() is true (T52)
 *   - cancel:  targets = all tabs
 *
 * The registry tests exercise the REAL ChatViewRegistry. The predicate
 * tests model the filters used in plugin.ts broadcast* (same pattern as
 * i41-send-while-connecting.test.ts) since plugin.ts isn't unit-mountable.
 */
import { describe, it, expect, vi } from "vitest";
import {
	ChatViewRegistry,
	type IChatViewContainer,
	type IChatTabHandle,
} from "../view-registry";
import type { ChatInputState } from "../../types/chat";

function makeHandle(
	tabId: string,
	opts: { canSend?: boolean; pending?: boolean } = {},
): IChatTabHandle {
	return {
		tabId,
		getInputState: () => ({ text: tabId, files: [] }),
		setInputState: vi.fn(),
		canSend: () => opts.canSend ?? true,
		sendMessage: vi.fn(async () => true),
		cancelOperation: vi.fn(async () => {}),
		hasPendingQueue: () => opts.pending ?? false,
	};
}

/** Minimal IChatViewContainer stub with no-op lifecycle + injectable tabs. */
function makeView(
	viewId: string,
	tabs: IChatTabHandle[],
): IChatViewContainer {
	const noop = () => {};
	return {
		viewId,
		viewType: "sidebar",
		getDisplayName: () => viewId,
		onActivate: noop,
		onDeactivate: noop,
		focus: noop,
		hasFocus: () => false,
		expand: noop,
		collapse: noop,
		getInputState: () => tabs[0]?.getInputState() ?? null,
		setInputState: noop,
		canSend: () => false,
		sendMessage: async () => false,
		cancelOperation: async () => {},
		getTabHandles: () => tabs,
		getActiveTabId: () => tabs[0]?.tabId ?? viewId,
		runQuickPrompt: noop,
		getContainerEl: () => document.createElement("div"),
	};
}

describe("ChatViewRegistry.getAllTabHandles (F11 seam)", () => {
	it("returns [] when no views are registered", () => {
		const reg = new ChatViewRegistry();
		expect(reg.getAllTabHandles()).toEqual([]);
	});

	it("flattens all tabs across one view with multiple tabs", () => {
		const reg = new ChatViewRegistry();
		reg.register(makeView("v1", [makeHandle("t1"), makeHandle("t2")]));
		expect(reg.getAllTabHandles().map((h) => h.tabId)).toEqual([
			"t1",
			"t2",
		]);
	});

	it("flattens tabs across multiple views in registration order", () => {
		const reg = new ChatViewRegistry();
		reg.register(makeView("v1", [makeHandle("a"), makeHandle("b")]));
		reg.register(makeView("v2", [makeHandle("c")]));
		expect(reg.getAllTabHandles().map((h) => h.tabId)).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("drops a view's tabs after it is unregistered", () => {
		const reg = new ChatViewRegistry();
		reg.register(makeView("v1", [makeHandle("a")]));
		reg.register(makeView("v2", [makeHandle("b")]));
		reg.unregister("v1");
		expect(reg.getAllTabHandles().map((h) => h.tabId)).toEqual(["b"]);
	});
});

describe("broadcast selection predicates (F11)", () => {
	it("prompt: targets every tab except the focused source tab (T53)", () => {
		const all = [makeHandle("src"), makeHandle("t2"), makeHandle("t3")];
		const sourceTabId = "src";
		const targets = all.filter((t) => t.tabId !== sourceTabId);
		expect(targets.map((t) => t.tabId)).toEqual(["t2", "t3"]);
	});

	it("prompt: setInputState lands on every target tab", () => {
		const setSrc = vi.fn();
		const set2 = vi.fn();
		const set3 = vi.fn();
		const all = [
			{ ...makeHandle("src"), setInputState: setSrc },
			{ ...makeHandle("t2"), setInputState: set2 },
			{ ...makeHandle("t3"), setInputState: set3 },
		];
		const input: ChatInputState = { text: "hello", files: [] };
		const targets = all.filter((t) => t.tabId !== "src");
		for (const t of targets) t.setInputState(input);
		expect(setSrc).not.toHaveBeenCalled();
		expect(set2).toHaveBeenCalledWith(input);
		expect(set3).toHaveBeenCalledWith(input);
	});

	it("send: skips tabs where canSend() is false, e.g. lazy tabs (T52)", () => {
		const all = [
			makeHandle("ready1", { canSend: true }),
			makeHandle("lazy", { canSend: false }),
			makeHandle("ready2", { canSend: true }),
		];
		const sendable = all.filter((t) => t.canSend());
		expect(sendable.map((t) => t.tabId)).toEqual(["ready1", "ready2"]);
	});

	it("cancel: targets every tab regardless of state (T51)", () => {
		const all = [
			makeHandle("a", { canSend: false }),
			makeHandle("b", { canSend: true }),
		];
		expect(all.map((t) => t.tabId)).toEqual(["a", "b"]);
	});
});
