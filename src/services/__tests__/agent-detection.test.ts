import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	detectAvailableAgents,
	pickDefaultAgentId,
	type AgentProbe,
} from "../agent-detection";

vi.mock("../../utils/paths", () => ({
	resolveCommandPath: vi.fn(),
	resolveCommandPathInWsl: vi.fn(),
}));

import { resolveCommandPath } from "../../utils/paths";
const mockResolve = vi.mocked(resolveCommandPath);

// Detection-priority order (Amazon-internal first), per the spec.
const PROBES: AgentProbe[] = [
	{ id: "kiro", command: "kiro-cli" },
	{ id: "claude-code-acp", command: "claude-agent-acp" },
	{ id: "codex-acp", command: "codex-acp" },
	{ id: "gemini-cli", command: "gemini" },
];

describe("detectAvailableAgents", () => {
	beforeEach(() => mockResolve.mockReset());

	it("returns only the agents whose command resolves on PATH", async () => {
		mockResolve.mockImplementation(async (cmd: string) =>
			cmd === "kiro-cli" || cmd === "gemini"
				? `/usr/local/bin/${cmd}`
				: null,
		);
		const available = await detectAvailableAgents(PROBES);
		expect(available).toEqual(new Set(["kiro", "gemini-cli"]));
	});

	it("returns an empty set when nothing resolves", async () => {
		mockResolve.mockResolvedValue(null);
		expect(await detectAvailableAgents(PROBES)).toEqual(new Set());
	});

	it("skips probes with an empty command without calling the resolver", async () => {
		mockResolve.mockResolvedValue(null);
		await detectAvailableAgents([{ id: "blank", command: "  " }]);
		expect(mockResolve).not.toHaveBeenCalled();
	});
});

describe("pickDefaultAgentId", () => {
	it("prefers kiro when present (Amazon-first priority)", () => {
		const available = new Set(["kiro", "claude-code-acp", "gemini-cli"]);
		expect(pickDefaultAgentId(PROBES, available)).toBe("kiro");
	});

	it("falls through to the next available agent in priority order", () => {
		// kiro absent -> claude wins over codex/gemini
		const available = new Set(["codex-acp", "claude-code-acp", "gemini-cli"]);
		expect(pickDefaultAgentId(PROBES, available)).toBe("claude-code-acp");
	});

	it("returns null when none resolved", () => {
		expect(pickDefaultAgentId(PROBES, new Set())).toBeNull();
	});
});
