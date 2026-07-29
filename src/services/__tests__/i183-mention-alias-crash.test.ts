/**
 * I183 reproduction — `@` mention search must not crash on non-string
 * frontmatter aliases.
 *
 * Root cause (unfixed code, `VaultService.searchNotes`):
 *
 *     const aliasArray: string[] = Array.isArray(aliases) ? aliases : ...
 *     const searchFields = [basename, path, ...aliasArray];
 *     for (const field of searchFields) fuzzySearch(field);
 *
 * `aliases` is read straight off `frontmatter` and cast to `string[]` with no
 * runtime validation, so YAML like
 *
 *     aliases:
 *       -
 *       - Valid Alias
 *
 * yields `[null, "Valid Alias"]` and a `null` reaches the fuzzy matcher.
 * Obsidian's matcher lowercases the text it is handed — verified against
 * Obsidian's own bundle (obsidian.asar):
 *
 *     function Sy(e){var t=My(e);return function(e){return Dy(t,e)}}  // prepareFuzzySearch
 *     function Dy(e,t){ ... var n=Ty(e.tokens,e.query,t,!1); ... }    // t = the text
 *     function Ty(e,t,n,i){ ... var r=n.toLowerCase(); ... }          // → TypeError
 *
 * so the mention dropdown throws instead of listing notes. The stub below
 * models that contract (lowercases its argument) rather than tolerating any
 * input, which is what makes this a faithful boundary test.
 *
 * Note: `aliases: null` alone does NOT crash — the existing ternary maps a
 * falsy value to `[]`. The crashing shapes are an array *containing*
 * non-strings, and non-string scalars/objects.
 *
 * Upstream report: RAIT-09/obsidian-agent-client#354
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => {
	class TFile {
		path = "";
		basename = "";
		extension = "md";
		stat = { ctime: 0, mtime: 0, size: 0 };
	}
	class MarkdownView {
		file: unknown = null;
		editor: unknown = null;
	}
	// Faithful to Obsidian's implementation: the returned matcher calls
	// `.toLowerCase()` on the text argument, so a non-string throws.
	const prepareFuzzySearch = (query: string) => (text: string) => {
		const haystack = text.toLowerCase();
		const needle = query.toLowerCase();
		const idx = haystack.indexOf(needle);
		return idx === -1 ? null : { score: -needle.length, matches: [] };
	};
	return { TFile, MarkdownView, prepareFuzzySearch };
});

import { VaultService } from "../vault-service";
import { TFile } from "obsidian";

function makeFile(basename: string, path: string): TFile {
	const f = new (TFile as unknown as { new (): TFile })();
	f.path = path;
	f.basename = basename;
	f.extension = "md";
	f.stat = { ctime: 0, mtime: 1, size: 0 };
	return f;
}

describe("I183: VaultService tolerates malformed frontmatter aliases", () => {
	let file: TFile;
	let frontmatter: Record<string, unknown> | null;

	beforeEach(() => {
		file = makeFile("Zotero Import", "refs/Zotero Import.md");
		frontmatter = null;
	});

	function makePlugin() {
		const workspace = {
			getActiveFile: () => null,
			getActiveViewOfType: () => null,
			getLeavesOfType: () => [],
			on: () => ({}),
			offref: () => {},
		};
		const vault = {
			getMarkdownFiles: () => [file],
			on: () => ({}),
			getAbstractFileByPath: () => file,
			read: async () => "",
			offref: () => {},
		};
		const metadataCache = {
			getFileCache: () => (frontmatter ? { frontmatter } : null),
		};
		return { app: { workspace, vault, metadataCache } } as never;
	}

	it("does not throw when an alias array contains a null entry, and still matches the valid alias", async () => {
		// YAML: `aliases:\n  -\n  - Valid Alias` → [null, "Valid Alias"]
		frontmatter = { aliases: [null, "Valid Alias"] };
		const svc = new VaultService(makePlugin());

		const results = await svc.searchNotes("valid");

		expect(results).toHaveLength(1);
		expect(results[0].path).toBe("refs/Zotero Import.md");
	});

	it("does not throw when an alias array mixes strings with objects", async () => {
		frontmatter = { aliases: ["Good One", { nested: "bad" }, 42] };
		const svc = new VaultService(makePlugin());

		const results = await svc.searchNotes("good");

		expect(results).toHaveLength(1);
	});

	it("does not throw when aliases is a non-string scalar", async () => {
		frontmatter = { aliases: 2026 };
		const svc = new VaultService(makePlugin());

		// Still searchable by basename — the bad alias must not break scoring.
		const results = await svc.searchNotes("zotero");

		expect(results).toHaveLength(1);
	});

	it("does not throw when aliases is a mapping instead of a list", async () => {
		frontmatter = { aliases: { short: "ZI" } };
		const svc = new VaultService(makePlugin());

		const results = await svc.searchNotes("zotero");

		expect(results).toHaveLength(1);
	});

	it("exposes only string aliases on note metadata", async () => {
		frontmatter = { aliases: [null, "Valid Alias", 7] };
		const svc = new VaultService(makePlugin());

		const results = await svc.searchNotes("zotero");

		expect(results[0].aliases).toEqual(["Valid Alias"]);
	});

	it("still returns aliases untouched for well-formed frontmatter", async () => {
		frontmatter = { aliases: ["ZI", "Zotero"] };
		const svc = new VaultService(makePlugin());

		const results = await svc.searchNotes("zi");

		expect(results[0].aliases).toEqual(["ZI", "Zotero"]);
	});
});
