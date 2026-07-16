import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * I18N-I01 regression guard, v2 (whole-file scan).
 *
 * v1 checked three known-miss patterns (addOption labels, collapsible
 * titles, blockToggle args) and let a second round of misses through
 * (install hint, per-agent working-directory describe, picker titles,
 * default custom-agent name). v2 inverts the approach: strip comments,
 * then flag EVERY sentence-like string literal in SettingsTab that is not
 * on the explicit allowlist. New user-facing strings must go through
 * t(); genuinely non-UI strings get an allowlist entry with a reason.
 *
 * R1 evidence: v1 red at 9446d83 (3/3); v2 red at 1e09ede (round-3
 * misses present), green after.
 */

const path = resolve(__dirname, "../../ui/SettingsTab.ts");

/** Strings that legitimately stay literal. Key: exact string. */
const ALLOWLIST = new Set<string>([
	// Agent display-name fallbacks — product proper nouns, not translated.
	"Claude Code",
	"Codex",
	"Gemini CLI",
	"Kiro CLI",
	"OpenCode",
]);

function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/([^:"'])\/\/[^"'\n]*$/gm, "$1");
}

/**
 * Sentence-like: contains a space between letter-bearing words, or ends
 * with sentence punctuation. Identifiers, ids, CSS classes, key names,
 * and single words don't match.
 */
function isSentenceLike(s: string): boolean {
	if (ALLOWLIST.has(s)) return false;
	if (s.startsWith("settings.") || s.startsWith("notices.")) return false;
	if (/^[a-z0-9-]+$/.test(s)) return false; // ids / classes / slugs
	if (/^[A-Z_0-9]+$/.test(s)) return false; // env-var style
	return /[A-Za-z]{2,}\s+[A-Za-z]/.test(s) || /[A-Za-z]{3,}[.!?…:]$/.test(s);
}

describe("I18N-I01 — SettingsTab has no un-localized sentence literals", () => {
	it("every sentence-like string routes through t() or the allowlist", () => {
		const src = stripComments(readFileSync(path, "utf-8"));
		const offenders: string[] = [];
		// Double- and single-quoted literals (template literals are covered
		// by their embedded quoted parts; pure-interpolation templates hold
		// no translatable text once t() owns the sentence).
		for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
			const s = (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1");
			if (isSentenceLike(s)) {
				offenders.push(s.slice(0, 80));
			}
		}
		expect(offenders).toEqual([]);
	});
});
