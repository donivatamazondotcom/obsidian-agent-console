/**
 * Preloaded into every vitest process worker (`--require` in
 * vitest.config.ts poolOptions.forks / vmForks execArgv). Kills the worker
 * when its parent vitest process dies.
 *
 * Without this, killing the vitest parent (a shell timeout, an interrupted
 * agent session) leaves its fork workers running with no parent. They keep
 * running and grow until macOS runs out of memory. Reproduced 2026-11-09:
 * 3 orphans reached 3.2 GB in 25 s. On 2026-11-08, eight orphans each hit
 * Node's 4.6 GB heap limit and took the machine down.
 *
 * It must be a preload, not a setupFiles entry: a worker that is still
 * loading modules when the parent dies never reaches setup files.
 *
 * Exits with SIGKILL, not process.exit, because vitest replaces
 * process.exit in workers with a function that throws.
 *
 * Signals (any one kills the worker):
 *  1. the IPC channel is already closed when the guard installs;
 *  2. the IPC channel to the parent disconnects;
 *  3. a slow poll sees the worker reparented (ppid changed).
 *
 * Limit: both live signals need the event loop. A worker stuck in a
 * synchronous loop stays alive until the loop yields; the heap cap in
 * vitest.config.ts stops one that allocates while it spins.
 */
"use strict";

function installParentDeathGuard(deps, pollMs) {
	let exited = false;
	const exitOnce = () => {
		if (exited) return;
		exited = true;
		deps.exit(1);
	};

	// Not ppid === 1: vitest itself can be PID 1 in a container.
	if (!deps.isConnected()) {
		exitOnce();
		return;
	}

	deps.onDisconnect(exitOnce);
	const timer = deps.schedule(() => {
		if (deps.getPpid() !== deps.initialPpid) exitOnce();
	}, pollMs === undefined ? 2000 : pollMs);
	// Never keep a finished worker alive just for this poll.
	if (timer && typeof timer.unref === "function") timer.unref();
}

const GUARD_KEY = Symbol.for("agent-console.parentDeathGuard");
// Only fork workers have an IPC channel; skip the main vitest process.
if (typeof process.send === "function" && !process[GUARD_KEY]) {
	process[GUARD_KEY] = true;
	installParentDeathGuard({
		initialPpid: process.ppid,
		isConnected: () => process.connected,
		getPpid: () => process.ppid,
		exit: () => process.kill(process.pid, "SIGKILL"),
		onDisconnect: (cb) => process.once("disconnect", cb),
		schedule: (cb, ms) => setInterval(cb, ms),
	});
}

module.exports = { installParentDeathGuard };
