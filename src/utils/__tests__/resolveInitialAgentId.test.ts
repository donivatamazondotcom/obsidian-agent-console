/**
 * Restore-OFF agent seed — when "Restore tabs on startup" is OFF, a fresh tab
 * must open on the Default agent, NOT the Obsidian view-state's last-active
 * agent. Sibling finding to [[TP-I05 …]]; same architectural split (the
 * view-state agent diverging from the tab's intended agent).
 *
 * SYMPTOM (live, 2026-06-25): default agent was Claude Code, restore-tabs off,
 * but the reloaded tab opened as Kiro CLI — the last agent connected in the
 * prior session — because `initialAgentId = view.getInitialAgentId() ??
 * defaultAgentId` is not gated by `restoreTabsOnStartup`.
 *
 * RED until the pure `resolveInitialAgentId` helper exists and ChatView uses it.
 */

import { describe, it, expect } from "vitest";
import { resolveInitialAgentId } from "../../resolvers/resolveInitialAgentId";

describe("resolveInitialAgentId — restore-OFF honors the Default agent", () => {
	it("restore OFF → Default agent, even with a persisted view-state last-agent", () => {
		expect(
			resolveInitialAgentId({
				restoreEnabled: false,
				viewStateAgentId: "kiro-cli",
				defaultAgentId: "claude-code-acp",
			}),
		).toBe("claude-code-acp");
	});

	it("restore ON → the view-state agent when present (restored leaf continuity)", () => {
		expect(
			resolveInitialAgentId({
				restoreEnabled: true,
				viewStateAgentId: "kiro-cli",
				defaultAgentId: "claude-code-acp",
			}),
		).toBe("kiro-cli");
	});

	it("restore ON, no view-state agent → Default agent", () => {
		expect(
			resolveInitialAgentId({
				restoreEnabled: true,
				viewStateAgentId: null,
				defaultAgentId: "claude-code-acp",
			}),
		).toBe("claude-code-acp");
	});
});
