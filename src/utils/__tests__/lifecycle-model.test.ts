import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	decideSessionIntent,
	selectAcquisitionAgent,
	type SessionIntent,
} from "../agent-switch";
import { checkTabAgentInvariant } from "../tab-agent-invariant";

/**
 * Slice 4 — model-based lifecycle test ([[Tab Agent Identity and Session
 * Acquisition Unification]] § "Lock it with the retro's test strategy").
 *
 * fast-check `commands` generates random sequences over
 * {open, switch, type, send, new-chat, new-chat-in-directory, restart,
 * hard-reload, soft-reload} and drives them through a simulator that mirrors
 * ChatPanel's orchestration using the REAL pure decision (decideSessionIntent)
 * and the REAL acquisition-agent selection (selectAcquisitionAgent). After
 * EVERY command, the governing invariant must hold:
 *
 *     a live session's agent == the tab's selected agent.
 *
 * This is the generated counterpart to the hand-written transition tests:
 * the switch-then-send race that motivated the whole feature is *generated*,
 * not hard-coded, and any violating sequence is shrunk to a minimal replay.
 */

const AGENTS = ["test-agent", "claude-code", "codex"] as const;

/** Simulator mirroring the ChatPanel orchestration of the unification. */
class TabSessionSim {
	selectedAgent: string;
	/** Agent the live session is bound to; null when no live session. */
	liveAgent: string | null = null;
	messageCount = 0;

	constructor(initial: string) {
		this.selectedAgent = initial;
	}

	get hasSession(): boolean {
		return this.liveAgent !== null;
	}

	/** The single owner: binds a fresh session to the live selected agent. */
	private acquire(): void {
		this.liveAgent =
			selectAcquisitionAgent(this.selectedAgent, undefined) ??
			this.selectedAgent;
	}

	private decide(intent: SessionIntent, requestedAgentId?: string) {
		return decideSessionIntent({
			intent,
			currentAgentId: this.selectedAgent,
			requestedAgentId,
			hasSession: this.hasSession,
			messageCount: this.messageCount,
		});
	}

	switch(agent: string): void {
		const d = this.decide("switch-agent", agent);
		if (d.kind === "swap-idle" || d.kind === "recreate-lazy") {
			this.selectedAgent = d.agentId; // setAgentWithoutSession
			this.liveAgent = null; // reset() — defer acquisition
			this.messageCount = 0;
		}
	}

	type(): void {
		// Typing triggers lazy acquisition when there is no live session.
		if (!this.hasSession) this.acquire();
	}

	send(): void {
		if (!this.hasSession) this.acquire();
		this.messageCount += 1;
	}

	newChat(): void {
		const d = this.decide("new-chat");
		if (d.kind === "recreate-lazy") {
			this.liveAgent = null;
			this.messageCount = 0;
		}
	}

	newChatInDirectory(): void {
		const d = this.decide("new-chat-in-directory");
		if (d.kind === "recreate-lazy") {
			this.selectedAgent = d.agentId; // keeps current agent
			this.liveAgent = null;
			this.messageCount = 0;
		}
	}

	respawn(intent: "restart-agent" | "hard-reload"): void {
		const d = this.decide(intent);
		if (d.kind === "respawn-lazy") {
			this.selectedAgent = d.agentId;
			this.liveAgent = null; // closeSession teardown
			this.messageCount = 0;
			this.acquire(); // acquireNow — eager re-acquire through the owner
		}
	}

	softReload(): void {
		// resume keeps the live session; noop changes nothing. Either way the
		// session's agent does not change.
		this.decide("soft-reload");
	}

	invariantViolation() {
		return checkTabAgentInvariant({
			selectedAgentId: this.selectedAgent,
			liveSessionAgentId: this.liveAgent,
		});
	}
}

// Minimal model for fc.commands (the real assertions live in run()).
interface Model {
	open: boolean;
}

type Sim = TabSessionSim;

function assertInvariant(real: Sim): void {
	expect(real.invariantViolation()).toBeNull();
}

class SwitchCmd implements fc.Command<Model, Sim> {
	constructor(private agent: string) {}
	check = () => true;
	run(_m: Model, r: Sim): void {
		r.switch(this.agent);
		assertInvariant(r);
	}
	toString = () => `switch(${this.agent})`;
}

class TypeCmd implements fc.Command<Model, Sim> {
	check = () => true;
	run(_m: Model, r: Sim): void {
		r.type();
		assertInvariant(r);
	}
	toString = () => "type";
}

class SendCmd implements fc.Command<Model, Sim> {
	check = () => true;
	run(_m: Model, r: Sim): void {
		r.send();
		assertInvariant(r);
	}
	toString = () => "send";
}

class NewChatCmd implements fc.Command<Model, Sim> {
	check = () => true;
	run(_m: Model, r: Sim): void {
		r.newChat();
		assertInvariant(r);
	}
	toString = () => "new-chat";
}

class NewChatInDirCmd implements fc.Command<Model, Sim> {
	check = () => true;
	run(_m: Model, r: Sim): void {
		r.newChatInDirectory();
		assertInvariant(r);
	}
	toString = () => "new-chat-in-directory";
}

class RestartCmd implements fc.Command<Model, Sim> {
	constructor(private intent: "restart-agent" | "hard-reload") {}
	check = () => true;
	run(_m: Model, r: Sim): void {
		r.respawn(this.intent);
		assertInvariant(r);
	}
	toString = () => this.intent;
}

class SoftReloadCmd implements fc.Command<Model, Sim> {
	check = () => true;
	run(_m: Model, r: Sim): void {
		r.softReload();
		assertInvariant(r);
	}
	toString = () => "soft-reload";
}

describe("Slice 4 — model-based tab session lifecycle", () => {
	it("the tab-agent invariant holds after every command in any sequence", () => {
		const commandArbs = [
			fc.constantFrom(...AGENTS).map((a) => new SwitchCmd(a)),
			fc.constant(new TypeCmd()),
			fc.constant(new SendCmd()),
			fc.constant(new NewChatCmd()),
			fc.constant(new NewChatInDirCmd()),
			fc
				.constantFrom("restart-agent" as const, "hard-reload" as const)
				.map((i) => new RestartCmd(i)),
			fc.constant(new SoftReloadCmd()),
		];

		fc.assert(
			fc.property(
				fc.constantFrom(...AGENTS),
				fc.commands(commandArbs, { maxCommands: 40 }),
				(initialAgent, cmds) => {
					const setup = () => ({
						model: { open: true },
						real: new TabSessionSim(initialAgent),
					});
					fc.modelRun(setup, cmds);
				},
			),
		);
	});

	it("a live session is always bound to the currently selected agent (spot check)", () => {
		const sim = new TabSessionSim("test-agent");
		sim.type(); // acquire on test-agent
		expect(sim.liveAgent).toBe("test-agent");
		sim.switch("claude-code"); // recreate-lazy → session cleared
		expect(sim.liveAgent).toBeNull();
		sim.send(); // re-acquire on claude-code
		expect(sim.liveAgent).toBe("claude-code");
		expect(sim.invariantViolation()).toBeNull();
	});
});
