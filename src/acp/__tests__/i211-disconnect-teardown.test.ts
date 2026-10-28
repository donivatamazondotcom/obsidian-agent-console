/**
 * Reproduce-first tests for I211: disconnect() does not close stdin, does not
 * escalate to SIGKILL, and cannot reach MCP servers in their own process
 * groups.
 *
 * Measured on Kiro V2 (2026-10-27): closing a tab kills kiro-cli-chat but
 * leaves one ppid-1 `prex-trino-mcp` Python process per MCP set. The Toolbox
 * shim leads its own process group; the Python server is its child in that
 * group and ignores stdin EOF. A SIGTERM to OUR group never reaches it, and
 * once its shim dies it is reparented to pid 1, out of reach of any later
 * tree walk.
 *
 * Seam: the public `disconnect()` (and the I194 reconcile path). Boundary:
 * the OS — `process.kill` is routed into a simulated process table, and the
 * process lister is injected. No real signal is ever sent.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { ChildProcess } from "child_process";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";
import type { ProcessOps, ProcessRow } from "../process-teardown";

type SimProc = ProcessRow & {
	alive: boolean;
	ignoresTerm: boolean;
	/** Dies when its parent dies (e.g. an MCP shim its agent shuts down). */
	diesWithParent: boolean;
};

/** A tiny process table that models signals, groups, and reparenting. */
class ProcessTable {
	procs = new Map<number, SimProc>();
	signals: Array<{ target: number; sig: string }> = [];

	add(p: Partial<SimProc> & { pid: number; ppid: number; pgid: number }) {
		this.procs.set(p.pid, {
			started: `t-${p.pid}`,
			alive: true,
			ignoresTerm: false,
			diesWithParent: false,
			...p,
		});
	}

	alive(pid: number): boolean {
		return this.procs.get(pid)?.alive ?? false;
	}

	private die(pid: number) {
		const p = this.procs.get(pid);
		if (!p || !p.alive) return;
		p.alive = false;
		for (const c of this.procs.values()) {
			if (!c.alive || c.ppid !== pid) continue;
			if (c.diesWithParent) this.die(c.pid);
			else c.ppid = 1; // reparented to launchd
		}
	}

	private deliver(p: SimProc, sig: string) {
		if (sig === "0") return;
		if (sig === "SIGTERM" && p.ignoresTerm) return;
		this.die(p.pid);
	}

	kill = (target: number, sig: string | number = "SIGTERM"): true => {
		const s = String(sig);
		this.signals.push({ target, sig: s });
		const victims =
			target < 0
				? [...this.procs.values()].filter(
						(p) => p.alive && p.pgid === -target,
					)
				: [this.procs.get(target)].filter(
						(p): p is SimProc => !!p && p.alive,
					);
		if (victims.length === 0) {
			const err = new Error("kill ESRCH") as NodeJS.ErrnoException;
			err.code = "ESRCH";
			throw err;
		}
		for (const v of victims) this.deliver(v, s);
		return true;
	};

	rows(): ProcessRow[] {
		return [...this.procs.values()]
			.filter((p) => p.alive)
			.map(({ pid, ppid, pgid, started }) => ({ pid, ppid, pgid, started }));
	}
}

/**
 * The Kiro V2 shape that leaks:
 *   5000 toolbox shim (our spawned pid, group leader 5000)
 *   └ 5001 kiro-cli-chat (group 5000)
 *     └ 5002 prex-trino-mcp shim (own group 5002, dies with its parent)
 *       └ 5003 python server (group 5002, ignores EOF, no signal reaches it)
 * plus 9000, an unrelated process the teardown must never touch.
 */
function v2Table(opts: { chatIgnoresTerm: boolean }): ProcessTable {
	const t = new ProcessTable();
	t.add({ pid: 5000, ppid: 777, pgid: 5000 });
	t.add({
		pid: 5001,
		ppid: 5000,
		pgid: 5000,
		ignoresTerm: opts.chatIgnoresTerm,
	});
	t.add({ pid: 5002, ppid: 5001, pgid: 5002, diesWithParent: true });
	t.add({ pid: 5003, ppid: 5002, pgid: 5002 });
	t.add({ pid: 9000, ppid: 1, pgid: 9000 });
	return t;
}

const OUR_TREE = [5000, 5001, 5002, 5003];

type Internals = {
	agentProcess: ChildProcess | null;
	connection: unknown;
	isInitializedFlag: boolean;
	currentSessionId: string | null;
	processOps: ProcessOps;
	reconcileProcessGone: (proc: ChildProcess) => void;
	whenTornDown?: () => Promise<void>;
};

function setup(
	table: ProcessTable,
	listImpl?: (call: number) => Promise<ProcessRow[]>,
) {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const c = client as unknown as Internals;

	vi.spyOn(process, "kill").mockImplementation(
		table.kill as unknown as typeof process.kill,
	);

	let calls = 0;
	const sleeps: number[] = [];
	c.processOps = {
		listProcesses: () =>
			listImpl ? listImpl(calls++) : Promise.resolve(table.rows()),
		sleep: (ms: number) => {
			sleeps.push(ms);
			return Promise.resolve();
		},
	};

	const stdinEnd = vi.fn();
	const proc = {
		pid: 5000,
		kill: vi.fn(),
		stdin: { end: stdinEnd },
	} as unknown as ChildProcess;
	c.agentProcess = proc;
	c.connection = { agent: {} };
	c.isInitializedFlag = true;
	c.currentSessionId = "sess-1";

	const settle = () => c.whenTornDown?.() ?? Promise.resolve();
	return { client, c, proc, stdinEnd, sleeps, settle };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("I211: agent teardown reaps the whole tree", () => {
	it("disconnect closes stdin and leaves nothing from our tree alive, even an MCP server in its own group", async () => {
		const table = v2Table({ chatIgnoresTerm: false });
		const { client, stdinEnd, settle } = setup(table);

		await client.disconnect();
		await settle();

		expect(stdinEnd).toHaveBeenCalledTimes(1);
		const survivors = OUR_TREE.filter((pid) => table.alive(pid));
		expect(survivors).toEqual([]);
		// Unrelated process untouched and never signaled.
		expect(table.alive(9000)).toBe(true);
		expect(table.signals.some((s) => Math.abs(s.target) === 9000)).toBe(
			false,
		);
		// State cleared immediately for the caller.
		expect(client.isInitialized()).toBe(false);
	});

	it("escalates to SIGKILL after the grace period when the agent ignores SIGTERM", async () => {
		const table = v2Table({ chatIgnoresTerm: true });
		const { client, sleeps, settle } = setup(table);

		await client.disconnect();
		await settle();

		expect(table.alive(5001)).toBe(false);
		expect(OUR_TREE.filter((pid) => table.alive(pid))).toEqual([]);
		// A real grace period was waited before escalating. Since I230 the
		// grace is polled in steps, so assert the total wait, not one sleep.
		expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2000);
		expect(
			table.signals.some((s) => s.target === 5001 && s.sig === "SIGKILL"),
		).toBe(true);
	});

	it("does not SIGKILL anything when the whole tree exits on SIGTERM", async () => {
		// No orphan-prone MCP: a well-behaved tree that dies on SIGTERM.
		const table = new ProcessTable();
		table.add({ pid: 5000, ppid: 777, pgid: 5000 });
		table.add({ pid: 5001, ppid: 5000, pgid: 5000 });
		const { client, settle } = setup(table);

		await client.disconnect();
		await settle();

		expect(table.alive(5000)).toBe(false);
		expect(table.alive(5001)).toBe(false);
		expect(table.signals.filter((s) => s.sig === "SIGKILL")).toEqual([]);
	});

	it("never kills a pid that was reused by an unrelated process during the grace period", async () => {
		const table = v2Table({ chatIgnoresTerm: false });
		const { client, settle } = setup(table, (call) => {
			if (call === 0) return Promise.resolve(table.rows());
			// After the snapshot, the orphan exits on its own and an unrelated
			// process takes its pid with a different start time.
			const orphan = table.procs.get(5003)!;
			orphan.alive = false;
			table.add({ pid: 5003, ppid: 1, pgid: 5003, started: "reused" });
			return Promise.resolve(table.rows());
		});

		await client.disconnect();
		await settle();

		expect(table.alive(5003)).toBe(true);
		expect(table.procs.get(5003)!.started).toBe("reused");
		expect(table.signals.some((s) => s.target === 5003)).toBe(false);
	});

	it("falls back to a group SIGKILL when the process list is unavailable", async () => {
		const table = v2Table({ chatIgnoresTerm: true });
		const { client, settle } = setup(table, () =>
			Promise.reject(new Error("ps: Operation not permitted")),
		);

		await client.disconnect();
		await settle();

		// Our own group is still reaped; only the foreign-group orphan is out
		// of reach without a snapshot.
		expect(table.alive(5000)).toBe(false);
		expect(table.alive(5001)).toBe(false);
		expect(table.alive(9000)).toBe(true);
	});

	it("the I194 reconcile path runs the same teardown", async () => {
		const table = v2Table({ chatIgnoresTerm: false });
		const { c, proc, stdinEnd, settle } = setup(table);

		c.reconcileProcessGone(proc);
		await settle();

		expect(stdinEnd).toHaveBeenCalled();
		expect(OUR_TREE.filter((pid) => table.alive(pid))).toEqual([]);
	});
});

describe("I211: ps snapshot parsing", () => {
	it("parses macOS `ps -axo pid=,ppid=,pgid=,lstart=` lines and walks only our tree", async () => {
		const { parsePsOutput, collectDescendants } = await import(
			"../process-teardown"
		);
		// Shape copied from a live `ps` on 2026-10-27 (pids changed).
		const stdout = [
			"  977     1   939 Mon Oct 26 18:49:42 2026",
			"29388 33983 29388 Tue Oct 27 19:24:05 2026",
			"29488 29388 29388 Tue Oct 27 19:24:06 2026",
			"29963 29488 29963 Tue Oct 27 19:24:17 2026",
			"29964 29963 29963 Tue Oct 27 19:24:17 2026",
			"",
		].join("\n");

		const rows = parsePsOutput(stdout);
		expect(rows[3]).toEqual({
			pid: 29963,
			ppid: 29488,
			pgid: 29963,
			started: "Tue Oct 27 19:24:17 2026",
		});
		expect(
			collectDescendants(rows, 29388)
				.map((r) => r.pid)
				.sort(),
		).toEqual([29388, 29488, 29963, 29964]);
	});
});
