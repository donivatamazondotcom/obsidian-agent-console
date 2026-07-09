import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useQueueOrchestration,
	type QueueEffectHandlers,
} from "../useQueueOrchestration";
import type { QueuedMessage } from "../../types/chat";

/**
 * Adapter tests for `useQueueOrchestration` — the React bridge over the pure
 * `queueOrchestrationReducer`. Confirms the hook applies reducer state and
 * executes the declarative effects through the injected handlers, and — the
 * load-bearing property — that `dispatch` decides against the ref-held slot,
 * not a stale render snapshot (Q4 immunity at the adapter layer).
 */

const MSG: QueuedMessage = { content: "hello" };

function makeHandlers(): QueueEffectHandlers & { log: string[] } {
	const log: string[] = [];
	return {
		log,
		acquire: vi.fn(() => log.push("acquire")),
		flushDispatch: vi.fn((m: QueuedMessage) => log.push(`flush:${m.content}`)),
		clearComposer: vi.fn(() => log.push("clearComposer")),
		cancelTurn: vi.fn(() => log.push("cancelTurn")),
	};
}

describe("useQueueOrchestration — state + effects", () => {
	it("starts empty", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		expect(result.current.isQueued).toBe(false);
		expect(result.current.pending).toBeNull();
	});

	it("sendWhileStreaming holds the message, fires no effects", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhileStreaming", message: MSG }));
		expect(result.current.isQueued).toBe(true);
		expect(result.current.pending).toEqual(MSG);
		expect(h.log).toEqual([]);
	});

	it("sendWhilePreReady holds the message and triggers acquire", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhilePreReady", message: MSG }));
		expect(result.current.isQueued).toBe(true);
		expect(h.acquire).toHaveBeenCalledTimes(1);
		expect(h.log).toEqual(["acquire"]);
	});

	it("steerWhileStreaming holds flagged steering and fires cancelTurn (#81)", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() =>
			result.current.dispatch({ type: "steerWhileStreaming", message: MSG }),
		);
		expect(result.current.isQueued).toBe(true);
		expect(result.current.isSteering).toBe(true);
		expect(h.cancelTurn).toHaveBeenCalledTimes(1);
		expect(h.log).toEqual(["cancelTurn"]);
	});

	it("a steer-held message flushes on steerCancelSettled (after the cancel settles) (#81)", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() =>
			result.current.dispatch({ type: "steerWhileStreaming", message: MSG }),
		);
		// The mid-cancel turn-end must HOLD (flush deferred), so cleanup can't
		// clobber the redirect turn's isSending (I165).
		act(() =>
			result.current.dispatch({
				type: "turnEnded",
				hadError: false,
				wasCancelled: true,
			}),
		);
		expect(result.current.isQueued).toBe(true); // still held
		expect(h.log).toEqual(["cancelTurn"]); // no flush yet
		// Cancel fully settled → flush the redirect now.
		act(() => result.current.dispatch({ type: "steerCancelSettled" }));
		expect(result.current.isQueued).toBe(false);
		expect(result.current.isSteering).toBe(false);
		expect(h.log).toEqual(["cancelTurn", "clearComposer", `flush:${MSG.content}`]);
	});

	it("turnEnded (normal) flushes raw: clearComposer BEFORE flushDispatch, slot emptied", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhileStreaming", message: MSG }));
		act(() =>
			result.current.dispatch({
				type: "turnEnded",
				hadError: false,
				wasCancelled: false,
			}),
		);
		expect(result.current.isQueued).toBe(false);
		expect(h.clearComposer).toHaveBeenCalledTimes(1);
		expect(h.flushDispatch).toHaveBeenCalledWith(MSG);
		expect(h.log).toEqual(["clearComposer", "flush:hello"]);
	});

	it("turnEnded with error holds (no flush)", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhileStreaming", message: MSG }));
		act(() =>
			result.current.dispatch({
				type: "turnEnded",
				hadError: true,
				wasCancelled: false,
			}),
		);
		expect(result.current.isQueued).toBe(true);
		expect(h.flushDispatch).not.toHaveBeenCalled();
	});

	it("acquisitionComplete with sessionId flushes", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhilePreReady", message: MSG }));
		act(() =>
			result.current.dispatch({ type: "acquisitionComplete", hasSessionId: true }),
		);
		expect(result.current.isQueued).toBe(false);
		expect(h.flushDispatch).toHaveBeenCalledWith(MSG);
	});

	it("editQueued releases the slot without clearing the composer", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhileStreaming", message: MSG }));
		act(() => result.current.dispatch({ type: "editQueued" }));
		expect(result.current.isQueued).toBe(false);
		expect(h.clearComposer).not.toHaveBeenCalled();
	});

	it("deleteQueued releases the slot AND clears the composer", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhileStreaming", message: MSG }));
		act(() => result.current.dispatch({ type: "deleteQueued" }));
		expect(result.current.isQueued).toBe(false);
		expect(h.clearComposer).toHaveBeenCalledTimes(1);
		expect(h.flushDispatch).not.toHaveBeenCalled();
	});

	it("queue-of-one: a second send while full does not overwrite or re-fire effects", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		act(() => result.current.dispatch({ type: "sendWhileStreaming", message: MSG }));
		act(() =>
			result.current.dispatch({
				type: "sendWhilePreReady",
				message: { content: "second" },
			}),
		);
		expect(result.current.pending).toEqual(MSG); // original preserved
		expect(h.acquire).not.toHaveBeenCalled(); // no acquire from the rejected send
	});

	it("dispatch identity is stable across renders", () => {
		const h = makeHandlers();
		const { result, rerender } = renderHook(() => useQueueOrchestration(h));
		const first = result.current.dispatch;
		act(() => result.current.dispatch({ type: "sendWhileStreaming", message: MSG }));
		rerender();
		expect(result.current.dispatch).toBe(first);
	});
});

describe("useQueueOrchestration — Q4 immunity at the adapter layer", () => {
	it("two synchronous dispatches in one tick see the ref-held slot (no stale snapshot)", () => {
		const h = makeHandlers();
		const { result } = renderHook(() => useQueueOrchestration(h));
		// Enqueue and flush in the SAME act() — before React re-renders. If the
		// reducer read rendered state, the second dispatch would see pending=null
		// (stale) and drop the flush. Reading stateRef makes the flush land.
		act(() => {
			result.current.dispatch({ type: "sendWhileStreaming", message: MSG });
			result.current.dispatch({
				type: "turnEnded",
				hadError: false,
				wasCancelled: false,
			});
		});
		expect(result.current.isQueued).toBe(false);
		expect(h.flushDispatch).toHaveBeenCalledWith(MSG);
		expect(h.log).toEqual(["clearComposer", "flush:hello"]);
	});
});
