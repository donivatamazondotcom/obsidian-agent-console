/**
 * Tests for useRecentlyClosedTabs (F13 — Undo Close Tab).
 * The hook wraps the pure stack with a ref; these tests assert the
 * capture/reopen contract callers rely on.
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentlyClosedTabs } from "../useRecentlyClosedTabs";
import type { ClosedTabRecord } from "../../services/recently-closed-stack";

function rec(sessionId: string, position = 0): ClosedTabRecord {
	return {
		sessionId,
		label: `label-${sessionId}`,
		labelIsCustom: false,
		agentId: "claude-code-acp",
		position,
	};
}

describe("useRecentlyClosedTabs", () => {
	it("reopens captured tabs in LIFO order", () => {
		const { result } = renderHook(() => useRecentlyClosedTabs());

		act(() => {
			result.current.capture(rec("A"));
			result.current.capture(rec("B"));
		});
		expect(result.current.count()).toBe(2);

		let popped: ClosedTabRecord | null = null;
		act(() => {
			popped = result.current.reopenLast();
		});
		expect(popped!.sessionId).toBe("B");

		act(() => {
			popped = result.current.reopenLast();
		});
		expect(popped!.sessionId).toBe("A");
		expect(result.current.count()).toBe(0);
	});

	it("ignores a null record (never-used tab not pushed)", () => {
		const { result } = renderHook(() => useRecentlyClosedTabs());

		act(() => {
			result.current.capture(null);
			result.current.capture(rec("A"));
			result.current.capture(null);
		});
		expect(result.current.count()).toBe(1);
	});

	it("returns null when reopening with an empty stack", () => {
		const { result } = renderHook(() => useRecentlyClosedTabs());

		let popped: ClosedTabRecord | null = rec("x");
		act(() => {
			popped = result.current.reopenLast();
		});
		expect(popped).toBeNull();
	});

	it("enforces the depth cap", () => {
		const { result } = renderHook(() => useRecentlyClosedTabs(3));

		act(() => {
			result.current.capture(rec("A"));
			result.current.capture(rec("B"));
			result.current.capture(rec("C"));
			result.current.capture(rec("D"));
		});
		expect(result.current.count()).toBe(3);

		// A (oldest) was dropped; LIFO from D → C → B.
		const order: string[] = [];
		act(() => {
			let r = result.current.reopenLast();
			while (r) {
				order.push(r.sessionId);
				r = result.current.reopenLast();
			}
		});
		expect(order).toEqual(["D", "C", "B"]);
	});

	it("keeps a stable identity across re-renders", () => {
		const { result, rerender } = renderHook(() =>
			useRecentlyClosedTabs(),
		);
		const first = result.current;
		rerender();
		expect(result.current).toBe(first);
	});
});

describe("useRecentlyClosedTabs.sessionIds (I202 review)", () => {
	it("lists the session ids that can still be reopened", () => {
		const { result } = renderHook(() => useRecentlyClosedTabs(2));
		act(() => {
			result.current.capture(rec("a"));
			result.current.capture(rec("b"));
			result.current.capture(rec("c"));
		});
		expect(result.current.sessionIds().sort()).toEqual(["b", "c"]);
		act(() => {
			result.current.reopenLast();
		});
		expect(result.current.sessionIds()).toEqual(["b"]);
	});
});

describe("useRecentlyClosedTabs.recordIds (I269)", () => {
	it("returns closed tabs' record ids in stack order, skipping tabs without one", () => {
		const { result } = renderHook(() => useRecentlyClosedTabs());
		act(() => {
			result.current.capture({ ...rec("s1"), recordId: "r1" });
			result.current.capture(rec("s2"));
			result.current.capture({ ...rec("s3"), recordId: "r3" });
		});
		expect(result.current.recordIds()).toEqual(["r1", "r3"]);
	});
});
