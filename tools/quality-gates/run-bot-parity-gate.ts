#!/usr/bin/env -S npx tsx
/**
 * Bot-parity gate — CLI shell.
 *
 * Runs `eslint.bot-parity.mjs` over the repo, diffs the findings against
 * `bot-findings-exceptions.json`, and fails on any delta. Predicts the Obsidian
 * store's automated review so a "Caution" label cannot land minutes after a
 * clean `npm run lint` — which is exactly what happened on v2.2.0 (33 findings,
 * 29 of them structurally invisible to the old gate).
 *
 * Usage:
 *   npm run gate:bot-parity                     run eslint, diff, report
 *   npm run gate:bot-parity -- --report r.json   diff a report captured earlier
 *                                                (used to re-verify old tags)
 *
 * Exit codes:
 *   0  no new findings, no stale exceptions
 *   1  delta — new finding(s) and/or stale exception entr(y/ies)
 *   2  harness failure — bad exception list, or eslint could not parse a file
 *
 * ── Why this does not read eslint's exit code ─────────────────────────────
 * eslint exits 0 when a run produces only warnings. Every finding on the
 * current tree is a warning, and warnings are precisely what produce the store's
 * "Caution" label (D4). Trusting the exit status would reproduce blind spot #3
 * verbatim, so the verdict comes from the parsed report, never from the status.
 *
 * This gate is BLOCKING from day one, unlike the warn-only perf sub-gate. The
 * `tools/**` findings were fixed rather than baselined (D2), so the target is
 * genuinely zero and a delta is always actionable.
 *
 * Spec: [[Agent Console Review-Bot Parity Gate]] — Layers 1 and 2. Layer 3, the
 * authoritative developer-dashboard preview scan, is a release-flow step: this
 * pass is an approximation (our obsidianmd version can drift from the bot's, and
 * the bot also runs dependency-advisory, malware and CSS checks that no local
 * eslint pass reproduces).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { log, logError } from "../lib/cli-log";
import {
	evaluateParity,
	formatVerdict,
	parseEslintReport,
	validateExceptions,
} from "./lib/bot-parity";

const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const CONFIG = join(ROOT, "eslint.bot-parity.mjs");
const EXCEPTIONS = join(ROOT, "tools/quality-gates/bot-findings-exceptions.json");

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Run the parity lint and return the path of its JSON report. */
function runParityLint(): string {
	const out = join(mkdtempSync(join(tmpdir(), "bot-parity-")), "report.json");
	try {
		execFileSync(
			"npx",
			["eslint", "--config", CONFIG, ".", "--format", "json", "--output-file", out],
			{ cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
		);
	} catch {
		// Non-zero here means eslint found problems, which is the normal case and
		// says nothing about severity. The report file is still written; the
		// verdict is derived from it. A genuinely broken run is caught below by
		// the missing-report check and by parse fatals.
	}
	if (!existsSync(out)) {
		logError("bot-parity: FAIL — eslint produced no report; the parity config may be broken.");
		process.exit(2);
	}
	return out;
}

const argv = process.argv.slice(2);
const reportFlag = argv.indexOf("--report");
const reportPath = reportFlag !== -1 ? argv[reportFlag + 1] : undefined;

if (reportFlag !== -1 && !reportPath) {
	logError("bot-parity: FAIL — --report requires a path to an eslint JSON report.");
	process.exit(2);
}

// 1. Exception list first: an invalid list must fail loudly rather than be
//    silently treated as empty (which would report every accepted finding as a
//    delta) or as permissive (which would hide real ones).
const exceptions = validateExceptions(readJson(EXCEPTIONS));
if (exceptions.kind === "invalid") {
	logError(`bot-parity: FAIL — ${EXCEPTIONS} is invalid:`);
	for (const issue of exceptions.issues) logError(`  ${issue}`);
	process.exit(2);
}

// 2. Findings.
const parsed = parseEslintReport(readJson(reportPath ?? runParityLint()), ROOT);
if (parsed.kind === "fatal") {
	logError("bot-parity: FAIL — eslint could not lint the following file(s), so the run is not a clean signal:");
	for (const e of parsed.errors) logError(`  ${e.file}: ${e.message}`);
	process.exit(2);
}

// 3. Verdict.
const verdict = evaluateParity(parsed.findings, exceptions.entries);
for (const line of formatVerdict(verdict)) log(line);
process.exit(verdict.kind === "pass" ? 0 : 1);
