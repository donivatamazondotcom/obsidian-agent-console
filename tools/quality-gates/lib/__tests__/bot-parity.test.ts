import { describe, it, expect } from "vitest";
import {
	parseEslintReport,
	validateExceptions,
	evaluateParity,
	formatVerdict,
	REASON_CODES,
	type ExceptionEntry,
	type Finding,
} from "../bot-parity";

/**
 * Unit tests for the bot-parity gate's pure core.
 *
 * These enter at the three functions the CLI shell actually calls
 * (`parseEslintReport` → `validateExceptions` → `evaluateParity` →
 * `formatVerdict`), not at private helpers (R2). Every assertion is on a
 * returned value — a verdict, an issue list, rendered output lines — never on
 * "a mock was called" (R3). The only fixtures are literal eslint JSON payloads
 * and exception entries, so nothing here re-implements the diff logic it is
 * checking (R5).
 *
 * Spec: [[Agent Console Review-Bot Parity Gate]] T3 / T4 / T5 + decisions
 * D3 (mandatory reason codes) and D4 (warnings count).
 */

const ROOT = "/repo";

/** Minimal eslint JSON shape — one file, N messages. */
function report(
	file: string,
	messages: Array<Partial<{ ruleId: string | null; line: number; column: number; severity: number; message: string }>>,
) {
	return [
		{
			filePath: `${ROOT}/${file}`,
			messages: messages.map((m) => ({
				// Note `in` rather than `??` — an explicit `ruleId: null` is a parse
				// fatal and must survive the fixture, not be coalesced to a default.
				ruleId: "ruleId" in m ? m.ruleId : "obsidianmd/no-global-this",
				line: m.line ?? 1,
				column: m.column ?? 1,
				severity: m.severity ?? 1,
				message: m.message ?? "finding",
			})),
		},
	];
}

function entry(over: Partial<ExceptionEntry> = {}): ExceptionEntry {
	return {
		rule: "obsidianmd/prefer-create-el",
		file: "src/__test_stubs__/vitest.setup.ts",
		count: 3,
		reason: "false-positive-unreported",
		note: "Stub deliberately calls raw DOM APIs to build the helpers the rule wants used.",
		...over,
	};
}

function finding(over: Partial<Finding> = {}): Finding {
	return {
		rule: "obsidianmd/prefer-create-el",
		file: "src/__test_stubs__/vitest.setup.ts",
		line: 71,
		column: 14,
		severity: 1,
		message: "Use createEl",
		...over,
	};
}

describe("parseEslintReport", () => {
	it("normalizes absolute paths to repo-relative posix paths", () => {
		const res = parseEslintReport(report("src/plugin.ts", [{}]), ROOT);
		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		expect(res.findings[0].file).toBe("src/plugin.ts");
	});

	it("keeps warnings as well as errors (D4 — 'Caution' comes from warnings)", () => {
		const res = parseEslintReport(
			report("src/plugin.ts", [{ severity: 1 }, { severity: 2 }]),
			ROOT,
		);
		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		expect(res.findings.map((f) => f.severity).sort()).toEqual([1, 2]);
	});

	it("unwraps rule-custom-message into the core rule it wraps", () => {
		// The console class arrives under obsidianmd/rule-custom-message with the
		// wrapped rule in a leading bracket. Without unwrapping, a new no-new-func
		// finding would hide behind a no-console exception in the same file.
		const res = parseEslintReport(
			report("tools/screenshots/run.ts", [
				{
					ruleId: "obsidianmd/rule-custom-message",
					message: "[no-console] Avoid unnecessary logging to console. See https://…",
				},
			]),
			ROOT,
		);
		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		expect(res.findings[0].rule).toBe("obsidianmd/rule-custom-message[no-console]");
	});

	it("surfaces a parse fatal (null ruleId) instead of silently dropping it", () => {
		// A fatal means the config could not lint the file at all — reporting
		// "0 findings" there would be a false clean, the exact failure mode the
		// gate exists to prevent.
		const res = parseEslintReport(
			report("vitest.config.ts", [{ ruleId: null, message: "Parsing error" }]),
			ROOT,
		);
		expect(res.kind).toBe("fatal");
		if (res.kind !== "fatal") return;
		expect(res.errors[0]).toMatchObject({ file: "vitest.config.ts" });
	});

	it("yields no findings for a clean report", () => {
		const res = parseEslintReport([{ filePath: `${ROOT}/src/plugin.ts`, messages: [] }], ROOT);
		expect(res).toEqual({ kind: "ok", findings: [] });
	});
});

describe("validateExceptions (D3 — reason codes are mandatory)", () => {
	it("accepts a well-formed list", () => {
		const res = validateExceptions([entry()]);
		expect(res.kind).toBe("ok");
	});

	it("exposes exactly three reason codes", () => {
		expect([...REASON_CODES].sort()).toEqual([
			"deferred",
			"false-positive-reported",
			"false-positive-unreported",
		]);
	});

	it("rejects an unknown reason code", () => {
		const res = validateExceptions([entry({ reason: "because-i-said-so" as never })]);
		expect(res.kind).toBe("invalid");
		if (res.kind !== "invalid") return;
		expect(res.issues.join(" ")).toMatch(/reason/i);
	});

	it("rejects a missing or blank note — an unreasoned entry is how a real finding gets accepted", () => {
		expect(validateExceptions([entry({ note: "   " })]).kind).toBe("invalid");
		expect(validateExceptions([{ ...entry(), note: undefined } as never]).kind).toBe("invalid");
	});

	it("rejects a wildcard rule (T4 — no blanket absorption)", () => {
		const res = validateExceptions([entry({ rule: "obsidianmd/*" })]);
		expect(res.kind).toBe("invalid");
		if (res.kind !== "invalid") return;
		expect(res.issues.join(" ")).toMatch(/wildcard/i);
	});

	it("rejects a glob or directory file scope (T4)", () => {
		expect(validateExceptions([entry({ file: "tools/**/*.ts" })]).kind).toBe("invalid");
		expect(validateExceptions([entry({ file: "tools/" })]).kind).toBe("invalid");
	});

	it("rejects duplicate rule+file entries", () => {
		const res = validateExceptions([entry(), entry({ count: 1 })]);
		expect(res.kind).toBe("invalid");
		if (res.kind !== "invalid") return;
		expect(res.issues.join(" ")).toMatch(/duplicate/i);
	});

	it("rejects a non-positive or fractional count", () => {
		expect(validateExceptions([entry({ count: 0 })]).kind).toBe("invalid");
		expect(validateExceptions([entry({ count: 1.5 })]).kind).toBe("invalid");
	});

	it("rejects a non-array root", () => {
		expect(validateExceptions({ entries: [] }).kind).toBe("invalid");
	});
});

describe("evaluateParity", () => {
	it("passes when every finding is covered exactly", () => {
		const findings = [finding({ line: 71 }), finding({ line: 76 }), finding({ line: 78 })];
		const verdict = evaluateParity(findings, [entry({ count: 3 })]);
		expect(verdict).toEqual({ kind: "pass", covered: 3 });
	});

	it("passes on a clean tree with an empty exception list", () => {
		expect(evaluateParity([], [])).toEqual({ kind: "pass", covered: 0 });
	});

	it("fails and names a new finding in shipped source (T3)", () => {
		const verdict = evaluateParity(
			[finding({ rule: "obsidianmd/rule-custom-message[no-console]", file: "src/plugin.ts", line: 42 })],
			[],
		);
		expect(verdict.kind).toBe("fail");
		if (verdict.kind !== "fail") return;
		expect(verdict.newFindings).toHaveLength(1);
		expect(verdict.newFindings[0]).toMatchObject({ file: "src/plugin.ts", line: 42 });
	});

	it("fails on a new finding in tools/ — a src-scoped exception cannot absorb it (T4)", () => {
		const verdict = evaluateParity(
			[
				finding({
					rule: "obsidianmd/rule-custom-message[no-console]",
					file: "tools/screenshots/run.ts",
					line: 9,
				}),
			],
			[entry({ rule: "obsidianmd/rule-custom-message[no-console]", file: "src/plugin.ts", count: 5 })],
		);
		expect(verdict.kind).toBe("fail");
		if (verdict.kind !== "fail") return;
		expect(verdict.newFindings.map((f) => f.file)).toEqual(["tools/screenshots/run.ts"]);
	});

	it("counts only the overflow when a file exceeds its accepted count", () => {
		const findings = [
			finding({ line: 71 }),
			finding({ line: 76 }),
			finding({ line: 78 }),
			finding({ line: 91 }),
		];
		const verdict = evaluateParity(findings, [entry({ count: 3 })]);
		expect(verdict.kind).toBe("fail");
		if (verdict.kind !== "fail") return;
		expect(verdict.newFindings).toHaveLength(1);
		expect(verdict.stale).toHaveLength(0);
	});

	it("reports a fixed-but-still-listed exception as stale (T5)", () => {
		const verdict = evaluateParity([], [entry({ count: 3 })]);
		expect(verdict.kind).toBe("fail");
		if (verdict.kind !== "fail") return;
		expect(verdict.newFindings).toHaveLength(0);
		expect(verdict.stale).toEqual([
			{ entry: entry({ count: 3 }), actual: 0, reason: "unused" },
		]);
	});

	it("reports an over-broad exception whose count now exceeds reality (T5)", () => {
		const verdict = evaluateParity([finding()], [entry({ count: 3 })]);
		expect(verdict.kind).toBe("fail");
		if (verdict.kind !== "fail") return;
		expect(verdict.stale).toEqual([
			{ entry: entry({ count: 3 }), actual: 1, reason: "over-broad" },
		]);
	});
});

describe("formatVerdict", () => {
	it("renders a pass with the covered count", () => {
		const out = formatVerdict({ kind: "pass", covered: 5 }).join("\n");
		expect(out).toMatch(/5/);
		expect(out).toMatch(/pass|clean|no new/i);
	});

	it("renders each new finding with rule, file and line so the delta is actionable", () => {
		const out = formatVerdict({
			kind: "fail",
			newFindings: [
				finding({ rule: "obsidianmd/no-global-this", file: "src/utils/x.ts", line: 107 }),
			],
			stale: [],
		}).join("\n");
		expect(out).toContain("src/utils/x.ts");
		expect(out).toContain("107");
		expect(out).toContain("obsidianmd/no-global-this");
	});

	it("renders stale entries with an instruction to remove them", () => {
		const out = formatVerdict({
			kind: "fail",
			newFindings: [],
			stale: [{ entry: entry({ count: 3 }), actual: 0, reason: "unused" }],
		}).join("\n");
		expect(out).toMatch(/stale/i);
		expect(out).toContain("src/__test_stubs__/vitest.setup.ts");
	});
});
