/**
 * An agent that exits before reading its stdin must not raise an unhandled
 * `write EPIPE` when Agent Console sends `initialize`.
 *
 * Found on PR #344's CI (Linux): the D3 old-CLI stub exited before the
 * `initialize` write, the child's stdin emitted `error` with no listener,
 * and Vitest failed the run on the unhandled error. In Obsidian the same
 * write surfaces as an uncaught error. It predates D3: any agent that dies
 * before reading stdin can hit it.
 *
 * Red-first: the race is timing-dependent (macOS wraps the agent in a login
 * shell, which keeps the pipe open, so it never shows locally). The test
 * drives the mechanism instead: the real spawned child's stdin emits the
 * EPIPE error CI saw. With no listener, Node's emit throws, which is what
 * surfaced as the unhandled error. With the listener it is logged, and
 * initialize still rejects with the D3 reason.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";

let dir: string;
let stub: string;

/** Closes stdin, gives the write time to hit the closed pipe, then fails like an old CLI. */
const STUB = `#!/bin/sh
exec 0<&-
sleep 1.5
printf "error: unexpected argument '--agent-engine' found\\n" >&2
exit 2
`;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "epipe-kiro-"));
	stub = join(dir, "kiro-cli");
	writeFileSync(stub, STUB);
	chmodSync(stub, 0o755);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function makeClient(): AcpClient {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false, nodePath: "" },
		manifest: { version: "0.0.0-test" },
		app: { secretStorage: { getSecret: () => null } },
	} as unknown as AgentClientPlugin;
	return new AcpClient(plugin);
}

type Internals = { agentProcess: { stdin: NodeJS.EventEmitter | null } | null };

describe("initialize against an agent that closed its stdin", () => {
	it("a stdin EPIPE is handled, and D3 still recognizes the old CLI", async () => {
		const client = makeClient();
		const pending = client
			.initialize({
				id: "kiro-old",
				displayName: "Kiro (old CLI)",
				command: stub,
				args: ["acp"],
				env: {},
				workingDirectory: dir,
				kiroEngine: "v3",
			} as unknown as Parameters<AcpClient["initialize"]>[0])
			.then(
				() => null,
				(e: unknown) => e,
			);

		// Wait for the real child, then fail its stdin the way CI did.
		const internals = client as unknown as Internals;
		// Spawn waits on a login-shell PATH lookup, which is slow under load.
		for (let i = 0; i < 750 && !internals.agentProcess; i++) {
			await new Promise((r) => setTimeout(r, 20));
		}
		const stdin = internals.agentProcess?.stdin;
		expect(stdin).toBeTruthy();
		const epipe = Object.assign(new Error("write EPIPE"), {
			code: "EPIPE",
			syscall: "write",
			errno: -32,
		});
		expect(() => stdin?.emit("error", epipe)).not.toThrow();

		const err = await pending;
		expect(err).toBeInstanceOf(Error);
		expect((err as { info?: { title?: string } }).info?.title).toBe(
			"Kiro CLI needs an update",
		);
		await client.whenTornDown();
	}, 30_000);
});
