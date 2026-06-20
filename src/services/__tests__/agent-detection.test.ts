import { describe, it, expect, vi } from "vitest";
import {
	detectAvailableAgents,
	pickDefaultAgentId,
	chooseFirstRunDefault,
	DEFAULT_AGENT_PRIORITY,
	type AgentCandidate,
} from "../agent-detection";

const CANDIDATES: AgentCandidate[] = [
	{ id: "kiro-cli", command: "kiro-cli" },
	{ id: "claude-code-acp", command: "claude-agent-acp" },
	{ id: "codex-acp", command: "codex-acp" },
	{ id: "gemini-cli", command: "gemini" },
];

describe("T01: detectAvailableAgents maps installed commands to agent ids", () => {
	it("returns only agents whose command resolves", async () => {
		const resolve = vi.fn(async (command: string) =>
			command === "kiro-cli" || command === "gemini"
				? `/usr/local/bin/${command}`
				: null,
		);

		const available = await detectAvailableAgents(CANDIDATES, resolve);

		expect(available).toEqual(new Set(["kiro-cli", "gemini-cli"]));
		expect(resolve).toHaveBeenCalledTimes(4);
	});

	it("returns an empty set when no command resolves", async () => {
		const resolve = vi.fn(async () => null);
		const available = await detectAvailableAgents(CANDIDATES, resolve);
		expect(available.size).toBe(0);
	});

	it("skips blank commands without calling the resolver", async () => {
		const resolve = vi.fn(async () => "/usr/local/bin/x");
		const available = await detectAvailableAgents(
			[
				{ id: "kiro-cli", command: "kiro-cli" },
				{ id: "blank", command: "   " },
				{ id: "empty", command: "" },
			],
			resolve,
		);
		expect(available).toEqual(new Set(["kiro-cli"]));
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith("kiro-cli");
	});

	it("treats a resolver rejection as not-available (fail-soft)", async () => {
		const resolve = vi.fn(async (command: string) => {
			if (command === "kiro-cli") throw new Error("boom");
			if (command === "gemini") return "/usr/local/bin/gemini";
			return null;
		});
		const available = await detectAvailableAgents(CANDIDATES, resolve);
		expect(available).toEqual(new Set(["gemini-cli"]));
	});
});

describe("T02: pickDefaultAgentId honors priority order", () => {
	it("prefers kiro when present", () => {
		const picked = pickDefaultAgentId(
			new Set(["gemini-cli", "kiro-cli", "codex-acp"]),
		);
		expect(picked).toBe("kiro-cli");
	});

	it("falls through to the next available agent by priority", () => {
		const picked = pickDefaultAgentId(new Set(["gemini-cli", "codex-acp"]));
		expect(picked).toBe("codex-acp");
	});

	it("returns null when none of the available ids are in the priority list", () => {
		expect(pickDefaultAgentId(new Set())).toBeNull();
		expect(pickDefaultAgentId(new Set(["some-custom-agent"]))).toBeNull();
	});

	it("default priority is kiro → claude → codex → gemini", () => {
		expect(DEFAULT_AGENT_PRIORITY).toEqual([
			"kiro-cli",
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
		]);
	});
});

describe("Phase B: chooseFirstRunDefault (first-run default selection)", () => {
	it("picks the highest-priority detected agent on a fresh install", () => {
		const chosen = chooseFirstRunDefault(
			new Set(["gemini-cli", "kiro-cli"]),
			"claude-code-acp",
		);
		expect(chosen).toBe("kiro-cli");
	});

	it("keeps the current default (claude) when nothing resolves", () => {
		const chosen = chooseFirstRunDefault(new Set(), "claude-code-acp");
		expect(chosen).toBe("claude-code-acp");
	});

	it("falls through priority to the only installed agent", () => {
		const chosen = chooseFirstRunDefault(
			new Set(["gemini-cli"]),
			"claude-code-acp",
		);
		expect(chosen).toBe("gemini-cli");
	});
});
