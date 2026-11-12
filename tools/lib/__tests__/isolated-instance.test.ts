import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
	stageAppAsar,
	finishTake,
	signalGate,
	assertClean,
	listMarkedProcesses,
	type MarkedRow,
	type RunState,
	type TeardownOps,
} from "../isolated-instance";

const L = "Tue Nov 10 20:41:00 2026";
const row = (pid: number, ppid: number, pgid: number, command: string, started = L): MarkedRow => ({ pid, ppid, pgid, started, command });

describe("listMarkedProcesses — locale", () => {
	it("parses an en_GB-formatted line as nothing, which is why the listing forces LC_ALL=C", () => {
		expect(parseMarkerPs("  4242     1  4242 Wed 11 Nov 16:00:17 2026     node x")).toEqual([]);
	});
	it("still lists this process when the caller's locale isn't C or en_US", async () => {
		const prev = process.env.LC_ALL;
		process.env.LC_ALL = "en_GB.UTF-8";
		try {
			const rows = await listMarkedProcesses();
			expect(rows.some((r) => r.pid === process.pid)).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.LC_ALL;
			else process.env.LC_ALL = prev;
		}
	});
});

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
	it("retries a failed process listing and still signals the run", async () => {
		let calls = 0;
		const flaky = { ...ops(), list: () => (++calls <= 2 ? Promise.reject(new Error("ps failed")) : Promise.resolve(table)) };
		expect(await teardownTake(state(), { pid: 11, started: L }, flaky)).toBe(true);
		expect(kills).toEqual([[-100, "SIGTERM"], [-500, "SIGTERM"]]);
		expect(existsSync(takeDonePath(runId, 1))).toBe(true);
	});
	it("leaves the take unfinished and its lock released when processes can't be listed at all", async () => {
		const broken = { ...ops(), list: () => Promise.reject(new Error("ps failed")) };
		expect(await teardownTake(state(), { pid: 11, started: L }, broken)).toBe(false);
		expect(kills).toEqual([]);
		expect(existsSync(takeDonePath(runId, 1))).toBe(false);
		expect(existsSync(takeLockPath(runId, 1))).toBe(false);
	});
	it("doesn't break a lock when it can't list processes to check the holder", async () => {
		acquireLock(takeLockPath(runId, 1), { pid: 77777, started: L });
		const broken = { ...ops(), list: () => Promise.reject(new Error("ps failed")) };
		expect(await teardownTake(state(), { pid: 12, started: L }, broken)).toBe(false);
		expect(existsSync(takeLockPath(runId, 1))).toBe(true);
	});
	it("finishTake retries until a live holder's lock is gone, then tears down", async () => {
		acquireLock(takeLockPath(runId, 1), { pid: 11, started: L });
		let polls = 0;
		const o = { ...ops(), sleep: () => { if (++polls === 2) table = table.filter((r) => r.pid !== 11); return Promise.resolve(); } };
		expect(await finishTake(state(), { pid: 12, started: L }, o)).toBe(true);
		expect(kills.length).toBeGreaterThan(0);
		expect(existsSync(takeDonePath(runId, 1))).toBe(true);
	});
	it("finishTake does nothing when the take is already done", async () => {
		writeFileSync(takeDonePath(runId, 1), "");
		expect(await finishTake(state(), { pid: 12, started: L }, ops())).toBe(true);
		expect(kills).toEqual([]);
	});
	it("treats a listing that doesn't include the caller as unreadable: no signals, no done marker", async () => {
		const foreign = { ...ops(), list: () => Promise.resolve(table.filter((r) => r.pid !== 11)) };
		expect(await teardownTake(state(), { pid: 11, started: L }, foreign)).toBe(false);
		expect(kills).toEqual([]);
		expect(existsSync(takeDonePath(runId, 1))).toBe(false);
		const empty = { ...ops(), list: () => Promise.resolve([] as MarkedRow[]) };
		expect(await teardownTake(state(), { pid: 11, started: L }, empty)).toBe(false);
		expect(existsSync(takeDonePath(runId, 1))).toBe(false);
	});
	it("finishTake stops at its deadline, not after a fixed number of tries, and calls closeBrowser once", async () => {
		let t = 0;
		let closes = 0;
		const o = { ...ops(), list: () => Promise.reject(new Error("ps failed")), closeBrowser: () => { closes++; return Promise.resolve(); }, sleep: (ms: number) => { t += ms; return Promise.resolve(); }, now: () => t };
		expect(await finishTake(state(), { pid: 12, started: L }, o, 10_000)).toBe(false);
		expect(t).toBeLessThanOrEqual(12_000);
		expect(closes).toBe(1);
	});
	it("keeps a live holder's lock when its recorded start time is empty", () => {
		const f = takeLockPath(runId, 1);
		acquireLock(f, { pid: 11, started: "" });
		expect(breakStaleLock(f, table)).toBe(false);
		expect(existsSync(f)).toBe(true);
	});
	it("still signals and cleans up when closing the browser fails", async () => {
		const failing = { ...ops(), closeBrowser: () => Promise.reject(new Error("Target page, context or browser has been closed")) };
		expect(await teardownTake(state(), { pid: 11, started: L }, failing)).toBe(true);
		expect(kills).toEqual([[-100, "SIGTERM"], [-500, "SIGTERM"]]);
		expect(existsSync(runRoot)).toBe(false);
		expect(existsSync(takeDonePath(runId, 1))).toBe(true);
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

describe("stageAppAsar", () => {
	it("copies the asar into the user-data folder under its own name", () => {
		const d = mkdtempSync(path.join(tmpdir(), "stage-"));
		const src = path.join(d, "obsidian-1.15.0.asar");
		const ud = path.join(d, "userdata");
		mkdirSync(ud);
		writeFileSync(src, "app");
		expect(stageAppAsar(src, ud)).toBe(path.join(ud, "obsidian-1.15.0.asar"));
		expect(readFileSync(path.join(ud, "obsidian-1.15.0.asar"), "utf8")).toBe("app");
		rmSync(d, { recursive: true, force: true });
	});
});

describe("assertClean — unreadable process table", () => {
	it("reports a problem when the listing doesn't include this process", async () => {
		const st = { runId: "rx", runRoot: "/tmp/x", userData: "/tmp/x/userdata", take: 1, takeStartedAt: 0, perTakeMs: 1, runDeadline: 1, recorderPid: 1 } as RunState;
		const problems = await assertClean(st, () => Promise.resolve([]));
		expect(problems.join("\n")).toMatch(/couldn't read the process table/);
	});
});

describe("signalGate", () => {
	it("treats the duplicate SIGINT tsx relays ~30 ms after a Ctrl-C as the same signal", () => {
		let t = 0;
		const gate = signalGate(() => t);
		expect(gate()).toBe("start");
		t = 30;
		expect(gate()).toBe("ignore");
	});
	it("exits on a second Ctrl-C more than a second later", () => {
		let t = 0;
		const gate = signalGate(() => t);
		expect(gate()).toBe("start");
		t = 1500;
		expect(gate()).toBe("exit");
	});
});
