import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSessionSearch } from "../useSessionSearch";
import type { ChatMessage } from "../../types/chat";
import type { SessionInfo } from "../../types/session";

function session(sessionId: string, title: string): SessionInfo {
	return { sessionId, cwd: "/vault", title, updatedAt: "2026-06-23T00:00:00Z" };
}

function textMessages(body: string): ChatMessage[] {
	return [
		{
			id: "m1",
			role: "user",
			content: [{ type: "text", text: body }],
			timestamp: new Date(),
		},
	];
}

describe("useSessionSearch", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("T07: debounces the query — rapid typing collapses to the final value", () => {
		vi.useFakeTimers();
		const sessions = [
			session("a", "wikilink debugging"),
			session("b", "travel planning"),
		];
		const load = vi.fn(async () => null);

		const { result } = renderHook(() =>
			useSessionSearch({
				sessions,
				loadSessionMessages: load,
				debounceMs: 200,
			}),
		);

		// Empty query → full list.
		expect(result.current.results.map((r) => r.sessionId)).toEqual([
			"a",
			"b",
		]);

		// Rapid burst, each within the debounce window.
		act(() => {
			result.current.setQuery("w");
		});
		act(() => {
			vi.advanceTimersByTime(50);
			result.current.setQuery("wi");
		});
		act(() => {
			vi.advanceTimersByTime(50);
			result.current.setQuery("wikilink");
		});

		// Before the window elapses, debouncedQuery is still "" → full list.
		expect(result.current.results.map((r) => r.sessionId)).toEqual([
			"a",
			"b",
		]);

		// Let the final value settle.
		act(() => {
			vi.advanceTimersByTime(200);
		});

		// Only the final query applied — single collapsed result.
		expect(result.current.results.map((r) => r.sessionId)).toEqual(["a"]);
	});

	it("T08: index build transitions idle → building → ready", async () => {
		const sessions = [session("a", "Untitled"), session("b", "Untitled")];
		const load = vi.fn(async (id: string) =>
			textMessages(`session ${id} discussed kubernetes`),
		);

		const { result } = renderHook(() =>
			useSessionSearch({ sessions, loadSessionMessages: load }),
		);

		expect(result.current.indexState).toBe("idle");

		act(() => {
			result.current.ensureIndex();
		});

		// Synchronously after the call it is building.
		expect(result.current.indexState).toBe("building");

		await waitFor(() =>
			expect(result.current.indexState).toBe("ready"),
		);

		expect(load).toHaveBeenCalledTimes(2);

		// Content search now matches on body text (titles don't contain it).
		act(() => {
			result.current.setQuery("kubernetes");
		});
		await waitFor(() => {
			expect(
				result.current.results.every(
					(r) => r.matchKind === "content",
				),
			).toBe(true);
			expect(
				result.current.results.map((r) => r.sessionId).sort(),
			).toEqual(["a", "b"]);
		});
	});

	it("ensureIndex is a no-op once building/ready (single build)", async () => {
		const sessions = [session("a", "x")];
		const load = vi.fn(async () => textMessages("hello kubernetes"));

		const { result } = renderHook(() =>
			useSessionSearch({ sessions, loadSessionMessages: load }),
		);

		act(() => {
			result.current.ensureIndex();
			result.current.ensureIndex(); // immediate second call — must not double-build
		});
		await waitFor(() =>
			expect(result.current.indexState).toBe("ready"),
		);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("T09: invalidate drops a session's content-index entry", async () => {
		const sessions = [session("a", "Untitled")];
		const load = vi.fn(async () => textMessages("contains kubernetes"));

		const { result } = renderHook(() =>
			useSessionSearch({ sessions, loadSessionMessages: load }),
		);

		act(() => {
			result.current.ensureIndex();
		});
		await waitFor(() =>
			expect(result.current.indexState).toBe("ready"),
		);

		act(() => {
			result.current.setQuery("kubernetes");
		});
		await waitFor(() =>
			expect(result.current.results).toHaveLength(1),
		);

		// Invalidate the entry → content match disappears (title doesn't match).
		act(() => {
			result.current.invalidate("a");
		});
		await waitFor(() =>
			expect(result.current.results).toHaveLength(0),
		);
	});

	it("title search works before the index is built (two-tier)", () => {
		const sessions = [session("a", "wikilink notes")];
		const load = vi.fn(async () => null);

		const { result } = renderHook(() =>
			useSessionSearch({
				sessions,
				loadSessionMessages: load,
				debounceMs: 0,
			}),
		);

		act(() => {
			result.current.setQuery("wikilink");
		});
		// debounceMs 0 → next tick; assert without index built.
		return waitFor(() => {
			expect(result.current.results.map((r) => r.sessionId)).toEqual([
				"a",
			]);
			expect(result.current.indexState).toBe("idle");
			expect(load).not.toHaveBeenCalled();
		});
	});
});
