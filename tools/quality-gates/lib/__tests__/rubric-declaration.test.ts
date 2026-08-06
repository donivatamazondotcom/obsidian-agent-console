/**
 * Tests for the rubric-declaration gate (pure).
 *
 * Red-first for [[I192 rubric-declared gate passes on a bare R1 token]]. The
 * gate's documented intent is to assert the R1–R5 section was *answered*
 * whenever the diff touches tests — presence, not truth. Two holes broke that
 * on its own terms:
 *
 *   1. the token `R1` alone counted as answering a five-item section;
 *   2. `N/A` matched anywhere in the body, so a stray "N/A" in an unrelated
 *      table silently waived the whole check — the exact silent-omission path
 *      the job exists to remove.
 */
import { describe, it, expect } from "vitest";
import { evaluateRubricDeclaration } from "../rubric-declaration";

const TESTS_CHANGED = ["src/services/__tests__/thing.test.ts"];

const FULL_CHECKLIST = `
## Test-quality rubric

- [x] **R1 Red-first:** failed before the fix, output cited below
- [x] **R2 Boundary honesty:** enters at the public hook API
- [x] **R3 Outcome assertion:** asserts persisted state
- [x] **R4 Mock budget:** no mocks added
- [x] **R5 No tautology:** expected values hand-written
`;

describe("evaluateRubricDeclaration", () => {
	it("skips when the diff touches no test files", () => {
		const r = evaluateRubricDeclaration({ body: "", changedTestFiles: [] });
		expect(r.kind).toBe("skip");
	});

	it("passes when all five gates are declared", () => {
		const r = evaluateRubricDeclaration({
			body: FULL_CHECKLIST,
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("ok");
	});

	// ── Hole 1: a bare R1 token used to satisfy the whole section ──────────
	it("FAILS on a bare R1 mention and names the missing gates", () => {
		const r = evaluateRubricDeclaration({
			body: "Testing\n\n- R1 red-first: 20 failures against unfixed code.\n",
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("fail");
		if (r.kind !== "fail") return;
		expect(r.missing).toEqual(["R2", "R3", "R4", "R5"]);
	});

	it("FAILS when any single gate is missing", () => {
		const r = evaluateRubricDeclaration({
			body: FULL_CHECKLIST.replace("**R4 Mock budget:**", "mock notes:"),
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("fail");
		if (r.kind !== "fail") return;
		expect(r.missing).toEqual(["R4"]);
	});

	// ── Hole 2: an unanchored N/A anywhere used to waive the check ─────────
	it("FAILS on a stray N/A in unrelated prose", () => {
		const r = evaluateRubricDeclaration({
			body: "| Field | Value |\n|---|---|\n| Owner | N/A |\n",
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("fail");
	});

	it("FAILS on a bare `Rubric: N/A` with no reason", () => {
		const r = evaluateRubricDeclaration({
			body: "Rubric: N/A\n",
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("fail");
	});

	it("passes on an anchored waiver that carries a reason", () => {
		const r = evaluateRubricDeclaration({
			body: "Rubric: N/A — test-only rename, no behaviour asserted either side.\n",
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("waived");
		if (r.kind !== "waived") return;
		expect(r.reason).toContain("test-only rename");
	});

	it("accepts the waiver case-insensitively and with a hyphen separator", () => {
		for (const body of [
			"rubric: n/a - deleted a dead fixture, nothing to assert.\n",
			"RUBRIC: N/A: dropped an obsolete snapshot file.\n",
		]) {
			expect(
				evaluateRubricDeclaration({ body, changedTestFiles: TESTS_CHANGED })
					.kind,
			).toBe("waived");
		}
	});

	// ── Token matching must not be fooled by lookalikes ───────────────────
	it("does not count R1 inside a longer token", () => {
		const r = evaluateRubricDeclaration({
			body: "Bumped to release R10 and R123; see PR1 and AR1.\n",
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("fail");
		if (r.kind !== "fail") return;
		expect(r.missing).toEqual(["R1", "R2", "R3", "R4", "R5"]);
	});

	it("accepts gates written as plain prose, not only checkboxes", () => {
		const r = evaluateRubricDeclaration({
			body: "R1 red-first. R2 at the send seam. R3 asserts the DOM. R4 no mocks. R5 hand-written expectations.\n",
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("ok");
	});

	it("treats a null/absent body as a failure, not a pass", () => {
		const r = evaluateRubricDeclaration({
			body: null,
			changedTestFiles: TESTS_CHANGED,
		});
		expect(r.kind).toBe("fail");
	});
});
