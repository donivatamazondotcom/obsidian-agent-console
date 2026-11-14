/**
 * `new Notification` ban guard (I52 round 9) — proves the SHIPPED ESLint
 * selector catches direct notification construction outside the registry.
 *
 * Why this exists: the round-9 root cause was a tag literal at two
 * `new Notification(...)` sites (the tab id, reused on every notification of a
 * tab). The registry (`services/notification-registry.ts`) now constructs every
 * notification and assigns a fresh tag; this guard keeps a new call site from
 * reintroducing the bug. A selector that matches nothing passes silently, so
 * this drives the shipped selector against positive and negative fixtures and
 * checks that every zone that re-lists `baseRestrictedSyntax` keeps it.
 * Same harness shape as `title-attribute-ban.test.ts`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Linter } from "eslint";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PARSER_MODULE = "@typescript-eslint/parser";
const ISSUE_MARKER = "I52";

interface RestrictedEntry {
	selector: string;
	message: string;
}

interface ConfigZone {
	files?: string[];
	rules?: Record<string, unknown>;
}

async function loadShippedConfig(): Promise<ConfigZone[]> {
	const href = pathToFileURL(resolve(process.cwd(), "eslint.config.mjs")).href;
	const mod = (await import(/* @vite-ignore */ href)) as {
		default: ConfigZone[];
	};
	return mod.default;
}

function zonesWithEntries(
	config: ConfigZone[],
): { files: string[]; entries: RestrictedEntry[] }[] {
	const out: { files: string[]; entries: RestrictedEntry[] }[] = [];
	for (const zone of config) {
		const rule = zone.rules?.["no-restricted-syntax"];
		if (!Array.isArray(rule)) continue;
		out.push({ files: zone.files ?? [], entries: rule.slice(1) as RestrictedEntry[] });
	}
	return out;
}

function banOf(entries: RestrictedEntry[]): RestrictedEntry[] {
	return entries.filter(
		(e) => e.message?.includes(ISSUE_MARKER) && e.message.includes("Notification"),
	);
}

let zones: { files: string[]; entries: RestrictedEntry[] }[] = [];
let config: ConfigZone[] = [];
let parser: Linter.Parser;

beforeAll(async () => {
	const mod = (await import(/* @vite-ignore */ PARSER_MODULE)) as {
		default?: unknown;
		parseForESLint?: unknown;
	};
	parser = (mod.parseForESLint ? mod : mod.default) as Linter.Parser;
	config = await loadShippedConfig();
	zones = zonesWithEntries(config);
});

const POSITIVE: Record<string, string> = {
	"bare constructor": `const n = new Notification("t", { body: "b" });`,
	"window.Notification": `const n = new window.Notification("t");`,
	"activeWindow.Notification": `const n = new activeWindow.Notification("t");`,
};

const NEGATIVE: Record<string, string> = {
	"Obsidian Notice": `new Notice("saved");`,
	"type reference": `let n: Notification | null = null;`,
	"static call": `void Notification.requestPermission();`,
	"property read": `const p = Notification.permission;`,
	"unrelated constructor": `const c = new NotificationCenter();`,
};

function violationsFor(selector: string, code: string): number {
	const linter = new Linter();
	const messages = linter.verify(
		code,
		{
			files: ["**/*.ts"],
			languageOptions: { ecmaVersion: 2022, sourceType: "module", parser },
			rules: { "no-restricted-syntax": ["error", { selector, message: "HIT" }] },
		} as Linter.Config,
		"fixture.ts",
	);
	const fatal = messages.find((m) => m.fatal);
	if (fatal) throw new Error(`fixture failed to parse: ${fatal.message}\n${code}`);
	return messages.filter((m) => m.message === "HIT").length;
}

describe("new Notification ban (I52 round 9)", () => {
	it("CONTROL: the lint harness reports violations at all", () => {
		expect(violationsFor("VariableDeclaration", `const a = 1;`)).toBe(1);
	});

	it("every zone that configures no-restricted-syntax carries exactly one ban", () => {
		expect(zones.length).toBeGreaterThan(0);
		for (const zone of zones) {
			expect(
				banOf(zone.entries).length,
				`zone ${JSON.stringify(zone.files)} lacks the I52 new-Notification ban — add it to baseRestrictedSyntax`,
			).toBe(1);
		}
	});

	it("the registry, which owns construction, passes the ban without an exemption", () => {
		const exempt = config.filter(
			(z) =>
				z.rules?.["no-restricted-syntax"] === "off" &&
				(z.files ?? []).some((f) => f.includes("notification-registry")),
		);
		expect(exempt).toHaveLength(0);
		const ban = banOf(zones[0]?.entries ?? [])[0];
		const source = readFileSync(
			resolve(process.cwd(), "src/services/notification-registry.ts"),
			"utf8",
		);
		expect(violationsFor(ban.selector, source)).toBe(0);
	});

	for (const [label, code] of Object.entries(POSITIVE)) {
		it(`fires on ${label}`, () => {
			const ban = banOf(zones[0]?.entries ?? [])[0];
			expect(ban).toBeDefined();
			expect(violationsFor(ban.selector, code)).toBe(1);
		});
	}

	for (const [label, code] of Object.entries(NEGATIVE)) {
		it(`does not fire on ${label}`, () => {
			const ban = banOf(zones[0]?.entries ?? [])[0];
			expect(ban).toBeDefined();
			expect(violationsFor(ban.selector, code)).toBe(0);
		});
	}
});
