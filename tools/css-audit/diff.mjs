/**
 * css-audit: diff
 *
 * Compares two snapshots (baseline vs after) property-by-property. The cleanup is
 * appearance-preserving iff there are zero deltas on NON-pseudo targets.
 *
 * Exit code: 0 if no non-pseudo deltas (PASS), 1 if any (FAIL — those selectors
 * lost the cascade when !important was dropped → bump their specificity and re-run).
 *
 * Pseudo targets are recorded in base state only (getComputedStyle can't see
 * :hover/:focus); their deltas are reported as INFORMATIONAL, not gating, until
 * forced-state coverage lands. A base-state delta on a pseudo target still means
 * the element's resting style changed and is worth a look.
 *
 * Usage: node diff.mjs --baseline baseline.json --after after.json
 *
 * Spec: 04-initiatives/Agent Console/Agent Console Plugin Store Warnings.md
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const getArg = (flag, def) => {
	const i = args.indexOf(flag);
	return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const baselinePath = getArg("--baseline", "tools/css-audit/baseline.json");
const afterPath = getArg("--after", "tools/css-audit/after.json");

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));

const META = new Set(["__source", "__pseudo"]);
const gating = []; // non-pseudo deltas
const informational = []; // pseudo (base-state) deltas
const missing = []; // targets present in one snapshot but not the other

const selectors = new Set([...Object.keys(baseline.results), ...Object.keys(after.results)]);
for (const sel of selectors) {
	const b = baseline.results[sel];
	const a = after.results[sel];
	if (!b || !a) {
		missing.push(sel);
		continue;
	}
	const isPseudo = b.__pseudo || a.__pseudo;
	const props = new Set([...Object.keys(b), ...Object.keys(a)].filter((p) => !META.has(p)));
	for (const p of props) {
		if (b[p] !== a[p]) {
			const delta = { selector: sel, prop: p, before: b[p], after: a[p], source: a.__source || b.__source };
			(isPseudo ? informational : gating).push(delta);
		}
	}
}

const fmt = (d) => `  ${d.selector}\n      ${d.prop}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}  [${d.source}]`;

console.log(`css-audit diff: ${baselinePath}  vs  ${afterPath}`);
console.log(`  baseline mode=${baseline.mode} css=${baseline.css}`);
console.log(`  after    mode=${after.mode} css=${after.css}`);
console.log("");

if (missing.length) {
	console.log(`⚠ ${missing.length} target(s) present in only one snapshot:`);
	missing.forEach((s) => console.log("  " + s));
	console.log("");
}

if (gating.length === 0) {
	console.log(`✓ PASS — 0 deltas on non-pseudo targets (appearance preserved)`);
} else {
	console.log(`✗ FAIL — ${gating.length} delta(s) on non-pseudo targets (these regressed):`);
	gating.forEach((d) => console.log(fmt(d)));
}
console.log("");

if (informational.length) {
	console.log(`ℹ ${informational.length} delta(s) on pseudo targets (base-state only — verify with forced-state pass):`);
	informational.forEach((d) => console.log(fmt(d)));
} else {
	console.log(`✓ no base-state deltas on pseudo targets`);
}

process.exit(gating.length === 0 ? 0 : 1);
