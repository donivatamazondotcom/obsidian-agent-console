import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";

/**
 * Phase-3 i18n regression guard (React components + commands) — inverted
 * scan, extending the phase-2 guard per the I18N-I01 lesson: flag
 * EVERYTHING, allowlist the exceptions, so the next un-localized string
 * is a CI failure instead of a smoke finding.
 *
 * Three sweeps:
 *  1. Whole-DIRECTORY sentence-literal scan of src/ui/*.tsx (quoted
 *     strings + template literals via a real string tokenizer + JSX text
 *     nodes). Scanning the directory (not a file list) means a newly
 *     added React component is covered from day one.
 *     SessionHistoryModal.tsx moves into scope here (its React list body
 *     was phase-3 work; its debug section stays English via the
 *     allowlist, per spec Decision 7 posture).
 *  2. Command names: every `addCommand({ name: <literal> })` across src/
 *     must route through t() — command names ARE user-facing copy.
 *  3. Menu items: `.setTitle(<literal>)` across src/ must route through
 *     t() (context menus, more-menus).
 *
 * Conventions encoded as patterns (not allowlist entries):
 *  - Strings that are the first argument of a logger call
 *    (log/error/warn/info/debug/debugLog/logError) or of `new Error(`
 *    stay English — spec Decision 7 (log/debug strings out of scope);
 *    thrown error messages are for the console and issue reports.
 *  - Log strings prefixed `[Tag] …` stay English (same posture).
 *  - Machine tokens (ids, classes, events, paths, key names) are not copy.
 *  - Brand/agent proper names stay untranslated by design.
 *
 * R1 evidence: red against the pre-extraction tree (see the phase-3 note
 * in the vault spec), green after extraction.
 */

const SRC_ROOT = resolve(__dirname, "../..");
const UI_DIR = join(SRC_ROOT, "ui");

/** Extra non-React files that carry extracted phase-3 UI strings. */
const EXTRA_FILES = ["services/quick-prompts-logic.ts"];

/**
 * Global allowlist — strings that legitimately stay literal anywhere.
 * Add entries with a reason; never widen the patterns instead.
 */
const GLOBAL_ALLOW = new Set<string>([
	// DOM KeyboardEvent.key values / Obsidian Keymap modifier tokens —
	// API contract, not UI copy.
	"Enter",
	"Escape",
	"Backspace",
	"ArrowDown",
	"ArrowUp",
	"ArrowLeft",
	"ArrowRight",
	"Tab",
	"Home",
	"End",
	"Delete",
	// DataTransfer.types value — DOM API contract.
	"Files",
	"Mod",
	"Alt",
	"Shift",
	// Intl.DateTimeFormat option values — API contract.
	"numeric",
	"2-digit",
	// Brand + agent proper names — untranslated by design.
	"Agent Console",
	"Agent console",
	"Claude Code",
	"Codex",
	"Gemini CLI",
	"Kiro CLI",
	"OpenCode",
]);

/**
 * Per-file allowlist — literal strings that stay English in a specific
 * file, each with a reason. Keys are paths relative to src/.
 */
const PER_FILE_ALLOW: Record<string, string[]> = {
	// Debug section stays English (spec: phase-2 Current State note;
	// Decision 7 posture — debug surfaces are not user copy).
	"ui/SessionHistoryModal.tsx": [
		"Debug: Manual Session Input",
		"Session ID:",
		"Enter session ID…",
		"Working Directory (cwd):",
		"Enter working directory…",
		"Restore",
	],
	// A2UI catalog component-type names — protocol tokens matched
	// against the fence JSON, not copy.
	"ui/A2uiSurfaceHost.tsx": ["Card", "Row", "Text", "Button", "Divider", "Column"],
	// New-prompt template note body — deferred to phase 4 (its
	// `always show` / `show when` / `open in new tab` directives are
	// parse-relevant literals matched by the frontmatter parser;
	// translating the scaffold is a separate decision recorded in the
	// spec). `{{selection}}` is the selection token itself.
	"services/quick-prompts-logic.ts": [
		"show when",
		"always show",
		"open in new tab",
		"{{selection}}",
		"Write your prompt here.",
		"Notes & help — everything below this line is ignored; only the text above the --- is sent. Keep it, edit it, or jot draft variations here.",
		"Set the label above, then choose where this prompt's chip appears:",
		"- open in new tab: runs in a new chat tab instead of this one.",
		"- always show: the chip shows on every note.",
		"- show when: the chip shows only on matching notes. Add one list item per condition, like type=meeting, tags=people, or status=open.",
		"- order: a number that sorts this prompt in the chip row and ! list — lower comes first (order: 0 pins it leftmost). Leave it blank to sort after pinned prompts, alphabetically.",
		"Set none of these and the prompt stays out of the chip row — type ! in the composer to run it.",
		"To pull in text you've selected in a note, write {{selection}} in your prompt above.",
		"Guide: https://donivatamazondotcom.github.io/obsidian-agent-console/usage/quick-prompts",
	],
};

function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
}

/** Letter-bearing but clearly non-UI: ids, classes, tags, events, slugs. */
function isMachineToken(s: string): boolean {
	return (
		/^[a-z0-9-]*$/.test(s) || // ids / classes / tags / events / kebab enums
		/^[a-z][a-zA-Z0-9]*$/.test(s) || // camelCase identifiers / prop names
		/^[A-Z_0-9]+$/.test(s) || // env-var style
		/^[a-z0-9_]+$/.test(s) || // snake_case enums (tool_call, sign_in)
		/^_[a-z]+$/.test(s) || // _blank
		/^[a-z0-9-]+:[a-z0-9-]+$/.test(s) || // namespaced events (agent-console:x)
		/^\.{0,2}\/[a-zA-Z0-9_./-]+$/.test(s) || // module import paths
		/^[a-zA-Z0-9-]+\.(ts|tsx|md|json|css|svg|png)$/.test(s) || // file names
		/^[.#]?[a-z][a-z0-9-]*(?:[ .][a-z][a-z0-9-]*)*$/.test(s) || // css class lists / selectors
		/^https?:\/\/\S+$/.test(s) || // URLs
		/^[a-z@][a-z0-9-]*(?:\/[a-z0-9-]+)+$/.test(s) || // bare module specifiers (react-dom/client)
		/^data:\s*;base64,\s*$/.test(s) || // data-URI skeleton (interpolations blanked)
		/^noopener(\s+noreferrer)?$/.test(s) || // rel values
		/^\{[a-zA-Z]+\}$/.test(s) // bare interpolation placeholder
	);
}

function isUserFacingLiteral(s: string, fileAllow: Set<string>): boolean {
	const trimmed = s.trim();
	if (!/[A-Za-z]{2}/.test(trimmed)) return false; // no words at all
	if (GLOBAL_ALLOW.has(trimmed) || fileAllow.has(trimmed)) return false;
	if (/^(settings|notices|modals|commands|chat)\./.test(trimmed)) {
		return false; // t() keys
	}
	// Log/debug convention: `[Tag] message` — stays English (Decision 7).
	if (/^\[[A-Za-z][^\]]*\]/.test(trimmed)) return false;
	return !isMachineToken(trimmed);
}

/**
 * Calls whose first string argument is not UI copy: loggers (Decision 7)
 * and thrown errors (console / issue-report text).
 */
const NON_UI_CALL_CONTEXT =
	/(?:\.(?:log|error|warn|info|debug)|debugLog|logError|new Error)\s*\(\s*$/;

interface FoundString {
	text: string;
	/** Source immediately before the opening quote (for call context). */
	before: string;
}

/**
 * Real string tokenizer: walks the source handling ' " ` quotes and
 * escapes, so a backtick inside a quoted string can never pair with a
 * later backtick (the failure mode of regex scanning). Template-literal
 * interpolations are blanked — `${x}` is not copy. Interpolation bodies
 * are re-scanned for nested strings.
 */
function tokenizeStrings(src: string): FoundString[] {
	const out: FoundString[] = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			const start = i;
			i++;
			let text = "";
			while (i < src.length) {
				const c = src[i];
				if (c === "\\") {
					text += src[i + 1] ?? "";
					i += 2;
					continue;
				}
				if (c === quote) {
					i++;
					break;
				}
				if (quote === "`" && c === "$" && src[i + 1] === "{") {
					// blank the interpolation; recurse into its body
					let depth = 1;
					let j = i + 2;
					while (j < src.length && depth > 0) {
						if (src[j] === "{") depth++;
						else if (src[j] === "}") depth--;
						j++;
					}
					out.push(...tokenizeStrings(src.slice(i + 2, j - 1)));
					text += " ";
					i = j;
					continue;
				}
				text += c;
				i++;
			}
			out.push({
				text,
				before: src.slice(Math.max(0, start - 40), start),
			});
			continue;
		}
		i++;
	}
	return out;
}

/**
 * JSX text nodes: bare text between tags. TS generic artifacts (e.g.
 * `Promise<void> | null` fragments) are excluded via the identifier-soup
 * pattern — a text node that is only identifiers/pipes/commas is type
 * syntax, not copy.
 */
function jsxTextNodes(src: string): string[] {
	const out: string[] = [];
	for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) {
		const text = m[1].trim();
		if (!text) continue;
		if (/^[\w$]+(\s*[|&,]\s*[\w$]+)*$/.test(text)) {
			// Identifier soup — type syntax if every word is a known TS
			// type-ish name or lowercase; a capitalized word ("Retry")
			// in text position is UI copy.
			const TYPE_NAME =
				/^(Promise|ReturnType|Record|Map|Set|Partial|Readonly|Array|React|JSX|HTMLElement|Element|Error|Date|RegExp)$/;
			const words = text.split(/\s*[|&,]\s*/);
			if (words.every((w) => TYPE_NAME.test(w) || /^[a-z$_]/.test(w))) {
				continue;
			}
		}
		// Code fragments the regex grabs when `>` closes a generic or
		// arrow function rather than a JSX tag: they carry statement /
		// expression syntax that never appears in a prose text node.
		if (/[;=()`]|=>|\breturn\b|\bconst\b|\bcase\b/.test(text)) continue;
		out.push(text);
	}
	return out;
}

function uiFiles(): string[] {
	return readdirSync(UI_DIR)
		.filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
		.map((f) => join(UI_DIR, f));
}

function offendersIn(file: string): string[] {
	const rel = relative(SRC_ROOT, file);
	const fileAllow = new Set(PER_FILE_ALLOW[rel] ?? []);
	const src = stripComments(readFileSync(file, "utf-8"));
	const fromStrings = tokenizeStrings(src)
		.filter((f) => !NON_UI_CALL_CONTEXT.test(f.before))
		.map((f) => f.text);
	const candidates = [...fromStrings, ...jsxTextNodes(src)];
	return candidates
		.filter((s) => isUserFacingLiteral(s, fileAllow))
		.map((s) => `${rel}: ${JSON.stringify(s.slice(0, 80))}`);
}

describe("i18n phase 3 — React UI files have no un-localized literals", () => {
	it.each(uiFiles().map((f) => [relative(SRC_ROOT, f), f]))(
		"%s",
		(_rel, file) => {
			const offenders = offendersIn(file);
			expect(offenders, offenders.join("\n")).toEqual([]);
		},
	);

	it.each(EXTRA_FILES)("%s", (rel) => {
		const offenders = offendersIn(join(SRC_ROOT, rel));
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("i18n phase 3 — command names route through t()", () => {
	it("no `addCommand({ name: <literal> })` across src/", () => {
		const offenders: string[] = [];
		for (const file of allSourceFiles(SRC_ROOT)) {
			const src = stripComments(readFileSync(file, "utf-8"));
			for (const m of src.matchAll(
				/addCommand\(\s*\{[\s\S]{0,200}?name:\s*("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g,
			)) {
				const text = m[1].slice(1, -1);
				if (/[A-Za-z]{2}/.test(text)) {
					offenders.push(
						`${relative(SRC_ROOT, file)}: addCommand name ${JSON.stringify(text)}`,
					);
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("no `.setTitle(<literal>)` menu items across src/", () => {
		const offenders: string[] = [];
		for (const file of allSourceFiles(SRC_ROOT)) {
			const src = stripComments(readFileSync(file, "utf-8"));
			for (const m of src.matchAll(
				/\.setTitle\(\s*("(?:[^"\\\n]|\\.)*")/g,
			)) {
				const text = m[1].slice(1, -1);
				if (/[A-Za-z]{2}/.test(text)) {
					offenders.push(
						`${relative(SRC_ROOT, file)}: setTitle(${JSON.stringify(text)})`,
					);
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

/** All .ts/.tsx files under src/, excluding i18n/, tests, and stubs. */
function allSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		const rel = relative(SRC_ROOT, full);
		if (
			rel.startsWith("i18n") ||
			rel.includes("__tests__") ||
			rel.includes("__test_stubs__") ||
			rel.includes("__mocks__")
		) {
			continue;
		}
		if (entry.isDirectory()) {
			out.push(...allSourceFiles(full));
		} else if (
			/\.tsx?$/.test(entry.name) &&
			!/\.test\.tsx?$/.test(entry.name)
		) {
			out.push(full);
		}
	}
	return out;
}
