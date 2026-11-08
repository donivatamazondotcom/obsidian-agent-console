/**
 * I302: on the Default engine (V3), a kiro-cli without V3 rejects
 * `--agent-engine=v3` the way clap rejects any unknown flag (exit 2,
 * `error: unexpected argument '--agent-engine' found`, measured for D3).
 * Default relaunches once without the flag, through I270's relaunch, and
 * runs V2. An agent set to V3 by name keeps D3's error.
 *
 * Seams (R2): a real AcpClient spawns a real stub `kiro-cli` through the
 * public `initialize()`. Outcomes (R3): what the stub was launched with, the
 * InitializeResult the session reads, the error the chat shows.
 *
 * Red-first (R1): on main a Default (V3) launch on the old CLI throws D3's
 * "Kiro CLI needs an update" after one spawn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	chmodSync,
	readFileSync,
	rmSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpClient } from "../acp-client";
import { isInitializeSuperseded } from "../../utils/error-utils";
import type AgentClientPlugin from "../../plugin";

type Mode = "old" | "oldbroken" | "current" | "unrelated" | "oldheld";

let dir: string;
const cli = (mode: Mode) => join(dir, mode, "kiro-cli");

/**
 * argv log, then:
 * - old: reject --agent-engine like clap; without it, a minimal ACP agent.
 * - oldbroken: reject the flag; without it, exit 1 before answering.
 * - oldheld: reject the flag; without it, wait for RELEASE, then exit 1.
 * - current: accept the flag (any engine), a minimal ACP agent.
 * - unrelated: exit 1 with stderr that mentions --agent-engine but isn't
 *   clap's unknown-argument error.
 */
const agentStub = (mode: Mode) => `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
fs.appendFileSync(path.join(__dirname, "argv.log"), process.argv.slice(2).join(" ") + "\\n");
const flagged = process.argv.some((a) => a.startsWith("--agent-engine"));
const mode = ${JSON.stringify(mode)};
if (mode === "unrelated") {
  process.stderr.write("error: could not start the agent for --agent-engine=v3: workspace config missing\\n");
  process.exit(1);
}
const reject = () => {
  process.stderr.write("error: unexpected argument '--agent-engine' found\\n\\n  tip: to pass '--agent-engine' as a value, use '-- --agent-engine'\\n");
  process.exit(2);
};
const hold = path.join(__dirname, "HOLD");
if (mode !== "current" && flagged) {
  // A test can hold the rejection (HOLD marker) to land a disconnect first.
  const wait = () => (fs.existsSync(hold) ? setTimeout(wait, 10) : reject());
  wait();
} else {
if (mode === "oldbroken") {
  process.stderr.write("error: something unrelated broke\\n");
  process.exit(1);
}
if (mode === "oldheld") {
  const release = path.join(__dirname, "RELEASE");
  const wait = () => (fs.existsSync(release) ? process.exit(1) : setTimeout(wait, 10));
  wait();
} else {
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [],
      } }) + "\\n");
    }
  }
});
}
}
`;

const MODES: Mode[] = ["old", "oldbroken", "current", "unrelated", "oldheld"];

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "i302-kiro-"));
	for (const mode of MODES) {
		mkdirSync(join(dir, mode));
		writeFileSync(cli(mode), agentStub(mode));
		chmodSync(cli(mode), 0o755);
	}
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
	for (const mode of MODES) {
		rmSync(join(dir, mode, "argv.log"), { force: true });
	}
	rmSync(join(dir, "oldheld", "RELEASE"), { force: true });
});

function makeClient(): AcpClient {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false, nodePath: "" },
		manifest: { version: "0.0.0-test" },
		app: { secretStorage: { getSecret: () => null } },
	} as unknown as AgentClientPlugin;
	return new AcpClient(plugin);
}

/** A Kiro launch on V3: Default (follows Agent Console's default) or explicit. */
const config = (mode: Mode, source: "default" | "explicit" = "default") =>
	({
		id: "kiro-test",
		displayName: "Kiro Test",
		command: cli(mode),
		args: ["acp", "--agent", "auto-sa"],
		env: {},
		workingDirectory: dir,
		kiroEngine: "v3",
		...(source === "default" ? { kiroEngineFollowsDefault: true } : {}),
	}) as unknown as Parameters<AcpClient["initialize"]>[0];

const spawns = (mode: Mode) => {
	const log = join(dir, mode, "argv.log");
	return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
};

const errorTitle = (err: unknown) =>
	(err as { info?: { title?: string } } | null)?.info?.title;
const errorSuggestion = (err: unknown) =>
	(err as { info?: { suggestion?: string } } | null)?.info?.suggestion ?? "";

async function settle<T>(p: Promise<T>): Promise<unknown> {
	return p.then(
		() => null,
		(e: unknown) => e,
	);
}

describe("I302 — Default (V3) on a kiro-cli without V3", () => {
	it("relaunches once without the flag and runs V2, with no cache key", async () => {
		const client = makeClient();
		const result = await client.initialize(config("old"));
		// V3 rejected, then the user's own args with no engine flag: V2
		// accepts --agent on the command line.
		expect(spawns("old")).toEqual([
			"acp --agent-engine=v3",
			"acp --agent auto-sa",
		]);
		expect(result.kiroEngine).toBe("v2");
		expect(result.kiroEngineFallback).toBe("old-cli");
		expect(result.kiroCli).toBe(true);
		expect(client.getLaunchKey()).toBeNull();
		await client.disconnect();
		await client.whenTornDown();
	}, 30_000);

	it("a second initialize during the relaunch coalesces onto it", async () => {
		const client = makeClient();
		const [a, b] = await Promise.all([
			client.initialize(config("old")),
			client.initialize(config("old")),
		]);
		expect(a).toBe(b);
		expect(spawns("old")).toHaveLength(2);
		await client.disconnect();
		await client.whenTornDown();
	}, 30_000);

	it("tries V3 again on the next launch (no memo)", async () => {
		const client = makeClient();
		await client.initialize(config("old"));
		await client.disconnect();
		await client.whenTornDown();
		await client.initialize(config("old"));
		expect(spawns("old")).toEqual([
			"acp --agent-engine=v3",
			"acp --agent auto-sa",
			"acp --agent-engine=v3",
			"acp --agent auto-sa",
		]);
		await client.disconnect();
		await client.whenTornDown();
	}, 30_000);

	it("an agent set to V3 by name keeps D3's error and doesn't relaunch", async () => {
		const client = makeClient();
		const err = await settle(client.initialize(config("old", "explicit")));
		expect(errorTitle(err)).toBe("Kiro CLI needs an update");
		expect(spawns("old")).toEqual(["acp --agent-engine=v3"]);
		await client.whenTornDown();
	}, 30_000);

	it("other stderr that mentions the flag keeps D3's error on Default", async () => {
		const client = makeClient();
		const err = await settle(client.initialize(config("unrelated")));
		expect(errorTitle(err)).toBe("Kiro CLI needs an update");
		expect(spawns("unrelated")).toHaveLength(1);
		await client.whenTornDown();
	}, 30_000);

	it("a current CLI runs V3 in one spawn, with no fallback", async () => {
		const client = makeClient();
		const result = await client.initialize(config("current"));
		expect(spawns("current")).toEqual(["acp --agent-engine=v3"]);
		expect(result.kiroEngine).toBe("v3");
		expect(result.kiroEngineFallback).toBeUndefined();
		expect(client.getLaunchKey()).not.toBeNull();
		await client.disconnect();
		await client.whenTornDown();
	}, 30_000);

	it("a relaunch that exits before answering shows update-only advice", async () => {
		const client = makeClient();
		const err = await settle(client.initialize(config("oldbroken")));
		expect(spawns("oldbroken")).toEqual([
			"acp --agent-engine=v3",
			"acp --agent auto-sa",
		]);
		expect(errorTitle(err)).toBe("Kiro CLI needs an update");
		expect(errorSuggestion(err)).toMatch(/kiro-cli update/);
		// The V2 hint would be wrong: this CLI just failed on V2.
		expect(errorSuggestion(err)).not.toMatch(/V2/);
		await client.whenTornDown();
	}, 30_000);

	it("a disconnect while the relaunch runs gives no update advice", async () => {
		const client = makeClient();
		const pending = settle(client.initialize(config("oldheld")));
		for (let i = 0; i < 1500 && spawns("oldheld").length < 2; i++) {
			await new Promise((r) => setTimeout(r, 10));
		}
		expect(spawns("oldheld")).toHaveLength(2);
		// Keep the relaunch's process alive past disconnect, so it exits 1
		// afterwards (as `taskkill /F` does on Windows).
		const internals = client as unknown as { agentProcess: unknown };
		internals.agentProcess = null;
		await client.disconnect();
		writeFileSync(join(dir, "oldheld", "RELEASE"), "");
		const err = await pending;
		expect(isInitializeSuperseded(err)).toBe(true);
		await client.whenTornDown();
	}, 30_000);

	it("a disconnect during the rejected V3 attempt doesn't relaunch", async () => {
		const client = makeClient();
		const hold = join(dir, "old", "HOLD");
		writeFileSync(hold, "");
		try {
			const pending = settle(client.initialize(config("old")));
			for (let i = 0; i < 1500 && spawns("old").length === 0; i++) {
				await new Promise((r) => setTimeout(r, 10));
			}
			const internals = client as unknown as { agentProcess: { kill: () => void } | null };
			const proc = internals.agentProcess;
			internals.agentProcess = null;
			await client.disconnect();
			rmSync(hold, { force: true });
			const err = await pending;
			expect(isInitializeSuperseded(err)).toBe(true);
			expect(spawns("old")).toEqual(["acp --agent-engine=v3"]);
			proc?.kill();
			await client.whenTornDown();
		} finally {
			rmSync(hold, { force: true });
		}
	}, 30_000);
});
