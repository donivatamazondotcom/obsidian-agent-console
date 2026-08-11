/**
 * Reproduce-first tests for issue #286: ACP connection close leaves orphaned
 * agent processes.
 *
 * Symptom: when the ACP connection closes/resets, the plugin does not reap the
 * spawned agent process. A standard ACP stdio server blocks on stdin and exits
 * only on EOF, so the child lingers and processes accumulate on every reconnect.
 *
 * The fork already has `killProcessTree()`, but nothing invokes it when the
 * connection closes on its own — the process `exit`/`close` handlers and the
 * SDK connection-closed path never reconcile client state or close stdin.
 *
 * Test seam: `reconcileProcessGone(proc)` is the single reconcile point wired
 * from both the process `exit`/`close` handlers and the SDK connection's
 * `closed` promise (via `watchConnectionClosed`). `killProcessTree()` is spied
 * so the tests never send a real signal to a real pid.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";

function makeClient(): AcpClient {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	return new AcpClient(plugin);
}

// Minimal fake child: records stdin.end / kill without touching a real process.
function makeFakeProc(pid: number) {
	const stdinEnd = vi.fn();
	const kill = vi.fn();
	const proc = {
		pid,
		kill,
		stdin: { end: stdinEnd },
	} as unknown as ChildProcess;
	return { proc, stdinEnd, kill };
}

type Internals = {
	agentProcess: ChildProcess | null;
	connection: unknown;
	isInitializedFlag: boolean;
	currentSessionId: string | null;
	reconcileProcessGone: (proc: ChildProcess) => void;
	watchConnectionClosed: (
		connection: { closed: Promise<void> },
		proc: ChildProcess,
	) => void;
	killProcessTree: () => void;
};

describe("AcpClient process reaping on connection/process end (#286)", () => {
	it("reaps the child and clears state when reconcileProcessGone fires for the live process", () => {
		const client = makeClient();
		const c = client as unknown as Internals;
		const { proc, stdinEnd } = makeFakeProc(4242);

		// killProcessTree wraps the OS kill (process-group SIGTERM / taskkill);
		// mock it at that boundary so no real signal is sent. Mirror its
		// contract: it nulls agentProcess.
		const killSpy = vi
			.spyOn(c, "killProcessTree")
			.mockImplementation(() => {
				c.agentProcess = null;
			});

		// Simulate a live, connected client.
		c.agentProcess = proc;
		c.connection = { agent: {} };
		c.isInitializedFlag = true;
		c.currentSessionId = "sess-1";
		expect(client.isInitialized()).toBe(true); // precondition

		c.reconcileProcessGone(proc);

		// Child reaped: stdin closed (EOF for a well-behaved agent) AND the
		// process tree killed.
		expect(stdinEnd).toHaveBeenCalledTimes(1);
		expect(killSpy).toHaveBeenCalledTimes(1);
		// Connection state cleared so a reconnect starts clean.
		expect(client.isInitialized()).toBe(false);
		expect(c.connection).toBeNull();
		expect(c.currentSessionId).toBeNull();
	});

	it("reaps the child when the ACP connection's `closed` promise resolves (connection dropped, child still alive)", async () => {
		const client = makeClient();
		const c = client as unknown as Internals;
		const { proc, stdinEnd } = makeFakeProc(4243);

		const killSpy = vi
			.spyOn(c, "killProcessTree")
			.mockImplementation(() => {
				c.agentProcess = null;
			});

		let resolveClosed!: () => void;
		const closed = new Promise<void>((r) => {
			resolveClosed = r;
		});
		const connection = { closed, agent: {} };

		c.agentProcess = proc;
		c.connection = connection;
		c.isInitializedFlag = true;
		c.currentSessionId = "sess-2";

		// Wire the watcher exactly as doInitialize does after .connect(stream).
		c.watchConnectionClosed(connection, proc);
		expect(client.isInitialized()).toBe(true);

		// The connection closes on its own — the reporter's exact case.
		resolveClosed();
		await Promise.resolve();
		await Promise.resolve();

		expect(stdinEnd).toHaveBeenCalledTimes(1);
		expect(killSpy).toHaveBeenCalledTimes(1);
		expect(client.isInitialized()).toBe(false);
	});

	it("does NOT reconcile when a newer process has superseded the closing one (deliberate respawn guard)", () => {
		const client = makeClient();
		const c = client as unknown as Internals;
		const { proc: oldProc } = makeFakeProc(1);
		const { proc: newProc } = makeFakeProc(2);

		const killSpy = vi
			.spyOn(c, "killProcessTree")
			.mockImplementation(() => {
				c.agentProcess = null;
			});

		// A respawn already replaced the process; the OLD process's late
		// exit/close event must not tear down the NEW live connection.
		c.agentProcess = newProc;
		c.connection = { agent: {} };
		c.isInitializedFlag = true;

		c.reconcileProcessGone(oldProc);

		expect(killSpy).not.toHaveBeenCalled();
		expect(c.agentProcess).toBe(newProc);
		expect(client.isInitialized()).toBe(true);
	});
});
