/**
 * Context-token efficiency benchmark — CLI harness.
 *
 * Runs the scenario matrix with the real cl100k_base tokenizer (BM5),
 * emits a markdown matrix, the S1 headline (B1-vs-B0, the SHIPPED axis),
 * a separate caching-discounted dollar-cost estimate (BM1), and a v0
 * analytical-model cross-check.
 *
 * Run: `npm run bench:tokens`  (node type-strips this .ts at runtime)
 *
 * This module is CLI-only — not imported by any test, so tsc (include:
 * src/**) never type-checks it; the explicit `.ts` import extensions below
 * are required by Node's type-stripping loader and are intentional.
 *
 * Spec: [[Agent Console Token Efficiency Benchmark]].
 */
import {
	createEncoder,
	serializeBlock,
	type CountableBlock,
} from "./token-accounting.ts";
import { b0Timed, b1Timed, hydTimed } from "./strategies.ts";
import {
	SCENARIOS,
	runScenario,
	simulate,
	dollarCostB0,
	totalWithReplay,
	percentLower,
	makeNote,
	type StrategyDeps,
} from "./scenarios.ts";

const enc = createEncoder();
const countBlock = (b: CountableBlock): number => enc(serializeBlock(b));
const deps: StrategyDeps = { b0Timed, b1Timed, hydTimed, countBlock };

const n = (x: number): string => x.toLocaleString("en-US");
const pct = (x: number | null): string =>
	x === null ? "—" : `${x.toFixed(1)}%`;

function main(): void {
	const results = SCENARIOS.map((s) => runScenario(s, deps));

	console.log(
		"# Agent Console — Context-Token Efficiency Benchmark\n",
	);
	console.log(
		`Tokenizer: tiktoken \`cl100k_base\` (js-tiktoken, offline). Generated: ${new Date().toISOString()}\n`,
	);

	// --- Headline (S1, B1 vs B0 — the shipped reference-only model) ---
	const s1 = results.find((r) => r.headline);
	if (s1) {
		console.log(
			`> **Headline:** Over a typical multi-turn conversation (K=${s1.K}, single median context note), Agent Console's reference-only context uses **${s1.b1VsB0.toFixed(0)}% fewer context tokens** than injecting the note's full content on every message.\n`,
		);
		console.log(
			"> Scope: multi-turn only (one-shots have no re-injection). Context-window axis (caching-independent). HYD shown as a model row — hydration is not yet shipped and is token-neutral vs reference-only; sell it on latency/determinism, not tokens.\n",
		);
	}

	// --- Full scenario matrix (always published, incl. the never-read row) ---
	console.log("## Scenario matrix\n");
	console.log(
		"| ID | Scenario | B0 tokens | B1 tokens | HYD tokens | B1 vs B0 | HYD vs B0 | HYD vs B1 |",
	);
	console.log(
		"|----|----------|-----------|-----------|------------|----------|-----------|-----------|",
	);
	for (const r of results) {
		const flag = r.headline ? " **★**" : "";
		console.log(
			`| ${r.id}${flag} | ${r.label} | ${n(r.b0)} | ${n(r.b1)} | ${r.hyd === null ? "—" : n(r.hyd)} | ${pct(r.b1VsB0)} | ${pct(r.hydVsB0)} | ${pct(r.hydVsB1)} |`,
		);
	}
	console.log(
		"\n*B1 vs B0 is the shipped headline axis. HYD vs B1 < 0 (e.g. S5) is the honesty guard — front-loaded hydration loses when the note is never read.*\n",
	);

	// --- Dollar-cost axis (separate, caveated estimate) ---
	console.log("## Dollar-cost axis (estimate — do NOT conflate with headline)\n");
	if (s1) {
		const scenario = SCENARIOS.find((s) => s.id === s1.id)!;
		const cacheHitDiscount = 0.1; // assume cached input ≈ 10% of full price
		const b0Dollar = dollarCostB0(
			b0Timed(scenario.notes, scenario.K),
			scenario.K,
			countBlock,
			cacheHitDiscount,
		);
		// B1 has no repeated identical large block to cache meaningfully; use raw.
		const b1Dollar = s1.b1;
		console.log(
			`With prompt caching (cached input billed at ${cacheHitDiscount * 100}% of full), B0's repeated body blocks get discounted:\n`,
		);
		console.log(`- B0 context-window tokens: ${n(s1.b0)} → billed ≈ ${n(Math.round(b0Dollar))}`);
		console.log(`- B1 billed ≈ ${n(b1Dollar)}`);
		console.log(
			`- **$-axis B1 vs B0 ≈ ${percentLower(b0Dollar, b1Dollar).toFixed(0)}%** (vs ${s1.b1VsB0.toFixed(0)}% on the context-window axis — the $ saving is smaller because caching softens B0's repeats).\n`,
		);
	}

	// --- v0 analytical-model cross-check (BM-T01 reference) ---
	console.log("## v0 analytical-model cross-check (illustrative, chars/4)\n");
	const model = simulate(8, 1500);
	console.log(
		`Model (K=8, C=1500, chars/4): HYD vs B0 = ${percentLower(model.b0, model.hyd).toFixed(0)}%, B1 vs B0 = ${percentLower(model.b0, model.b1).toFixed(0)}% — sets the ~75–85% expectation band.`,
	);
	// silence unused-import lint in case helpers drift
	void totalWithReplay;
	void makeNote;
}

main();
