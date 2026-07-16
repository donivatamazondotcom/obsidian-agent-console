/**
 * The feasibility-probe corpus as regression fixtures: every fence the three
 * gate-clearing agents emitted (Kiro CLI, Claude Code, Codex — 2026-07-15
 * probe run, 100% profile-valid) must pass this validator. If a validator
 * change rejects any of these, the trust boundary drifted stricter than the
 * briefing teaches.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateA2uiFence } from "../validator";

const FIXTURES = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
	"probe-corpus",
);

const AGENTS = ["kiro-cli", "claude-code", "codex"] as const;

function loadAgentFixtures(agent: string): { name: string; body: string }[] {
	const dir = join(FIXTURES, agent);
	return readdirSync(dir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort()
		.map((f) => ({
			name: f,
			body: readFileSync(join(dir, f), "utf8").trimEnd(),
		}));
}

describe("probe corpus — every agent-emitted fence validates", () => {
	for (const agent of AGENTS) {
		describe(agent, () => {
			const fixtures = loadAgentFixtures(agent);

			it("has the expected fixture count", () => {
				const expected = { "kiro-cli": 10, "claude-code": 9, codex: 8 }[
					agent
				];
				expect(fixtures.length).toBe(expected);
			});

			for (const { name, body } of loadAgentFixtures(agent)) {
				it(`${name} is profile-valid with at least one button`, () => {
					const result = validateA2uiFence(body);
					expect(result.kind).toBe("valid");
					if (result.kind !== "valid") return;
					const buttons = [...result.surface.components.values()].filter(
						(c) => c.kind === "button",
					);
					expect(buttons.length).toBeGreaterThanOrEqual(1);
					// Every probe fence was emitted under the strict briefing:
					// no tolerated-shape fallbacks should be needed.
					expect(result.surface.tolerated).toEqual({
						version: false,
						catalog: false,
					});
				});
			}

			it("uses session-unique surfaceIds across the battery", () => {
				const seen = new Set<string>();
				for (const { body } of loadAgentFixtures(agent)) {
					const result = validateA2uiFence(body, {
						existingSurfaceIds: seen,
					});
					expect(result.kind).toBe("valid");
					if (result.kind === "valid") {
						seen.add(result.surface.surfaceId);
					}
				}
			});
		});
	}

	it("asserts known button counts from the battery design", () => {
		// P1 fork = 2 buttons, P2 three scopes = 3, P3 confirm = 2, P5 four
		// stacked options = 4 (battery table in the probe note).
		const expectations: [string, string, number][] = [
			["kiro-cli", "p01.jsonl", 2],
			["kiro-cli", "p02.jsonl", 3],
			["kiro-cli", "p03.jsonl", 2],
			["kiro-cli", "p05.jsonl", 4],
			["claude-code", "p01.jsonl", 2],
			["claude-code", "p02.jsonl", 3],
			["claude-code", "p05.jsonl", 4],
			["codex", "p01.jsonl", 2],
			["codex", "p02.jsonl", 3],
			["codex", "p05.jsonl", 4],
		];
		for (const [agent, file, count] of expectations) {
			const body = readFileSync(join(FIXTURES, agent, file), "utf8").trimEnd();
			const result = validateA2uiFence(body);
			expect(result.kind).toBe("valid");
			if (result.kind !== "valid") continue;
			const buttons = [...result.surface.components.values()].filter(
				(c) => c.kind === "button",
			);
			expect(buttons.length, `${agent}/${file}`).toBe(count);
		}
	});
});
