import { execFile } from "child_process";

/**
 * Agent process-tree teardown (I211).
 *
 * One routine owns every agent teardown on Unix: tab close (`disconnect`),
 * respawn (`doInitialize`), and the I194 reconcile path. It has to reach
 * processes our process-group SIGTERM can't: MCP servers that lead their own
 * group (e.g. the Toolbox `prex-trino-mcp` shim and its Python child). Once
 * the agent dies those are reparented to pid 1, so they can only be found by
 * snapshotting our tree BEFORE we signal anything.
 *
 * Safety: we only ever signal pids that were in our own spawned tree at the
 * snapshot, and only while they still carry the same start time, so a pid
 * reused by an unrelated process is never touched. Nothing is matched by
 * name.
 */

export interface ProcessRow {
	pid: number;
	ppid: number;
	pgid: number;
	/** Process start time, used to detect pid reuse. */
	started: string;
}

/** OS boundary, injectable for tests. Signals go through `process.kill`. */
export interface ProcessOps {
	listProcesses(): Promise<ProcessRow[]>;
	sleep(ms: number): Promise<void>;
}

export interface TeardownLogger {
	log: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
}

/** Time the agent gets to exit (and shut down its MCP servers) on its own. */
export const TEARDOWN_GRACE_MS = 2500;
/** Recheck delay after SIGKILL before reporting survivors. */
const SURVIVOR_RECHECK_MS = 250;

/** Parse `ps -axo pid=,ppid=,pgid=,lstart=` output. */
export function parsePsOutput(stdout: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of stdout.split("\n")) {
		const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
		if (!m) continue;
		rows.push({
			pid: Number(m[1]),
			ppid: Number(m[2]),
			pgid: Number(m[3]),
			started: m[4],
		});
	}
	return rows;
}

/** The root and every process under it, by parent links. */
export function collectDescendants(
	rows: ProcessRow[],
	rootPid: number,
): ProcessRow[] {
	const byParent = new Map<number, ProcessRow[]>();
	for (const r of rows) {
		const list = byParent.get(r.ppid) ?? [];
		list.push(r);
		byParent.set(r.ppid, list);
	}
	const root = rows.find((r) => r.pid === rootPid);
	const out: ProcessRow[] = root ? [root] : [];
	const seen = new Set<number>([rootPid]);
	const queue = [rootPid];
	while (queue.length > 0) {
		const pid = queue.shift() as number;
		for (const child of byParent.get(pid) ?? []) {
			if (seen.has(child.pid)) continue;
			seen.add(child.pid);
			out.push(child);
			queue.push(child.pid);
		}
	}
	return out;
}

export const nodeProcessOps: ProcessOps = {
	listProcesses: () =>
		new Promise((resolve, reject) => {
			execFile(
				"ps",
				["-axo", "pid=,ppid=,pgid=,lstart="],
				{ timeout: 2000, maxBuffer: 8 * 1024 * 1024 },
				(error, stdout) => {
					if (error) reject(new Error(`ps failed: ${error.message}`));
					else resolve(parsePsOutput(stdout));
				},
			);
		}),
	sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

/** Send a signal, ignoring "no such process". Returns whether it was delivered. */
function trySignal(target: number, sig: NodeJS.Signals): boolean {
	try {
		process.kill(target, sig);
		return true;
	} catch {
		return false;
	}
}

const key = (r: ProcessRow) => `${r.pid}|${r.started}`;

/**
 * Tear down an agent's process tree (Unix):
 * snapshot our tree → stdin.end → SIGTERM our group → grace →
 * SIGKILL every snapshot pid still alive (same start time) → log survivors.
 * If the process list is unavailable, falls back to a group SIGKILL.
 */
export async function teardownProcessTree(
	target: { pid: number; stdin?: { end: () => void } | null },
	ops: ProcessOps,
	logger: TeardownLogger,
	graceMs: number = TEARDOWN_GRACE_MS,
): Promise<void> {
	const rootPid = target.pid;

	// 1. Snapshot first: after the agent dies, its orphans are reparented to
	//    pid 1 and can no longer be found from our root.
	let snapshot: ProcessRow[] | null = null;
	try {
		snapshot = collectDescendants(await ops.listProcesses(), rootPid);
	} catch (error) {
		logger.warn(
			`Teardown (PID ${rootPid}): process list unavailable, falling back to group kill`,
			error,
		);
	}

	// 2. EOF: a well-behaved ACP agent exits and shuts its MCP servers down.
	try {
		target.stdin?.end();
	} catch {
		// stdin may already be closed
	}

	// 3. SIGTERM our process group (requires detached: true on spawn).
	if (!trySignal(-rootPid, "SIGTERM")) trySignal(rootPid, "SIGTERM");

	// 4. Grace period.
	await ops.sleep(graceMs);

	if (snapshot === null) {
		trySignal(-rootPid, "SIGKILL");
		return;
	}

	// 5. SIGKILL anything from the snapshot that is still the same process.
	let remaining: ProcessRow[];
	try {
		const live = new Set((await ops.listProcesses()).map(key));
		remaining = snapshot.filter((r) => live.has(key(r)));
	} catch {
		trySignal(-rootPid, "SIGKILL");
		return;
	}
	if (remaining.length === 0) {
		logger.log(`Teardown (PID ${rootPid}): tree exited cleanly`);
		return;
	}

	for (const r of remaining) trySignal(r.pid, "SIGKILL");
	logger.warn(
		`Teardown (PID ${rootPid}): escalated to SIGKILL after ${graceMs} ms for PIDs ${remaining
			.map((r) => r.pid)
			.join(", ")}`,
	);

	// 6. Report anything that still survived.
	await ops.sleep(SURVIVOR_RECHECK_MS);
	try {
		const live = new Set((await ops.listProcesses()).map(key));
		const survivors = remaining.filter((r) => live.has(key(r)));
		if (survivors.length > 0) {
			logger.warn(
				`Teardown (PID ${rootPid}): processes survived SIGKILL: ${survivors
					.map((r) => r.pid)
					.join(", ")}`,
			);
		}
	} catch {
		// best effort
	}
}
