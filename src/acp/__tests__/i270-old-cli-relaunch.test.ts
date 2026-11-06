/**
 * I270: a V2 Kiro launch now pins `--agent-engine=v2`. A kiro-cli that
 * predates the flag rejects it the way clap rejects any unknown flag (exit 2,
 * `error: unexpected argument '--agent-engine' found`, measured for D3). That
 * CLI only has V2, so the client relaunches once without the flag.
 *
 * Seams (R2): a real AcpClient spawns a real stub `kiro-cli` through the
 * public `initialize()`. The stub is a tiny Node ACP agent: with the flag it
 * fails like an old CLI; without it, it answers `initialize`.
 *
 * Red-first (R1): on main a V2 launch passes no flag, so the stub sees one
 * spawn and no relaunch, and `getLaunchKey()` is a key (the cache writers
 * would record this unverified launch).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpClient, resetKiroEngineFlagMemoForTests } from "../acp-client";
import type AgentClientPlugin from "../../plugin";

let dir: string;
let oldCli: string;
let failsAnyway: string;

/** argv log, then: reject --agent-engine like clap, else a minimal ACP agent. */
const agentStub = (mode: "old" | "broken") => `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
fs.appendFileSync(path.join(__dirname, "argv-${mode}.log"), process.argv.slice(2).join(" ") + "\\n");
if (process.argv.some((a) => a.startsWith("--agent-engine"))) {
  process.stderr.write("error: unexpected argument '--agent-engine' found\\n\\n  tip: to pass '--agent-engine' as a value, use '-- --agent-engine'\\n");
  process.exit(2);
}
${mode === "broken" ? 'process.stderr.write("error: something unrelated broke\\n"); process.exit(1);' : ""}
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
`;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "i270-kiro-"));
	oldCli = join(dir, "old", "kiro-cli");
	failsAnyway = join(dir, "broken", "kiro-cli");
	for (const [file, mode] of [
		[oldCli, "old"],
		[failsAnyway, "broken"],
	] as const) {
		const sub = join(dir, mode);
		if (!existsSync(sub)) mkdirSync(sub);
		writeFileSync(file, agentStub(mode));
		chmodSync(file, 0o755);
	}
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
	resetKiroEngineFlagMemoForTests();
	for (const mode of ["old", "broken"]) {
		const log = join(dir, mode, `argv-${mode}.log`);
		if (existsSync(log)) rmSync(log);
	}
});

function makeClient(): AcpClient {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false, nodePath: "" },
		manifest: { version: "0.0.0-test" },
		app: { secretStorage: { getSecret: () => null } },
	} as unknown as AgentClientPlugin;
	return new AcpClient(plugin);
}

const config = (command: string, kiroEngine: "v2" | "v3" = "v2") =>
	({
		id: "kiro-old",
		displayName: "Kiro (old CLI)",
		command,
		args: ["acp"],
		env: {},
		workingDirectory: dir,
		kiroEngine,
	}) as unknown as Parameters<AcpClient["initialize"]>[0];

const spawns = (mode: "old" | "broken") => {
	const log = join(dir, mode, `argv-${mode}.log`);
	return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
};

describe("I270 — V2 on a kiro-cli without --agent-engine", () => {
	it("relaunches once without the flag and connects as V2, with no cache key", async () => {
		const client = makeClient();
		const result = await client.initialize(config(oldCli));
		expect(spawns("old")).toEqual(["acp --agent-engine=v2", "acp"]);
		expect(result.kiroEngine).toBe("v2");
		// Unpinned: neither cache may record this launch.
		expect(client.getLaunchKey()).toBeNull();
		await client.disconnect();
		await client.whenTornDown();
	}, 30_000);

	it("a second initialize during the relaunch coalesces onto it", async () => {
		const client = makeClient();
		const first = client.initialize(config(oldCli));
		const second = client.initialize(config(oldCli));
		const [a, b] = await Promise.all([first, second]);
		expect(a).toBe(b);
		expect(spawns("old")).toHaveLength(2);
		await client.disconnect();
		await client.whenTornDown();
	}, 30_000);

	it("remembers the CLI for the rest of the run, so the next launch skips the doomed spawn", async () => {
		const client = makeClient();
		await client.initialize(config(oldCli));
		await client.disconnect();
		await client.whenTornDown();
		await client.initialize(config(oldCli));
		expect(spawns("old")).toEqual(["acp --agent-engine=v2", "acp", "acp"]);
		await client.disconnect();
		await client.whenTornDown();
	}, 30_000);

	it("an unpinned launch that fails surfaces its error and forgets the memo", async () => {
		const client = makeClient();
		const err = await client.initialize(config(failsAnyway)).then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Error);
		expect(spawns("broken")).toEqual(["acp --agent-engine=v2", "acp"]);
		await client.whenTornDown();
		await client.initialize(config(failsAnyway)).catch(() => {});
		expect(spawns("broken")).toEqual([
			"acp --agent-engine=v2",
			"acp",
			"acp --agent-engine=v2",
			"acp",
		]);
		await client.whenTornDown();
	}, 30_000);

	it("V3 still shows 'Kiro CLI needs an update' and doesn't relaunch", async () => {
		const client = makeClient();
		const err = await client.initialize(config(oldCli, "v3")).then(
			() => null,
			(e: unknown) => e,
		);
		expect((err as { info?: { title?: string } }).info?.title).toBe(
			"Kiro CLI needs an update",
		);
		expect(spawns("old")).toEqual(["acp --agent-engine=v3"]);
		await client.whenTornDown();
	}, 30_000);
});
