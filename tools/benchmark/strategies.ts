/**
 * Baseline strategy block-builders for the context-efficiency benchmark.
 *
 * Each strategy emits the blocks a strategy introduces across a K-turn
 * conversation, tagged with the turn `at` which they first appear. The
 * replay accounting in `scenarios.ts` counts a block in every call from
 * `at` onward (standard stateless completion replays full history), which
 * is what makes every-message injection quadratic.
 *
 * Leaf module: only `import type`, no relative runtime imports.
 *
 * IMPORTANT (BM3 faithfulness): `refBlockText` independently reconstructs
 * the `<obsidian_context_note>` wrapper emitted by the shipped
 * `buildContextBlocks` (context-builder.ts). It deliberately does NOT call
 * that function — the faithfulness test (BM-T02) asserts the two agree, so
 * if the plugin's wrapper changes, the harness diverges and the marketing
 * number is re-derived.
 *
 * Spec: [[Agent Console Token Efficiency Benchmark]] § Baselines, Metric definition.
 */
import type { CountableBlock } from "./token-accounting.ts";

/** A note as the harness sees it: identity path + body + vault root. */
export interface BenchNote {
	path: string;
	body: string;
	vaultPath: string;
}

/** A block tagged with the turn it is first introduced (1-based). */
export interface TimedBlock {
	at: number;
	block: CountableBlock;
}

/** Mirrors context-builder.ts buildFileUri (note: `file://`, not `file:///`). */
export function buildFileUri(vaultPath: string, notePath: string): string {
	return `file://${vaultPath}/${notePath}`;
}

/**
 * The reference-only Channel-1 wrapper. Reconstructed verbatim from
 * context-builder.ts (useEmbeddedContext === false branch). BM-T02 guards
 * that this stays byte-identical to the shipped output.
 */
export function refBlockText(note: BenchNote): string {
	const ref = buildFileUri(note.vaultPath, note.path);
	return `<obsidian_context_note ref="${ref}">\nThe user has set this note as context for this chat. The conversation involves this note. Use the Read tool to examine its content when relevant.\n</obsidian_context_note>`;
}

/** B1 reference block for a single note (one user turn's worth). */
export function b1RefBlock(note: BenchNote): CountableBlock {
	return { type: "text", text: refBlockText(note) };
}

/**
 * Inlined-body block: same envelope as the reference wrapper but with the
 * note body in place of the "use the Read tool" instruction. Used by B0
 * (every turn) and HYD (turn 1 only). Same envelope keeps B0/HYD vs B1
 * apples-to-apples — the only difference is body vs one-line instruction.
 */
export function inlinedBodyBlock(note: BenchNote): CountableBlock {
	const ref = buildFileUri(note.vaultPath, note.path);
	return {
		type: "text",
		text: `<obsidian_context_note ref="${ref}">\n${note.body}\n</obsidian_context_note>`,
	};
}

/** The two history blocks a single Read round-trip adds. */
export function readRoundTrip(note: BenchNote): CountableBlock[] {
	return [
		{ type: "tool_use", name: "Read", input: { path: note.path } },
		{ type: "tool_result", text: note.body },
	];
}

export interface ReadBehavior {
	/** Turn on which the agent issues the Read (1-based). */
	readTurn: number;
	/** Whether the agent reads at all (S5 honesty guard sets this false). */
	read: boolean;
}

/**
 * B0 — inject full note content on every user turn.
 * Each note's inlined body is introduced at every turn 1..K.
 */
export function b0Timed(notes: BenchNote[], K: number): TimedBlock[] {
	const out: TimedBlock[] = [];
	for (const note of notes) {
		for (let j = 1; j <= K; j++) {
			out.push({ at: j, block: inlinedBodyBlock(note) });
		}
	}
	return out;
}

/**
 * B1 — reference-only Channel 1 + (optionally) one Read per note.
 * Ref block every turn; the Read round-trip is introduced on readTurn+1
 * (the result enters history after the agent acts on the reference).
 */
export function b1Timed(
	notes: BenchNote[],
	K: number,
	behavior: ReadBehavior,
): TimedBlock[] {
	const out: TimedBlock[] = [];
	for (const note of notes) {
		for (let j = 1; j <= K; j++) {
			out.push({ at: j, block: b1RefBlock(note) });
		}
		if (behavior.read) {
			const at = behavior.readTurn + 1;
			for (const block of readRoundTrip(note)) {
				out.push({ at, block });
			}
		}
	}
	return out;
}

/**
 * HYD — hydrate once (body inlined on turn 1), reference thereafter, no Read.
 * Front-loads the body; replayed K times it costs ~K*C, which is why it
 * loses badly in the never-read scenario (S5) — the honesty guard.
 */
export function hydTimed(notes: BenchNote[], K: number): TimedBlock[] {
	const out: TimedBlock[] = [];
	for (const note of notes) {
		out.push({ at: 1, block: inlinedBodyBlock(note) });
		for (let j = 2; j <= K; j++) {
			out.push({ at: j, block: b1RefBlock(note) });
		}
	}
	return out;
}
