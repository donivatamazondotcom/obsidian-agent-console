/**
 * I326: a tab opened by an `obsidian://agent-console` link must not send the
 * lines that were selected in a note when the link fired. That note has
 * nothing to do with where the link came from; the tab already hides the
 * active-note pill for the same reason.
 *
 * Root cause: a new tab's tracker primes from the last active note on mount,
 * selection included, and ChatPanel turns any tracked selection into a
 * context block. `suppressAutoContext` only covered the active-note pill.
 *
 * Fix: `ignoreInitialSelection` makes the tracker hide the selection it first
 * observes, until the user changes it. A selection made after the link
 * opened counts, and from then on the tab behaves like any other.
 *
 * [[I326 A link-opened tab sends the editor selection with its first message]].
 * Entered at the hook's public API with only the selection source mocked.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useSelectionTracker } from "../useSelectionTracker";
import type { SelectionSource } from "../useSelectionTracker";

afterEach(cleanup);

type Note = Awaited<ReturnType<SelectionSource["getActiveNote"]>>;

const note = (path: string, lines?: [number, number]): Note => ({
	path,
	name: path.replace(/\.md$/, ""),
	selection: lines
		? { from: { line: lines[0], ch: 0 }, to: { line: lines[1], ch: 3 } }
		: undefined,
});

function makeSource(initial: Note) {
	let current = initial;
	let listener: (() => void) | null = null;
	let rename: ((o: string, n: string) => void) | null = null;
	const source: SelectionSource = {
		getActiveNote: vi.fn(async () => current),
		subscribeSelectionChanges: vi.fn((cb: () => void) => {
			listener = cb;
			return () => {};
		}),
		onRename: vi.fn((cb: (o: string, n: string) => void) => {
			rename = cb;
			return () => {};
		}),
		onDelete: vi.fn(() => () => {}),
		hasOpenMarkdownLeaves: () => true,
	};
	return {
		source,
		/** The editor reports a (possibly unchanged) selection. */
		emit: async (next: Note = current) => {
			current = next;
			await act(async () => {
				listener?.();
				await Promise.resolve();
			});
		},
		rename: async (from: string, to: string) => {
			current = current ? { ...current, path: to, name: to } : current;
			await act(async () => {
				rename?.(from, to);
				await Promise.resolve();
			});
		},
	};
}

async function mount(source: SelectionSource, ignoreInitialSelection?: boolean) {
	const hook = renderHook(() =>
		useSelectionTracker(source, { ignoreInitialSelection }),
	);
	await act(async () => {
		await Promise.resolve();
	});
	return hook;
}

describe("I326: a link-opened tab ignores the selection already in the editor", () => {
	it("hides the selection primed on mount, but keeps the active note", async () => {
		const s = makeSource(note("Notes/Unrelated.md", [3, 5]));
		const { result } = await mount(s.source, true);

		expect(result.current.activeNotePath).toBe("Notes/Unrelated.md");
		expect(result.current.selection).toBeNull();
	});

	it("keeps hiding it when the editor re-reports the same selection", async () => {
		const s = makeSource(note("Notes/Unrelated.md", [3, 5]));
		const { result } = await mount(s.source, true);

		// Focus moving to the chat, or a layout change, re-reads the note.
		await s.emit();

		expect(result.current.selection).toBeNull();
	});

	it("keeps hiding it after the note is renamed", async () => {
		const s = makeSource(note("Notes/Unrelated.md", [3, 5]));
		const { result } = await mount(s.source, true);

		await s.rename("Notes/Unrelated.md", "Notes/Renamed.md");
		await s.emit();

		expect(result.current.activeNotePath).toBe("Notes/Renamed.md");
		expect(result.current.selection).toBeNull();
	});

	it("shows a selection the user makes after the link opened", async () => {
		const s = makeSource(note("Notes/Unrelated.md", [3, 5]));
		const { result } = await mount(s.source, true);

		await s.emit(note("Notes/Unrelated.md", [8, 9]));

		expect(result.current.selection).toEqual({ fromLine: 8, toLine: 9 });
	});

	it("after a change, behaves like any tab, even back on the first lines", async () => {
		const s = makeSource(note("Notes/Unrelated.md", [3, 5]));
		const { result } = await mount(s.source, true);

		await s.emit(note("Notes/Unrelated.md"));
		await s.emit(note("Notes/Unrelated.md", [3, 5]));

		expect(result.current.selection).toEqual({ fromLine: 3, toLine: 5 });
	});

	it("with nothing selected at mount, the first selection counts", async () => {
		const s = makeSource(note("Notes/Unrelated.md"));
		const { result } = await mount(s.source, true);

		await s.emit(note("Notes/Other.md", [1, 2]));

		expect(result.current.selection).toEqual({ fromLine: 1, toLine: 2 });
	});

	it("with no note open at mount, a note opened later keeps its selection", async () => {
		const s = makeSource(null);
		const { result } = await mount(s.source, true);

		await s.emit(note("Notes/Opened.md", [4, 6]));

		expect(result.current.selection).toEqual({ fromLine: 4, toLine: 6 });
	});

	it("other tabs still pick up the selection on mount", async () => {
		const s = makeSource(note("Notes/Unrelated.md", [3, 5]));
		const { result } = await mount(s.source);

		expect(result.current.selection).toEqual({ fromLine: 3, toLine: 5 });
	});
});
