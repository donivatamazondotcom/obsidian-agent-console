/**
 * Pure pieces of `run.ts`: the device pixel ratio a run captures at, the
 * run-level problems of an isolated run, and the final report and exit code.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Window, DPR and focus.
 */
import type { CaptureResult } from "./orchestrator";

/**
 * DPR for every capture: `SCREENSHOT_DPR` if set, else 2 in isolated mode
 * (the spec's fixed value), else the page's real DPR (legacy path).
 */
export async function captureDpr(
	env: Record<string, string | undefined>,
	isolated: boolean,
	readPageDpr: () => Promise<number>,
): Promise<number> {
	if (env.SCREENSHOT_DPR) return parseInt(env.SCREENSHOT_DPR, 10);
	return isolated ? 2 : readPageDpr();
}

/** Run-level failures of an isolated run: harness problems and steals over the budget. */
export function isolatedRunProblems(run: { steals: number; problems: string[] }, budget: number): string[] {
	const out: string[] = [];
	if (run.problems.length) out.push(`isolated run problems:\n- ${run.problems.join("\n- ")}`);
	if (run.steals > budget) out.push(`${run.steals} focus steals, over the budget of ${budget}: the ▶ line before each extra "restored focus" names the entry that caused it`);
	return out;
}

export interface RunReport {
	/** Per-entry lines and the closing line, for stdout. */
	lines: string[];
	/** Problem lines, for stderr. */
	errors: string[];
	exitCode: 0 | 1;
}

/** The end-of-run report: fails on a failed entry, a run problem, or a run that captured nothing. */
export function reportRun(results: CaptureResult[], runProblems: string[]): RunReport {
	const lines: string[] = [];
	const errors: string[] = [];
	const failures = results.filter((r) => !r.success);
	const skipped = results.filter((r) => r.skipped);
	for (const r of results) {
		const icon = r.skipped ? "–" : r.success ? "✓" : "✗";
		const suffix = r.error ? ` — ${r.error}` : r.skipped ? ` — skipped: ${r.skipped}` : "";
		lines.push(`  ${icon} ${r.name}${suffix}`);
	}
	if (skipped.length) lines.push(`\n${skipped.length} entr${skipped.length === 1 ? "y" : "ies"} skipped (rerun with SCREENSHOT_LEGACY=1 to capture them the old way).`);
	for (const p of runProblems) errors.push(`\n❌ ${p}`);
	if (failures.length) errors.push(`\n❌ ${failures.length} screenshot(s) failed.`);
	if (results.length > 0 && skipped.length === results.length) {
		errors.push("\n❌ nothing was captured: every selected entry needs the real screen. Rerun with SCREENSHOT_LEGACY=1.");
	}
	const exitCode = errors.length ? 1 : 0;
	if (!exitCode) lines.push(`\n✅ Done. ${results.length - skipped.length} screenshot(s) written.`);
	return { lines, errors, exitCode };
}

/**
 * Why an isolated run would capture nothing (every selected entry is skipped),
 * or null. Checked before launch, so such a run never starts an instance.
 */
export function nothingToCaptureMessage<E extends { name: string }>(targets: E[], skip: (e: E) => string | undefined): string | null {
	if (!targets.length || targets.some((e) => !skip(e))) return null;
	return `nothing to capture in isolated mode: ${targets.map((e) => `${e.name} (${skip(e) ?? ""})`).join(", ")}. Rerun with SCREENSHOT_LEGACY=1.`;
}
