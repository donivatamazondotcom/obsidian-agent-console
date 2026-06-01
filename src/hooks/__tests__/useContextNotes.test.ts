/**
 * Unit tests for useContextNotes hook.
 *
 * TDD — written before implementation. Covers:
 * - Add/remove/has/isFull operations
 * - Cap enforcement (Decision #9, #16)
 * - Deduplication by path (Decision #22)
 * - Source immutability (Decision #22)
 * - Insertion order (Decision #17)
 * - Rename/delete vault event handling
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContextNotes } from "../useContextNotes";
import { MAX_CONTEXT_NOTES } from "../../types/context";
import type { ContextNote } from "../../types/context";

describe("useContextNotes", () => {
	// ========================================================================
	// Initial state
	// ========================================================================

	it("starts with an empty notes array", () => {
		const { result } = renderHook(() => useContextNotes());
		expect(result.current.notes).toEqual([]);
	});

	it("starts not full", () => {
		const { result } = renderHook(() => useContextNotes());
		expect(result.current.isFull).toBe(false);
	});

	// ========================================================================
	// Add (crystallize)
	// ========================================================================

	it("adds a note with correct metadata", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("path/to/note.md", "user");
		});
		expect(result.current.notes).toEqual([
			{ path: "path/to/note.md", source: "user", seen: false },
		]);
	});

	it("appends new notes to the right (insertion order, Decision #17)", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("a.md", "user");
			result.current.add("b.md", "mention");
			result.current.add("c.md", "auto-default");
		});
		expect(result.current.notes.map((n) => n.path)).toEqual([
			"a.md",
			"b.md",
			"c.md",
		]);
	});

	it("deduplicates by path — second add is a no-op (Decision #22)", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("note.md", "user");
			result.current.add("note.md", "mention");
		});
		expect(result.current.notes).toHaveLength(1);
		expect(result.current.notes[0].source).toBe("user"); // first source wins
	});

	it("returns true from add on success, false on duplicate", () => {
		const { result } = renderHook(() => useContextNotes());
		let first: boolean, second: boolean;
		act(() => {
			first = result.current.add("note.md", "user");
			second = result.current.add("note.md", "mention");
		});
		expect(first!).toBe(true);
		expect(second!).toBe(false);
	});

	// ========================================================================
	// Cap enforcement (Decision #9, #16)
	// ========================================================================

	it("enforces cap at MAX_CONTEXT_NOTES", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			for (let i = 0; i < MAX_CONTEXT_NOTES + 2; i++) {
				result.current.add(`note-${i}.md`, "user");
			}
		});
		expect(result.current.notes).toHaveLength(MAX_CONTEXT_NOTES);
	});

	it("reports isFull when at cap", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			for (let i = 0; i < MAX_CONTEXT_NOTES; i++) {
				result.current.add(`note-${i}.md`, "user");
			}
		});
		expect(result.current.isFull).toBe(true);
	});

	it("returns false from add when at cap (skip-new policy, Decision #16)", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			for (let i = 0; i < MAX_CONTEXT_NOTES; i++) {
				result.current.add(`note-${i}.md`, "user");
			}
		});
		let overflow: boolean;
		act(() => {
			overflow = result.current.add("overflow.md", "user");
		});
		expect(overflow!).toBe(false);
	});

	// ========================================================================
	// Remove
	// ========================================================================

	it("removes a note by path", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("a.md", "user");
			result.current.add("b.md", "user");
			result.current.remove("a.md");
		});
		expect(result.current.notes.map((n) => n.path)).toEqual(["b.md"]);
	});

	it("remove is a no-op for non-existent path", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("a.md", "user");
			result.current.remove("nonexistent.md");
		});
		expect(result.current.notes).toHaveLength(1);
	});

	it("isFull becomes false after removing from a full strip", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			for (let i = 0; i < MAX_CONTEXT_NOTES; i++) {
				result.current.add(`note-${i}.md`, "user");
			}
		});
		expect(result.current.isFull).toBe(true);
		act(() => {
			result.current.remove("note-0.md");
		});
		expect(result.current.isFull).toBe(false);
	});

	// ========================================================================
	// Has (query)
	// ========================================================================

	it("has() returns true for crystallized path", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("note.md", "user");
		});
		expect(result.current.has("note.md")).toBe(true);
	});

	it("has() returns false for non-crystallized path", () => {
		const { result } = renderHook(() => useContextNotes());
		expect(result.current.has("note.md")).toBe(false);
	});

	// ========================================================================
	// Rename (vault event)
	// ========================================================================

	it("rename updates path in-place, preserving order and source", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("a.md", "user");
			result.current.add("old-name.md", "mention");
			result.current.add("c.md", "auto-default");
		});
		act(() => {
			result.current.rename("old-name.md", "new-name.md");
		});
		expect(result.current.notes[1]).toEqual({
			path: "new-name.md",
			source: "mention",
			seen: false,
		});
		// Order preserved
		expect(result.current.notes.map((n) => n.path)).toEqual([
			"a.md",
			"new-name.md",
			"c.md",
		]);
	});

	it("rename is a no-op for non-existent path", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("a.md", "user");
		});
		act(() => {
			result.current.rename("nonexistent.md", "new.md");
		});
		expect(result.current.notes[0].path).toBe("a.md");
	});

	// ========================================================================
	// Initialize from persisted state
	// ========================================================================

	it("accepts initial notes via parameter", () => {
		const initial: ContextNote[] = [
			{ path: "restored.md", source: "user", seen: false },
			{ path: "other.md", source: "mention", seen: false },
		];
		const { result } = renderHook(() => useContextNotes(initial));
		expect(result.current.notes).toEqual(initial);
	});

	it("clamps initial notes to cap if persisted state exceeds it", () => {
		const initial: ContextNote[] = Array.from({ length: 12 }, (_, i) => ({
			path: `note-${i}.md`,
			source: "user" as const,
			seen: false,
		}));
		const { result } = renderHook(() => useContextNotes(initial));
		expect(result.current.notes).toHaveLength(MAX_CONTEXT_NOTES);
	});

	// ========================================================================
	// Clear
	// ========================================================================

	it("clear removes all notes", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("a.md", "user");
			result.current.add("b.md", "user");
			result.current.clear();
		});
		expect(result.current.notes).toEqual([]);
		expect(result.current.isFull).toBe(false);
	});
});
