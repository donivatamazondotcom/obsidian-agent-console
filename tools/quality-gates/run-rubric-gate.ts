/**
 * run-rubric-gate — CLI wrapper for the `rubric-declared` CI gate.
 *
 * Owns the impure edges (git, environment, exit codes); the decision itself is
 * the pure `evaluateRubricDeclaration` in `lib/rubric-declaration.ts`, which is
 * unit-tested. See that file for why the gate exists and what it deliberately
 * does NOT check.
 *
 * The PR body arrives via the environment and is never interpolated into a
 * shell command — a PR body is attacker-controlled text.
 *
 * Env:
 *   PR_BODY   the pull request body (may be empty/unset)
 *   BASE_REF  the base branch name, e.g. `main`
 *
 * Exit 0 = declared, waived, or not applicable. Exit 1 = undeclared.
 */

import { execFileSync } from "node:child_process";
import { log, logError } from "../lib/cli-log";
import {
	describeRubricResult,
	evaluateRubricDeclaration,
} from "./lib/rubric-declaration";

const TEST_FILE = /(__tests__\/|\.test\.tsx?$)/;

function changedTestFiles(baseRef: string): string[] {
	// Three-dot diff against the merge base — the same range the PR shows.
	const out = execFileSync(
		"git",
		["diff", "--name-only", `origin/${baseRef}...HEAD`],
		{ encoding: "utf8" },
	);
	return out
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && TEST_FILE.test(line));
}

function main(): void {
	const baseRef = process.env.BASE_REF ?? "main";
	const body = process.env.PR_BODY ?? null;

	let files: string[];
	try {
		files = changedTestFiles(baseRef);
	} catch (error) {
		// A gate that cannot compute its input must fail loudly, never pass by
		// default — a silent pass here is the very hole this gate closes.
		logError(
			`::error::rubric gate could not diff against origin/${baseRef}: ${String(error)}`,
		);
		process.exit(1);
	}

	if (files.length > 0) {
		log("Test files changed in this PR:");
		for (const file of files) log(`  ${file}`);
	}

	const result = evaluateRubricDeclaration({ body, changedTestFiles: files });
	const message = describeRubricResult(result);

	if (result.kind === "fail") {
		logError(`::error::${message}`);
		process.exit(1);
	}
	log(message);
}

main();
