/**
 * Token accounting for the context-efficiency benchmark.
 *
 * Pure, offline, deterministic. Shared by the CLI harness
 * (`token-efficiency.ts`) and the vitest faithfulness/band tests
 * (`src/services/__tests__/token-*.test.ts`).
 *
 * Leaf module: no relative runtime imports (only `import type`), so it is
 * importable both by tsc-governed `.ts` tests (classic node resolution,
 * extensionless) and by the Node type-stripping CLI (explicit `.ts` ext).
 *
 * Spec: [[Agent Console Token Efficiency Benchmark]] § Metric definition,
 *       Decision BM5 (real tokenizer for headline, chars/4 only for v0 model).
 */
import { getEncoding, type Tiktoken } from "js-tiktoken";
import type { PromptContent } from "../../src/types/chat";

/**
 * A block whose tokens we count. Superset of PromptContent (the plugin's
 * prompt blocks) plus the two conversation-history block kinds a Read
 * round-trip adds: the agent's `tool_use` call and the `tool_result`
 * carrying the note body. These are not PromptContent — they live in
 * message history — but they occupy the context window and must be counted
 * (Metric definition: "counts ... tool round-trips").
 */
export type CountableBlock =
	| PromptContent
	| { type: "tool_use"; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; text: string };

/** A token counter: text -> token count. */
export type TokenCounter = (text: string) => number;

let sharedEncoder: Tiktoken | null = null;

/**
 * Real tokenizer for the headline number (BM5): tiktoken `cl100k_base`,
 * pure-JS (js-tiktoken), bundled ranks — fully offline, CI-runnable.
 * Cached: encoder construction parses the BPE ranks and is non-trivial.
 */
export function createEncoder(): TokenCounter {
	if (!sharedEncoder) {
		sharedEncoder = getEncoding("cl100k_base");
	}
	const enc = sharedEncoder;
	return (text: string) => enc.encode(text).length;
}

/**
 * Illustrative-only chars/4 counter (BM5): used solely to reproduce the v0
 * analytical model in BM-T01. NEVER used for the published headline.
 */
export const charsOver4: TokenCounter = (text: string) =>
	Math.ceil(text.length / 4);

/**
 * Serialize a single block to the text that occupies the context window.
 *
 * The agent receives structured content; we count the textual payload of
 * each block. Deterministic so the faithfulness gate (BM-T02) is exact.
 */
export function serializeBlock(block: CountableBlock): string {
	switch (block.type) {
		case "text":
			return block.text;
		case "resource":
			// Embedded body + the URI/mimeType envelope the agent sees.
			return `${block.resource.uri}\n${block.resource.mimeType}\n${block.resource.text}`;
		case "resource_link":
			// Reference only — name + uri (+ mimeType). No body.
			return `${block.name}\n${block.uri}${block.mimeType ? `\n${block.mimeType}` : ""}`;
		case "image":
			// Not used in any scenario; base64 payloads are out of scope.
			return "";
		case "tool_use":
			// The agent's Read call: tool name + input args.
			return JSON.stringify({ name: block.name, input: block.input });
		case "tool_result":
			// The note body returned by the Read.
			return block.text;
		default: {
			// Exhaustiveness guard.
			const _never: never = block;
			return _never;
		}
	}
}

/** Total tokens for a list of blocks under the given counter. */
export function countBlocksTokens(
	blocks: CountableBlock[],
	count: TokenCounter,
): number {
	let total = 0;
	for (const block of blocks) {
		total += count(serializeBlock(block));
	}
	return total;
}
