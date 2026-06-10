#!/usr/bin/env node
/**
 * Quality-gate umbrella (Gate B-v1 today; Gates A/C fold in later per QG1).
 * Stable entry point so CI / the release flow call `npm run gate` regardless
 * of which sub-gates exist. Runs each sub-gate, forwarding any args (e.g.
 * `--update` to ratchet baselines), and exits with the worst sub-gate code.
 *
 * Phase 1: warn-only — sub-gates exit 0 on regression. When a sub-gate flips
 * to blocking, its non-zero exit propagates here and fails the run.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const subgates = [
	{ name: "perf (B-v1)", script: join(HERE, "run-perf-gate.mjs") },
	// future: coverage (Gate A), bundle size (Gate C)
];

let worst = 0;
for (const g of subgates) {
	console.log(`\n=== quality-gate: ${g.name} ===`);
	try {
		execFileSync("node", [g.script, ...process.argv.slice(2)], { stdio: "inherit" });
	} catch (e) {
		worst = Math.max(worst, e.status ?? 1);
	}
}
console.log(`\nquality-gate: done (${subgates.length} sub-gate(s)).`);
process.exit(worst);
