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
		onRename: vi.fn().mockReturnValue(() => {}),
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
			// Absorb the mount-time priming call (T02/T03 fix).
			.mockResolvedValueOnce(null)
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
			// Absorb the mount-time priming call (T02/T03 fix).
			.mockResolvedValueOnce(null)
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

	// T02/T03 reproduction.
	// On a new chat tab, VaultService.ensureSelectionTracking() early-returns
	// for the 2nd+ subscriber (activeLeafRef already set), so the listener
	// never receives an initial emit. The hook must self-prime from
	// getActiveNote() on mount; current code only updates when the listener
	// fires, so activeNotePath stays null until the user clicks into a note
	// (grab button disabled, tooltip name missing). This test FAILS unfixed.
	it("primes activeNotePath from getActiveNote() on mount when the source never emits (T02/T03)", async () => {
		const getActiveNote = vi.fn().mockResolvedValue({
			path: "folder/Design Doc.md",
			name: "Design Doc",
			extension: "md",
			created: 0,
			modified: 0,
		});
		const source = makeMockSource({
			getActiveNote,
			// Returns a no-op unsubscribe and never invokes the listener.
			subscribeSelectionChanges: vi.fn().mockReturnValue(() => {}),
		});

		const { result } = renderHook(() => useSelectionTracker(source));

		// Flush any mount-time async priming.
		await act(async () => {
			await Promise.resolve();
		});

		expect(result.current.activeNotePath).toBe("folder/Design Doc.md");
		expect(result.current.activeNoteName).toBe("Design Doc");
	});
});

// ============================================================================
// I85: tracker must refresh on vault rename of the currently-active note.
// Without this, the active-note path/name go stale after a rename until the
// next selection/leaf change — the "Toggle active note in context" hotkey
// then announces the OLD name (and pins the stale OLD path). Reproduce-first:
// these FAIL against unfixed code (the hook never subscribes to onRename).
// ============================================================================
describe("useSelectionTracker — I85 rename handling", () => {
	function captureRename() {
		let cb: ((oldPath: string, newPath: string) => void) | null = null;
		const dispose = vi.fn();
		const onRename = vi.fn((listener: (o: string, n: string) => void) => {
			cb = listener;
			return dispose;
		});
		return { onRename, dispose, getCb: () => cb };
	}

	async function flushMount() {
		await act(async () => {
			await Promise.resolve();
		});
	}

	it("T-A: renaming the active note updates path and name without a selection change", async () => {
		const { onRename, getCb } = captureRename();
		const getActiveNote = vi.fn().mockResolvedValue({
			path: "A.md",
			name: "A",
			extension: "md",
			created: 0,
			modified: 0,
		});
		const source = makeMockSource({ getActiveNote, onRename });

		const { result } = renderHook(() => useSelectionTracker(source));
		await flushMount();
		expect(result.current.activeNotePath).toBe("A.md");

		expect(onRename).toHaveBeenCalledTimes(1);
		await act(async () => {
			getCb()!("A.md", "B.md");
		});

		expect(result.current.activeNotePath).toBe("B.md");
		expect(result.current.activeNoteName).toBe("B");
	});

	it("T-B: renaming a different (non-active) note leaves the tracker unchanged", async () => {
		const { onRename, getCb } = captureRename();
		const getActiveNote = vi.fn().mockResolvedValue({
			path: "A.md",
			name: "A",
			extension: "md",
			created: 0,
			modified: 0,
		});
		const source = makeMockSource({ getActiveNote, onRename });

		const { result } = renderHook(() => useSelectionTracker(source));
		await flushMount();

		await act(async () => {
			getCb()!("Other.md", "Renamed.md");
		});

		expect(result.current.activeNotePath).toBe("A.md");
		expect(result.current.activeNoteName).toBe("A");
	});

	it("T-C: moving the active note (basename unchanged) updates the path, keeps the name", async () => {
		const { onRename, getCb } = captureRename();
		const getActiveNote = vi.fn().mockResolvedValue({
			path: "A.md",
			name: "A",
			extension: "md",
			created: 0,
			modified: 0,
		});
		const source = makeMockSource({ getActiveNote, onRename });

		const { result } = renderHook(() => useSelectionTracker(source));
		await flushMount();

		await act(async () => {
			getCb()!("A.md", "folder/A.md");
		});

		expect(result.current.activeNotePath).toBe("folder/A.md");
		expect(result.current.activeNoteName).toBe("A");
	});

	it("T-D: a rename with no active note tracked is a no-op (no crash, stays null)", async () => {
		const { onRename, getCb } = captureRename();
		const source = makeMockSource({
			getActiveNote: vi.fn().mockResolvedValue(null),
			onRename,
		});

		const { result } = renderHook(() => useSelectionTracker(source));
		await flushMount();

		await act(async () => {
			getCb()!("X.md", "Y.md");
		});

		expect(result.current.activeNotePath).toBeNull();
		expect(result.current.activeNoteName).toBeNull();
	});

	it("T-E: disposes the rename subscription on unmount", async () => {
		const { onRename, dispose } = captureRename();
		const source = makeMockSource({ onRename });

		const { unmount } = renderHook(() => useSelectionTracker(source));
		await flushMount();
		unmount();

		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
