/**
 * Bot-parity gate — pure core.
 *
 * Parses an eslint JSON report produced by `eslint.bot-parity.mjs`, validates
 * the accepted-findings list, and diffs one against the other to produce a
 * verdict. No I/O, no process access: the CLI shell
 * (`tools/quality-gates/run-bot-parity-gate.ts`) owns those, so every decision
 * here is unit-testable at the same seam the runtime uses.
 *
 * The gate is a ratchet, the same shape as `perf-baseline.json`: a finding
 * either matches an entry in the exception list — with a mandatory reason code
 * (D3) — or it is a delta and fails the build. Because I178–I181 fixed the
 * v2.2.0 `tools/**` findings rather than baselining them, the target is
 * genuinely zero new findings (D2).
 *
 * Spec: [[Agent Console Review-Bot Parity Gate]].
 */

/**
 * Closed set of justifications for accepting a finding. Deliberately small — an
 * unreasoned entry is how a real finding gets silently accepted (D3).
 *
 * - `false-positive-reported`   established rule defect, reported upstream
 * - `false-positive-unreported` assessed as a rule defect, report not yet filed
 * - `deferred`                  genuine finding, tracked as its own work item
 */
export const REASON_CODES = [
	"false-positive-reported",
	"false-positive-unreported",
	"deferred",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** One normalized parity finding. */
export interface Finding {
	/** eslint rule id, with `rule-custom-message` unwrapped to `…[no-console]`. */
	rule: string;
	/** Repo-relative posix path. */
	file: string;
	line: number;
	column: number;
	/** 1 = warning, 2 = error. Both count (D4). */
	severity: number;
	message: string;
}

/** One consciously accepted finding group, keyed by rule + exact file. */
export interface ExceptionEntry {
	rule: string;
	file: string;
	/** How many findings of this rule in this file are accepted. */
	count: number;
	reason: ReasonCode;
	/** Why. Must be non-empty. */
	note: string;
	/** Optional upstream report / tracking link. */
	link?: string;
}

export type ParseResult =
	| { kind: "ok"; findings: Finding[] }
	| { kind: "fatal"; errors: Array<{ file: string; message: string }> };

export type ExceptionsResult =
	| { kind: "ok"; entries: ExceptionEntry[] }
	| { kind: "invalid"; issues: string[] };

/** An entry that no longer matches reality, so the list cannot rot (T5). */
export interface StaleEntry {
	entry: ExceptionEntry;
	actual: number;
	/** `unused` = finding is gone entirely; `over-broad` = count too high. */
	reason: "unused" | "over-broad";
}

export type ParityVerdict =
	| { kind: "pass"; covered: number }
	| { kind: "fail"; newFindings: Finding[]; stale: StaleEntry[] };

/** Shape of the bits of eslint's JSON formatter output we consume. */
interface RawEslintFile {
	filePath?: unknown;
	messages?: unknown;
}

const WRAPPED_RULE = /^\[([^\]]+)\]/;

function toRelativePosix(absolute: string, rootDir: string): string {
	const root = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
	const rel = absolute.startsWith(root) ? absolute.slice(root.length) : absolute;
	return rel.split("\\").join("/");
}

/**
 * Normalize an eslint JSON report into findings.
 *
 * A message with a null `ruleId` is a parse fatal, not a finding — the config
 * could not lint that file at all. Reporting "0 findings" there would be a
 * false clean, which is the failure mode this whole gate exists to prevent, so
 * fatals short-circuit the verdict.
 */
export function parseEslintReport(report: unknown, rootDir: string): ParseResult {
	if (!Array.isArray(report)) {
		return { kind: "fatal", errors: [{ file: "(report)", message: "eslint report is not an array" }] };
	}

	const findings: Finding[] = [];
	const errors: Array<{ file: string; message: string }> = [];

	for (const raw of report as RawEslintFile[]) {
		const filePath = typeof raw?.filePath === "string" ? raw.filePath : "";
		const file = toRelativePosix(filePath, rootDir);
		const messages = Array.isArray(raw?.messages) ? raw.messages : [];

		for (const m of messages as Array<Record<string, unknown>>) {
			const ruleId = m.ruleId;
			const message = typeof m.message === "string" ? m.message : "";

			if (typeof ruleId !== "string" || ruleId.length === 0) {
				errors.push({ file, message });
				continue;
			}

			// The console class arrives under obsidianmd/rule-custom-message, which
			// wraps core rules and prefixes the wrapped rule name. Unwrap it so a
			// no-console exception cannot silently absorb a no-new-func finding in
			// the same file.
			let rule = ruleId;
			if (ruleId === "obsidianmd/rule-custom-message") {
				const wrapped = WRAPPED_RULE.exec(message);
				if (wrapped) rule = `${ruleId}[${wrapped[1]}]`;
			}

			findings.push({
				rule,
				file,
				line: typeof m.line === "number" ? m.line : 0,
				column: typeof m.column === "number" ? m.column : 0,
				severity: typeof m.severity === "number" ? m.severity : 1,
				message,
			});
		}
	}

	if (errors.length > 0) return { kind: "fatal", errors };
	return { kind: "ok", findings };
}

function hasWildcard(value: string): boolean {
	return value.includes("*") || value.includes("?");
}

/**
 * Validate the exception list.
 *
 * Rejects anything that could quietly widen into a blanket excuse: wildcards or
 * globs in the rule or file, directory-scoped files, duplicate rule+file keys,
 * an unknown reason code, a blank note, or a non-positive count. A wildcard
 * entry would absorb the next genuine finding, which is exactly the outcome the
 * gate exists to prevent (T4).
 */
export function validateExceptions(raw: unknown): ExceptionsResult {
	if (!Array.isArray(raw)) {
		return { kind: "invalid", issues: ["exception list must be a JSON array of entries"] };
	}

	const issues: string[] = [];
	const entries: ExceptionEntry[] = [];
	const seen = new Set<string>();

	raw.forEach((item: unknown, i: number) => {
		const at = `entry ${i}`;
		if (typeof item !== "object" || item === null) {
			issues.push(`${at}: must be an object`);
			return;
		}
		const e = item as Record<string, unknown>;
		const { rule, file, count, reason, note, link } = e;

		if (typeof rule !== "string" || rule.trim() === "") {
			issues.push(`${at}: "rule" must be a non-empty string`);
			return;
		}
		if (hasWildcard(rule)) {
			issues.push(`${at}: "rule" must name one rule exactly — wildcard "${rule}" would absorb unrelated findings`);
			return;
		}
		if (typeof file !== "string" || file.trim() === "") {
			issues.push(`${at}: "file" must be a non-empty string`);
			return;
		}
		if (hasWildcard(file)) {
			issues.push(`${at}: "file" must be one exact path — wildcard/glob "${file}" would absorb unrelated findings`);
			return;
		}
		if (file.endsWith("/")) {
			issues.push(`${at}: "file" must be a file, not the directory "${file}" — a directory scope absorbs new files`);
			return;
		}
		if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
			issues.push(`${at}: "count" must be a positive integer (got ${JSON.stringify(count)})`);
			return;
		}
		if (typeof reason !== "string" || !(REASON_CODES as readonly string[]).includes(reason)) {
			issues.push(
				`${at}: "reason" must be one of ${REASON_CODES.join(" | ")} (got ${JSON.stringify(reason)})`,
			);
			return;
		}
		if (typeof note !== "string" || note.trim() === "") {
			issues.push(`${at}: "note" is required and must explain why this finding is accepted`);
			return;
		}
		if (link !== undefined && typeof link !== "string") {
			issues.push(`${at}: "link" must be a string when present`);
			return;
		}

		const key = `${rule}\u0000${file}`;
		if (seen.has(key)) {
			issues.push(`${at}: duplicate entry for ${rule} in ${file} — merge them into one count`);
			return;
		}
		seen.add(key);

		entries.push({
			rule,
			file,
			count,
			reason: reason as ReasonCode,
			note,
			...(typeof link === "string" ? { link } : {}),
		});
	});

	if (issues.length > 0) return { kind: "invalid", issues };
	return { kind: "ok", entries };
}

function groupKey(rule: string, file: string): string {
	return `${rule}\u0000${file}`;
}

/**
 * Diff findings against accepted entries.
 *
 * Per rule+file group: the first `count` findings are covered, any beyond that
 * are deltas. A group with no entry is entirely delta. An entry matched by
 * fewer findings than its count is stale — either fixed outright (`unused`) or
 * now over-broad — so a fix must remove or lower its entry in the same change
 * (T5).
 */
export function evaluateParity(
	findings: readonly Finding[],
	entries: readonly ExceptionEntry[],
): ParityVerdict {
	const byGroup = new Map<string, Finding[]>();
	for (const f of findings) {
		const key = groupKey(f.rule, f.file);
		const list = byGroup.get(key);
		if (list) list.push(f);
		else byGroup.set(key, [f]);
	}

	const newFindings: Finding[] = [];
	const stale: StaleEntry[] = [];
	let covered = 0;

	const entryByGroup = new Map<string, ExceptionEntry>();
	for (const e of entries) entryByGroup.set(groupKey(e.rule, e.file), e);

	for (const [key, group] of byGroup) {
		const entry = entryByGroup.get(key);
		if (!entry) {
			newFindings.push(...group);
			continue;
		}
		covered += Math.min(entry.count, group.length);
		if (group.length > entry.count) {
			// Report the overflow deterministically: keep source order.
			newFindings.push(...group.slice(entry.count));
		}
	}

	for (const e of entries) {
		const actual = byGroup.get(groupKey(e.rule, e.file))?.length ?? 0;
		if (actual === 0) stale.push({ entry: e, actual, reason: "unused" });
		else if (actual < e.count) stale.push({ entry: e, actual, reason: "over-broad" });
	}

	if (newFindings.length === 0 && stale.length === 0) return { kind: "pass", covered };
	return { kind: "fail", newFindings, stale };
}

const SEVERITY_LABEL: Record<number, string> = { 1: "warn", 2: "error" };

/**
 * Render a verdict as output lines. Returned rather than printed so the CLI
 * shell stays trivial and the rendering is assertable in tests.
 */
export function formatVerdict(verdict: ParityVerdict): string[] {
	if (verdict.kind === "pass") {
		return [
			`bot-parity: PASS — no new findings (${verdict.covered} accepted finding(s) matched the exception list).`,
		];
	}

	const lines: string[] = [];

	if (verdict.newFindings.length > 0) {
		lines.push(`bot-parity: FAIL — ${verdict.newFindings.length} new finding(s) not in the exception list:`);
		for (const f of verdict.newFindings) {
			const sev = SEVERITY_LABEL[f.severity] ?? "warn";
			lines.push(`  ${sev.padEnd(5)} ${f.file}:${f.line}:${f.column}  [${f.rule}]`);
			lines.push(`        ${f.message}`);
		}
		lines.push("");
		lines.push("  Fix the finding, or add it to tools/quality-gates/bot-findings-exceptions.json");
		lines.push(`  with one of these reason codes: ${REASON_CODES.join(" | ")}`);
	}

	if (verdict.stale.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(`bot-parity: FAIL — ${verdict.stale.length} stale exception entr(y/ies):`);
		for (const s of verdict.stale) {
			const what =
				s.reason === "unused"
					? "no longer reported — remove this entry"
					: `only ${s.actual} finding(s) remain — lower "count" to ${s.actual}`;
			lines.push(`  ${s.entry.file}  [${s.entry.rule}]  count=${s.entry.count}: ${what}`);
		}
		lines.push("");
		lines.push("  A fix must remove or lower its entry in the same change, so the list cannot");
		lines.push("  rot into a permanent excuse.");
	}

	return lines;
}
