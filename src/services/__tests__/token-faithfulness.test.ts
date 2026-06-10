/**
 * BM-T02 — Faithfulness gate.
 *
 * The benchmark's marketing number is only credible if the harness's B1
 * strategy models what the plugin actually emits. This test feeds identical
 * context-note input to the shipped `buildContextBlocks` and the harness
 * `b1RefBlock`, and asserts they produce the same text (and token count).
 *
 * If the plugin's context-note wrapper changes, this test fails and the
 * published number is re-derived (Decision BM3).
 *
 * Spec: [[Agent Console Token Efficiency Benchmark]] § Faithfulness gate.
 */
import { describe, it, expect } from "vitest";
import { buildContextBlocks } from "../context-builder";
import { b1RefBlock } from "../../../tools/benchmark/strategies";
import {
	createEncoder,
	serializeBlock,
	countBlocksTokens,
} from "../../../tools/benchmark/token-accounting";

describe("BM-T02: harness B1 == shipped buildContextBlocks", () => {
	const vaultPath = "/Users/example/vault";
	const notePath = "06-knowledge/Median Note.md";

	const shippedBlocks = buildContextBlocks({
		contextNotes: [{ path: notePath, source: "user", seen: false }],
		selection: null,
		useEmbeddedContext: false,
		vaultPath,
	});

	const harnessBlock = b1RefBlock({ path: notePath, body: "", vaultPath });

	it("produces byte-identical reference text", () => {
		expect(shippedBlocks).toHaveLength(1);
		const shipped = shippedBlocks[0];
		expect(shipped.type).toBe("text");
		// Both serialize to exactly the same <obsidian_context_note> wrapper.
		expect(serializeBlock(harnessBlock)).toBe(serializeBlock(shipped));
	});

	it("produces an equal token count under cl100k_base", () => {
		const enc = createEncoder();
		const shippedTokens = countBlocksTokens(shippedBlocks, enc);
		const harnessTokens = countBlocksTokens([harnessBlock], enc);
		expect(harnessTokens).toBe(shippedTokens);
		expect(harnessTokens).toBeGreaterThan(0);
	});
});
