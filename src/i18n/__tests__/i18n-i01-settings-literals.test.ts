import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * I18N-I01 regression guard: user-facing strings in SettingsTab must route
 * through t(), including the plain-argument patterns the original
 * extraction missed (dropdown option labels, collapsible section titles,
 * blockToggle name/desc args).
 *
 * Source-scan test: reads the TS source and flags literal string arguments
 * in the known user-facing argument positions. R1 evidence: fails against
 * commit 9446d83 (pre-fix), which carried 14 such literals.
 */

const source = readFileSync(
	resolve(__dirname, "../../ui/SettingsTab.ts"),
	"utf-8",
);

/** Match a literal string (either quote style) with at least one letter. */
const LITERAL = `["'][^"'\\n]*[A-Za-z][^"'\\n]*["']`;

describe("I18N-I01 — no literal UI strings bypass t() in SettingsTab", () => {
	it("addOption labels are t() calls, not literals", () => {
		// .addOption("value", "Literal Label") — the label (2nd arg) must
		// not be a letter-bearing literal. Multiline calls put the label on
		// its own line after the value arg.
		const singleLine = source.match(
			new RegExp(`\\.addOption\\(\\s*${LITERAL},\\s*${LITERAL}\\s*\\)`, "g"),
		);
		const multiLine = source.match(
			new RegExp(
				`\\.addOption\\(\\n\\s*${LITERAL},\\n\\s*${LITERAL},?\\n`,
				"g",
			),
		);
		expect([...(singleLine ?? []), ...(multiLine ?? [])]).toEqual([]);
	});

	it("collapsible section titles are t() calls, not literals", () => {
		const inline = source.match(
			new RegExp(`renderCollapsibleSection\\(\\s*\\w+,\\s*${LITERAL}`, "g"),
		);
		const multiline = source.match(
			new RegExp(`renderCollapsibleSection\\(\\n\\s*\\w+,\\n\\s*${LITERAL}`, "g"),
		);
		expect([...(inline ?? []), ...(multiline ?? [])]).toEqual([]);
	});

	it("blockToggle name/desc args are t() calls, not literals", () => {
		const hits = source.match(
			new RegExp(`blockToggle\\(\\n\\s*${LITERAL},`, "g"),
		);
		expect(hits ?? []).toEqual([]);
	});
});
