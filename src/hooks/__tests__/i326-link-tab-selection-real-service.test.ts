/**
 * I326 (review): a link-opened tab keeps ignoring the stale selection against
 * the REAL VaultService, which re-reports selections on its own when the user
 * re-activates a note's tab, visits another note, or renames the note.
 *
 * The round-1 fix ended the ignore on the vault service's first no-selection
 * report, so each of these paths brought the stale lines back. Only Obsidian's
 * workspace, vault and editor are faked; the selection source is the service
 * ChatPanel passes to the tracker.
 *
 * [[I326 A link-opened tab sends the editor selection with its first message]].
 * Adapted from the code reviewer's probe (2026-11-11).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("obsidian", () => {
	class TFile {
		path = "";
		basename = "";
		extension = "md";
		stat = { ctime: 0, mtime: 0 };
	}
	class MarkdownView {
		file: unknown = null;
		editor: unknown = null;
	}
	return { TFile, MarkdownView, prepareFuzzySearch: vi.fn() };
});

import { MarkdownView, TFile } from "obsidian";
import { VaultService } from "../../services/vault-service";
import { useSelectionTracker } from "../useSelectionTracker";

type Sel = { anchor: { line: number; ch: number }; head: { line: number; ch: number } } | null;

function makeNote(path: string, sel: Sel) {
	const file = new (TFile as unknown as { new (): TFile })();
	file.path = path;
	(file as unknown as { basename: string }).basename = path.replace(/^.*\//, "").replace(/\.md$/, "");
	const st = { sel };
	const editor = {
		somethingSelected: () => st.sel !== null,
		listSelections: () => (st.sel ? [st.sel] : []),
		getSelection: () => (st.sel ? "text" : ""),
		hasFocus: () => true,
	};
	const view = new (MarkdownView as unknown as { new (): MarkdownView })();
	(view as unknown as { file: unknown }).file = file;
	(view as unknown as { editor: unknown }).editor = editor;
	return { file, view, st };
}

function world() {
	const N = makeNote("Notes/Unrelated.md", { anchor: { line: 3, ch: 0 }, head: { line: 5, ch: 3 } });
	const B = makeNote("Notes/Other.md", null);
	let active: MarkdownView | null = N.view;
	let activeFile = N.file;
	let leafChange: ((leaf: unknown) => void) | null = null;
	const renameCbs: Array<(f: unknown, old: string) => void> = [];
	const workspace = {
		getActiveFile: () => activeFile,
		getActiveViewOfType: () => active,
		getLeavesOfType: () => [{ view: N.view }, { view: B.view }],
		on: (evt: string, cb: (leaf: unknown) => void) => {
			if (evt === "active-leaf-change") leafChange = cb;
			return {};
		},
		offref: () => {},
	};
	const vault = {
		getMarkdownFiles: () => [N.file, B.file],
		on: (evt: string, cb: (f: unknown, old: string) => void) => {
			if (evt === "rename") renameCbs.push(cb);
			return {};
		},
		getAbstractFileByPath: () => null,
		read: async () => "",
		offref: () => {},
	};
	const svc = new VaultService({
		app: { workspace, vault, metadataCache: { getFileCache: () => null } },
	} as never);
	const flush = async (fn: () => void) => {
		await act(async () => {
			fn();
			await Promise.resolve();
			await Promise.resolve();
		});
	};
	return {
		svc,
		N,
		B,
		chat: () => flush(() => { active = null; leafChange!({ view: {} }); }),
		leaf: (n: typeof N) => flush(() => { active = n.view; activeFile = n.file; leafChange!({ view: n.view }); }),
		rename: (n: typeof N, to: string) => flush(() => {
			const old = n.file.path;
			n.file.path = to;
			for (const cb of renameCbs) cb(n.file, old);
		}),
	};
}

async function scenario(steps: (w: ReturnType<typeof world>) => Promise<void>, ignore = true) {
	const w = world();
	w.svc.subscribeSelectionChanges(() => {}); // another tab keeps tracking live
	await w.chat(); // opening the link focuses the chat leaf
	const { result } = renderHook(() =>
		useSelectionTracker(w.svc, { ignoreInitialSelection: ignore }),
	);
	await act(async () => {
		await Promise.resolve();
	});
	const atMount = result.current.selection;
	await steps(w);
	return { atMount, end: result.current.selection };
}

describe("I326: link-opened tab vs the real vault service", () => {
	it("re-activating the note's tab doesn't bring the stale lines back", async () => {
		const r = await scenario(async (w) => {
			await w.leaf(w.N);
			await w.chat();
		});
		expect(r.atMount).toBeNull();
		expect(r.end).toBeNull();
	});

	it("visiting another note and coming back doesn't bring them back", async () => {
		const r = await scenario(async (w) => {
			await w.leaf(w.B);
			await w.leaf(w.N);
			await w.chat();
		});
		expect(r.end).toBeNull();
	});

	it("renaming the note doesn't bring them back", async () => {
		const r = await scenario(async (w) => {
			await w.rename(w.N, "Notes/Renamed.md");
			await w.chat();
			await w.leaf(w.N);
			await w.chat();
		});
		expect(r.end).toBeNull();
	});

	it("a selection made after the link opened is sent", async () => {
		const r = await scenario(async (w) => {
			await w.leaf(w.N);
			w.N.st.sel = { anchor: { line: 8, ch: 0 }, head: { line: 9, ch: 1 } };
			await w.leaf(w.N);
			await w.chat();
		});
		expect(r.end).toEqual({ fromLine: 8, toLine: 9 });
	});

	it("a tab not opened by a link still picks up the selection", async () => {
		const r = await scenario(async (w) => {
			await w.leaf(w.N);
			await w.chat();
		}, false);
		expect(r.end).toEqual({ fromLine: 3, toLine: 5 });
	});
});
