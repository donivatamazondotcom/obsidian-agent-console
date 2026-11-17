// smoke-test-teardown.sh with isolated instances: st down first (studio kept
// on failure), Kiro V2 record cleanup after the delete (non-fatal, never an
// empty path), and a missing studio still deregisters.
// Contained: fake HOME, ST_TSX pointing at a stub that logs its arguments.
// Spec: [[Isolated smoke-test instances]] § Teardown.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../smoke-test-teardown.sh");

describe("smoke-test-teardown.sh — isolated instances and Kiro cleanup", () => {
	let repo: string;
	let script: string;
	let home: string;
	let studio: string;
	let inst: string;
	let stub: string;
	let calls: string;
	const cfg = () => join(home, "Library/Application Support/obsidian/obsidian.json");
	/** The stub exits with `codes[cmd]` (default 0) and logs "<cmd> <args>". */
	const writeStub = (codes: Record<string, number> = {}) => {
		const cases = Object.entries(codes).map(([c, n]) => `  ${c}) exit ${n} ;;`).join("\n");
		writeFileSync(stub, `#!/bin/bash\nshift\necho "$*" >> "${calls}"\ncase "$1" in\n${cases}\n  *) exit 0 ;;\nesac\n`);
		chmodSync(stub, 0o755);
	};
	const run = (...args: string[]) => spawnSync("bash", [script, ...args], { encoding: "utf8", timeout: 20_000, env: { ...process.env, HOME: home, ST_TSX: stub } });
	const logged = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "smoke-td-iso-"));
		spawnSync("git", ["init", "-q", repo]);
		mkdirSync(join(repo, "tools/smoke-test"), { recursive: true });
		script = join(repo, "tools/smoke-test/smoke-test-teardown.sh");
		copyFileSync(SCRIPT, script);
		home = join(repo, "home");
		mkdirSync(join(home, "Library/Application Support/obsidian"), { recursive: true });
		studio = join(repo, "tools/smoke-test/studios/ST-wt");
		inst = join(repo, "tools/smoke-test/studios/.instances/ST-wt");
		writeFileSync(cfg(), JSON.stringify({ vaults: { abc: { path: studio, ts: 1 } } }));
		stub = join(repo, "tsx-stub");
		calls = join(repo, "calls.log");
	});
	afterEach(() => rmSync(repo, { recursive: true, force: true }));

	it("isolated: st down, then delete, then _clean-kiro with both path forms", () => {
		writeStub();
		mkdirSync(studio, { recursive: true });
		mkdirSync(inst, { recursive: true });
		const r = run("wt");
		expect(r.status).toBe(0);
		expect(existsSync(studio)).toBe(false);
		const lines = logged().trim().split("\n");
		expect(lines[0]).toBe("down wt");
		expect(lines[1]).toMatch(/^_clean-kiro wt --path \S+ST-wt --path \S+ST-wt$/);
		expect(JSON.parse(readFileSync(cfg(), "utf8")).vaults).toEqual({});
	});

	it("routes a leftover trash folder through st down even without an instance folder", () => {
		writeStub();
		mkdirSync(studio, { recursive: true });
		mkdirSync(join(repo, "tools/smoke-test/studios/.instances/.trash-ST-wt-123-456"), { recursive: true });
		const r = spawnSync("/bin/bash", [script, "wt"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, HOME: home, ST_TSX: stub } });
		expect(r.status).toBe(0);
		expect(logged().trim().split("\n")[0]).toBe("down wt");
	});

	it("ignores a sibling worktree's trash folder (ST-wt vs ST-wt-100)", () => {
		mkdirSync(studio, { recursive: true });
		mkdirSync(join(repo, "tools/smoke-test/studios/.instances/.trash-ST-wt-100-123-456"), { recursive: true });
		writeStub();
		let r = run("wt");
		expect(r.status).toBe(0);
		expect(logged()).not.toMatch(/^down wt$/m);
		mkdirSync(studio, { recursive: true });
		r = spawnSync("/bin/bash", [script, "wt"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, HOME: home, ST_TSX: join(repo, "nope") } });
		expect(r.status).toBe(0);
		expect(existsSync(studio)).toBe(false);
	});

	it("keeps the studio and exits non-zero when st down fails", () => {
		writeStub({ down: 1 });
		mkdirSync(studio, { recursive: true });
		mkdirSync(inst, { recursive: true });
		const r = run("wt");
		expect(r.status).not.toBe(0);
		expect(existsSync(studio)).toBe(true);
		expect(logged()).not.toMatch(/_clean-kiro/);
	});

	it("a failing _clean-kiro only warns: studio deleted, exit 0", () => {
		writeStub({ "_clean-kiro": 1 });
		mkdirSync(studio, { recursive: true });
		const r = run("wt");
		expect(r.status).toBe(0);
		expect(existsSync(studio)).toBe(false);
		expect(r.stdout + r.stderr).toMatch(/Kiro session cleanup failed/);
	});

	it("a missing studio still deregisters and never passes an empty path", () => {
		writeStub();
		const r = run("wt");
		expect(r.status).toBe(0);
		expect(JSON.parse(readFileSync(cfg(), "utf8")).vaults).toEqual({});
		expect(logged()).not.toMatch(/--path ( |$)/);
		expect(logged()).toMatch(/--path \S+ST-wt/);
	});

	it("a missing tsx skips the cleanup with a warning", () => {
		mkdirSync(studio, { recursive: true });
		const r = spawnSync("bash", [script, "wt"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, HOME: home, ST_TSX: join(repo, "nope") } });
		expect(r.status).toBe(0);
		expect(existsSync(studio)).toBe(false);
		expect(r.stdout + r.stderr).toMatch(/tsx not found/);
	});
});
