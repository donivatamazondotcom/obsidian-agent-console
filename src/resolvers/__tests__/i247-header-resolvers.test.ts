/**
 * I247: the pure resolvers behind the header tooltip's Engine, Effort, Mode
 * and Folder lines.
 *
 * The trap these pin: before I250, `kiroEngine` was "v2" for every launch
 * that wasn't V3, Claude included, and old session state can still carry it.
 * Only `kiroCli` (decided at the acp/ edge) says the tab runs Kiro, so a
 * Claude tab must never read as "Kiro CLI V2".
 *
 * Seam (R2): the exported resolvers ChatPanel calls, fed the session-state
 * shape it passes. Outcome assertions on the tagged result (R3), no mocks
 * (R4), literal expectations (R5).
 *
 * Red-first (R1): none of these resolvers exist on main (`deriveHeaderRuntime`
 * is the old Runtime-only one), so the file fails to import.
 *
 * Spec: [[I247 Header tooltip uses internal terms and omits the V2 engine]].
 */
import { describe, it, expect } from "vitest";
import {
	deriveHeaderEngine,
	deriveHeaderEffort,
	deriveHeaderMode,
	deriveHeaderFolder,
} from "../header-agent";
import type { SessionConfigOption } from "../../types/session";

const CLAUDE_INFO = { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.57.0" };

function option(category: string, current: string, values: [string, string][]): SessionConfigOption {
	return {
		id: category,
		name: category,
		category,
		type: "select",
		currentValue: current,
		options: values.map(([value, name]) => ({ value, name })),
	};
}

describe("deriveHeaderEngine", () => {
	it("Kiro on V2 names V2", () => {
		expect(deriveHeaderEngine({ kiroCli: true, kiroEngine: "v2" })).toEqual({
			kind: "kiroCli",
			engine: "v2",
		});
	});

	it("Kiro on V3 names V3", () => {
		expect(deriveHeaderEngine({ kiroCli: true, kiroEngine: "v3" })).toEqual({
			kind: "kiroCli",
			engine: "v3",
		});
	});

	it("Claude (no engine, not Kiro) uses its reported agentInfo", () => {
		expect(
			deriveHeaderEngine({ kiroCli: false, agentInfo: CLAUDE_INFO }),
		).toEqual({ kind: "reported", label: "Claude Agent 0.57.0" });
	});

	it("a stale 'v2' with kiroCli false still never reads as Kiro V2 (pre-I250 state)", () => {
		expect(
			deriveHeaderEngine({ kiroCli: false, kiroEngine: "v2", agentInfo: CLAUDE_INFO }),
		).toEqual({ kind: "reported", label: "Claude Agent 0.57.0" });
	});

	it("not Kiro and nothing reported: unknown", () => {
		expect(deriveHeaderEngine({ kiroCli: false, kiroEngine: "v2" })).toEqual({ kind: "unknown" });
	});

	it("before initialize (nothing known): unknown", () => {
		expect(deriveHeaderEngine({})).toEqual({ kind: "unknown" });
	});
});

describe("deriveHeaderEffort", () => {
	it("names the current thought_level option", () => {
		expect(
			deriveHeaderEffort({
				configOptions: [option("thought_level", "high", [["low", "Low"], ["high", "High"]])],
			}),
		).toBe("High");
	});

	it("no effort offered: null", () => {
		expect(deriveHeaderEffort({ configOptions: [option("model", "a", [["a", "A"]])] })).toBeNull();
		expect(deriveHeaderEffort({})).toBeNull();
	});
});

describe("deriveHeaderMode", () => {
	const modes = { currentModeId: "plan", availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan Mode" }] };

	it("a non-Kiro agent with modes names the current mode", () => {
		expect(deriveHeaderMode({ kiroCli: false, modes })).toBe("Plan Mode");
	});

	it("a Kiro tab never shows a Mode line (its mode is the agent)", () => {
		expect(
			deriveHeaderMode({
				kiroCli: true,
				configOptions: [option("mode", "kiro_default", [["kiro_default", "Default"]])],
			}),
		).toBeNull();
	});

	it("no modes offered: null", () => {
		expect(deriveHeaderMode({ kiroCli: false })).toBeNull();
	});
});

describe("deriveHeaderFolder", () => {
	// Smoke H3 (2026-11-02): show the folder on every tab. The vault folder is
	// shown too, since its path is visible nowhere else.
	it("the vault folder is shown", () => {
		expect(deriveHeaderFolder({ cwd: "/Users/me/vault" })).toBe("/Users/me/vault");
	});

	it("another folder is shown as given", () => {
		expect(deriveHeaderFolder({ cwd: "/Users/me/project" })).toBe("/Users/me/project");
	});

	it("no folder known: null", () => {
		expect(deriveHeaderFolder({ cwd: "" })).toBeNull();
		expect(deriveHeaderFolder({})).toBeNull();
	});
});
