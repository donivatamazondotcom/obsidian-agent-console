// smoke-test-spawn.sh: the flag checks and the non-isolated half of the mode
// guard run before any build, so they are tested against the real script in
// a throwaway git repo. Spec: [[Isolated smoke-test instances]] § Behavior.
//
// Containment: the script runs with a fake HOME and with stub `open`,
// `obsidian` and `npm` first on PATH, so even a missing guard (the red run)
// can't reach the user's Obsidian, its vault list or a real build. A real
// red run without these stubs opened obsidian://open?vault=ST-wt in the
// user's Obsidian (2026-11-16).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../smoke-test-spawn.sh");

describe("smoke-test-spawn.sh flags and non-isolated mode guard", () => {
	let repo: string;
	let script: string;
	let studio: string;
	let home: string;
	let bin: string;
	const stubLog = () => join(bin, "calls.log");
	const run = (...args: string[]) =>
		spawnSync("bash", [script, ...args], { encoding: "utf8", timeout: 20_000, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` } });
	const stubCalls = () => (existsSync(stubLog()) ? readFileSync(stubLog(), "utf8") : "");

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "smoke-spawn-iso-"));
		spawnSync("git", ["init", "-q", repo]);
		mkdirSync(join(repo, "tools/smoke-test"), { recursive: true });
		script = join(repo, "tools/smoke-test/smoke-test-spawn.sh");
		copyFileSync(SCRIPT, script);
		chmodSync(script, 0o755);
		mkdirSync(join(repo, ".trees/wt"), { recursive: true });
		spawnSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "x"]);
		spawnSync("git", ["-C", repo, "worktree", "add", "-q", "--detach", ".trees/wt2"]);
		studio = join(repo, "tools/smoke-test/studios/ST-wt");
		home = join(repo, "fake-home");
		mkdirSync(join(home, "Library/Application Support/obsidian"), { recursive: true });
		writeFileSync(join(home, "Library/Application Support/obsidian/obsidian.json"), JSON.stringify({ vaults: {} }));
		bin = join(repo, "stub-bin");
		mkdirSync(bin);
		for (const name of ["open", "obsidian", "npm"]) {
			writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${join(bin, "calls.log")}"\nexit 1\n`);
			chmodSync(join(bin, name), 0o755);
		}
	});
	afterEach(() => rmSync(repo, { recursive: true, force: true }));

	it("rejects --isolated with --first-run, with the reason", () => {
		const r = run("wt", "--isolated", "--first-run");
		expect(r.status).toBe(2);
		expect(r.stderr).toMatch(/--isolated can't be combined with --first-run/);
		expect(stubCalls()).toBe("");
	});

	it("refuses a non-isolated spawn of a studio with AC_SMOKE_RUN agent env rows", () => {
		const plug = join(studio, ".obsidian/plugins/agent-console");
		mkdirSync(plug, { recursive: true });
		writeFileSync(join(studio, ".obsidian/app.json"), "{}");
		writeFileSync(join(plug, "data.json"), JSON.stringify({ kiro: { env: [{ key: "AC_SMOKE_RUN", value: "st-wt" }] } }));
		const r = run("wt");
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/isolated/);
		expect(r.stdout + r.stderr).not.toMatch(/building plugin/);
		expect(stubCalls()).not.toMatch(/^open /m);
	});

	it("refuses a non-isolated spawn while the studio has isolated instance state", () => {
		mkdirSync(join(repo, "tools/smoke-test/studios/.instances/ST-wt"), { recursive: true });
		writeFileSync(join(repo, "tools/smoke-test/studios/.instances/ST-wt/state.json"), "{}");
		mkdirSync(studio, { recursive: true });
		const r = run("wt");
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/st\.ts down wt|smoke-test-teardown/);
		expect(stubCalls()).not.toMatch(/^(open|npm) /m);
	});
});
