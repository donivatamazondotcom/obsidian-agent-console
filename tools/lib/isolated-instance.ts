/**
 * Run an isolated Obsidian instance for docs screenshots and demo videos
 * without taking the user's screen or touching their own Obsidian.
 *
 * The instance gets its own user-data folder, a fake `HOME` (Obsidian's CLI
 * socket is a fixed `~/.obsidian-cli.sock`, which the instance would otherwise
 * take over and delete on quit), a mock keychain (a fake `HOME` alone makes
 * macOS ask for a login keychain), and a random CDP port. A focus guard hands
 * focus back to the user's app at launch; a detached watchdog tears the run
 * down if the recorder dies or runs out of time.
 *
 * Specs: [[Agent Console Isolated Screenshot Capture]] § Shared harness,
 * [[Agent Console Demo Video Automation]] § Containment.
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { collectDescendants, type ProcessRow } from "../../src/acp/process-teardown";

export const RUN_PARENT = "/tmp/agent-console-video";
export const OBSIDIAN_APP = "/Applications/Obsidian.app";
export const CLI_SOCKET = path.join(homedir(), ".obsidian-cli.sock");
export const LAUNCH_FLAGS: readonly string[] = [
	"--remote-debugging-port=0",
	"--disable-backgrounding-occluded-windows",
	"--disable-renderer-backgrounding",
	"--disable-background-timer-throttling",
	"--use-mock-keychain",
	"--password-store=basic",
];
const STEP_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------- state ----

/** Persisted run state, shared with the watchdog through a file outside the run folder. */
export interface RunState {
	runId: string;
	runRoot: string;
	userData: string;
	take: number;
	takeStartedAt: number;
	perTakeMs: number;
	runDeadline: number;
	recorderPid: number;
	watchdogPid?: number;
	mainPid?: number;
	mainStarted?: string;
	port?: number;
	socketInode?: number | null;
}

export const statePath = (runId: string): string => path.join(RUN_PARENT, `${runId}.state.json`);
export const takeLockPath = (runId: string, take: number): string => path.join(RUN_PARENT, `${runId}.take${take}.teardown.lock`);
export const takeDonePath = (runId: string, take: number): string => path.join(RUN_PARENT, `${runId}.take${take}.done`);
export const runDonePath = (runId: string): string => path.join(RUN_PARENT, `${runId}.done`);

/** Atomic replace: write a temp file, then rename. */
export function writeState(s: RunState): void {
	const p = statePath(s.runId);
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, JSON.stringify(s));
	renameSync(tmp, p);
}

/** Read the state file; `null` while missing or mid-swap ("between takes"). */
export function readState(file: string): RunState | null {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as RunState;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------- process scan ----

export interface MarkedRow extends ProcessRow {
	command: string;
}

/**
 * Parse `ps -axww -E -o pid=,ppid=,pgid=,lstart=,command=`. `lstart` is the
 * fixed 24-character `Www Mmm dd hh:mm:ss yyyy`, so it is split by position;
 * the command column (args, then environment under `-E`) can hold anything.
 */
export function parseMarkerPs(stdout: string): MarkedRow[] {
	const rows: MarkedRow[] = [];
	for (const line of stdout.split("\n")) {
		const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+/.exec(line);
		if (!m) continue;
		const rest = line.slice(m[0].length);
		const started = rest.slice(0, 24).trim();
		if (!/^\w{3} \w{3}\s+\d{1,2} \d\d:\d\d:\d\d \d{4}$/.test(started)) continue;
		rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], started, command: rest.slice(24).trim() });
	}
	return rows;
}

export interface RunMarkers {
	userData: string;
	runId: string;
}

const hasToken = (command: string, token: string): boolean =>
	command === token || command.startsWith(`${token} `) || command.includes(` ${token} `) || command.endsWith(` ${token}`);

/**
 * Processes that belong to the run: exact `--user-data-dir=<path>` or
 * `AC_VIDEO_RUN=<id>` tokens, plus every descendant of a matched process
 * (Electron helpers don't all carry the flag). `exclude` (the recorder, the
 * watchdog and their ancestors) is never matched.
 */
export function matchRun(rows: MarkedRow[], m: RunMarkers, exclude: ReadonlySet<number>): MarkedRow[] {
	const direct = rows.filter(
		(r) => !exclude.has(r.pid) && (hasToken(r.command, `--user-data-dir=${m.userData}`) || hasToken(r.command, `AC_VIDEO_RUN=${m.runId}`)),
	);
	const out = new Map<number, MarkedRow>();
	for (const r of direct) {
		for (const d of collectDescendants(rows, r.pid)) {
			const row = rows.find((x) => x.pid === d.pid);
			if (row && !exclude.has(row.pid)) out.set(row.pid, row);
		}
	}
	return [...out.values()];
}

/** Ancestors of `pid` (inclusive), so the recorder's shell and terminal are never signalled. */
export function ancestors(rows: ProcessRow[], pid: number): Set<number> {
	const byPid = new Map(rows.map((r) => [r.pid, r]));
	const out = new Set<number>();
	for (let p: number | undefined = pid; p && !out.has(p); p = byPid.get(p)?.ppid) out.add(p);
	return out;
}

/** Signal a whole group only when its leader is matched; otherwise signal the pid. */
export function planSignals(matched: MarkedRow[]): { groups: number[]; pids: number[] } {
	const ids = new Set(matched.map((r) => r.pid));
	const groups = new Set<number>();
	const pids: number[] = [];
	for (const r of matched) {
		if (ids.has(r.pgid) && r.pgid > 1) groups.add(r.pgid);
		else pids.push(r.pid);
	}
	return { groups: [...groups], pids: pids.filter((p) => !groups.has(matched.find((r) => r.pid === p)?.pgid ?? -1)) };
}

export async function listMarkedProcesses(): Promise<MarkedRow[]> {
	const stdout = await new Promise<string>((resolve, reject) => {
		execFile("ps", ["-axww", "-E", "-o", "pid=,ppid=,pgid=,lstart=,command="], { maxBuffer: 256 * 1024 * 1024, timeout: STEP_TIMEOUT_MS }, (err, out) => (err ? reject(new Error(err.message)) : resolve(out)));
	});
	return parseMarkerPs(stdout);
}

// ------------------------------------------------------------------ lock ----

export interface LockHolder {
	pid: number;
	started: string;
}

/** Exclusive-create lock holding the holder's pid and start time. */
export function acquireLock(file: string, holder: LockHolder): boolean {
	try {
		const fd = openSync(file, "wx");
		writeSync(fd, JSON.stringify(holder));
		closeSync(fd);
		return true;
	} catch {
		return false;
	}
}

/** Break a lock whose holder is gone (dead pid, or pid reused with another start time). */
export function breakStaleLock(file: string, rows: ProcessRow[]): boolean {
	let h: LockHolder;
	try {
		h = JSON.parse(readFileSync(file, "utf8")) as LockHolder;
	} catch {
		return false;
	}
	const live = rows.find((r) => r.pid === h.pid);
	if (live && live.started === h.started) return false;
	rmSync(file, { force: true });
	return true;
}

// -------------------------------------------------------------- teardown ----

export interface TeardownOps {
	list(): Promise<MarkedRow[]>;
	kill(target: number, signal: NodeJS.Signals): void;
	sleep(ms: number): Promise<void>;
	/** Raw CDP `Browser.close`, when a connection exists. */
	closeBrowser?: () => Promise<void>;
	log(msg: string): void;
}

export const nodeTeardownOps = (log: (m: string) => void, closeBrowser?: () => Promise<void>): TeardownOps => ({
	list: listMarkedProcesses,
	kill: (t, s) => {
		try {
			process.kill(t, s);
		} catch {
			/* already gone */
		}
	},
	sleep: (ms) => sleep(ms),
	closeBrowser,
	log,
});

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
	Promise.race([p, sleep(ms).then(() => undefined)]);

/**
 * Tear down the current take. Takes the take's lock, closes the browser,
 * signals everything carrying the run markers, then removes the take's run
 * folder. The state file survives for the next take and the watchdog.
 * Returns false when another process holds a live lock.
 */
export async function teardownTake(state: RunState, self: LockHolder, ops: TeardownOps): Promise<boolean> {
	const lock = takeLockPath(state.runId, state.take);
	const rows0 = await withTimeout(ops.list(), STEP_TIMEOUT_MS) ?? [];
	if (!acquireLock(lock, self)) {
		if (!breakStaleLock(lock, rows0) || !acquireLock(lock, self)) return false;
	}
	if (ops.closeBrowser) await withTimeout(ops.closeBrowser(), STEP_TIMEOUT_MS);
	await ops.sleep(1000);
	const markers = { userData: state.userData, runId: state.runId };
	for (const [signal, wait] of [["SIGTERM", 2500], ["SIGKILL", 500]] as const) {
		const rows = await withTimeout(ops.list(), STEP_TIMEOUT_MS) ?? [];
		const exclude = new Set([...ancestors(rows, state.recorderPid), ...(state.watchdogPid ? ancestors(rows, state.watchdogPid) : []), ...ancestors(rows, self.pid)]);
		const matched = matchRun(rows, markers, exclude);
		if (!matched.length) break;
		const plan = planSignals(matched);
		ops.log(`teardown take ${state.take}: ${signal} ${matched.length} process(es)`);
		for (const g of plan.groups) ops.kill(-g, signal);
		for (const p of plan.pids) ops.kill(p, signal);
		await ops.sleep(wait);
	}
	rmSync(state.runRoot, { recursive: true, force: true });
	writeFileSync(takeDonePath(state.runId, state.take), "");
	return true;
}

/** Post-run assertion: nothing carries the run markers, and the user's CLI socket is unchanged. */
export async function assertClean(state: RunState, list: () => Promise<MarkedRow[]>): Promise<string[]> {
	const problems: string[] = [];
	const rows = await list();
	const exclude = new Set([...ancestors(rows, state.recorderPid), ...(state.watchdogPid ? ancestors(rows, state.watchdogPid) : [])]);
	const left = matchRun(rows, { userData: state.userData, runId: state.runId }, exclude);
	if (left.length) problems.push(`${left.length} process(es) still carry the run markers: ${left.map((r) => r.pid).join(", ")}`);
	if (state.socketInode !== undefined && socketInode() !== state.socketInode) problems.push(`the Obsidian CLI socket ${CLI_SOCKET} changed during the run`);
	return problems;
}

/** Remove every `<run-id>*` file in the run parent (state, locks, markers, run folder). */
export function removeRunFiles(runId: string): void {
	rmSync(path.join(RUN_PARENT, runId), { recursive: true, force: true });
	for (const f of [statePath(runId), runDonePath(runId)]) rmSync(f, { force: true });
	for (let t = 1; t < 20; t++) for (const f of [takeLockPath(runId, t), takeDonePath(runId, t)]) rmSync(f, { force: true });
}

// --------------------------------------------------------------- preflight ----

export function socketInode(): number | null {
	try {
		return statSync(CLI_SOCKET).ino;
	} catch {
		return null;
	}
}

const run = (cmd: string, args: string[], timeout = STEP_TIMEOUT_MS) => spawnSync(cmd, args, { encoding: "utf8", timeout });

/** Frontmost app's pid via System Events, or null. A timeout usually means a pending TCC prompt. */
export function frontmostPid(): number | null {
	const r = run("osascript", ["-e", 'tell application "System Events" to get unix id of first application process whose frontmost is true'], 3000);
	const n = Number(r.stdout?.trim());
	return r.status === 0 && n > 0 ? n : null;
}

/** Problems that block a run. Empty means go. */
export function preflight(): string[] {
	const p: string[] = [];
	if (platform() !== "darwin") p.push("isolated capture needs macOS");
	if (!existsSync(OBSIDIAN_APP)) p.push(`${OBSIDIAN_APP} not found`);
	for (const bin of ["ffmpeg", "ffprobe"]) if (run(bin, ["-version"]).status !== 0) p.push(`${bin} not found on PATH`);
	const ps = run("ps", ["-o", "pid=", "-p", String(process.pid)]);
	if (ps.status !== 0) p.push("ps is blocked (agent sandbox?); run from a normal terminal");
	if (frontmostPid() === null) p.push("System Events didn't answer within 3 s: grant Automation access or answer the pending macOS prompt");
	return p;
}

/** The user's login-shell PATH and a resolver for bare command names. */
export function loginShell(): { path: string; resolve: (cmd: string) => string } {
	const shell = process.env.SHELL || "/bin/zsh";
	const pathOut = run(shell, ["-i", "-l", "-c", 'printf %s "$PATH"'], 15000).stdout ?? "";
	return {
		path: pathOut || process.env.PATH || "",
		resolve: (cmd) => {
			const r = run(shell, ["-i", "-l", "-c", `command -v ${JSON.stringify(cmd)}`], 15000).stdout?.trim().split("\n").pop();
			return r && path.isAbsolute(r) ? r : cmd;
		},
	};
}

// ----------------------------------------------------------- focus guard ----

/**
 * Hands focus back to the user whenever one of the instance's processes becomes
 * frontmost. Compares by unix id (both instances are named "Obsidian") and
 * restores the last app that wasn't the instance.
 */
export class FocusGuard {
	steals = 0;
	private last: number | null = frontmostPid();
	private running = false;

	constructor(private readonly isInstance: (pid: number) => boolean, private readonly log: (m: string) => void) {}

	start(): void {
		this.running = true;
		void (async () => {
			while (this.running) {
				await this.tick();
				await sleep(250);
			}
		})();
	}

	stop(): void {
		this.running = false;
	}

	private async tick(): Promise<void> {
		try {
			const f = frontmostPid();
			if (f === null) return;
			if (!this.isInstance(f)) {
				this.last = f;
				return;
			}
			if (this.last === null) return;
			run("osascript", ["-e", `tell application "System Events" to set frontmost of (first application process whose unix id is ${this.last}) to true`], 3000);
			this.steals++;
			this.log(`focus guard: restored focus (steal #${this.steals})`);
		} catch {
			/* a failed poll is retried on the next tick */
		}
	}
}

// --------------------------------------------------------------- launch ----

export interface LaunchResult {
	port: number;
	mainPid: number;
	mainStarted: string;
}

/** Launch the instance in the background and wait for its CDP port and main process. */
export async function launchInstance(r: { userData: string; home: string }, timeoutMs = 30000): Promise<LaunchResult> {
	const res = run("open", ["-g", "-n", "--env", `HOME=${r.home}`, "-a", OBSIDIAN_APP, "--args", `--user-data-dir=${r.userData}`, ...LAUNCH_FLAGS], 15000);
	if (res.status !== 0) throw new Error(`open failed: ${res.stderr}`);
	const deadline = Date.now() + timeoutMs;
	const portFile = path.join(r.userData, "DevToolsActivePort");
	while (Date.now() < deadline) {
		const port = existsSync(portFile) ? Number(readFileSync(portFile, "utf8").split("\n")[0]) : 0;
		if (port > 0) {
			const rows = await listMarkedProcesses();
			const main = rows.find((x) => hasToken(x.command, `--user-data-dir=${r.userData}`) && !x.command.includes("--type="));
			if (main) return { port, mainPid: main.pid, mainStarted: main.started };
		}
		await sleep(250);
	}
	throw new Error("the isolated instance didn't start (no DevToolsActivePort)");
}

/** Spawn the detached watchdog; it reads the state file and watches our pipe for EOF. */
export function spawnWatchdog(runId: string): { pid: number; release: () => void } {
	const child = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "isolated-watchdog.ts"), statePath(runId)], {
		detached: true,
		stdio: ["pipe", "ignore", "ignore"],
	});
	child.unref();
	// Keep stdin open for the life of this process; closing it (or dying) tells the watchdog.
	return { pid: child.pid ?? 0, release: () => child.stdin?.end() };
}

/** Remove Kiro V2 session records whose cwd is under the run folder. Returns the removed files. */
export function cleanKiroSessionRecords(runRoot: string, kiroHome = path.join(homedir(), ".kiro")): string[] {
	const dir = path.join(kiroHome, "sessions", "cli");
	const removed: string[] = [];
	let files: string[] = [];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	} catch {
		return removed;
	}
	for (const f of files) {
		try {
			const cwd = (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { cwd?: string }).cwd ?? "";
			if (cwd === runRoot || cwd.startsWith(`${runRoot}/`)) {
				rmSync(path.join(dir, f), { force: true });
				rmSync(path.join(dir, f.replace(/\.json$/, ".jsonl")), { force: true });
				removed.push(f);
			}
		} catch {
			/* unreadable record: leave it */
		}
	}
	return removed;
}

// ---------------------------------------------------------------- runner ----

export interface RunOptions {
	repoRoot: string;
	profile: "screenshot" | "video";
	takes?: number;
	perTakeMs?: number;
	log?: (m: string) => void;
	/** Builds the run folder for a take; defaults to fixtures-vault's materializeRun. */
	materialize: (runRoot: string, runId: string) => { vault: string; userData: string; home: string };
}

export interface Take {
	take: number;
	vault: string;
	port: number;
	guard: FocusGuard;
	/** Hook the CDP connection's `Browser.close` into teardown. */
	setCloseBrowser(fn: () => Promise<void>): void;
}

/**
 * One isolated run: preflight, watchdog, then `takes` fresh launches. Each
 * take gets a fresh vault copy; teardown runs per take; the post-run assertion
 * runs once at the end. `body` returns true for a good take (stop) or false to
 * retry; throwing aborts the run (still torn down).
 */
export async function withIsolatedRun(o: RunOptions, body: (t: Take) => Promise<boolean>): Promise<{ ok: boolean; problems: string[]; steals: number }> {
	const log = o.log ?? (() => {});
	const blockers = preflight();
	if (blockers.length) throw new Error(`preflight failed:\n- ${blockers.join("\n- ")}`);
	const runId = `r${Date.now().toString(36)}${process.pid.toString(36)}`;
	const runRoot = path.join(RUN_PARENT, runId);
	const takes = o.takes ?? 3;
	const perTakeMs = o.perTakeMs ?? 8 * 60_000;
	const self: LockHolder = { pid: process.pid, started: "" };
	self.started = (await listMarkedProcesses()).find((r) => r.pid === process.pid)?.started ?? "";
	const state: RunState = {
		runId,
		runRoot,
		userData: path.join(runRoot, "userdata"),
		take: 0,
		takeStartedAt: Date.now(),
		perTakeMs,
		runDeadline: Date.now() + takes * (perTakeMs + 30_000),
		recorderPid: process.pid,
		socketInode: socketInode(),
	};
	mkdirSync(RUN_PARENT, { recursive: true });
	writeState(state);
	const wd = spawnWatchdog(runId);
	state.watchdogPid = wd.pid;
	writeState(state);

	let stopping = false;
	let current: { close?: () => Promise<void> } = {};
	// A signal tears the current take down now and exits; further signals are
	// ignored so the teardown can't be cut short.
	const onSignal = (): void => {
		if (stopping) return;
		stopping = true;
		log("signal received: tearing down and stopping");
		void (async () => {
			await teardownTake(state, self, nodeTeardownOps(log, current.close)).catch(() => false);
			cleanKiroSessionRecords(runRoot);
			writeFileSync(runDonePath(runId), "");
			wd.release();
			removeRunFiles(runId);
			process.exit(130);
		})();
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	let ok = false;
	let steals = 0;
	try {
		for (let n = 1; n <= takes && !ok && !stopping; n++) {
			state.take = n;
			state.takeStartedAt = Date.now();
			writeState(state);
			const r = o.materialize(runRoot, runId);
			state.userData = r.userData;
			writeState(state);
			const isInstance = (pid: number): boolean => pid === state.mainPid;
			const guard = new FocusGuard(isInstance, log);
			guard.start();
			try {
				const l = await launchInstance(r);
				Object.assign(state, { mainPid: l.mainPid, mainStarted: l.mainStarted, port: l.port });
				writeState(state);
				ok = await body({ take: n, vault: r.vault, port: l.port, guard, setCloseBrowser: (fn) => (current.close = fn) });
			} finally {
				guard.stop();
				steals += guard.steals;
				await teardownTake(state, self, nodeTeardownOps(log, current.close));
				current = {};
				for (const f of cleanKiroSessionRecords(runRoot)) log(`removed Kiro session record ${f}`);
			}
			if (!ok && n < takes && !stopping) log(`take ${n} failed; retrying with a fresh vault`);
		}
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		writeFileSync(runDonePath(runId), "");
		wd.release();
	}
	const problems = await assertClean(state, listMarkedProcesses);
	removeRunFiles(runId);
	return { ok: ok && problems.length === 0, problems, steals };
}

// ---------------------------------------------------------- version check ----

/**
 * The Obsidian version the user's own instance runs: the `obsidian-<v>.asar`
 * its main process has open, else the app bundle's version. When the user's
 * Obsidian isn't running, the newest downloaded asar (and says so).
 */
export function userObsidianVersion(userDataDir = path.join(homedir(), "Library/Application Support/obsidian")): { version: string | null; source: string } {
	const ps = run("ps", ["-axww", "-o", "pid=,command="]);
	const main = (ps.stdout ?? "")
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.includes(`${OBSIDIAN_APP}/Contents/MacOS/Obsidian`) && !l.includes("--type=") && !l.includes("--user-data-dir="));
	if (main) {
		const pid = main.split(/\s+/)[0];
		const open = run("lsof", ["-p", pid, "-Fn"]).stdout ?? "";
		const asar = /obsidian-(\d+\.\d+\.\d+)\.asar/.exec(open);
		if (asar) return { version: asar[1], source: "running app (downloaded update)" };
		const plist = run("defaults", ["read", `${OBSIDIAN_APP}/Contents/Info.plist`, "CFBundleShortVersionString"]).stdout?.trim();
		return { version: plist || null, source: "running app (bundled)" };
	}
	try {
		const vs = readdirSync(userDataDir)
			.map((f) => /^obsidian-(\d+)\.(\d+)\.(\d+)\.asar$/.exec(f))
			.filter((m): m is RegExpExecArray => !!m)
			.sort((a, b) => +b[1] - +a[1] || +b[2] - +a[2] || +b[3] - +a[3]);
		if (vs[0]) return { version: `${vs[0][1]}.${vs[0][2]}.${vs[0][3]}`, source: "Obsidian not running; newest downloaded update" };
	} catch {
		/* no user data */
	}
	return { version: null, source: "unknown" };
}

/** Warning text when the instance and the user's app differ; null when they match. */
export function versionWarning(instanceUa: string, user: { version: string | null; source: string }): string | null {
	const inst = /obsidian\/(\d+\.\d+\.\d+)/.exec(instanceUa)?.[1] ?? null;
	if (!inst || !user.version || inst === user.version) return null;
	return `isolated Obsidian ${inst} differs from your Obsidian ${user.version} (${user.source}); shots may not match what you see`;
}
