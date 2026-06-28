import { describe, it, expect } from "vitest";
import {
	deriveSessionHistoryView,
	type SessionHistoryView,
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
// listSource — agent session/list vs plugin-local saved sessions
// ============================================================================

describe("deriveSessionHistoryView — listSource", () => {
	it("is 'agent' when the agent advertises session/list", () => {
		expect(
			deriveSessionHistoryView(caps({ listsSessions: true }), true, true)
				.listSource,
		).toBe("agent");
	});

	it("is 'local' when the agent does not advertise session/list", () => {
		expect(
			deriveSessionHistoryView(caps({ listsSessions: false }), true, true)
				.listSource,
		).toBe("local");
	});
});

// ============================================================================
// showFilters — the filter-checkbox facet (folded in from the modal)
// ============================================================================

describe("deriveSessionHistoryView — showFilters", () => {
	it("shows filters only when listing from the agent", () => {
		expect(
			deriveSessionHistoryView(caps({ listsSessions: true }), true, true)
				.showFilters,
		).toBe(true);
	});

	it("hides filters for plugin-local lists (Kiro CLI has no filter checkboxes)", () => {
		expect(deriveSessionHistoryView(KIRO_CLI, true, true).showFilters).toBe(
			false,
		);
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
			deriveSessionHistoryView(caps({ listsSessions: true }), true, false)
				.restore,
		).toBe("hidden");
	});

	it("is NOT 'hidden' for a plugin-local source even with no local-data overlay (RC-3)", () => {
		// A local list IS the local data — restorable from disk.
		expect(deriveSessionHistoryView(caps(), true, false).restore).toBe(
			"local-only",
		);
	});

	it("prefers the agent path (live) over local even when local data exists", () => {
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
		// Local-branch fallback: fork is offered; the server-vs-local choice is
		// made at acquisition time, not here.
		expect(deriveSessionHistoryView(caps(), true, true).fork).toBe(
			"available",
		);
	});

	it("is 'hidden' only when there is nothing to restore or branch", () => {
		// Agent-listed source, no restore capability, no local data → restore
		// hidden → fork hidden.
		expect(
			deriveSessionHistoryView(caps({ listsSessions: true }), true, false)
				.fork,
		).toBe("hidden");
	});
});

// ============================================================================
// banner — none / local-saved / no-restore-capability
// ============================================================================

describe("deriveSessionHistoryView — banner", () => {
	it("is 'none' for an agent-listed, restore-capable agent (Claude Code)", () => {
		expect(deriveSessionHistoryView(CLAUDE_CODE, true, true).banner).toBe(
			"none",
		);
	});

	it("is 'local-saved' for a plugin-local list that can still restore (Kiro CLI)", () => {
		expect(deriveSessionHistoryView(KIRO_CLI, true, true).banner).toBe(
			"local-saved",
		);
	});

	it("is 'no-restore-capability' only when restore is hidden (agent source, no data)", () => {
		expect(
			deriveSessionHistoryView(caps({ listsSessions: true }), true, false)
				.banner,
		).toBe("no-restore-capability");
	});

	it("a local source shows 'local-saved', never the no-restore banner, even pre-fetch (RC-3)", () => {
		// Kiro CLI pre-connect: NO_AGENT_CAPABILITIES (all false) is a local
		// source. The banner must be a stable 'local-saved', not the
		// misleading "does not support restoration" that flickered before.
		expect(deriveSessionHistoryView(caps(), false, false).banner).toBe(
			"local-saved",
		);
		expect(deriveSessionHistoryView(caps(), true, false).banner).toBe(
			"local-saved",
		);
	});

	it("never shows a 'connect to an agent' banner — connection is not a banner input", () => {
		// I09: the old modal showed an orange "Connect to an agent…" banner
		// when disconnected. The banner enum has no such member; disconnected
		// + local data is a plain operable state.
		const disconnected = deriveSessionHistoryView(KIRO_CLI, false, true);
		expect(disconnected.banner).toBe("local-saved");
	});

	it("suppresses the 'no restoration' banner when local data is available (I41)", () => {
		// I41: the old modal showed "This agent does not support session
		// restoration" for a no-capability agent even though local data could
		// be restored. The resolver returns local-only restore + local-saved
		// banner instead.
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
	const profiles: { name: string; caps: AgentCapabilities; hasLocalData: boolean }[] =
		[
			{ name: "Claude Code + local data", caps: CLAUDE_CODE, hasLocalData: true },
			{ name: "Claude Code, no local data", caps: CLAUDE_CODE, hasLocalData: false },
			{ name: "Kiro CLI + local data", caps: KIRO_CLI, hasLocalData: true },
			{ name: "no-capability + local data", caps: caps(), hasLocalData: true },
			{ name: "no-capability, no local data", caps: caps(), hasLocalData: false },
			{
				name: "fork-only + local data",
				caps: caps({ forks: true }),
				hasLocalData: true,
			},
		];

	for (const p of profiles) {
		it(`output is identical whether ready or not — ${p.name}`, () => {
			const ready = deriveSessionHistoryView(p.caps, true, p.hasLocalData);
			const notReady = deriveSessionHistoryView(
				p.caps,
				false,
				p.hasLocalData,
			);
			expect(notReady).toEqual(ready);
		});
	}
});

// ============================================================================
// Full input cube — totality (never throws; every cell maps to a known shape)
// ============================================================================

describe("deriveSessionHistoryView — totality over the input cube", () => {
	const bools = [true, false];
	it("is total: every (caps × isAgentReady × hasLocalData) cell resolves", () => {
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
								for (const hasLocalData of bools) {
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
									);
									listSources.push(v.listSource);
									restores.push(v.restore);
									forks.push(v.fork);
									banners.push(v.banner);
								}
		// 2^7 = 128 cells, all resolved without throwing.
		expect(listSources).toHaveLength(128);
		// banner is consistent with restore: no-restore-capability iff restore hidden
		expect(restores).toContain("hidden");
		expect(banners).toContain("no-restore-capability");
	});

	it("banner is 'no-restore-capability' iff restore is 'hidden' (invariant)", () => {
		for (const listsSessions of bools)
			for (const restoresViaLoad of bools)
				for (const restoresViaResume of bools)
					for (const forksCap of bools)
						for (const hasLocalData of bools) {
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
							);
							expect(v.banner === "no-restore-capability").toBe(
								v.restore === "hidden",
							);
						}
	});
});
