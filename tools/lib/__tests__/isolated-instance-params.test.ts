// Parameterization of the isolated harness for long-lived smoke instances
// ([[Isolated smoke-test instances]] § Instance layout): path helpers take a
// parent folder, run markers take a key, teardown's signalling core is shared,
// preflight splits core from capture, and the focus guard never "restores"
// focus to the instance itself.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	RUN_PARENT,
	FocusGuard,
	matchRun,
	runDonePath,
	signalMarked,
	statePath,
	takeDonePath,
	takeLockPath,
	preflightIssues,
	type MarkedRow,
	type TeardownOps,
} from "../isolated-instance";

const L = "Tue Nov 10 20:41:00 2026";
const row = (pid: number, ppid: number, pgid: number, command: string, started = L): MarkedRow => ({ pid, ppid, pgid, started, command });

describe("path helpers take a parent", () => {
	it("default to RUN_PARENT, unchanged for screenshots", () => {
		expect(statePath("r1")).toBe(path.join(RUN_PARENT, "r1.state.json"));
		expect(takeLockPath("r1", 2)).toBe(path.join(RUN_PARENT, "r1.take2.teardown.lock"));
		expect(takeDonePath("r1", 2)).toBe(path.join(RUN_PARENT, "r1.take2.done"));
		expect(runDonePath("r1")).toBe(path.join(RUN_PARENT, "r1.done"));
	});
	it("use the given parent", () => {
		expect(statePath("st-a", "/x/.instances")).toBe("/x/.instances/st-a.state.json");
		expect(takeLockPath("st-a", 1, "/x")).toBe("/x/st-a.take1.teardown.lock");
	});
});

describe("matchRun marker key", () => {
	const rows = [
		row(200, 1, 200, "kiro-cli acp AC_SMOKE_RUN=st-a HOME=/x"),
		row(201, 1, 201, "kiro-cli acp AC_VIDEO_RUN=st-a HOME=/x"),
		row(202, 1, 202, "kiro-cli acp AC_SMOKE_RUN=st-ab"),
	];
	it("defaults to AC_VIDEO_RUN", () => {
		expect(matchRun(rows, { userData: "/u", runId: "st-a" }, new Set()).map((r) => r.pid)).toEqual([201]);
	});
	it("matches AC_SMOKE_RUN exactly when given", () => {
		expect(matchRun(rows, { userData: "/u", runId: "st-a", markerKey: "AC_SMOKE_RUN" }, new Set()).map((r) => r.pid)).toEqual([200]);
	});
});

describe("signalMarked", () => {
	let dir: string;
	let table: MarkedRow[];
	let kills: [number, string][];
	let closed = 0;
	const ud = "/i/userdata";
	const ops = (o: Partial<TeardownOps> = {}): TeardownOps => ({
		list: () => Promise.resolve(table),
		kill: (t, s) => {
			kills.push([t, s]);
			table = table.filter((r) => r.pid !== t && r.pgid !== -t);
		},
		sleep: () => Promise.resolve(),
		closeBrowser: () => {
			closed++;
			return Promise.resolve();
		},
		log: () => {},
		...o,
	});
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "signal-marked-"));
		kills = [];
		closed = 0;
		table = [
			row(11, 1, 11, "node st.ts down"),
			row(100, 1, 100, `Obsidian --user-data-dir=${ud}`),
			row(101, 100, 100, "helper"),
			row(500, 1, 500, "agent AC_SMOKE_RUN=st-a"),
		];
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	const markers = { userData: ud, runId: "st-a", markerKey: "AC_SMOKE_RUN" };

	it("takes the lock, closes the browser, signals groups, reports nothing left, keeps the lock", async () => {
		const lock = path.join(dir, "op.lock");
		const r = await signalMarked(markers, [11], ops(), { pid: 11, started: L }, lock);
		expect(r).toEqual({ status: "ok", left: [] });
		expect(closed).toBe(1);
		expect(kills).toEqual([[-100, "SIGTERM"], [-500, "SIGTERM"]]);
		expect(existsSync(lock)).toBe(true);
	});
	it("reports survivors after SIGKILL", async () => {
		const stuck = { ...ops(), kill: (t: number, s: NodeJS.Signals) => void kills.push([t, s]) };
		const r = await signalMarked(markers, [11], stuck, { pid: 11, started: L }, path.join(dir, "l"));
		expect(r.status).toBe("ok");
		expect(r.left.map((x) => x.pid).sort((a, b) => a - b)).toEqual([100, 101, 500]);
		expect(kills.filter(([, s]) => s === "SIGKILL").length).toBeGreaterThan(0);
	});
	it("is busy when a live process holds the lock", async () => {
		table.push(row(77, 1, 77, "other st"));
		const lock = path.join(dir, "l");
		const { acquireLock } = await import("../isolated-instance");
		acquireLock(lock, { pid: 77, started: L });
		const r = await signalMarked(markers, [11], ops(), { pid: 11, started: L }, lock);
		expect(r.status).toBe("busy");
		expect(kills).toEqual([]);
	});
	it("is unreadable (lock released) when the table never lists the caller", async () => {
		const lock = path.join(dir, "l");
		const r = await signalMarked(markers, [11], ops({ list: () => Promise.resolve([]) }), { pid: 11, started: L }, lock);
		expect(r.status).toBe("unreadable");
		expect(existsSync(lock)).toBe(false);
	});
	it("never signals the caller's ancestors even when they carry the marker", async () => {
		table = [row(5, 1, 5, "zsh AC_SMOKE_RUN=st-a"), row(11, 5, 5, "node st.ts AC_SMOKE_RUN=st-a")];
		const r = await signalMarked(markers, [11], ops(), { pid: 11, started: L }, path.join(dir, "l"));
		expect(r).toEqual({ status: "ok", left: [] });
		expect(kills).toEqual([]);
	});
});

describe("FocusGuard", () => {
	it("doesn't count or restore when its recorded last app is the instance itself", async () => {
		const activated: number[] = [];
		const g = new FocusGuard((p) => p === 42, () => {}, { frontmost: () => 42, activate: (p) => void activated.push(p) });
		await g.tick();
		await g.tick();
		expect(g.steals).toBe(0);
		expect(activated).toEqual([]);
	});
	it("restores the last other app and counts a steal", async () => {
		let front = 7;
		const activated: number[] = [];
		const g = new FocusGuard((p) => p === 42, () => {}, { frontmost: () => front, activate: (p) => void activated.push(p) });
		await g.tick();
		front = 42;
		await g.tick();
		expect(g.steals).toBe(1);
		expect(activated).toEqual([7]);
	});
});

describe("preflight split", () => {
	const ok = { platform: "darwin", appExists: true, psOk: true, frontmostOk: true, hasBin: () => true, sandboxed: false };
	it("core passes without ffmpeg", () => {
		expect(preflightIssues({ ...ok, hasBin: () => false }, "core")).toEqual([]);
	});
	it("capture needs ffmpeg and ffprobe", () => {
		expect(preflightIssues({ ...ok, hasBin: (b) => b !== "ffmpeg" }, "capture")).toEqual(["ffmpeg not found on PATH"]);
	});
	it("names ASBX and gives a paste-ready command when ps is blocked in the sandbox", () => {
		const p = preflightIssues({ ...ok, psOk: false, sandboxed: true }, "core", "npx tsx tools/smoke-test/st.ts up a");
		expect(p).toHaveLength(1);
		expect(p[0]).toContain("ASBX agent sandboxing");
		expect(p[0]).toContain("npx tsx tools/smoke-test/st.ts up a");
	});
});
