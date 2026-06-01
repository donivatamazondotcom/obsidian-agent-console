/**
 * Unit tests for buildContextBlocks.
 *
 * TDD — written before implementation. Covers:
 * - Channel 1: crystallized notes as references (text + embeddedContext modes)
 * - Channel 2: selection as inlined content (text + embeddedContext modes)
 * - Both channels compose independently
 * - Empty inputs produce empty output
 *
 * Spec references: § How Context Is Provided to the Agent, Decision #23.
 */
import { describe, it, expect } from "vitest";
import { buildContextBlocks } from "../context-builder";
import type { ContextNote } from "../../types/context";
import type { PromptContent } from "../../types/chat";

const VAULT_PATH = "/Users/test/vault";

describe("buildContextBlocks", () => {
	// ========================================================================
	// Empty inputs
	// ========================================================================

	it("returns empty array when no context notes and no selection", () => {
		const result = buildContextBlocks({
			contextNotes: [],
			selection: null,
			useEmbeddedContext: false,
			vaultPath: VAULT_PATH,
		});
		expect(result).toEqual([]);
	});

	// ========================================================================
	// Channel 1: Crystallized notes (text mode)
	// ========================================================================

	it("produces one text block per crystallized note in text mode", () => {
		const notes: ContextNote[] = [
			{ path: "Design Doc.md", source: "user", seen: false },
			{ path: "folder/API Spec.md", source: "mention", seen: false },
		];
		const result = buildContextBlocks({
			contextNotes: notes,
			selection: null,
			useEmbeddedContext: false,
			vaultPath: VAULT_PATH,
		});
		expect(result).toHaveLength(2);
		expect(result[0].type).toBe("text");
		expect((result[0] as { type: "text"; text: string }).text).toContain(
			"obsidian_context_note",
		);
		expect((result[0] as { type: "text"; text: string }).text).toContain(
			"Design Doc.md",
		);
		expect((result[1] as { type: "text"; text: string }).text).toContain(
			"folder/API Spec.md",
		);
	});

	it("text mode context note block contains ref attribute and no body content", () => {
		const notes: ContextNote[] = [
			{ path: "note.md", source: "user", seen: false },
		];
		const result = buildContextBlocks({
			contextNotes: notes,
			selection: null,
			useEmbeddedContext: false,
			vaultPath: VAULT_PATH,
		});
		const text = (result[0] as { type: "text"; text: string }).text;
		expect(text).toMatch(/ref="[^"]*note\.md"/);
		// Should NOT contain the note's actual content (reference only, Decision #23)
		expect(text).toContain(
			"Use the Read tool to examine its content when relevant",
		);
	});

	// ========================================================================
	// Channel 1: Crystallized notes (embeddedContext mode)
	// ========================================================================

	it("produces resource_link blocks in embeddedContext mode", () => {
		const notes: ContextNote[] = [
			{ path: "note.md", source: "user", seen: false },
		];
		const result = buildContextBlocks({
			contextNotes: notes,
			selection: null,
			useEmbeddedContext: true,
			vaultPath: VAULT_PATH,
		});
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("resource_link");
		const block = result[0] as PromptContent & { type: "resource_link" };
		expect(block.uri).toContain("note.md");
		expect(block.name).toBe("note");
		expect(block.mimeType).toBe("text/markdown");
	});

	// ========================================================================
	// Channel 2: Selection (text mode)
	// ========================================================================

	it("produces selection text block with inlined content in text mode", () => {
		const result = buildContextBlocks({
			contextNotes: [],
			selection: {
				path: "impl.md",
				fromLine: 10,
				toLine: 20,
				text: "function hello() {\n  return 'world';\n}",
			},
			useEmbeddedContext: false,
			vaultPath: VAULT_PATH,
		});
		expect(result).toHaveLength(1);
		const text = (result[0] as { type: "text"; text: string }).text;
		expect(text).toContain("obsidian_selection");
		expect(text).toContain('ref="');
		expect(text).toContain("impl.md");
		expect(text).toContain('lines="10-20"');
		expect(text).toContain("function hello()");
	});

	// ========================================================================
	// Channel 2: Selection (embeddedContext mode)
	// ========================================================================

	it("produces resource block with priority 0.9 for selection in embeddedContext mode", () => {
		const result = buildContextBlocks({
			contextNotes: [],
			selection: {
				path: "impl.md",
				fromLine: 5,
				toLine: 8,
				text: "some selected text",
			},
			useEmbeddedContext: true,
			vaultPath: VAULT_PATH,
		});
		expect(result).toHaveLength(2); // resource + annotation text
		const resource = result[0] as PromptContent & { type: "resource" };
		expect(resource.type).toBe("resource");
		expect(resource.resource.text).toContain("some selected text");
		expect(resource.annotations?.priority).toBe(0.9);
	});

	// ========================================================================
	// Composition: both channels together
	// ========================================================================

	it("composes Channel 1 and Channel 2 independently", () => {
		const notes: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
			{ path: "b.md", source: "mention", seen: false },
		];
		const result = buildContextBlocks({
			contextNotes: notes,
			selection: {
				path: "c.md",
				fromLine: 1,
				toLine: 5,
				text: "selected",
			},
			useEmbeddedContext: false,
			vaultPath: VAULT_PATH,
		});
		// 2 context notes + 1 selection = 3 blocks
		expect(result).toHaveLength(3);
		// First two are context notes
		expect((result[0] as { type: "text"; text: string }).text).toContain("a.md");
		expect((result[1] as { type: "text"; text: string }).text).toContain("b.md");
		// Last is selection
		expect((result[2] as { type: "text"; text: string }).text).toContain("obsidian_selection");
	});
});
