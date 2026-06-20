/**
 * AgentPickerModal (C2/D4) — the single "New chat with agent…" picker that
 * replaced N per-agent "Switch agent to {X}" commands.
 *
 * Verifies the FuzzySuggestModal wiring: the modal lists every available
 * agent and, on choose, invokes the callback with that agent's id (which the
 * plugin routes through startChat(agentId)).
 */

import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { AgentPickerModal, type AgentChoice } from "../AgentPickerModal";

const AGENTS: AgentChoice[] = [
	{ id: "kiro-cli", displayName: "Kiro CLI" },
	{ id: "claude-agent-acp", displayName: "Claude Code" },
	{ id: "custom-1", displayName: "My Custom Agent" },
];

function makeModal(onChoose: (id: string) => void) {
	return new AgentPickerModal(new App(), AGENTS, onChoose);
}

describe("AgentPickerModal", () => {
	it("lists every available agent", () => {
		const modal = makeModal(vi.fn());
		expect(modal.getItems()).toEqual(AGENTS);
	});

	it("shows the agent display name as the item text", () => {
		const modal = makeModal(vi.fn());
		expect(modal.getItemText(AGENTS[0])).toBe("Kiro CLI");
		expect(modal.getItemText(AGENTS[2])).toBe("My Custom Agent");
	});

	it("invokes onChoose with the chosen agent id", () => {
		const onChoose = vi.fn();
		const modal = makeModal(onChoose);
		modal.onChooseItem(AGENTS[1]);
		expect(onChoose).toHaveBeenCalledWith("claude-agent-acp");
		expect(onChoose).toHaveBeenCalledTimes(1);
	});
});
