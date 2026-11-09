import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { installParentDeathGuard } = require("../orphan-guard.cjs") as {
	installParentDeathGuard: (deps: GuardDeps, pollMs?: number) => void;
};

interface GuardDeps {
	initialPpid: number;
	isConnected: () => boolean;
	getPpid: () => number;
	exit: (code: number) => void;
	onDisconnect: (cb: () => void) => void;
	schedule: (cb: () => void, ms: number) => { unref?: () => void };
}

/**
 * A vitest fork worker whose parent dies keeps running and grows until the
 * machine runs out of memory (reproduced 2026-11-09: 3 orphans reached
 * 3.2 GB in 25 s). The guard makes the worker exit on its own.
 */
function harness(initialPpid = 4242, connected = true) {
	let ppid = initialPpid;
	let tick: (() => void) | undefined;
	let disconnect: (() => void) | undefined;
	let unrefCalled = false;
	const exits: number[] = [];
	installParentDeathGuard({
		initialPpid,
		isConnected: () => connected,
		getPpid: () => ppid,
		exit: (code) => exits.push(code),
		onDisconnect: (cb) => {
			disconnect = cb;
		},
		schedule: (cb) => {
			tick = cb;
			return {
				unref: () => {
					unrefCalled = true;
				},
			};
		},
	});
	return {
		reparent: (p: number) => {
			ppid = p;
		},
		tick: () => tick?.(),
		disconnect: () => disconnect?.(),
		exits,
		unrefCalled: () => unrefCalled,
		scheduled: () => tick !== undefined,
	};
}

describe("installParentDeathGuard", () => {
	it("does not exit while the parent is alive", () => {
		const h = harness();
		h.tick();
		h.tick();
		expect(h.exits).toEqual([]);
	});

	it("exits when the worker is reparented (parent died)", () => {
		const h = harness();
		h.reparent(1);
		h.tick();
		expect(h.exits).toEqual([1]);
	});

	it("exits when the IPC channel to the parent disconnects", () => {
		const h = harness();
		h.disconnect();
		expect(h.exits).toEqual([1]);
	});

	it("exits only once even if both signals fire", () => {
		const h = harness();
		h.disconnect();
		h.reparent(1);
		h.tick();
		expect(h.exits).toEqual([1]);
	});

	it("unrefs its timer so it never keeps a finished worker alive", () => {
		const h = harness();
		expect(h.unrefCalled()).toBe(true);
	});

	// vitest itself can run as PID 1 (a container with no init process), so
	// a parent pid of 1 alone is not a reason to exit.
	it("stays alive when its live parent is PID 1", () => {
		const h = harness(1);
		h.tick();
		expect(h.exits).toEqual([]);
	});

	// If the guard installs after the parent already died, "disconnect" has
	// already fired and would never arrive.
	it("exits at install when the IPC channel is already closed", () => {
		const h = harness(4242, false);
		expect(h.exits).toEqual([1]);
		expect(h.scheduled()).toBe(false);
	});
});
