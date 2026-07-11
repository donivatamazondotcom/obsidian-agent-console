import { describe, it, expect, vi } from "vitest";
import {
	detectAvailableAgents,
	pickDefaultAgentId,
	chooseFirstRunDefault,
	shouldShowGettingStarted,
	createDetectionCache,
	resolveFirstRunDefaultAgent,
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

	it("default priority is kiro → claude → codex → gemini → opencode", () => {
		expect(DEFAULT_AGENT_PRIORITY).toEqual([
			"kiro-cli",
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"opencode-acp",
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

describe("I-FRO2: shouldShowGettingStarted", () => {
	const builtInIds = new Set([
		"claude-code-acp",
		"codex-acp",
		"gemini-cli",
		"kiro-cli",
	]);

	it("does NOT show for a custom-agent default (the I-FRO2 bug)", () => {
		// Custom agents are never in the built-in detected set; they must not
		// be treated as a dead end (regression: custom-agent default / new tabs).
		expect(
			shouldShowGettingStarted({
				messageCount: 0,
				currentAgentId: "test-custom-agent",
				builtInIds,
				detectedIds: new Set(["claude-code-acp", "kiro-cli"]),
			}),
		).toBe(false);
	});

	it("does NOT show for a built-in that is detected", () => {
		expect(
			shouldShowGettingStarted({
				messageCount: 0,
				currentAgentId: "kiro-cli",
				builtInIds,
				detectedIds: new Set(["kiro-cli"]),
			}),
		).toBe(false);
	});

	it("shows for a built-in default that is NOT detected (fresh install, nothing installed)", () => {
		expect(
			shouldShowGettingStarted({
				messageCount: 0,
				currentAgentId: "claude-code-acp",
				builtInIds,
				detectedIds: new Set(),
			}),
		).toBe(true);
	});

	it("does NOT show once the chat has messages", () => {
		expect(
			shouldShowGettingStarted({
				messageCount: 3,
				currentAgentId: "claude-code-acp",
				builtInIds,
				detectedIds: new Set(),
			}),
		).toBe(false);
	});

	it("does NOT show while detection is still pending (null)", () => {
		expect(
			shouldShowGettingStarted({
				messageCount: 0,
				currentAgentId: "claude-code-acp",
				builtInIds,
				detectedIds: null,
			}),
		).toBe(false);
	});
});

describe("Flow #1: chooseFirstRunDefault when every agent is installed", () => {
	it("picks the highest-priority (kiro) when all four are detected", () => {
		const chosen = chooseFirstRunDefault(
			new Set([
				"kiro-cli",
				"claude-code-acp",
				"codex-acp",
				"gemini-cli",
			]),
			"claude-code-acp",
		);
		expect(chosen).toBe("kiro-cli");
	});
});

describe("I-FRO5: createDetectionCache memoizes and re-probes after clear()", () => {
	it("probes once across repeated get() calls (session memoization)", async () => {
		const probe = vi.fn(async () => new Set<string>());
		const cache = createDetectionCache(probe);

		await cache.get();
		await cache.get();
		await cache.get();

		expect(probe).toHaveBeenCalledTimes(1);
	});

	it("re-probes after clear() — the I-FRO5 fix; a once-empty probe must not stay empty forever", async () => {
		// Models the bug: first probe finds nothing (bogus command); the user
		// fixes the command; clear() must force the next get() to re-probe and
		// see the now-installed agent. Without clear() (the old memoized field)
		// the second result would still be empty.
		let installed = false;
		const probe = vi.fn(async () =>
			installed ? new Set(["kiro-cli"]) : new Set<string>(),
		);
		const cache = createDetectionCache(probe);

		expect((await cache.get()).size).toBe(0);

		installed = true; // user fixes the path / install succeeds
		expect((await cache.get()).size).toBe(0); // still cached — no reload, no re-probe

		cache.clear(); // I-FRO5 / install-success invalidation
		expect(await cache.get()).toEqual(new Set(["kiro-cli"]));
		expect(probe).toHaveBeenCalledTimes(2);
	});

	it("does not cache a probe rejection (fail-soft yields an empty set)", async () => {
		let shouldThrow = true;
		const probe = vi.fn(async () => {
			if (shouldThrow) throw new Error("boom");
			return new Set(["kiro-cli"]);
		});
		const cache = createDetectionCache(probe);

		expect(await cache.get()).toEqual(new Set()); // fail-soft, not a rejection
		shouldThrow = false;
		cache.clear();
		expect(await cache.get()).toEqual(new Set(["kiro-cli"]));
	});
});

describe("maybeFirstRunOnboarding wiring: resolveFirstRunDefaultAgent", () => {
	it("composes detect → choose (Flow #1: picks the detected default)", async () => {
		const detect = vi.fn(async () => new Set(["gemini-cli", "kiro-cli"]));
		const chosen = await resolveFirstRunDefaultAgent(detect, "claude-code-acp");
		expect(detect).toHaveBeenCalledTimes(1);
		expect(chosen).toBe("kiro-cli");
	});

	it("keeps the current default when detection finds nothing (Flow #2)", async () => {
		const detect = vi.fn(async () => new Set<string>());
		const chosen = await resolveFirstRunDefaultAgent(detect, "claude-code-acp");
		expect(chosen).toBe("claude-code-acp");
	});
});
