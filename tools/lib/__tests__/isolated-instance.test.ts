import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	RUN_PARENT,
	acquireLock,
	ancestors,
	breakStaleLock,
	matchRun,
	parseMarkerPs,
	planSignals,
	readState,
	statePath,
	takeDonePath,
	takeLockPath,
	teardownTake,
	writeState,
	removeRunFiles,
	type MarkedRow,
	type RunState,
	type TeardownOps,
} from "../isolated-instance";

const L = "Tue Nov 10 20:41:00 2026";
const row = (pid: number, ppid: number, pgid: number, command: string, started = L): MarkedRow => ({ pid, ppid, pgid, started, command });

describe("parseMarkerPs", () => {
	it("splits lstart by position and keeps args plus env intact", () => {
		const out = [
			`  101     1   101 ${L} /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=/tmp/agent-console-video/r1/userdata`,
			`  202   101   202 Tue Nov  3 09:05:07 2026 node agent.js HOME=/Users/a b AC_VIDEO_RUN=r1 X=1`,
			"garbage line",
		].join("\n");
		const rows = parseMarkerPs(out);
		expect(rows).toHaveLength(2);
		expect(rows[0].started).toBe(L);
		expect(rows[1].started).toBe("Tue Nov  3 09:05:07 2026");
		expect(rows[1].command).toBe("node agent.js HOME=/Users/a b AC_VIDEO_RUN=r1 X=1");
	});
});

describe("matchRun", () => {
	const ud = "/tmp/agent-console-video/r1/userdata";
	const rows = [
		row(10, 1, 10, "zsh"),
		row(11, 10, 11, "node recorder.ts"),
		row(12, 1, 12, "node isolated-watchdog.ts /tmp/agent-console-video/r1.state.json"),
		row(100, 1, 100, `Obsidian --user-data-dir=${ud}`),
		row(101, 100, 100, "Obsidian Helper (GPU) --type=gpu-process"),
		row(200, 100, 200, "kiro-cli acp AC_VIDEO_RUN=r1 HOME=/x"),
		row(201, 200, 200, "mcp-server"),
		row(300, 1, 300, `Obsidian --user-data-dir=${ud}-other`),
		row(301, 1, 301, "node thing AC_VIDEO_RUN=r10"),
	];
	it("matches exact tokens and descendants, never the recorder or watchdog", () => {
		const exclude = new Set([...ancestors(rows, 11), ...ancestors(rows, 12)]);
		const m = matchRun(rows, { userData: ud, runId: "r1" }, exclude).map((r) => r.pid).sort((a, b) => a - b);
		expect(m).toEqual([100, 101, 200, 201]);
	});
	it("excludes a recorder that carries the marker", () => {
		const r2 = [...rows, row(13, 11, 11, "node child AC_VIDEO_RUN=r1")];
		const m = matchRun(r2, { userData: ud, runId: "r1" }, new Set([...ancestors(r2, 11), 13]));
		expect(m.map((r) => r.pid)).not.toContain(13);
	});
	it("signals a group only when its leader matched", () => {
		const plan = planSignals([row(100, 1, 100, "a"), row(101, 100, 100, "b"), row(400, 1, 11, "c")]);
		expect(plan.groups).toEqual([100]);
		expect(plan.pids).toEqual([400]);
	});
});

describe("locks and state", () => {
	const runId = `rtest${process.pid}`;
	beforeEach(() => mkdirSync(RUN_PARENT, { recursive: true }));
	afterEach(() => removeRunFiles(runId));

	it("exclusive lock; a stale holder is broken, a live one is not", () => {
		const f = takeLockPath(runId, 1);
		expect(acquireLock(f, { pid: 999999, started: L })).toBe(true);
		expect(acquireLock(f, { pid: 1, started: L })).toBe(false);
		expect(breakStaleLock(f, [row(999999, 1, 1, "x", L)])).toBe(false);
		expect(breakStaleLock(f, [row(999999, 1, 1, "x", "Wed Nov 11 01:00:00 2026")])).toBe(true);
		expect(existsSync(f)).toBe(false);
	});
	it("state round-trips atomically and reads null while missing", () => {
		expect(readState(statePath(runId))).toBeNull();
		const s = { runId, take: 2 } as RunState;
		writeState(s);
		expect(readState(statePath(runId))?.take).toBe(2);
	});
});

describe("teardownTake", () => {
	const runId = `rtd${process.pid}`;
	const runRoot = path.join(RUN_PARENT, runId);
	const ud = path.join(runRoot, "userdata");
	let table: MarkedRow[];
	let kills: [number, string][];
	const ops = (): TeardownOps => ({
		list: () => Promise.resolve(table),
		kill: (t, s) => {
			kills.push([t, s]);
			table = table.filter((r) => r.pid !== t && r.pgid !== -t);
		},
		sleep: () => Promise.resolve(),
		closeBrowser: () => Promise.resolve(),
		log: () => {},
	});
	const state = (): RunState => ({ runId, runRoot, userData: ud, take: 1, takeStartedAt: 0, perTakeMs: 1, runDeadline: 1, recorderPid: 11, watchdogPid: 12 });
	beforeEach(() => {
		mkdirSync(ud, { recursive: true });
		writeFileSync(path.join(ud, "x"), "");
		kills = [];
		table = [
			row(11, 1, 11, "node recorder"),
			row(12, 1, 12, "watchdog"),
			row(100, 1, 100, `Obsidian --user-data-dir=${ud}`),
			row(101, 100, 100, "helper"),
			row(500, 1, 500, "orphaned mcp AC_VIDEO_RUN=" + runId),
		];
	});
	afterEach(() => removeRunFiles(runId));

	it("signals the run's groups, removes the take folder, marks the take done", async () => {
		expect(await teardownTake(state(), { pid: 11, started: L }, ops())).toBe(true);
		expect(kills).toEqual([[-100, "SIGTERM"], [-500, "SIGTERM"]]);
		expect(existsSync(runRoot)).toBe(false);
		expect(existsSync(takeDonePath(runId, 1))).toBe(true);
		expect(readState(statePath(runId))).toBeNull();
	});
	it("a second caller with the lock held by a live process does nothing", async () => {
		acquireLock(takeLockPath(runId, 1), { pid: 12, started: L });
		expect(await teardownTake(state(), { pid: 11, started: L }, ops())).toBe(false);
		expect(kills).toEqual([]);
	});
	it("breaks a dead holder's lock and tears down", async () => {
		acquireLock(takeLockPath(runId, 1), { pid: 77777, started: L });
		expect(await teardownTake(state(), { pid: 12, started: L }, ops())).toBe(true);
		expect(kills.length).toBeGreaterThan(0);
	});
	it("keeps the state file across a take teardown", async () => {
		writeState(state());
		await teardownTake(state(), { pid: 11, started: L }, ops());
		expect(readState(statePath(runId))?.runId).toBe(runId);
	});
});
