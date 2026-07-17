import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

/**
 * Phase-2 i18n regression guard (notices + modals) — inverted scan.
 *
 * Shape per the I18N-I01 lesson: don't enumerate miss patterns (that
 * provably under-covers); flag EVERYTHING and allowlist the exceptions,
 * so the next un-localized string is a CI failure, not a smoke finding.
 *
 * Two sweeps:
 *  1. Notice-literal scan across ALL of src/ (excluding src/i18n/ and
 *     tests): any `new Notice(` whose first argument is a letter-bearing
 *     string/template literal must route through t() instead.
 *  2. Whole-file sentence-literal scan of every extracted modal file
 *     (same shape as the I18N-I01 SettingsTab guard).
 *
 * SessionHistoryModal.tsx is deliberately NOT in sweep 2: its Modal-class
 * chrome is extracted, but the React list body is phase-3 scope. Sweep 1
 * still covers its Notice calls. Move it into MODAL_FILES in phase 3.
 *
 * R1 evidence: red against the pre-extraction tree (see I18N note in the
 * vault spec), green after extraction.
 */

const SRC_ROOT = resolve(__dirname, "../..");

/** Modal files that are fully extracted — whole-file scanned. */
const MODAL_FILES = [
	"ui/RenamePromptModal.ts",
	"ui/AgentPickerModal.ts",
	"ui/ConfirmCloseModal.ts",
	"ui/ChooseQuickPromptFolderModal.ts",
	"ui/ImportSettingsModal.ts",
	"ui/McpAuthModal.ts",
	"ui/ChangeDirectoryModal.ts",
	"ui/CorruptionRecoveryModal.ts",
	"ui/ConfirmResetModal.ts",
	"ui/ConfirmSessionIntentModal.ts",
];

/**
 * Strings that legitimately stay literal in modal files.
 * Add entries with a reason; never widen the patterns instead.
 */
const ALLOWLIST = new Set<string>([
	// DOM KeyboardEvent.key values — API contract, not UI copy.
	"Enter",
	"Escape",
	// Intl.DateTimeFormat option values — API contract.
	"numeric",
	"2-digit",
]);

function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/([^:"'])\/\/[^"'\n]*$/gm, "$1");
}

/** Letter-bearing but clearly non-UI: ids, classes, tags, events, slugs. */
function isMachineToken(s: string): boolean {
	return (
		/^[a-z0-9-]*$/.test(s) || // ids / classes / tags / events / kebab enums
		/^[a-z][a-zA-Z0-9]*$/.test(s) || // camelCase identifiers / prop names
		/^[A-Z_0-9]+$/.test(s) || // env-var style
		/^\.{0,2}\/[a-zA-Z0-9_./-]+$/.test(s) || // module import paths
		/^[a-zA-Z0-9-]+\.(ts|tsx|md|json|css)$/.test(s) // file names
	);
}

function isUserFacingLiteral(s: string): boolean {
	if (!/[A-Za-z]{2}/.test(s)) return false; // no words at all
	if (ALLOWLIST.has(s)) return false;
	if (/^(settings|notices|modals)\./.test(s)) return false; // t() keys
	return !isMachineToken(s);
}

function quotedStrings(src: string): string[] {
	const out: string[] = [];
	for (const m of src.matchAll(
		/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g,
	)) {
		out.push((m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1"));
	}
	return out;
}

/** All .ts/.tsx files under src/, excluding i18n/, tests, and stubs. */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const rel = relative(SRC_ROOT, full);
		if (
			rel.startsWith("i18n") ||
			rel.includes("__tests__") ||
			rel.includes("__test_stubs__") ||
			rel.includes("__mocks__")
		) {
			continue;
		}
		if (statSync(full).isDirectory()) {
			out.push(...sourceFiles(full));
		} else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe("i18n phase 2 — notice literals route through t()", () => {
	it("no `new Notice(<literal>)` with English text outside src/i18n/", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC_ROOT)) {
			const src = stripComments(readFileSync(file, "utf-8"));
			for (const m of src.matchAll(/new Notice\(/g)) {
				const after = src.slice(
					(m.index ?? 0) + m[0].length,
					(m.index ?? 0) + m[0].length + 300,
				);
				const arg = after.replace(/^[\s\n]*/, "");
				// First arg is a quoted string or template literal?
				const lit = arg.match(/^"((?:[^"\\\n]|\\.)*)"|^'((?:[^'\\\n]|\\.)*)'|^`((?:[^`\\]|\\.)*?)`/);
				if (!lit) continue;
				const text = (lit[1] ?? lit[2] ?? lit[3] ?? "")
					.replace(/\$\{[^}]*\}/g, "") // interpolations aren't copy
					.replace(/\\(.)/g, "$1");
				if (/[A-Za-z]{2}/.test(text)) {
					offenders.push(
						`${relative(SRC_ROOT, file)}: new Notice(${JSON.stringify(text.slice(0, 60))}…)`,
					);
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("i18n phase 2 — extracted modal files have no un-localized literals", () => {
	it.each(MODAL_FILES)("%s", (rel) => {
		const src = stripComments(
			readFileSync(join(SRC_ROOT, rel), "utf-8"),
		);
		const offenders = quotedStrings(src).filter(isUserFacingLiteral);
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});
