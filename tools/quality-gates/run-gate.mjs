#!/usr/bin/env node
/**
 * Quality-gate umbrella (Gate B-v1 today; Gates A/C fold in later per QG1).
 * Stable entry point so CI / the release flow call `npm run gate` regardless
 * of which sub-gates exist. Runs each sub-gate, forwarding any args (e.g.
 * `--update` to ratchet baselines), and exits with the worst sub-gate code.
 *
 * Both sub-gates are blocking; a non-zero exit propagates here and fails the
 * run. bot-parity has been blocking from the outset (zero new findings). perf
 * flipped to blocking 2026-07-31 after calibration (see run-perf-gate.mjs) —
 * note the perf diff is meaningful only on the machine that seeded the
 * committed baseline, so `npm run gate` is a release-time/maintainer command,
 * not a CI one.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const subgates = [
	{ name: "perf (B-v1)", cmd: "node", args: [join(HERE, "run-perf-gate.mjs")] },
	// Predicts the Obsidian store review's verdict. Run via tsx (already a
	// devDependency, same as `npm run invariants`) because the gate's pure core
	// is TypeScript and unit-tested; the runner writes through tools/lib/cli-log
	// so the gate does not trip its own no-console check.
	{
		name: "bot-parity",
		cmd: "npx",
		args: ["tsx", join(HERE, "run-bot-parity-gate.ts")],
	},
	// future: coverage (Gate A), bundle size (Gate C)
];

let worst = 0;
for (const g of subgates) {
	console.log(`\n=== quality-gate: ${g.name} ===`);
	try {
		execFileSync(g.cmd, [...g.args, ...process.argv.slice(2)], { stdio: "inherit" });
	} catch (e) {
		worst = Math.max(worst, e.status ?? 1);
	}
}
console.log(`\nquality-gate: done (${subgates.length} sub-gate(s)).`);
process.exit(worst);
