/**
 * I251 — a reload on a fork-pending tab restarts the agent before acquiring.
 * `session/fork` needs a live connection, so the fork path must initialize a
 * disconnected client first and read fork support from the restarted agent.
 *
 * Seam (R2): `prepareForkAcquisition`, which ChatPanel's
 * `forkExistingSession` runs before forking. Faked (R4): the ACP client port
 * and the tab's initialize / init-failure callbacks. Assertions (R3): the
 * call order, the fork decision, and what the UI is told on failure.
 * Literals only (R5).
 *
 * Spec: [[I251 Reload does nothing on a chat restored from history]].
 */
import { describe, expect, it, vi } from "vitest";
import { prepareForkAcquisition } from "../forkSessionFlow";
import {
	NO_AGENT_CAPABILITIES,
	type AgentCapabilities,
} from "../../types/session";

function caps(forks: boolean): AgentCapabilities {
	return { ...NO_AGENT_CAPABILITIES, forks };
}

function fakeClient(opts: { initialized: boolean; forksAfterInit: boolean }) {
	const calls: string[] = [];
	let initialized = opts.initialized;
	const client = {
		isInitialized: () => initialized,
		getInitializeResult: () =>
			initialized ? { capabilities: caps(opts.forksAfterInit) } : null,
	};
	const initialize = vi.fn(async () => {
		calls.push("initialize");
		initialized = true;
		return true;
	});
	return { client, initialize, calls };
}

describe("I251: fork after a reload's restart", () => {
	it("initializes a disconnected client before the fork", async () => {
		const c = fakeClient({ initialized: false, forksAfterInit: true });
		const result = await prepareForkAcquisition({
			client: c.client,
			initialize: c.initialize,
			applyInitFailure: vi.fn(),
			knownCapabilities: caps(true),
		});
		expect(c.calls).toEqual(["initialize"]);
		expect(result).toEqual({ serverForks: true });
	});

	it("reads fork support from the restarted agent, not the old capabilities", async () => {
		const c = fakeClient({ initialized: false, forksAfterInit: false });
		const result = await prepareForkAcquisition({
			client: c.client,
			initialize: c.initialize,
			applyInitFailure: vi.fn(),
			knownCapabilities: caps(true),
		});
		expect(result).toEqual({ serverForks: false });
	});

	it("doesn't re-initialize a live client", async () => {
		const c = fakeClient({ initialized: true, forksAfterInit: true });
		await prepareForkAcquisition({
			client: c.client,
			initialize: c.initialize,
			applyInitFailure: vi.fn(),
			knownCapabilities: caps(true),
		});
		expect(c.initialize).not.toHaveBeenCalled();
	});

	it("an agent that can't start shows its startup error and fails the fork", async () => {
		const c = fakeClient({ initialized: false, forksAfterInit: true });
		const startupError = new Error("kiro-cli not found");
		const applyInitFailure = vi.fn();
		await expect(
			prepareForkAcquisition({
				client: c.client,
				initialize: async () => {
					throw startupError;
				},
				applyInitFailure,
				knownCapabilities: caps(true),
			}),
		).rejects.toThrow("kiro-cli not found");
		expect(applyInitFailure).toHaveBeenCalledWith(startupError);
	});

	it("no agent configured: fails with a reason the UI is told", async () => {
		const c = fakeClient({ initialized: false, forksAfterInit: true });
		const applyInitFailure = vi.fn();
		await expect(
			prepareForkAcquisition({
				client: c.client,
				initialize: async () => false,
				applyInitFailure,
				knownCapabilities: caps(true),
			}),
		).rejects.toThrow("No agent configured for this tab");
		expect(applyInitFailure).toHaveBeenCalledTimes(1);
	});
});
