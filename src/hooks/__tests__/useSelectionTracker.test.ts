/**
 * Unit tests for useSelectionTracker hook.
 *
 * TDD — written before implementation. Covers:
 * - Exposes activeNotePath/activeNoteName from last markdown leaf
 * - Exposes selection (fromLine, toLine, charCount) when present
 * - Subscribes to selection changes on mount, unsubscribes on unmount
 * - Updates state when listener fires
 * - Does NOT clear state when getActiveNote returns null (lastMarkdownLeaf persists)
 *
 * Decision #24: selection source is lastMarkdownLeaf, not activeLeaf.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useSelectionTracker } from "../useSelectionTracker";
import type { SelectionSource } from "../useSelectionTracker";

afterEach(cleanup);

function makeMockSource(overrides: Partial<SelectionSource> = {}): SelectionSource {
	return {
		getActiveNote: vi.fn().mockResolvedValue(null),
		subscribeSelectionChanges: vi.fn().mockReturnValue(() => {}),
		...overrides,
	};
}

describe("useSelectionTracker", () => {
	it("starts with null activeNotePath and null selection", () => {
		const source = makeMockSource();
		const { result } = renderHook(() => useSelectionTracker(source));
		expect(result.current.activeNotePath).toBeNull();
		expect(result.current.activeNoteName).toBeNull();
		expect(result.current.selection).toBeNull();
	});

	it("subscribes to selection changes on mount", () => {
		const subscribe = vi.fn().mockReturnValue(() => {});
		const source = makeMockSource({ subscribeSelectionChanges: subscribe });
		renderHook(() => useSelectionTracker(source));
		expect(subscribe).toHaveBeenCalledTimes(1);
		expect(subscribe).toHaveBeenCalledWith(expect.any(Function));
	});

	it("unsubscribes on unmount", () => {
		const unsubscribe = vi.fn();
		const subscribe = vi.fn().mockReturnValue(unsubscribe);
		const source = makeMockSource({ subscribeSelectionChanges: subscribe });
		const { unmount } = renderHook(() => useSelectionTracker(source));
		unmount();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("updates activeNotePath and activeNoteName when listener fires with a note", async () => {
		let listener: (() => void) | null = null;
		const subscribe = vi.fn((cb: () => void) => {
			listener = cb;
			return () => {};
		});
		const getActiveNote = vi.fn().mockResolvedValue({
			path: "folder/Design Doc.md",
			name: "Design Doc",
			extension: "md",
			created: 0,
			modified: 0,
		});
		const source = makeMockSource({ subscribeSelectionChanges: subscribe, getActiveNote });

		const { result } = renderHook(() => useSelectionTracker(source));

		// Simulate selection change
		await act(async () => {
			listener!();
		});

		expect(result.current.activeNotePath).toBe("folder/Design Doc.md");
		expect(result.current.activeNoteName).toBe("Design Doc");
	});

	it("exposes selection when active note has one", async () => {
		let listener: (() => void) | null = null;
		const subscribe = vi.fn((cb: () => void) => {
			listener = cb;
			return () => {};
		});
		const getActiveNote = vi.fn().mockResolvedValue({
			path: "note.md",
			name: "note",
			extension: "md",
			created: 0,
			modified: 0,
			selection: {
				from: { line: 5, ch: 0 },
				to: { line: 10, ch: 20 },
			},
		});
		const source = makeMockSource({ subscribeSelectionChanges: subscribe, getActiveNote });

		const { result } = renderHook(() => useSelectionTracker(source));

		await act(async () => {
			listener!();
		});

		expect(result.current.selection).toEqual({
			fromLine: 5,
			toLine: 10,
		});
	});

	it("clears selection when active note has no selection", async () => {
		let listener: (() => void) | null = null;
		const subscribe = vi.fn((cb: () => void) => {
			listener = cb;
			return () => {};
		});
		const getActiveNote = vi.fn()
			.mockResolvedValueOnce({
				path: "note.md",
				name: "note",
				extension: "md",
				created: 0,
				modified: 0,
				selection: { from: { line: 1, ch: 0 }, to: { line: 3, ch: 5 } },
			})
			.mockResolvedValueOnce({
				path: "note.md",
				name: "note",
				extension: "md",
				created: 0,
				modified: 0,
				// no selection
			});
		const source = makeMockSource({ subscribeSelectionChanges: subscribe, getActiveNote });

		const { result } = renderHook(() => useSelectionTracker(source));

		await act(async () => { listener!(); });
		expect(result.current.selection).not.toBeNull();

		await act(async () => { listener!(); });
		expect(result.current.selection).toBeNull();
	});

	it("preserves last markdown note when getActiveNote returns null (Decision #24)", async () => {
		let listener: (() => void) | null = null;
		const subscribe = vi.fn((cb: () => void) => {
			listener = cb;
			return () => {};
		});
		const getActiveNote = vi.fn()
			.mockResolvedValueOnce({
				path: "note.md",
				name: "note",
				extension: "md",
				created: 0,
				modified: 0,
			})
			.mockResolvedValueOnce(null); // user focused chat textarea
		const source = makeMockSource({ subscribeSelectionChanges: subscribe, getActiveNote });

		const { result } = renderHook(() => useSelectionTracker(source));

		await act(async () => { listener!(); });
		expect(result.current.activeNotePath).toBe("note.md");

		await act(async () => { listener!(); });
		// Should NOT clear — lastMarkdownLeaf persists
		expect(result.current.activeNotePath).toBe("note.md");
	});

	it("updates to a different note when a new markdown note becomes active", async () => {
		let listener: (() => void) | null = null;
		const subscribe = vi.fn((cb: () => void) => {
			listener = cb;
			return () => {};
		});
		const getActiveNote = vi.fn()
			.mockResolvedValueOnce({
				path: "first.md",
				name: "first",
				extension: "md",
				created: 0,
				modified: 0,
			})
			.mockResolvedValueOnce({
				path: "second.md",
				name: "second",
				extension: "md",
				created: 0,
				modified: 0,
			});
		const source = makeMockSource({ subscribeSelectionChanges: subscribe, getActiveNote });

		const { result } = renderHook(() => useSelectionTracker(source));

		await act(async () => { listener!(); });
		expect(result.current.activeNotePath).toBe("first.md");

		await act(async () => { listener!(); });
		expect(result.current.activeNotePath).toBe("second.md");
	});
});
