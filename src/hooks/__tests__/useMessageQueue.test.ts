/**
 * Unit tests for useMessageQueue (#82) — queue-of-one slot semantics (T14, T5).
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMessageQueue } from "../useMessageQueue";
import type { QueuedMessage } from "../../types/chat";

const msg = (content: string): QueuedMessage => ({ content });

describe("useMessageQueue (T14, T5)", () => {
	it("starts empty", () => {
		const { result } = renderHook(() => useMessageQueue());
		expect(result.current.isQueued).toBe(false);
		expect(result.current.queued).toBeNull();
	});

	it("enqueue sets the slot and isQueued", () => {
		const { result } = renderHook(() => useMessageQueue());
		let accepted = false;
		act(() => {
			accepted = result.current.enqueue(msg("hello"));
		});
		expect(accepted).toBe(true);
		expect(result.current.isQueued).toBe(true);
		expect(result.current.queued?.content).toBe("hello");
	});

	it("T5 — enqueue is capped at one: a second enqueue is rejected", () => {
		const { result } = renderHook(() => useMessageQueue());
		act(() => {
			result.current.enqueue(msg("first"));
		});
		let secondAccepted = true;
		act(() => {
			secondAccepted = result.current.enqueue(msg("second"));
		});
		expect(secondAccepted).toBe(false); // queue-of-one
		expect(result.current.queued?.content).toBe("first"); // not displaced
	});

	it("consume returns the head and empties the slot", () => {
		const { result } = renderHook(() => useMessageQueue());
		act(() => {
			result.current.enqueue(msg("flush-me"));
		});
		let consumed: QueuedMessage | null = null;
		act(() => {
			consumed = result.current.consume();
		});
		expect(consumed).not.toBeNull();
		expect((consumed as unknown as QueuedMessage).content).toBe("flush-me");
		expect(result.current.isQueued).toBe(false);
		expect(result.current.queued).toBeNull();
	});

	it("consume on an empty queue returns null", () => {
		const { result } = renderHook(() => useMessageQueue());
		let consumed: QueuedMessage | null = msg("x");
		act(() => {
			consumed = result.current.consume();
		});
		expect(consumed).toBeNull();
	});

	it("clear empties the slot without returning it (Edit/Cancel backing)", () => {
		const { result } = renderHook(() => useMessageQueue());
		act(() => {
			result.current.enqueue(msg("draft"));
		});
		act(() => {
			result.current.clear();
		});
		expect(result.current.isQueued).toBe(false);
		expect(result.current.queued).toBeNull();
	});

	it("after consume, the slot accepts a new enqueue (re-queue path)", () => {
		const { result } = renderHook(() => useMessageQueue());
		act(() => {
			result.current.enqueue(msg("one"));
		});
		act(() => {
			result.current.consume();
		});
		let accepted = false;
		act(() => {
			accepted = result.current.enqueue(msg("two"));
		});
		expect(accepted).toBe(true);
		expect(result.current.queued?.content).toBe("two");
	});
});
