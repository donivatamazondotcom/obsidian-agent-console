/**
 * Unit tests for AcpClient.initialize() concurrent-call coalescing (I46).
 *
 * Reproduces the double-`initialize()` race from
 * [[ACP Tab Persistence Across Restarts]] I46: the eager-init-on-mount
 * (Decision #10) and the lazy `createSession` first-keystroke path can both
 * call `initialize()` for the same agent inside the ~2s ACP handshake window.
 * Without coalescing, the second call runs the full body — `killProcessTree()`
 * on the in-flight process + handshake restart — producing the visible
 * `ready → connecting → ready` flicker.
 *
 * Test seam: the actual spawn + ACP SDK connection live in the private
 * `doInitialize()`; `initialize()` is the coalescing wrapper. Spying on
 * `doInitialize` lets us assert how many times the expensive body runs
 * without mocking the child process or the SDK.
 */

import { describe, it, expect, vi } from "vitest";
import { AcpClient, type AgentConfig } from "../acp-client";
import type { InitializeResult } from "../../types/session";
import type AgentClientPlugin from "../../plugin";

type DoInitializeSeam = {
	doInitialize: (config: AgentConfig) => Promise<InitializeResult>;
};

function makeClient(): AcpClient {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	return new AcpClient(plugin);
}

function makeConfig(id: string): AgentConfig {
	return {
		id,
		displayName: id,
		command: "echo",
		args: [],
		workingDirectory: "/tmp",
	};
}

const RESULT = { protocolVersion: 1 } as unknown as InitializeResult;

describe("AcpClient.initialize — concurrent-call coalescing (I46)", () => {
	it("runs doInitialize once for two concurrent same-agent calls; both resolve to the same result", async () => {
		const client = makeClient();
		// Each invocation resolves on its own short timer so the handshake is
		// "in flight" when the second initialize() fires, but both promises
		// still settle (so the discriminator is the call count, not a hang).
		const spy = vi
			.spyOn(client as unknown as DoInitializeSeam, "doInitialize")
			.mockImplementation(
				() =>
					new Promise<InitializeResult>((res) =>
						setTimeout(() => res(RESULT), 10),
					),
			);

		const cfg = makeConfig("auto-sa");
		// Second call fires synchronously while the first is still in flight.
		const p1 = client.initialize(cfg);
		const p2 = client.initialize(cfg);

		const [r1, r2] = await Promise.all([p1, p2]);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(r1).toBe(RESULT);
		expect(r2).toBe(RESULT);
	});

	it("does NOT coalesce concurrent calls for different agents (agent switch still re-initializes)", async () => {
		const client = makeClient();
		const spy = vi
			.spyOn(client as unknown as DoInitializeSeam, "doInitialize")
			.mockResolvedValue(RESULT);

		await Promise.all([
			client.initialize(makeConfig("agent-a")),
			client.initialize(makeConfig("agent-b")),
		]);

		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("re-runs doInitialize for a sequential call after the first settles (in-flight promise cleared)", async () => {
		const client = makeClient();
		const spy = vi
			.spyOn(client as unknown as DoInitializeSeam, "doInitialize")
			.mockResolvedValue(RESULT);

		const cfg = makeConfig("auto-sa");
		await client.initialize(cfg);
		await client.initialize(cfg);

		expect(spy).toHaveBeenCalledTimes(2);
	});
});
