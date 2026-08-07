/**
 * rubric-declaration — pure evaluator for the `rubric-declared` CI gate.
 *
 * The gate asserts the R1–R5 test-quality section of the PR template was
 * **answered** whenever the diff touches test files. It deliberately checks
 * PRESENCE, not truth: only human review or the mutation audit can tell whether
 * an R1 claim is honest. What it removes is the silent-omission path, so
 * skipping the rubric stays a visible choice.
 *
 * Extracted from an inline CI bash step (I192) because that step passed on two
 * inputs that had not answered the section at all:
 *
 *   1. the token `R1` anywhere satisfied a FIVE-item section, so a passing
 *      prose mention ("R1 red-first: …") went green with R2–R5 undeclared;
 *   2. `[Nn]/[Aa]` was unanchored, so a stray "N/A" in an unrelated table
 *      waived the whole check — silently, and with no reason recorded.
 *
 * Both are failures on the gate's own terms, not a redefinition of it. Living
 * here as a pure function so the semantics are unit-testable; the CLI wrapper
 * (`run-rubric-gate.ts`) owns git and the environment.
 */

/** The five gates, in template order. */
export const RUBRIC_GATES = ["R1", "R2", "R3", "R4", "R5"] as const;

/**
 * An anchored waiver: a line whose FIRST content is `Rubric: N/A`, followed by
 * a separator and a reason. Anchoring to line start (multiline) is what stops
 * an incidental "N/A" in prose or a table cell from waiving the gate, and
 * requiring a reason is what keeps the waiver a visible, justified choice.
 */
const WAIVER = /^[ \t>*-]*rubric:[ \t]*n\/a[ \t]*[—–:-]?[ \t]*(.*)$/im;

/** Minimum reason length; `Rubric: N/A` and `Rubric: N/A -` must not pass. */
const MIN_REASON_LENGTH = 3;

export interface RubricInput {
	/** The PR body. Null/absent is a failure, never a pass. */
	body: string | null;
	/** Test files touched by the diff; empty ⇒ the gate does not apply. */
	changedTestFiles: string[];
}

export type RubricResult =
	| { kind: "skip" }
	| { kind: "ok" }
	| { kind: "waived"; reason: string }
	| { kind: "fail"; missing: string[] };

/**
 * Whether a gate token appears as its own token. `R1` must not match inside
 * `R10`, `R123`, `PR1`, or `AR1` — a trailing digit or a leading alphanumeric
 * means it is a different token.
 */
function gateDeclared(body: string, gate: string): boolean {
	return new RegExp(`(^|[^A-Za-z0-9])${gate}([^0-9]|$)`).test(body);
}

/**
 * Fenced code blocks (``` or ~~~), including the fence lines themselves.
 * A PR body that DOCUMENTS the waiver syntax, or quotes CONTRIBUTING.md, is
 * not waiving anything — but the waiver anchor cannot tell prose from a code
 * sample, so code regions are removed before any matching happens.
 */
const FENCED_BLOCK = /^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm;

/** Inline code spans — same reasoning as fenced blocks, one line down. */
const INLINE_CODE = /`[^`\n]*`/g;

/**
 * Remove code regions so only prose is matched. This closes the same hole the
 * gate exists to close, one level up: the first version of this fix reported
 * "rubric waived" against its OWN pull request, because that PR's body showed
 * the waiver format in a fenced block as documentation (found on the gate's
 * first live run, PR #284 — the check was GREEN and only the job log revealed
 * the wrong verdict).
 */
export function stripCodeRegions(body: string): string {
	return body.replace(FENCED_BLOCK, "").replace(INLINE_CODE, "");
}

/**
 * Evaluate a PR body against the rubric requirement. Total: every input maps
 * to exactly one tagged result, and nothing throws.
 */
export function evaluateRubricDeclaration(input: RubricInput): RubricResult {
	if (input.changedTestFiles.length === 0) return { kind: "skip" };

	// Prose only — a code sample neither declares a gate nor waives one.
	const body = stripCodeRegions(input.body ?? "");

	const waiver = WAIVER.exec(body);
	if (waiver) {
		const reason = (waiver[1] ?? "").trim();
		if (reason.length >= MIN_REASON_LENGTH) return { kind: "waived", reason };
		// An anchored waiver with no reason is the silent-omission path wearing
		// a label — fall through to the all-gates requirement.
	}

	const missing = RUBRIC_GATES.filter((gate) => !gateDeclared(body, gate));
	return missing.length === 0 ? { kind: "ok" } : { kind: "fail", missing: [...missing] };
}

/** Human-readable gate outcome, shared by the CLI and its tests. */
export function describeRubricResult(result: RubricResult): string {
	switch (result.kind) {
		case "skip":
			return "OK - no test files changed; rubric declaration not required.";
		case "ok":
			return `OK - PR body declares all ${RUBRIC_GATES.length} rubric gates.`;
		case "waived":
			return `OK - rubric waived with a reason: ${result.reason}`;
		case "fail":
			return (
				`This PR changes test files but its body does not declare ` +
				`${result.missing.join(", ")}. Tick R1-R5 from the PR template, or ` +
				`state "Rubric: N/A - <reason>" on its own line. ` +
				`See CONTRIBUTING.md -> Test quality rubric.`
			);
	}
}
