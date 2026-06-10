/**
 * Scenario matrix + accounting for the context-efficiency benchmark.
 *
 * Leaf module: only `import type` (erased by Node type-stripping; resolved
 * extensionless by tsc). Strategy builders + the token counter are injected
 * (StrategyDeps) so this file has zero relative runtime imports — the CLI
 * and the tests wire the real implementations in.
 *
 * Spec: [[Agent Console Token Efficiency Benchmark]] § Scenario matrix,
 *       § Analytical model, Decisions BM1/BM4/BM5.
 */
import type { BenchNote, ReadBehavior, TimedBlock } from "./strategies";
import type { CountableBlock } from "./token-accounting";

export const DEFAULT_VAULT = "/Users/example/vault";

/** Deterministic markdown-ish filler sized to ~approxTokens (cl100k ≈ 4 ch/tok). */
export function makeNote(
	path: string,
	approxTokens: number,
	vaultPath: string = DEFAULT_VAULT,
): BenchNote {
	const unit =
		"The crystallized context model keeps a reference in the window and lets the agent read on demand. ";
	const targetChars = approxTokens * 4;
	let body = "";
	while (body.length < targetChars) body += unit;
	return { path, body: body.slice(0, targetChars), vaultPath };
}

export type ScenarioKind = "standard" | "mention";

export interface Scenario {
	id: string;
	label: string;
	K: number;
	notes: BenchNote[];
	read: ReadBehavior;
	/** "mention": B1 is a truncated inline body (no Read); HYD not applicable. */
	kind: ScenarioKind;
	/** For kind="mention": chars of the body kept inline. */
	mentionTruncateChars?: number;
	headline?: boolean;
}

export const SCENARIOS: Scenario[] = [
	{
		id: "S1",
		label: "1 median note (~1.5K tok), K=8, read once",
		K: 8,
		notes: [makeNote("06-knowledge/Median Note.md", 1500)],
		read: { readTurn: 1, read: true },
		kind: "standard",
		headline: true,
	},
	{
		id: "S2",
		label: "1 small note (~400 tok), K=8, read once",
		K: 8,
		notes: [makeNote("06-knowledge/Small Note.md", 400)],
		read: { readTurn: 1, read: true },
		kind: "standard",
	},
	{
		id: "S3",
		label: "1 large note (~6K tok), K=8, read once",
		K: 8,
		notes: [makeNote("06-knowledge/Large Note.md", 6000)],
		read: { readTurn: 1, read: true },
		kind: "standard",
	},
	{
		id: "S4",
		label: "3 median notes, K=10, each read once",
		K: 10,
		notes: [
			makeNote("06-knowledge/Note A.md", 1500),
			makeNote("06-knowledge/Note B.md", 1500),
			makeNote("06-knowledge/Note C.md", 1500),
		],
		read: { readTurn: 1, read: true },
		kind: "standard",
	},
	{
		id: "S5",
		label: "1 median note, K=8, NEVER read (honesty guard)",
		K: 8,
		notes: [makeNote("06-knowledge/Median Note.md", 1500)],
		read: { readTurn: 1, read: false },
		kind: "standard",
	},
	{
		id: "S6",
		label: "mention of a large note, K=6, truncated inline",
		K: 6,
		notes: [makeNote("06-knowledge/Mentioned Large.md", 6000)],
		read: { readTurn: 1, read: false },
		kind: "mention",
		mentionTruncateChars: 1600, // ~400 tok kept inline
	},
];

/** Replay accounting: a block at turn `at` is counted in calls at..K. */
export function totalWithReplay(
	timed: TimedBlock[],
	K: number,
	countBlock: (b: CountableBlock) => number,
): number {
	let total = 0;
	for (const { at, block } of timed) {
		total += countBlock(block) * (K - at + 1);
	}
	return total;
}

export interface StrategyDeps {
	b0Timed: (notes: BenchNote[], K: number) => TimedBlock[];
	b1Timed: (
		notes: BenchNote[],
		K: number,
		behavior: ReadBehavior,
	) => TimedBlock[];
	hydTimed: (notes: BenchNote[], K: number) => TimedBlock[];
	countBlock: (b: CountableBlock) => number;
}

export interface ScenarioResult {
	id: string;
	label: string;
	K: number;
	headline: boolean;
	b0: number;
	b1: number;
	/** null when HYD is not applicable (mention scenarios). */
	hyd: number | null;
	/** % fewer tokens, B1 vs B0 — the SHIPPED headline axis. */
	b1VsB0: number;
	/** % fewer tokens, HYD vs B0 (model row; null for mention). */
	hydVsB0: number | null;
	/** % fewer tokens, HYD vs B1 — negative = HYD worse (honesty guard). */
	hydVsB1: number | null;
}

/** Percent fewer tokens of `x` relative to `base`. Negative = x is larger. */
export function percentLower(base: number, x: number): number {
	if (base === 0) return 0;
	return (1 - x / base) * 100;
}

export function runScenario(s: Scenario, deps: StrategyDeps): ScenarioResult {
	const b0 = totalWithReplay(deps.b0Timed(s.notes, s.K), s.K, deps.countBlock);

	let b1: number;
	let hyd: number | null;

	if (s.kind === "mention") {
		// B1 (mention) = truncated body inlined every turn, no Read; HYD n/a.
		const chars = s.mentionTruncateChars ?? 1600;
		const truncated: TimedBlock[] = [];
		for (const note of s.notes) {
			const block: CountableBlock = {
				type: "text",
				text: `<obsidian_mention ref="file://${note.vaultPath}/${note.path}">\n${note.body.slice(0, chars)}\n</obsidian_mention>`,
			};
			for (let j = 1; j <= s.K; j++) truncated.push({ at: j, block });
		}
		b1 = totalWithReplay(truncated, s.K, deps.countBlock);
		hyd = null;
	} else {
		b1 = totalWithReplay(
			deps.b1Timed(s.notes, s.K, s.read),
			s.K,
			deps.countBlock,
		);
		hyd = totalWithReplay(deps.hydTimed(s.notes, s.K), s.K, deps.countBlock);
	}

	return {
		id: s.id,
		label: s.label,
		K: s.K,
		headline: s.headline ?? false,
		b0,
		b1,
		hyd,
		b1VsB0: percentLower(b0, b1),
		hydVsB0: hyd === null ? null : percentLower(b0, hyd),
		hydVsB1: hyd === null ? null : percentLower(b1, hyd),
	};
}

// ---------------------------------------------------------------------------
// Analytical model (v0) — Python port from the spec. chars/4 + fixed r/f/O.
// Illustrative only (BM5); reproduced so BM-T01 can sanity-check the harness.
// ---------------------------------------------------------------------------

export interface ModelOpts {
	r?: number;
	f?: number;
	O?: number;
	readTurn?: number;
	read?: boolean;
}

export interface ModelResult {
	b0: number;
	b1: number;
	hyd: number;
}

/** Port of the spec's `simulate(K, C, ...)`. */
export function simulate(K: number, C: number, opts: ModelOpts = {}): ModelResult {
	const { r = 35, f = 40, O = 60, readTurn = 1, read = true } = opts;
	const total = (items: Array<[number, number]>): number =>
		items.reduce((acc, [at, size]) => acc + size * (K - at + 1), 0);

	const b0Items: Array<[number, number]> = [];
	for (let j = 1; j <= K; j++) b0Items.push([j, C]);

	const b1Items: Array<[number, number]> = [];
	for (let j = 1; j <= K; j++) b1Items.push([j, r]);
	if (read) b1Items.push([readTurn + 1, C + O]);

	const hydItems: Array<[number, number]> = [[1, C + f]];
	for (let j = 2; j <= K; j++) hydItems.push([j, r]);

	return { b0: total(b0Items), b1: total(b1Items), hyd: total(hydItems) };
}

// ---------------------------------------------------------------------------
// Dollar-cost axis (BM1/BM-T05) — prompt-caching discount on B0's repeats.
// Reported separately, labeled an estimate; never merged into the headline.
// ---------------------------------------------------------------------------

/**
 * B0 dollar-cost tokens: the first occurrence of each repeated block is full
 * price; replays are discounted by `cacheHitDiscount` (e.g. 0.1 = cached
 * reads cost 10% of full). This shrinks B0's *cost* relative to its raw
 * context-window token count — which is exactly why the $ delta is smaller
 * than the context-window delta.
 */
export function dollarCostB0(
	timed: TimedBlock[],
	K: number,
	countBlock: (b: CountableBlock) => number,
	cacheHitDiscount: number,
): number {
	// Group identical blocks; first turn full price, later replays discounted.
	let cost = 0;
	for (const { at, block } of timed) {
		const t = countBlock(block);
		const replays = K - at; // calls after the one it was introduced in
		cost += t + t * cacheHitDiscount * replays;
	}
	return cost;
}
