import { describe, it, expect } from "vitest";
import {
	deriveSessionHistoryView,
	type SessionHistoryView,
	type SessionListSource,
} from "../session-history-view";
import type { AgentCapabilities } from "../../types/session";

// ============================================================================
// Helpers
// ============================================================================

/** Build an AgentCapabilities record from explicit axes (all default false). */
function caps(over: Partial<AgentCapabilities> = {}): AgentCapabilities {
	return {
		listsSessions: false,
		restoresViaLoad: false,
		restoresViaResume: false,
		forks: false,
		reportsModels: false,
		...over,
	};
}

// Observed real profiles (corrected by the Track-B smoke, 2026-06-27).
// Claude Code: lists sessions, restores via load, forks.
const CLAUDE_CODE = caps({
	listsSessions: true,
	restoresViaLoad: true,
	forks: true,
});
// Kiro CLI: no server-side list, restore-only (resume), no fork. Sessions are
// "saved in the plugin". (The exact resume/load axis is read from the live
// record, never assumed — both restore-capable shapes are covered below.)
const KIRO_CLI = caps({ restoresViaResume: true });

// ============================================================================
// listSource — toggle-driven, defaulting to Local for EVERY agent (Decision 3)
// ============================================================================

describe("deriveSessionHistoryView — listSource (toggle-driven, default Local)", () => {
	it("defaults to 'local' even for a listing agent (Claude) when no source is chosen", () => {
		// Decision 3: the local store is the canonical record; a Claude user
		// lands on Local and clicks Agent to browse server history. This is the
		// behavior that makes a plugin-created fork visible by default.
		expect(deriveSessionHistoryView(CLAUDE_CODE, true, true).listSource).toBe(
			"local",
		);
	});

	it("is 'agent' only when the user chooses Agent AND the agent advertises session/list", () => {
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true, "agent").listSource,
		).toBe("agent");
	});

	it("falls back to 'local' when Agent is chosen but the agent cannot list (Kiro)", () => {
		expect(
			deriveSessionHistoryView(KIRO_CLI, true, true, "agent").listSource,
		).toBe("local");
	});

	it("is 'local' when Local is explicitly chosen, regardless of capability", () => {
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true, "local").listSource,
		).toBe("local");
	});
});

// ============================================================================
// agentViewAvailable — whether the [Agent] pill is offered
// ============================================================================

describe("deriveSessionHistoryView — agentViewAvailable", () => {
	it("is true for an agent that advertises session/list (Claude)", () => {
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true).agentViewAvailable,
		).toBe(true);
	});

	it("is false for a plugin-local agent with no session/list (Kiro)", () => {
		expect(
			deriveSessionHistoryView(KIRO_CLI, true, true).agentViewAvailable,
		).toBe(false);
	});

	it("does not depend on the chosen source", () => {
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true, "local")
				.agentViewAvailable,
		).toBe(true);
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true, "agent")
				.agentViewAvailable,
		).toBe(true);
	});
});

// ============================================================================
// showFilters — the "This vault only" cwd filter, Agent-view only
// ============================================================================

describe("deriveSessionHistoryView — showFilters", () => {
	it("shows the filter only on the resolved Agent view", () => {
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true, "agent")
				.showFilters,
		).toBe(true);
	});

	it("hides the filter on the Local view (default), even for a listing agent", () => {
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true).showFilters,
		).toBe(false);
	});

	it("hides the filter for plugin-local agents (Kiro has no filter)", () => {
		expect(
			deriveSessionHistoryView(KIRO_CLI, true, true, "agent").showFilters,
		).toBe(false);
	});
});

// ============================================================================
// restore — live / local-only / hidden (gated on data + capability, NOT connection)
// ============================================================================

describe("deriveSessionHistoryView — restore", () => {
	it("is 'live' when the agent restores via load", () => {
		expect(
			deriveSessionHistoryView(caps({ restoresViaLoad: true }), true, true)
				.restore,
		).toBe("live");
	});

	it("is 'live' when the agent restores via resume", () => {
		expect(
			deriveSessionHistoryView(
				caps({ restoresViaResume: true }),
				true,
				true,
			).restore,
		).toBe("live");
	});

	it("is 'local-only' when the agent cannot restore but local data exists", () => {
		expect(deriveSessionHistoryView(caps(), true, true).restore).toBe(
			"local-only",
		);
	});

	it("is 'hidden' only for an agent-listed source with no restore capability AND no local data", () => {
		expect(
			deriveSessionHistoryView(
				caps({ listsSessions: true }),
				true,
				false,
				"agent",
			).restore,
		).toBe("hidden");
	});

	it("is 'local-only' on the Local view even with no local-data overlay (RC-3)", () => {
		// A local source IS the local data — restorable from disk.
		expect(deriveSessionHistoryView(caps(), true, false).restore).toBe(
			"local-only",
		);
	});

	it("prefers the agent path (live) over local even when no overlay data exists", () => {
		expect(
			deriveSessionHistoryView(caps({ restoresViaLoad: true }), true, false)
				.restore,
		).toBe("live");
	});
});

// ============================================================================
// fork — available / hidden (gated on capability only; connect-then-fork)
// ============================================================================

describe("deriveSessionHistoryView — fork", () => {
	it("is 'available' when the agent advertises fork", () => {
		expect(
			deriveSessionHistoryView(caps({ forks: true }), true, true).fork,
		).toBe("available");
	});

	it("is 'available' for any agent that can restore — even without session/fork (agent-agnostic, RC-2)", () => {
		expect(deriveSessionHistoryView(caps(), true, true).fork).toBe(
			"available",
		);
	});

	it("is 'hidden' only when there is nothing to restore or branch", () => {
		expect(
			deriveSessionHistoryView(
				caps({ listsSessions: true }),
				true,
				false,
				"agent",
			).fork,
		).toBe("hidden");
	});
});

// ============================================================================
// banner — none / local-saved / no-restore-capability
// ============================================================================

describe("deriveSessionHistoryView — banner", () => {
	it("is 'none' for an agent-listed, restore-capable agent on the Agent view (Claude)", () => {
		expect(
			deriveSessionHistoryView(CLAUDE_CODE, true, true, "agent").banner,
		).toBe("none");
	});

	it("is 'local-saved' on the Local view (default), including for Claude", () => {
		expect(deriveSessionHistoryView(CLAUDE_CODE, true, true).banner).toBe(
			"local-saved",
		);
	});

	it("is 'local-saved' for a plugin-local list that can still restore (Kiro CLI)", () => {
		expect(deriveSessionHistoryView(KIRO_CLI, true, true).banner).toBe(
			"local-saved",
		);
	});

	it("is 'no-restore-capability' only when restore is hidden (agent source, no data)", () => {
		expect(
			deriveSessionHistoryView(
				caps({ listsSessions: true }),
				true,
				false,
				"agent",
			).banner,
		).toBe("no-restore-capability");
	});

	it("a local source shows 'local-saved', never the no-restore banner, even pre-fetch (RC-3)", () => {
		expect(deriveSessionHistoryView(caps(), false, false).banner).toBe(
			"local-saved",
		);
		expect(deriveSessionHistoryView(caps(), true, false).banner).toBe(
			"local-saved",
		);
	});

	it("never shows a 'connect to an agent' banner — connection is not a banner input", () => {
		const disconnected = deriveSessionHistoryView(KIRO_CLI, false, true);
		expect(disconnected.banner).toBe("local-saved");
	});

	it("suppresses the 'no restoration' banner when local data is available (I41)", () => {
		const v = deriveSessionHistoryView(caps(), true, true);
		expect(v.restore).toBe("local-only");
		expect(v.banner).toBe("local-saved");
	});
});

// ============================================================================
// CONNECTION INVARIANCE — the I09/I41 fix encoded as paired ready/not-ready rows
//
// isAgentReady is an input, but it MUST NOT change ANY output. Restore and
// fork are gated on data availability + capability + intent, never on whether
// the tab's agent is currently connected. These paired rows are the
// regression guard against re-introducing connection-gating.
// ============================================================================

describe("deriveSessionHistoryView — connection invariance (I09/I41)", () => {
	const profiles: {
		name: string;
		caps: AgentCapabilities;
		hasLocalData: boolean;
	}[] = [
		{ name: "Claude Code + local data", caps: CLAUDE_CODE, hasLocalData: true },
		{
			name: "Claude Code, no local data",
			caps: CLAUDE_CODE,
			hasLocalData: false,
		},
		{ name: "Kiro CLI + local data", caps: KIRO_CLI, hasLocalData: true },
		{ name: "no-capability + local data", caps: caps(), hasLocalData: true },
		{ name: "no-capability, no local data", caps: caps(), hasLocalData: false },
		{
			name: "fork-only + local data",
			caps: caps({ forks: true }),
			hasLocalData: true,
		},
	];

	const sources: SessionListSource[] = ["local", "agent"];

	for (const p of profiles) {
		for (const source of sources) {
			it(`output is identical whether ready or not — ${p.name} (source=${source})`, () => {
				const ready = deriveSessionHistoryView(
					p.caps,
					true,
					p.hasLocalData,
					source,
				);
				const notReady = deriveSessionHistoryView(
					p.caps,
					false,
					p.hasLocalData,
					source,
				);
				expect(notReady).toEqual(ready);
			});
		}
	}
});

// ============================================================================
// Full input cube — totality (never throws; every cell maps to a known shape)
// ============================================================================

describe("deriveSessionHistoryView — totality over the input cube", () => {
	const bools = [true, false];
	const sources: SessionListSource[] = ["local", "agent"];

	it("is total: every (caps × isAgentReady × hasLocalData × source) cell resolves", () => {
		const listSources: SessionHistoryView["listSource"][] = [];
		const restores: SessionHistoryView["restore"][] = [];
		const forks: SessionHistoryView["fork"][] = [];
		const banners: SessionHistoryView["banner"][] = [];
		for (const listsSessions of bools)
			for (const restoresViaLoad of bools)
				for (const restoresViaResume of bools)
					for (const forksCap of bools)
						for (const reportsModels of bools)
							for (const ready of bools)
								for (const hasLocalData of bools)
									for (const source of sources) {
										const v = deriveSessionHistoryView(
											{
												listsSessions,
												restoresViaLoad,
												restoresViaResume,
												forks: forksCap,
												reportsModels,
											},
											ready,
											hasLocalData,
											source,
										);
										listSources.push(v.listSource);
										restores.push(v.restore);
										forks.push(v.fork);
										banners.push(v.banner);
									}
		// 2^7 × 2 sources = 256 cells, all resolved without throwing.
		expect(listSources).toHaveLength(256);
		expect(restores).toContain("hidden");
		expect(banners).toContain("no-restore-capability");
	});

	it("agent view requires the capability: listSource 'agent' ⇒ listsSessions", () => {
		for (const listsSessions of bools)
			for (const source of sources) {
				const v = deriveSessionHistoryView(
					caps({ listsSessions }),
					true,
					true,
					source,
				);
				if (v.listSource === "agent") {
					expect(listsSessions).toBe(true);
					expect(source).toBe("agent");
				}
			}
	});

	it("showFilters ⇔ resolved Agent view (invariant)", () => {
		for (const listsSessions of bools)
			for (const source of sources) {
				const v = deriveSessionHistoryView(
					caps({ listsSessions }),
					true,
					true,
					source,
				);
				expect(v.showFilters).toBe(v.listSource === "agent");
			}
	});

	it("banner is 'no-restore-capability' iff restore is 'hidden' (invariant)", () => {
		for (const listsSessions of bools)
			for (const restoresViaLoad of bools)
				for (const restoresViaResume of bools)
					for (const forksCap of bools)
						for (const hasLocalData of bools)
							for (const source of sources) {
								const v = deriveSessionHistoryView(
									{
										listsSessions,
										restoresViaLoad,
										restoresViaResume,
										forks: forksCap,
										reportsModels: false,
									},
									true,
									hasLocalData,
									source,
								);
								expect(
									v.banner === "no-restore-capability",
								).toBe(v.restore === "hidden");
							}
		});
});
