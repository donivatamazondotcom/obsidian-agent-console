/**
 * T09 reproduction — selection must survive focus moving to the chat textarea.
 *
 * Root cause (current code): when the active leaf becomes a non-markdown view
 * (the chat panel takes focus), VaultService.attachToView(null) calls
 * handleSelectionChange(null, null), whose `filePath === null` branch nulls
 * `currentSelection`. getActiveNote() then returns the note WITHOUT a
 * selection, so nothing is inlined at send time.
 *
 * Expected: the selection persists while focus is in the chat so it can be
 * sent. This test asserts that contract and FAILS against the unfixed code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { VaultService } from "../vault-service";
import { MarkdownView, TFile } from "obsidian";

function makeFile(): TFile {
	const f = new (TFile as unknown as { new (): TFile })();
	f.path = "folder/note.md";
	f.basename = "note";
	f.extension = "md";
	f.stat = { ctime: 0, mtime: 0 };
	return f;
}

describe("VaultService selection persistence (T09)", () => {
	let file: TFile;
	let view: MarkdownView;
	let activeMarkdownView: MarkdownView | null;
	let leafChangeCb: ((leaf: unknown) => void) | null;

	beforeEach(() => {
		file = makeFile();
		const editor = {
			somethingSelected: () => true,
			listSelections: () => [
				{ anchor: { line: 5, ch: 0 }, head: { line: 10, ch: 20 } },
			],
			hasFocus: () => true,
			// no `cm` — attachToView returns after the initial emitSelection
		};
		view = new (MarkdownView as unknown as { new (): MarkdownView })();
		view.file = file;
		view.editor = editor;
		activeMarkdownView = view;
		leafChangeCb = null;
	});

	function makePlugin() {
		const workspace = {
			getActiveFile: () => file,
			getActiveViewOfType: () => activeMarkdownView,
			getLeavesOfType: () => [{ view }],
			on: (evt: string, cb: (leaf: unknown) => void) => {
				if (evt === "active-leaf-change") leafChangeCb = cb;
				return {};
			},
			offref: () => {},
		};
		const vault = {
			getMarkdownFiles: () => [file],
			on: () => ({}),
			getAbstractFileByPath: () => file,
			read: async () => "",
			offref: () => {},
		};
		const metadataCache = { getFileCache: () => null };
		return { app: { workspace, vault, metadataCache } } as never;
	}

	it("keeps the selection after focus moves to a non-markdown leaf (chat)", async () => {
		const svc = new VaultService(makePlugin());
		svc.subscribeSelectionChanges(() => {});

		// Sanity: selection captured while the note is focused.
		const before = await svc.getActiveNote();
		expect(before?.selection).toBeTruthy();

		// Focus moves to the chat textarea: active leaf is now non-markdown.
		activeMarkdownView = null;
		expect(leafChangeCb).toBeTypeOf("function");
		leafChangeCb!({ view: {} });

		// The note is still open in a leaf, so getActiveNote returns it —
		// but the selection must still be present for the send path.
		const after = await svc.getActiveNote();
		expect(after?.selection).toBeTruthy();
	});
});
