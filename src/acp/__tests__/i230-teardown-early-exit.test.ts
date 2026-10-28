/**
 * I230 — `teardownProcessTree` settles as soon as the old tree is gone,
 * instead of always sleeping the full grace period.
 *
 * Soft reload now waits for the teardown before resuming (the old process
 * holds the session lock). With a fixed 2.5 s sleep, every reload on every
 * agent would pay 2.5 s even when the tree exits in milliseconds. The
 * teardown polls the snapshot during the grace period and returns once
 * nothing from it is alive; anything still alive at the deadline is
 * SIGKILLed exactly as before (I211).
 *
 * Seam: the exported `teardownProcessTree` with injected process ops (the
 * module's declared OS boundary). `process.kill` is routed to a simulated
 * table; no real signal is sent.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	teardownProcessTree,
	TEARDOWN_GRACE_MS,
	type ProcessOps,
	type ProcessRow,
} from "../process-teardown";

interface Sim {
	alive: Set<number>;
	/** pid → how many polls it survives a SIGTERM for (Infinity = ignores). */
	termDelay: Map<number, number>;
	termed: Set<number>;
	signals: Array<{ target: number; sig: string }>;
}

const ROWS: ProcessRow[] = [
	{ pid: 5000, ppid: 777, pgid: 5000, started: "a" },
	{ pid: 5001, ppid: 5000, pgid: 5000, started: "b" },
];

function setup(termDelay: Record<number, number>) {
	const sim: Sim = {
		alive: new Set([5000, 5001]),
		termDelay: new Map(
			Object.entries(termDelay).map(([k, v]) => [Number(k), v]),
		),
		termed: new Set(),
		signals: [],
	};
	vi.spyOn(process, "kill").mockImplementation(((
		target: number,
		sig: string,
	) => {
		sim.signals.push({ target, sig: String(sig) });
		const pids = target < 0 ? [...sim.alive] : [target];
		for (const pid of pids) {
			if (!sim.alive.has(pid)) continue;
			if (sig === "SIGKILL") sim.alive.delete(pid);
			else if (sig === "SIGTERM") {
				if ((sim.termDelay.get(pid) ?? 0) === 0) sim.alive.delete(pid);
				else sim.termed.add(pid);
			}
		}
		return true;
	}) as unknown as typeof process.kill);

	let listCalls = 0;
	const sleeps: number[] = [];
	const ops: ProcessOps = {
		listProcesses: () => {
			listCalls += 1;
			return Promise.resolve(ROWS.filter((r) => sim.alive.has(r.pid)));
		},
		sleep: (ms: number) => {
			sleeps.push(ms);
			// Time passes: a SIGTERMed pid with a finite delay counts down.
			for (const pid of [...sim.termed]) {
				const left = (sim.termDelay.get(pid) ?? 0) - 1;
				sim.termDelay.set(pid, left);
				if (left <= 0) {
					sim.alive.delete(pid);
					sim.termed.delete(pid);
				}
			}
			return Promise.resolve();
		},
	};
	const logger = { log: vi.fn(), warn: vi.fn() };
	return { sim, ops, logger, sleeps, listCalls: () => listCalls };
}

afterEach(() => vi.restoreAllMocks());

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("I230: teardown settles as soon as the tree exits", () => {
	it("returns after the first poll when the tree dies on SIGTERM, without waiting the full grace", async () => {
		const { sim, ops, logger, sleeps } = setup({});

		await teardownProcessTree({ pid: 5000 }, ops, logger);

		expect(sim.alive.size).toBe(0);
		expect(total(sleeps)).toBeLessThan(TEARDOWN_GRACE_MS);
		expect(sim.signals.filter((s) => s.sig === "SIGKILL")).toEqual([]);
		expect(logger.log).toHaveBeenCalledWith(
			expect.stringContaining("tree exited cleanly"),
		);
	});

	it("waits only as long as the slowest process takes to exit", async () => {
		// The child takes three polls to exit after SIGTERM.
		const { sim, ops, logger, sleeps } = setup({ 5001: 3 });

		await teardownProcessTree({ pid: 5000 }, ops, logger);

		expect(sim.alive.size).toBe(0);
		expect(sleeps.length).toBe(3);
		expect(total(sleeps)).toBeLessThan(TEARDOWN_GRACE_MS);
		expect(sim.signals.filter((s) => s.sig === "SIGKILL")).toEqual([]);
	});

	it("still escalates to SIGKILL at the grace deadline, with a bounded number of process listings", async () => {
		const { sim, ops, logger, sleeps, listCalls } = setup({
			5001: Number.POSITIVE_INFINITY,
		});

		await teardownProcessTree({ pid: 5000 }, ops, logger);

		expect(sim.alive.has(5001)).toBe(false);
		expect(total(sleeps)).toBeGreaterThanOrEqual(TEARDOWN_GRACE_MS);
		expect(
			sim.signals.some((s) => s.target === 5001 && s.sig === "SIGKILL"),
		).toBe(true);
		// snapshot + at most 10 polls + the survivor recheck.
		expect(listCalls()).toBeLessThanOrEqual(12);
	});
});
