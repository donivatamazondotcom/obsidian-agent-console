/**
 * Tab Attention States — the runtime wiring that marks a tab "finished, not
 * viewed yet" ([[Tab Attention States]] § Unseen flag).
 *
 * Seam: the public hook API ChatPanel calls (R2). Only the browser focus /
 * visibility signals are controlled (R4). Outcome: the returned flag (R3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTabUnseen, type UseTabUnseenInput } from "../useTabUnseen";
import type { TurnEnd } from "../useAgentMessages";

let focused = true;
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
	focused = true;
	visibility = "visible";
	vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => vi.restoreAllMocks());

function setup(initial: Partial<UseTabUnseenInput> = {}) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const containerRef = { current: container };
	const props: UseTabUnseenInput = {
		lastTurnEnd: null,
		isSending: false,
		isActive: true,
		containerRef,
		...initial,
	};
	const hook = renderHook((p: UseTabUnseenInput) => useTabUnseen(p), {
		initialProps: props,
	});
	return { ...hook, props, container };
}

const turn = (seq: number, outcome: TurnEnd["outcome"]): TurnEnd => ({ seq, outcome });

describe("useTabUnseen", () => {
	it("a turn that ends while you're watching leaves no mark", () => {
		const { result, rerender, props } = setup();
		rerender({ ...props, lastTurnEnd: turn(1, "endTurn") });
		expect(result.current).toBeNull();
	});

	it("a turn that ends on a background tab marks it done", () => {
		const { result, rerender, props } = setup({ isActive: false });
		rerender({ ...props, lastTurnEnd: turn(1, "endTurn") });
		expect(result.current).toEqual({ kind: "done" });
	});

	it("the active tab is marked when the window is unfocused at turn end", () => {
		const { result, rerender, props } = setup();
		focused = false;
		rerender({ ...props, lastTurnEnd: turn(1, "maxTokens") });
		expect(result.current).toEqual({ kind: "stopped" });
	});

	it("switching to the tab clears the mark", () => {
		const { result, rerender, props } = setup({ isActive: false });
		rerender({ ...props, lastTurnEnd: turn(1, "endTurn") });
		rerender({ ...props, lastTurnEnd: turn(1, "endTurn"), isActive: true });
		expect(result.current).toBeNull();
	});

	it("returning focus to the window clears the active tab's mark", () => {
		const { result, rerender, props } = setup();
		focused = false;
		rerender({ ...props, lastTurnEnd: turn(1, "endTurn") });
		expect(result.current).toEqual({ kind: "done" });
		focused = true;
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(result.current).toBeNull();
	});

	it("a cancelled turn on a background tab leaves no mark", () => {
		const { result, rerender, props } = setup({ isActive: false });
		rerender({ ...props, lastTurnEnd: turn(1, "cancelled") });
		expect(result.current).toBeNull();
	});

	it("a new send clears the mark", () => {
		const { result, rerender, props } = setup({ isActive: false });
		rerender({ ...props, lastTurnEnd: turn(1, "endTurn") });
		rerender({ ...props, lastTurnEnd: turn(1, "endTurn"), isSending: true });
		expect(result.current).toBeNull();
	});
});
