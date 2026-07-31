#!/usr/bin/env node
/**
 * Perf gate (Gate B-v1) — runs the vitest benchmarks, compares ops/sec (hz)
 * against the committed baseline, and reports regressions.
 *
 * PHASE 2: BLOCKING (calibrated 2026-07-31). Exits 1 on any regression beyond
 * the threshold, 2 on harness failure. Meaningful ONLY on the machine that
 * seeded the baseline (the maintainer's) — CI runs the raw `npm run bench`
 * for observation, never this diff, because cross-hardware deltas are noise.
 *
 * Threshold: read from the committed baseline's `thresholdPct` (fallback 15).
 * Calibration evidence (2026-07-31, 5 runs, same machine): worst per-benchmark
 * hz spread 6.9%; 2x worst noise = 14%, so 15% keeps a margin above the noise
 * floor while catching a real regression. Re-calibrate whenever the benchmark
 * set changes materially: run the bench 5x, set thresholdPct >= 2x worst spread.
 *
 * Usage:
 *   node tools/quality-gates/run-perf-gate.mjs            measure + diff (warn)
 *   node tools/quality-gates/run-perf-gate.mjs --update   write current as new baseline
 *
 * Baseline: tools/quality-gates/perf-baseline.json
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = join(ROOT, "tools/quality-gates/perf-baseline.json");
const update = process.argv.includes("--update");
// Threshold lives in the baseline file so the number and the measurements it
// was calibrated against travel together. Fallback matches the calibrated 15%.
const THRESHOLD = existsSync(BASELINE)
	? ((JSON.parse(readFileSync(BASELINE, "utf8")).thresholdPct ?? 15) / 100)
	: 0.15;

// 1. Run vitest bench, capture JSON
const out = join(mkdtempSync(join(tmpdir(), "perfgate-")), "bench.json");
execFileSync("npx", ["vitest", "bench", "--run", "--outputJson", out], {
	cwd: ROOT,
	stdio: ["ignore", "ignore", "inherit"],
});

// 2. Flatten vitest output -> { name: { hz, mean } } (defensive: walk the tree)
function collect(node, acc) {
	if (Array.isArray(node)) {
		for (const n of node) collect(n, acc);
		return acc;
	}
	if (node && typeof node === "object") {
		if (typeof node.name === "string" && typeof node.hz === "number") {
			acc[node.name] = { hz: node.hz, mean: node.mean ?? null };
		}
		for (const v of Object.values(node)) collect(v, acc);
	}
	return acc;
}
const current = collect(JSON.parse(readFileSync(out, "utf8")), {});
const names = Object.keys(current);
if (names.length === 0) {
	console.error("perf-gate: FAIL — no benchmarks found in vitest output");
	process.exit(2);
}

// 3. Seed or ratchet baseline
if (update || !existsSync(BASELINE)) {
	writeFileSync(
		BASELINE,
		JSON.stringify(
			{ updated: new Date().toISOString(), thresholdPct: THRESHOLD * 100, benchmarks: current },
			null,
			"\t",
		) + "\n",
	);
	console.log(`perf-gate: ${update ? "ratcheted" : "seeded"} baseline (${names.length} benchmarks) -> ${BASELINE}`);
	process.exit(0);
}

// 4. Diff against baseline
const base = JSON.parse(readFileSync(BASELINE, "utf8")).benchmarks ?? {};
const regressions = [];
for (const name of names) {
	const b = base[name];
	if (!b) {
		console.log(`  NEW        ${name}  (${current[name].hz.toFixed(0)} hz; no baseline)`);
		continue;
	}
	const delta = (b.hz - current[name].hz) / b.hz; // >0 means slower now
	const pct = (delta * 100).toFixed(1);
	const flag = delta > THRESHOLD ? "REGRESSION" : delta < -THRESHOLD ? "faster" : "ok";
	console.log(`  ${flag.padEnd(10)} ${name}  ${pct}% (${b.hz.toFixed(0)} -> ${current[name].hz.toFixed(0)} hz)`);
	if (delta > THRESHOLD) regressions.push(name);
}
for (const name of Object.keys(base)) {
	if (!current[name]) console.log(`  MISSING    ${name}  (in baseline, not measured)`);
}

console.log("");
if (regressions.length) {
	console.log(
		`perf-gate: FAIL — ${regressions.length} regression(s) > ${(THRESHOLD * 100).toFixed(0)}%. ` +
			"If intended (an accepted tradeoff), ratchet with `npm run gate -- --update` and commit the baseline; otherwise investigate before tagging.",
	);
	process.exit(1); // blocking (phase 2, calibrated 2026-07-31)
} else {
	console.log("perf-gate: no regressions beyond threshold.");
}
process.exit(0);
