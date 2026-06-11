import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PR-time tripwire: test fixtures may only use PUBLIC or NEUTRAL agent ids.
 *
 * This catches an Amazon-internal agent name introduced as a test fixture —
 * the vector that leaked an internal name before the PR #44 scrub — at PR time, in
 * CI, WITHOUT this repo ever enumerating internal names. It lists only the
 * ALLOWED ids; anything else fails. Runs via the normal `npm test` CI step.
 *
 * It complements the maintainer's private release-time denylist scan (a
 * broader catch-all over comments/docs/etc. run before each release). This
 * guard is intentionally narrow and public-safe: agent-id fixtures only.
 *
 * To add an id here: it MUST be a public product id or a neutral test
 * fixture. Never add an internal agent name — that defeats the guard.
 */

const ALLOWED_AGENT_IDS = new Set<string>([
	// Public products shipped as built-in agents (canonical ids from plugin.ts)
	"claude-code-acp",
	"codex-acp",
	"gemini-cli",
	"kiro-cli",
	// Public product short-names used in mock-settings fixtures
	"claude",
	"codex",
	"gemini",
	"kiro",
	"claude-code",
	// Neutral test fixtures
	"test-agent",
	"A1",
]);

// Neutral fixture id prefixes (test-only naming conventions).
const ALLOWED_PREFIXES = ["test-", "mock-", "custom-", "fixture-", "agent-"];

function isAllowedAgentId(id: string): boolean {
	if (ALLOWED_AGENT_IDS.has(id)) return true;
	return ALLOWED_PREFIXES.some((p) => id.startsWith(p));
}

// Agent-id string literals appear in these contexts across the test suite.
// Each pattern captures the id in group 1.
const PATTERNS: RegExp[] = [
	// Object-property keys: agentId / currentAgentId / requestedAgentId / etc.
	/\b(?:agentId|currentAgentId|requestedAgentId|newAgentId|defaultAgentId|initialAgentId)\s*:\s*"([^"]+)"/g,
	// Known call sites that take an agent id as the first string arg.
	/\b(?:useTabManager|createSession|restartSession|setAgentWithoutSession|makeConfig|getCurrentAgent)\(\s*"([^"]+)"/g,
	// Settings-mock built-in agent slots: claude/codex/gemini/kiro: { id: "..." }
	/\b(?:claude|codex|gemini|kiro)\s*:\s*\{[^}]*?\bid\s*:\s*"([^"]+)"/g,
];

function extractAgentIdLiterals(source: string): string[] {
	const found: string[] = [];
	for (const re of PATTERNS) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(source)) !== null) {
			found.push(m[1]);
		}
	}
	return found;
}

// This file contains agent-id-shaped sample strings in its own unit tests;
// exclude it from the filesystem scan so it doesn't flag itself.
const SELF = "no-internal-agent-ids.test.ts";
const SKIP_DIRS = new Set(["node_modules", ".git", ".trees", "dist", "build", "coverage"]);

function collectTestFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...collectTestFiles(full));
		} else if (/\.(test|spec)\.tsx?$/.test(entry) && entry !== SELF) {
			out.push(full);
		}
	}
	return out;
}

describe("isAllowedAgentId", () => {
	it("allows public built-ins and neutral fixtures", () => {
		for (const id of [
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"kiro-cli",
			"test-agent",
			"custom-thing",
			"mock-x",
		]) {
			expect(isAllowedAgentId(id)).toBe(true);
		}
	});

	it("rejects a non-allowlisted id (mechanism check, synthetic value)", () => {
		// Synthetic placeholder — deliberately NOT a real internal name.
		expect(isAllowedAgentId("some-disallowed-id")).toBe(false);
	});
});

describe("extractAgentIdLiterals", () => {
	it("pulls ids from key contexts", () => {
		expect(extractAgentIdLiterals('agentId: "claude-code"')).toContain(
			"claude-code",
		);
		expect(
			extractAgentIdLiterals('defaultAgentId: "test-agent",'),
		).toContain("test-agent");
	});

	it("pulls ids from known call sites", () => {
		expect(extractAgentIdLiterals('useTabManager("test-agent")')).toContain(
			"test-agent",
		);
	});
});

describe("PR-time tripwire: no internal agent ids in test fixtures", () => {
	it("every agent-id fixture across the test suite is allowlisted", () => {
		const offenders: string[] = [];
		const root = join(process.cwd(), "src");
		for (const file of collectTestFiles(root)) {
			const src = readFileSync(file, "utf8");
			for (const id of extractAgentIdLiterals(src)) {
				if (!isAllowedAgentId(id)) {
					offenders.push(`${file.replace(process.cwd() + "/", "")}: "${id}"`);
				}
			}
		}
		expect(
			offenders,
			"Non-allowlisted agent-id fixture(s) found. Use a neutral fixture " +
				"(e.g. 'test-agent') or a public product id; add to ALLOWED_* " +
				"ONLY if the id is public/neutral — never an internal name:\n" +
				offenders.join("\n"),
		).toEqual([]);
	});
});
