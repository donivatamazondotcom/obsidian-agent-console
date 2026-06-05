/**
 * Unit tests for:
 * - extractMentionedPaths: parses @[[...]] mentions from message text
 * - useContextVaultEvents: subscribes to vault rename/delete and updates context notes
 *
 * TDD — written before implementation.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { extractMentionedPaths } from "../useContextVaultEvents";
import { useContextVaultEvents } from "../useContextVaultEvents";

afterEach(cleanup);

// ============================================================================
// extractMentionedPaths (pure function)
// ============================================================================

describe("extractMentionedPaths", () => {
	const resolver = (name: string): string | null => {
		const map: Record<string, string> = {
			"Design Doc": "folder/Design Doc.md",
			"API Spec": "API Spec.md",
			"Missing": "",
		};
		return map[name] ?? null;
	};

	it("extracts single @[[mention]] and resolves to path", () => {
		const result = extractMentionedPaths(
			"Help me with @[[Design Doc]] please",
			resolver,
		);
		expect(result).toEqual(["folder/Design Doc.md"]);
	});

	it("extracts multiple mentions in order", () => {
		const result = extractMentionedPaths(
			"See @[[Design Doc]] and @[[API Spec]]",
			resolver,
		);
		expect(result).toEqual(["folder/Design Doc.md", "API Spec.md"]);
	});

	it("deduplicates repeated mentions", () => {
		const result = extractMentionedPaths(
			"@[[Design Doc]] then @[[Design Doc]] again",
			resolver,
		);
		expect(result).toEqual(["folder/Design Doc.md"]);
	});

	it("skips mentions that resolver cannot find", () => {
		const result = extractMentionedPaths(
			"@[[Nonexistent Note]] and @[[Design Doc]]",
			resolver,
		);
		expect(result).toEqual(["folder/Design Doc.md"]);
	});

	it("returns empty array when no mentions", () => {
		const result = extractMentionedPaths("No mentions here", resolver);
		expect(result).toEqual([]);
	});

	it("handles mentions with special characters in name", () => {
		const specialResolver = (name: string) =>
			name === "C++ Guide" ? "C++ Guide.md" : null;
		const result = extractMentionedPaths(
			"See @[[C++ Guide]]",
			specialResolver,
		);
		expect(result).toEqual(["C++ Guide.md"]);
	});
});

// ============================================================================
// useContextVaultEvents (hook)
// ============================================================================

describe("useContextVaultEvents", () => {
	it("calls onRename when vault fires rename for a crystallized path", () => {
		const onRename = vi.fn();
		const onRemove = vi.fn();
		const crystallizedPaths = new Set(["old.md"]);
		let renameHandler: ((oldPath: string, newPath: string) => void) | null = null;

		const vault = {
			onRename: (cb: (oldPath: string, newPath: string) => void) => {
				renameHandler = cb;
				return () => {};
			},
			onDelete: (_cb: (path: string) => void) => () => {},
		};

		renderHook(() =>
			useContextVaultEvents({ vault, crystallizedPaths, onRename, onRemove }),
		);

		act(() => {
			renameHandler!("old.md", "new.md");
		});

		expect(onRename).toHaveBeenCalledWith("old.md", "new.md");
	});

	it("does NOT call onRename for paths not in crystallizedPaths", () => {
		const onRename = vi.fn();
		const onRemove = vi.fn();
		const crystallizedPaths = new Set(["other.md"]);
		let renameHandler: ((oldPath: string, newPath: string) => void) | null = null;

		const vault = {
			onRename: (cb: (oldPath: string, newPath: string) => void) => {
				renameHandler = cb;
				return () => {};
			},
			onDelete: (_cb: (path: string) => void) => () => {},
		};

		renderHook(() =>
			useContextVaultEvents({ vault, crystallizedPaths, onRename, onRemove }),
		);

		act(() => {
			renameHandler!("unrelated.md", "renamed.md");
		});

		expect(onRename).not.toHaveBeenCalled();
	});

	it("calls onRemove when vault fires delete for a crystallized path", () => {
		const onRename = vi.fn();
		const onRemove = vi.fn();
		const crystallizedPaths = new Set(["doomed.md"]);
		let deleteHandler: ((path: string) => void) | null = null;

		const vault = {
			onRename: (_cb: (oldPath: string, newPath: string) => void) => () => {},
			onDelete: (cb: (path: string) => void) => {
				deleteHandler = cb;
				return () => {};
			},
		};

		renderHook(() =>
			useContextVaultEvents({ vault, crystallizedPaths, onRename, onRemove }),
		);

		act(() => {
			deleteHandler!("doomed.md");
		});

		expect(onRemove).toHaveBeenCalledWith("doomed.md");
	});

	it("does NOT call onRemove for paths not in crystallizedPaths", () => {
		const onRename = vi.fn();
		const onRemove = vi.fn();
		const crystallizedPaths = new Set(["safe.md"]);
		let deleteHandler: ((path: string) => void) | null = null;

		const vault = {
			onRename: (_cb: (oldPath: string, newPath: string) => void) => () => {},
			onDelete: (cb: (path: string) => void) => {
				deleteHandler = cb;
				return () => {};
			},
		};

		renderHook(() =>
			useContextVaultEvents({ vault, crystallizedPaths, onRename, onRemove }),
		);

		act(() => {
			deleteHandler!("other.md");
		});

		expect(onRemove).not.toHaveBeenCalled();
	});

	it("unsubscribes on unmount", () => {
		const unsubRename = vi.fn();
		const unsubDelete = vi.fn();
		const vault = {
			onRename: () => unsubRename,
			onDelete: () => unsubDelete,
		};

		const { unmount } = renderHook(() =>
			useContextVaultEvents({
				vault,
				crystallizedPaths: new Set(),
				onRename: vi.fn(),
				onRemove: vi.fn(),
			}),
		);

		unmount();
		expect(unsubRename).toHaveBeenCalledTimes(1);
		expect(unsubDelete).toHaveBeenCalledTimes(1);
	});
});
