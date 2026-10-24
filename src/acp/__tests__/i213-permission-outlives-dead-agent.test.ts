/**
 * I213: a permission dialog outlives the agent process that asked for it
 * (ported from upstream RAIT-09 ba4f097).
 *
 * Every "the agent is gone" path in the fork — process `exit`, process
 * `close`, and the SDK connection's `closed` promise — funnels into
 * `reconcileProcessGone`. That reaps the process and clears connection state
 * but never settles the permission queue, so a pending dialog stays on screen
 * for a request nobody can answer, and its promise never resolves.
 *
 * Outcome asserted: the pending request resolves `cancelled`, and the UI gets
 * the cancelled tool_call_update that hides the banner. A superseded
 * process's late exit must NOT cancel the live successor's request.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChildProcess } from "child_process";
import type * as acp from "@agentclientprotocol/sdk";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";
import type { SessionUpdate } from "../../types/session";

type Internals = {
	agentProcess: ChildProcess | null;
	connection: unknown;
	isInitializedFlag: boolean;
	currentSessionId: string | null;
	reconcileProcessGone: (proc: ChildProcess) => void;
	killProcessTree: () => void;
	permissionManager: {
		request: (
			p: acp.RequestPermissionRequest,
		) => Promise<acp.RequestPermissionResponse>;
	};
};

function setup() {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const c = client as unknown as Internals;
	// killProcessTree wraps the OS signal; mock at that boundary and keep its
	// contract (it nulls agentProcess).
	vi.spyOn(c, "killProcessTree").mockImplementation(() => {
		c.agentProcess = null;
	});
	const updates: SessionUpdate[] = [];
	client.onSessionUpdate((u) => updates.push(u));
	const proc = {
		pid: 7001,
		kill: vi.fn(),
		stdin: { end: vi.fn() },
	} as unknown as ChildProcess;
	c.agentProcess = proc;
	c.connection = { agent: {} };
	c.isInitializedFlag = true;
	c.currentSessionId = "sess-1";
	return { client, c, proc, updates };
}

function askPermission(c: Internals) {
	let settled: acp.RequestPermissionResponse | null = null;
	void c.permissionManager
		.request({
			sessionId: "sess-1",
			toolCall: { toolCallId: "tc-1", title: "Write file" },
			options: [
				{ optionId: "allow", name: "Allow", kind: "allow_once" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" },
			],
		} as acp.RequestPermissionRequest)
		.then((r) => {
			settled = r;
		});
	return () => settled;
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("I213: pending permissions are settled when the agent process dies", () => {
	it("cancels the pending request and hides its banner when the live process goes away", async () => {
		const { c, proc, updates } = setup();
		const result = askPermission(c);
		await flush();
		expect(result()).toBeNull(); // precondition: dialog is pending

		c.reconcileProcessGone(proc);
		await flush();

		expect(result()).toEqual({ outcome: { outcome: "cancelled" } });
		const cancelled = updates.find(
			(u) =>
				u.type === "tool_call_update" &&
				u.toolCallId === "tc-1" &&
				u.permissionRequest?.isCancelled === true,
		);
		expect(cancelled, "expected a cancelled tool_call_update").toBeDefined();
	});

	it("a superseded process's late exit does not cancel the successor's pending request", async () => {
		const { c } = setup();
		const oldProc = {
			pid: 1,
			kill: vi.fn(),
			stdin: { end: vi.fn() },
		} as unknown as ChildProcess;
		const result = askPermission(c);
		await flush();

		c.reconcileProcessGone(oldProc);
		await flush();

		expect(result()).toBeNull();
	});
});
