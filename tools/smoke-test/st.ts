/**
 * `st` — drive a per-worktree smoke studio (`ST-<worktree>`) that runs in its
 * own isolated, background Obsidian instance: fake HOME, own user data, a
 * random CDP port, launched with `open -g -n`. It never touches the user's
 * Obsidian, its vault registry or its CLI socket, and takes focus at most
 * twice per `up`.
 *
 *   npx tsx tools/smoke-test/st.ts <command> <worktree> …
 *
 * Replaces `obsidian vault="ST-…" eval | dev:cdp | dev:screenshot` for
 * isolated smoke studios. Spec: [[Isolated smoke-test instances]].
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";
import { configDirOf, obsidianJson, pluginRel, seedAgentEnv, type SeedContext } from "../lib/fixtures-vault";
import {
	CLI_SOCKET,
	FocusGuard,
	OBSIDIAN_APP,
	acquireLock,
	breakStaleLock,
	cleanKiroSessionRecords,
	frontmostPid,
	hasToken,
	launchInstance,
	listMarkedProcesses,
	userObsidianVersion,
	loginShell,
	nodeTeardownOps,
	preflightCore,
	signalMarked,
	stageAppAsar,
	type InstanceState,
	type LockHolder,
	type MarkedRow,
	type RunMarkers,
} from "../lib/isolated-instance";
import { trustAndLoad } from "../lib/isolated-trust";
import { appVersionProblem, asarName, pinDriftNote, readAppPin, resolveAppAsar } from "../lib/obsidian-app";
import { SETTINGS_WINDOW_HOOK, settingsWindowTitlePrefix } from "../screenshots/lib/cdp";

export const STATE_SCHEMA = 1;
export const MARKER_KEY = "AC_SMOKE_RUN";
/** Focus steals each guarded command may cause (spec § Focus). */
export const STEAL_BUDGET = { up: 2, restart: 1, reload: 0 } as const;
const FOCUS_LOCK_WAIT_MS = 180_000;
const OP_LOCK_WAIT_MS = 360_000;
const SEED_BUDGET_MS = 90_000;
const RESTART_QUIT_WAIT_MS = 10_000;
const PAGE_WAIT_MS = 40_000;
/** Same as `REUSE_WAIT_MS` in tools/screenshots/lib/cdp.ts:34 (not exported there). */
const SETTINGS_REUSE_WAIT_MS = 400;

// ================================================================ pure parts ==

type Cmd = "up" | "eval" | "cdp" | "reload" | "restart" | "settings" | "screenshot" | "focus" | "status" | "down" | "_guard" | "_clean-kiro";

export interface ParsedArgs {
	cmd: Cmd;
	wt?: string;
	rest: string[];
	flags: { hard?: boolean; hidden?: boolean; close?: boolean };
	paths: string[];
}

const PUBLIC: [Cmd, string, string][] = [
	["up", "up <wt>", "launch (or adopt) the studio's isolated instance"],
	["eval", "eval <wt> <js>", "Runtime.evaluate on the workspace page; prints JSON"],
	["cdp", "cdp <wt> <method> [json]", "raw CDP call on the workspace page"],
	["reload", "reload <wt> [--hard]", "app:reload (re-reads CSS); --hard: Page.reload (no flushSave)"],
	["restart", "restart <wt>", "graceful quit and relaunch (use instead of Cmd+Q)"],
	["settings", "settings <wt> <tab> [--hidden] | settings <wt> --close", "open a settings tab (--hidden: invisible, no focus); --close after --hidden checks"],
	["screenshot", "screenshot <wt> <file> [selector]", "Page.captureScreenshot of the page or an element"],
	["focus", "focus <wt>", "raise the instance's window"],
	["status", "status [<wt>]", "list instances: up, dead or orphan"],
	["down", "down <wt>", "stop the instance and remove its instance files"],
];
const INTERNAL: Cmd[] = ["_guard", "_clean-kiro"];
const NEEDS_WT = new Set<Cmd>(["up", "eval", "cdp", "reload", "restart", "settings", "screenshot", "focus", "down", "_guard", "_clean-kiro"]);
const FLAGS: Partial<Record<Cmd, string[]>> = { reload: ["--hard"], settings: ["--hidden", "--close"] };

export function helpText(): string {
	return ["usage: npx tsx tools/smoke-test/st.ts <command> …", "", ...PUBLIC.map(([, u, d]) => `  ${u.padEnd(56)} ${d}`)].join("\n");
}

export function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
	const [c, ...tail] = argv;
	const all = [...PUBLIC.map((p) => p[0]), ...INTERNAL];
	if (!c || !all.includes(c as Cmd)) return { error: `unknown command: ${c ?? "(none)"}\n${helpText()}` };
	const cmd = c as Cmd;
	const out: ParsedArgs = { cmd, rest: [], flags: {}, paths: [] };
	const positional: string[] = [];
	for (let i = 0; i < tail.length; i++) {
		const a = tail[i];
		if (cmd === "_clean-kiro" && a === "--path") {
			out.paths.push(tail[++i] ?? "");
			continue;
		}
		// eval/cdp payloads may start with "-"; only flags this command knows are flags.
		if (a.startsWith("--") && (FLAGS[cmd] ?? []).includes(a)) {
			out.flags[a.slice(2) as keyof ParsedArgs["flags"]] = true;
			continue;
		}
		if (a.startsWith("--") && cmd !== "eval" && cmd !== "cdp") return { error: `${cmd}: unknown flag ${a}` };
		positional.push(a);
	}
	out.wt = positional.shift();
	out.rest = positional;
	if (NEEDS_WT.has(cmd) && !out.wt) return { error: `${cmd}: missing <worktree>` };
	if (out.wt !== undefined && (!/^[A-Za-z0-9._-]+$/.test(out.wt) || out.wt === "." || out.wt === "..")) return { error: `bad worktree name: ${out.wt}` };
	if (cmd === "settings") {
		if (out.flags.hidden && out.flags.close) return { error: "settings: --hidden and --close don't combine" };
		if (!out.flags.close && !out.rest[0]) return { error: "settings: missing <tab>" };
	}
	if ((cmd === "eval" || cmd === "cdp" || cmd === "screenshot") && !out.rest[0]) return { error: `${cmd}: missing argument` };
	return out;
}

export interface Target {
	id: string;
	type: string;
	url: string;
	title: string;
	webSocketDebuggerUrl: string;
}

/** Workspace-page candidates: page targets on index.html that aren't this vault's settings window. */
export function workspaceCandidates(targets: readonly Target[], vault: string): Target[] {
	const settings = settingsWindowTitlePrefix(vault);
	return targets.filter((t) => t.type === "page" && /index\.html(\?|#|$)/.test(t.url) && !t.title.startsWith(settings));
}

export type InstanceStatus = "up" | "dead" | "orphan" | "none";
export function classifyInstance(stateExists: boolean, liveMain: boolean): InstanceStatus {
	if (stateExists) return liveMain ? "up" : "dead";
	return liveMain ? "orphan" : "none";
}

export interface GuardResult {
	action: "ok" | "warn" | "refuse";
	message: string;
}

/**
 * Mode guard G: may this studio run in an isolated instance? Pure. The user's
 * CLI is asked only when the studio is registered and the CLI socket exists,
 * because the CLI opens a vault picker for an unknown vault name.
 */
export function guardDecision(f: { entry: { open?: boolean } | null; socketExists: boolean; cliAnswer: () => string | null }, vault: string): GuardResult {
	if (!f.entry) return { action: "ok", message: "" };
	const howTo = `close the ${vault} window in your own Obsidian, or quit Obsidian and run smoke-test-teardown.sh, or remove it with the vault switcher's "Remove from list"`;
	if (f.entry.open) return { action: "refuse", message: `${vault} is marked open in your Obsidian's vault list; ${howTo}` };
	if (f.socketExists && f.cliAnswer() === vault) return { action: "refuse", message: `${vault} is open in your own Obsidian right now; ${howTo}` };
	return { action: "warn", message: `${vault} is still registered in your Obsidian's vault list (not open); remove it with "Remove from list" when convenient` };
}

export type DataRead = { ok: true; data: Record<string, unknown> } | { ok: false; reason: "missing" | "unreadable" };
export function readDataJson(file: string): DataRead {
	if (!existsSync(file)) return { ok: false, reason: "missing" };
	try {
		const d = JSON.parse(readFileSync(file, "utf8")) as unknown;
		if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, reason: "unreadable" };
		return { ok: true, data: d as Record<string, unknown> };
	} catch {
		return { ok: false, reason: "unreadable" };
	}
}

export function dataProblem(reason: "missing" | "unreadable", wt: string): string {
	return reason === "missing"
		? `data.json missing; run tools/smoke-test/smoke-test-teardown.sh ${wt}, then tools/smoke-test/smoke-test-spawn.sh ${wt} --isolated`
		: "data.json unreadable (forced quit mid-write?); fix or restore it, then re-run";
}

export function readInstanceState(file: string): InstanceState | null {
	let s: InstanceState;
	try {
		s = JSON.parse(readFileSync(file, "utf8")) as InstanceState;
	} catch {
		return null;
	}
	if (typeof s.schema === "number" && s.schema > STATE_SCHEMA) throw new StError(`${file} has state schema ${s.schema}, newer than this st (${STATE_SCHEMA}); run the st.ts from a newer checkout`);
	return s;
}

/** Why `_clean-kiro` must refuse these paths, or null. Allowed: the studio or below, in plain or realpath form. */
export function validateCleanPaths(paths: readonly string[], studiosDir: string, wt: string): string | null {
	if (!paths.length) return "_clean-kiro needs at least one --path";
	const roots = [path.join(studiosDir, `ST-${wt}`)];
	try {
		roots.push(path.join(realpathSync(studiosDir), `ST-${wt}`));
	} catch {
		/* studios/ gone: only the plain form */
	}
	for (const p of paths) {
		if (!p) return "_clean-kiro: empty --path";
		if (!path.isAbsolute(p)) return `_clean-kiro: --path must be absolute: ${p}`;
		const n = path.normalize(p);
		if (!roots.some((r) => n === r || n.startsWith(`${r}/`))) return `_clean-kiro: --path outside the studio: ${p}`;
	}
	return null;
}

/**
 * The `st settings --hidden` expression (renderer side). Same properties as
 * `Cdp.openSettingsIsolated` (tools/screenshots/lib/cdp.ts): the main-process
 * hook is armed only around the open, a new window wins and an existing one
 * is reused after 400 ms, the window is tamed and kept concealed on `show`.
 * A `beforeunload` disarm covers a renderer reload during the wait.
 */
export function hiddenSettingsExpression(hookPath: string, prefix: string, tab: string): string {
	return `(async () => {
		const remote = require("@electron/remote");
		const prefix = ${JSON.stringify(prefix)};
		const hook = remote.require(${JSON.stringify(hookPath)});
		const isSettings = (w) => { try { return !w.isDestroyed() && w.getTitle().startsWith(prefix); } catch (e) { return false; } };
		const all = () => remote.BrowserWindow.getAllWindows().filter(isSettings).sort((a, b) => b.id - a.id);
		const before = new Set(all().map((w) => w.id));
		for (const w of all()) hook.tame(w);
		const onUnload = () => { try { hook.disarm(); } catch (e) {} };
		window.addEventListener("beforeunload", onUnload, { once: true });
		hook.armOnce();
		let sw;
		try {
			app.setting.open();
			app.setting.openTabById(${JSON.stringify(tab)});
			const start = Date.now();
			while (!sw && Date.now() - start < 10000) {
				const ws = all();
				sw = ws.find((w) => !before.has(w.id)) || (Date.now() - start >= ${SETTINGS_REUSE_WAIT_MS} ? ws[0] : undefined);
				if (!sw) await new Promise((r) => setTimeout(r, 20));
			}
		} finally {
			hook.disarm();
			window.removeEventListener("beforeunload", onUnload);
		}
		if (!sw) return "no settings window titled " + prefix;
		hook.tame(sw);
		const conceal = () => { try { sw.setOpacity(0); } catch (e) {} };
		sw.on("show", conceal);
		conceal();
		return "ok";
	})()`;
}

/** Close settings, then destroy any settings window left tamed (unfocusable or transparent). Returns the count destroyed. */
export function closeSettingsExpression(prefix: string): string {
	return `(async () => {
		const remote = require("@electron/remote");
		const prefix = ${JSON.stringify(prefix)};
		const isSettings = (w) => { try { return !w.isDestroyed() && w.getTitle().startsWith(prefix); } catch (e) { return false; } };
		try { app.setting.close(); } catch (e) {}
		const start = Date.now();
		while (Date.now() - start < 2000 && remote.BrowserWindow.getAllWindows().some(isSettings)) await new Promise((r) => setTimeout(r, 50));
		let n = 0;
		for (const w of remote.BrowserWindow.getAllWindows().filter(isSettings)) {
			if (!w.isFocusable() || w.getOpacity() === 0) { w.destroy(); n++; }
		}
		return n;
	})()`;
}

export const disarmExpression = (hookPath: string): string =>
	`(() => { try { require("@electron/remote").require(${JSON.stringify(hookPath)}).disarm(); return "ok"; } catch (e) { return "err:" + String(e); } })()`;

// ---------------------------------------------------------------- sequencers --

export interface Outcome {
	ok: boolean;
	message: string;
}
export type SeedResult = { ok: true } | { ok: false; message: string };

export interface UpDeps {
	/** Is a marked main process of this instance alive? */
	scanLive(): Promise<boolean>;
	guard(mode: "launch" | "live"): GuardResult;
	seedContext(): SeedResult;
	/** Runs `fn` under the focus lock and guard (or unarmed when the instance is frontmost). */
	withFocusLock(fn: () => Promise<Outcome>): Promise<Outcome>;
	adopt(): Promise<Outcome>;
	cleanStale(): void;
	readData(): DataRead;
	writeData(data: Record<string, unknown>): void;
	launch(): Promise<Outcome>;
	log(m: string): void;
	wt?: string;
}

/** `st up` order (spec § Agent environment): slow work before `focus.lock`, re-scan under it. */
export async function upSequence(d: UpDeps): Promise<Outcome> {
	if (await d.scanLive()) {
		const g = d.guard("live");
		if (g.action !== "ok") d.log(g.message);
		return d.withFocusLock(() => d.adopt());
	}
	const g = d.guard("launch");
	if (g.action === "refuse") return { ok: false, message: g.message };
	if (g.action === "warn") d.log(g.message);
	const s = d.seedContext();
	if (!s.ok) return { ok: false, message: s.message };
	return d.withFocusLock(async () => {
		if (await d.scanLive()) {
			d.log("an instance started while waiting; adopting it");
			return d.adopt();
		}
		d.cleanStale();
		const r = d.readData();
		if (!r.ok) return { ok: false, message: dataProblem(r.reason, d.wt ?? "<wt>") };
		d.writeData(r.data);
		return d.launch();
	});
}

export interface RestartDeps {
	guard(mode: "live"): GuardResult;
	seedContext(): SeedResult;
	withFocusLock?(fn: () => Promise<Outcome>): Promise<Outcome>;
	closeBrowser(): Promise<void>;
	/** True once the instance's main process has exited, within `ms`. */
	waitMainGone(ms: number): Promise<boolean>;
	/** SIGTERM then SIGKILL every marked process still alive (a forced main, leftover agents); returns survivors. */
	stopMarked(): Promise<number[]>;
	readData(): DataRead;
	writeData(data: Record<string, unknown>): void;
	launch(): Promise<Outcome | void>;
	log(m: string): void;
	wt?: string;
}

/** `st restart`: G and the env context before the quit; write and relaunch only after an empty scan. */
export async function restartSequence(d: RestartDeps): Promise<Outcome> {
	const g = d.guard("live");
	if (g.action === "refuse") return { ok: false, message: g.message };
	if (g.action === "warn") d.log(g.message);
	const s = d.seedContext();
	if (!s.ok) return { ok: false, message: s.message };
	const body = async (): Promise<Outcome> => {
		await d.closeBrowser();
		if (!(await d.waitMainGone(RESTART_QUIT_WAIT_MS))) d.log("forced quit: tab state may not have been saved");
		// Agent processes can outlive a clean quit; nothing marked may survive into the relaunch.
		const left = await d.stopMarked();
		if (left.length) return { ok: false, message: `marked process(es) ${left.join(", ")} still running after SIGKILL; not relaunching` };
		const r = d.readData();
		if (!r.ok) return { ok: false, message: dataProblem(r.reason, d.wt ?? "<wt>") };
		d.writeData(r.data);
		return (await d.launch()) ?? { ok: true, message: "restarted" };
	};
	return d.withFocusLock ? d.withFocusLock(body) : body();
}

/**
 * Obsidian asars in a user-data listing other than the pinned one. Obsidian
 * downloads its own updates into the user-data folder, which a smoke
 * instance keeps across launches, and would then run the newer version.
 */
export function staleAsars(files: readonly string[], pinnedVersion: string): string[] {
	return files.filter((f) => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(f) && f !== asarName(pinnedVersion));
}

/** Does the recorded state describe this live main process (same pid and start time)? */
export function stateMatchesLive(s: Pick<InstanceState, "mainPid" | "mainStarted"> | null, live: { pid: number; started: string } | undefined): boolean {
	return !!s && !!live && s.mainPid === live.pid && s.mainStarted === live.started;
}

/**
 * data.json without the `AC_SMOKE_RUN` env rows `st` injected, so a studio
 * whose instance is down can run non-isolated again (the plain spawn refuses
 * a studio carrying them). HOME and PATH stay: they are real values. Pure.
 */
export function stripSmokeMarker(data: Record<string, unknown>): Record<string, unknown> {
	const d: Record<string, unknown> = structuredClone(data);
	const strip = (a: unknown) => {
		if (!a || typeof a !== "object") return;
		const o = a as { env?: unknown };
		if (Array.isArray(o.env)) o.env = (o.env as { key?: string }[]).filter((e) => e?.key !== MARKER_KEY);
	};
	for (const v of Object.values(d)) strip(v);
	if (Array.isArray(d.customAgents)) for (const a of d.customAgents as unknown[]) strip(a);
	return d;
}

/** Remove a lock file only while it still names `holder` (another command may have taken it since). */
export function releaseIfOwner(file: string, holder: LockHolder): boolean {
	try {
		const h = JSON.parse(readFileSync(file, "utf8")) as LockHolder;
		if (h.pid !== holder.pid || h.started !== holder.started) return false;
	} catch {
		return false;
	}
	rmSync(file, { force: true });
	return true;
}

/** This studio's `.trash-` folders (left by a `down` that died mid-delete) whose deleting process is gone. Pure. */
export function staleTrash(entries: readonly string[], vault: string, livePids: ReadonlySet<number>): string[] {
	const re = new RegExp(`^\\.trash-${vault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)-\\d+$`);
	return entries.filter((e) => {
		const m = re.exec(e);
		return !!m && !livePids.has(Number(m[1]));
	});
}

export class StError extends Error {}

// ================================================================== runtime ==

const log = (m: string): void => void process.stderr.write(`${m}\n`);

/** The main checkout (studios live there), from this file's git common dir. */
function mainRoot(): string {
	const common = execFileSync("git", ["-C", __dirname, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
	return path.dirname(path.isAbsolute(common) ? common : path.resolve(__dirname, common));
}

interface Paths {
	wt: string;
	vault: string;
	main: string;
	studios: string;
	studio: string;
	instances: string;
	inst: string;
	userData: string;
	home: string;
	state: string;
	opLock: string;
	teardownLock: string;
	focusLock: string;
	portFile: string;
	dataJson: string;
	runId: string;
	markers: RunMarkers;
}

/** The studio's config folder (found by its app.json, as fixtures-vault does); the fixture default before the studio exists. */
function studioConfigDir(studio: string): string {
	try {
		return configDirOf(studio);
	} catch {
		return configDirOf(path.join(mainRoot(), "tools/screenshots/fixtures/studio"));
	}
}

function pathsFor(wt: string): Paths {
	const main = mainRoot();
	const studios = path.join(main, "tools/smoke-test/studios");
	const instances = path.join(studios, ".instances");
	const inst = path.join(instances, `ST-${wt}`);
	const userData = path.join(inst, "userdata");
	const studio = path.join(studios, `ST-${wt}`);
	const runId = `st-${wt}`;
	return {
		wt,
		vault: `ST-${wt}`,
		main,
		studios,
		studio,
		instances,
		inst,
		userData,
		home: path.join(inst, "home"),
		state: path.join(inst, "state.json"),
		opLock: path.join(inst, "op.lock"),
		teardownLock: path.join(inst, "teardown.lock"),
		focusLock: path.join(instances, ".focus.lock"),
		portFile: path.join(userData, "DevToolsActivePort"),
		dataJson: path.join(studio, pluginRel(studioConfigDir(studio)), "data.json"),
		runId,
		markers: { userData, runId, markerKey: MARKER_KEY },
	};
}

const isMain = (r: MarkedRow, userData: string): boolean => hasToken(r.command, `--user-data-dir=${userData}`) && !r.command.includes("--type=");

async function liveMain(p: Paths): Promise<MarkedRow | undefined> {
	return (await listMarkedProcesses()).find((r) => isMain(r, p.userData));
}

function writeJsonAtomic(file: string, v: unknown): void {
	const tmp = `${file}.tmp-${process.pid}`;
	writeFileSync(tmp, typeof v === "string" ? v : JSON.stringify(v, null, "\t"));
	renameSync(tmp, file);
}

// ------------------------------------------------------------------- CDP ----

class CdpConn {
	private nextId = 1;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private constructor(private readonly ws: WebSocket) {
		ws.addEventListener("message", (ev) => {
			const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
			if (m.id === undefined) return;
			const p = this.pending.get(m.id);
			if (!p) return;
			this.pending.delete(m.id);
			if (m.error) p.reject(new Error(m.error.message));
			else p.resolve(m.result);
		});
		ws.addEventListener("close", () => {
			for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
			this.pending.clear();
		});
	}

	static open(url: string, timeoutMs = 5000): Promise<CdpConn> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url);
			const t = setNodeTimeout(() => reject(new Error(`CDP connect timed out: ${url}`)), timeoutMs);
			ws.addEventListener("open", () => {
				clearNodeTimeout(t);
				resolve(new CdpConn(ws));
			});
			ws.addEventListener("error", () => {
				clearNodeTimeout(t);
				reject(new Error(`CDP connect failed: ${url}`));
			});
		});
	}

	send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const t = setNodeTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} timed out`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (v) => {
					clearNodeTimeout(t);
					resolve(v as T);
				},
				reject: (e) => {
					clearNodeTimeout(t);
					reject(e);
				},
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate<T = unknown>(expression: string, timeoutMs?: number): Promise<T> {
		const r = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
			"Runtime.evaluate",
			{ expression, awaitPromise: true, returnByValue: true },
			timeoutMs,
		);
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
		return r.result.value as T;
	}

	close(): void {
		try {
			this.ws.close();
		} catch {
			/* already closed */
		}
	}
}

function readPort(p: Paths): number | null {
	try {
		const n = Number(readFileSync(p.portFile, "utf8").split("\n")[0]);
		return n > 0 ? n : null;
	} catch {
		return null;
	}
}

/** GET a CDP HTTP endpoint on localhost as JSON. */
function httpJson<T>(port: number, route: string, timeoutMs = 3000): Promise<T> {
	return new Promise((resolve, reject) => {
		const req = http.get({ host: "127.0.0.1", port, path: route, timeout: timeoutMs }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (c: string) => (body += c));
			res.on("end", () => {
				try {
					resolve(JSON.parse(body) as T);
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				}
			});
		});
		req.on("timeout", () => req.destroy(new Error(`GET ${route} on port ${port} timed out`)));
		req.on("error", reject);
	});
}

const listTargets = (port: number): Promise<Target[]> => httpJson<Target[]>(port, "/json/list");

/** Connect to the workspace page (spec § Connection), or throw. */
async function workspace(port: number, vault: string): Promise<CdpConn> {
	const cands = workspaceCandidates(await listTargets(port), vault);
	if (!cands.length) throw new StError(`no workspace page on port ${port}`);
	for (const t of cands) {
		const c = await CdpConn.open(t.webSocketDebuggerUrl);
		if (cands.length === 1) return c;
		const popout = await c.evaluate<boolean>('document.body.classList.contains("is-popout-window")').catch(() => true);
		if (!popout) return c;
		c.close();
	}
	throw new StError(`no non-popout workspace page on port ${port}`);
}

/** Workspace connection that passed the identity check. */
async function connect(p: Paths, port: number): Promise<CdpConn> {
	const c = await workspace(port, p.vault);
	const name = await c.evaluate<string>("app.vault.getName()").catch(() => null);
	if (name !== p.vault) {
		c.close();
		throw new StError(`port ${port} is vault ${name ?? "(unknown)"}, expected ${p.vault}`);
	}
	return c;
}

async function waitReady(p: Paths, port: number, timeoutMs = PAGE_WAIT_MS): Promise<CdpConn> {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	while (Date.now() < deadline) {
		try {
			const c = await connect(p, port);
			if (await c.evaluate<boolean>("!!(window.app && app.workspace && app.workspace.layoutReady)").catch(() => false)) return c;
			c.close();
		} catch (e) {
			last = e instanceof Error ? e.message : String(e);
		}
		await sleep(400);
	}
	throw new StError(`the workspace didn't become ready on port ${port}${last ? ` (${last})` : ""}`);
}

async function closeBrowserAt(port: number): Promise<void> {
	const v = await httpJson<{ webSocketDebuggerUrl: string }>(port, "/json/version");
	const b = await CdpConn.open(v.webSocketDebuggerUrl);
	await b.send("Browser.close", {}, 5000).catch(() => {});
	b.close();
}

// ------------------------------------------------------------------- locks ---

async function selfHolder(cmd: string): Promise<LockHolder & { cmd: string }> {
	const started = (await listMarkedProcesses()).find((r) => r.pid === process.pid)?.started ?? "";
	return { pid: process.pid, started, cmd };
}

/** Poll for an exclusive lock, breaking stale ones; returns its release. */
async function waitLock(file: string, holder: LockHolder & { cmd: string }, boundMs: number, label: string, createDir = true): Promise<() => void> {
	const deadline = Date.now() + boundMs;
	let said = false;
	for (;;) {
		if (createDir) mkdirSync(path.dirname(file), { recursive: true });
		else if (!existsSync(path.dirname(file))) throw new StError(`${label}: ${path.dirname(file)} is gone (the instance was taken down)`);
		if (acquireLock(file, holder)) return () => void releaseIfOwner(file, holder);
		breakStaleLock(file, await listMarkedProcesses());
		if (!said) {
			let h: { pid?: number; cmd?: string } = {};
			try {
				h = JSON.parse(readFileSync(file, "utf8")) as typeof h;
			} catch {
				/* just released */
			}
			if (h.pid) {
				log(`waiting for ${label} held by pid ${h.pid} (${h.cmd ?? "?"})`);
				said = true;
			}
		}
		if (Date.now() > deadline) throw new StError(`timed out waiting for ${label}`);
		await sleep(250);
	}
}

// ------------------------------------------------------------- focus guard ---

/**
 * Run a guarded command (spec § Focus): unarmed when the instance is
 * frontmost at start; otherwise take `focus.lock`, check again, and arm the
 * guard only if the instance still isn't frontmost.
 */
async function guarded(p: Paths, holder: LockHolder & { cmd: string }, budget: number, mainPid: () => number | undefined, fn: (g: FocusGuard | null) => Promise<Outcome>): Promise<Outcome> {
	const frontIsInstance = (): boolean => {
		const m = mainPid();
		return !!m && frontmostPid() === m;
	};
	if (frontIsInstance()) {
		log("instance frontmost at start; guard not armed");
		return fn(null);
	}
	const release = await waitLock(p.focusLock, holder, FOCUS_LOCK_WAIT_MS, "the focus lock");
	try {
		if (frontIsInstance()) {
			log("instance frontmost at start; guard not armed");
			return await fn(null);
		}
		const lines: string[] = [];
		const g = new FocusGuard((pid) => pid === mainPid(), (m) => {
			lines.push(m);
			log(`  ${m}`);
		});
		g.start();
		let r: Outcome;
		try {
			r = await fn(g);
		} finally {
			g.stop();
		}
		if (g.steals > budget) return { ok: false, message: `${r.message}\nfocus steals: ${g.steals}, over the budget of ${budget}; the instance is left up\n${lines.join("\n")}` };
		return r;
	} finally {
		release();
	}
}

// ------------------------------------------------------------------ checks ---

function userObsidianJson(): Record<string, { path?: string; open?: boolean }> {
	try {
		const d = JSON.parse(readFileSync(path.join(homedir(), "Library/Application Support/obsidian/obsidian.json"), "utf8")) as { vaults?: Record<string, { path?: string; open?: boolean }> };
		return d.vaults ?? {};
	} catch {
		return {};
	}
}

function runGuard(p: Paths, mode: "launch" | "live", livePid?: number): GuardResult {
	let real = p.studio;
	try {
		real = realpathSync(p.studio);
	} catch {
		/* no studio */
	}
	const entry = Object.values(userObsidianJson()).find((v) => v.path === p.studio || v.path === real) ?? null;
	const r = guardDecision(
		{
			entry,
			socketExists: existsSync(CLI_SOCKET),
			cliAnswer: () => {
				const o = spawnSync("perl", ["-e", "alarm shift; exec @ARGV", "15", "obsidian", `vault=${p.vault}`, "eval", "code=app.vault.getName()"], { encoding: "utf8", timeout: 20_000 });
				return (o.stdout ?? "").replace(/^=>\s*/, "").replace(/"/g, "").trim() || null;
			},
		},
		p.vault,
	);
	if (mode === "live" && r.action === "refuse") {
		return {
			action: "refuse",
			message: `${p.vault} is open in your own Obsidian AND running in its isolated instance${livePid ? ` (pid ${livePid})` : ""} right now; both are writing the vault. Close the ${p.vault} window in your own Obsidian first, then run: npx tsx tools/smoke-test/st.ts restart ${p.wt}`,
		};
	}
	return r;
}

/** Socket check (spec § Teardown): no marked process holds the user's CLI socket, and cli:false held. */
async function socketProblems(p: Paths): Promise<string[]> {
	const problems: string[] = [];
	if (existsSync(path.join(p.home, ".obsidian-cli.sock"))) problems.push(`the instance created ${path.join(p.home, ".obsidian-cli.sock")} (cli:false didn't hold)`);
	const rows = await listMarkedProcesses();
	const pids = rows.filter((r) => isMain(r, p.userData) || hasToken(r.command, `${MARKER_KEY}=${p.runId}`)).map((r) => r.pid);
	if (pids.length) {
		const o = spawnSync("lsof", ["-a", "-p", pids.join(","), "-U", "-Fn"], { encoding: "utf8", timeout: 10_000 });
		if ((o.stdout ?? "").split("\n").some((l) => l === `n${CLI_SOCKET}`)) problems.push(`an instance process holds ${CLI_SOCKET}`);
	}
	return problems;
}

async function assertSocket(p: Paths): Promise<void> {
	const s = await socketProblems(p);
	if (s.length) throw new StError(`socket check failed: ${s.join("; ")}`);
}

function socketInodeNow(): number | null {
	try {
		return statSync(CLI_SOCKET).ino;
	} catch {
		return null;
	}
}

function userObsidianRunning(): boolean {
	const o = spawnSync("ps", ["-axww", "-o", "command="], { encoding: "utf8" });
	return (o.stdout ?? "").split("\n").some((l) => l.startsWith(`${OBSIDIAN_APP}/Contents/MacOS/Obsidian`) && !l.includes("--type=") && !l.includes("--user-data-dir="));
}

// ----------------------------------------------------------------- seeding ---

/** The env-injection context, resolved up front (login shells are slow), capped at 90 s. */
function buildSeedContext(p: Paths): { ok: true; ctx: SeedContext } | { ok: false; message: string } {
	const t0 = Date.now();
	const sh = loginShell();
	const bare = new Set<string>();
	const d = readDataJson(p.dataJson);
	if (d.ok) {
		const agents = [...Object.values(d.data), ...(Array.isArray(d.data.customAgents) ? (d.data.customAgents as unknown[]) : [])];
		for (const a of agents) {
			if (!a || typeof a !== "object") continue;
			const c = (a as { command?: unknown }).command;
			if (typeof c === "string" && c && !path.isAbsolute(c)) bare.add(c);
			for (const e of ((a as { env?: { key: string; value: string }[] }).env ?? [])) if (e.key === "CLAUDE_CODE_EXECUTABLE" && e.value && !path.isAbsolute(e.value)) bare.add(e.value);
		}
	}
	const resolved = new Map<string, string>();
	for (const c of bare) {
		if (Date.now() - t0 > SEED_BUDGET_MS) return { ok: false, message: `login shell too slow (over ${SEED_BUDGET_MS / 1000} s resolving agent commands)` };
		resolved.set(c, sh.resolve(c));
	}
	if (Date.now() - t0 > SEED_BUDGET_MS) return { ok: false, message: `login shell too slow (over ${SEED_BUDGET_MS / 1000} s)` };
	return { ok: true, ctx: { runId: p.runId, realHome: homedir(), loginPath: sh.path, resolveCommand: (c) => resolved.get(c) ?? c } };
}

// ---------------------------------------------------------------- launch -----

async function pluginLoaded(c: CdpConn, waitMs: number): Promise<boolean> {
	const deadline = Date.now() + waitMs;
	do {
		if (await c.evaluate<boolean>('!!app.plugins.plugins["agent-console"]').catch(() => false)) return true;
		await sleep(400);
	} while (Date.now() < deadline);
	return false;
}

/** The trust step through Playwright (role-based click), then disconnect without closing the instance. */
async function runTrust(port: number): Promise<string | null> {
	const { chromium } = await import("playwright-core");
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	try {
		const page = browser.contexts().flatMap((x) => x.pages()).find((pg) => pg.url().includes("index.html"));
		if (!page) throw new StError("no workspace page for the trust step");
		return (await trustAndLoad(page)).closedSettingsTab;
	} finally {
		// For a CDP-connected browser, close() disconnects; the instance keeps running.
		await browser.close().catch(() => {});
	}
}

/** Identity, plugin-loaded (trust when needed), socket check, then write state. */
async function settle(p: Paths, port: number, mainPid: number, mainStarted: string, hookPath: string, guard: FocusGuard | null): Promise<Outcome> {
	let c = await waitReady(p, port);
	try {
		if (!(await pluginLoaded(c, 10_000))) {
			log("  Agent Console not loaded; running the trust step");
			const tab = await runTrust(port);
			if (tab) log(`  closed the settings window Obsidian opened after the trust prompt (tab: ${tab})`);
			c.close();
			c = await waitReady(p, port);
			if (!(await pluginLoaded(c, 10_000))) return { ok: false, message: "Agent Console didn't load in the isolated instance" };
		}
		guard?.recheck();
		await assertSocket(p);
		const prev = readInstanceState(p.state);
		const s: InstanceState = { schema: STATE_SCHEMA, runId: p.runId, markerKey: MARKER_KEY, vault: p.vault, userData: p.userData, home: p.home, mainPid, mainStarted, port, hookPath, startedAt: prev?.mainPid === mainPid ? prev.startedAt : Date.now() };
		writeJsonAtomic(p.state, s);
		return { ok: true, message: `${p.vault} up (pid ${mainPid}, port ${port})` };
	} finally {
		c.close();
	}
}

async function launchFresh(p: Paths, onPid: (pid: number) => void, guard: () => FocusGuard | null, hookPath: string, holder: LockHolder): Promise<Outcome> {
	mkdirSync(p.userData, { recursive: true });
	mkdirSync(p.home, { recursive: true });
	const oj = path.join(p.userData, "obsidian.json");
	if (!existsSync(oj)) writeFileSync(oj, obsidianJson(p.studio, p.runId, Date.now()));
	const pin = readAppPin(p.main);
	const drift = pinDriftNote(userObsidianVersion(), pin);
	if (drift) log(`  note: ${drift.replace("captures use", "smoke instances use").replace(/ To reshoot.*$/, "")}`);
	for (const f of staleAsars(readdirSync(p.userData), pin.version)) {
		log(`  removing ${f} (Obsidian's own update; smoke instances run the pinned ${pin.version})`);
		rmSync(path.join(p.userData, f), { force: true });
	}
	if (!existsSync(path.join(p.userData, asarName(pin.version)))) {
		log(`  staging Obsidian ${pin.version} (downloads from obsidianmd/obsidian-releases if not cached)`);
		stageAppAsar(await resolveAppAsar(pin), p.userData);
	}
	const l = await launchInstance({ userData: p.userData, home: p.home });
	onPid(l.mainPid);
	guard()?.recheck();
	const c = await waitReady(p, l.port);
	const v = await c.evaluate<string | null>('(() => { const v = require("electron").ipcRenderer.sendSync("version"); return typeof v === "string" ? v : null; })()').catch(() => null);
	c.close();
	const vp = appVersionProblem(v, pin);
	if (vp) {
		// Never leave a wrong-version instance for a later `up` to adopt.
		const s = await signalMarked(p.markers, [], nodeTeardownOps(log, () => closeBrowserAt(l.port)), holder, p.teardownLock, { label: "stop wrong-version instance" });
		rmSync(p.teardownLock, { force: true });
		if (s.status !== "ok") return { ok: false, message: `${vp}; couldn't stop it (${s.status === "busy" ? "another teardown holds the lock" : "can't read the process table"}): run st down ${p.wt}` };
		if (s.left.length) return { ok: false, message: `${vp}; still running after SIGKILL: ${s.left.map((x) => x.pid).join(", ")}` };
		return { ok: false, message: `${vp} (instance stopped)` };
	}
	return settle(p, l.port, l.mainPid, l.mainStarted, hookPath, guard());
}

async function adoptLive(p: Paths, guard: FocusGuard | null): Promise<Outcome> {
	const m = await liveMain(p);
	if (!m) return { ok: false, message: "the instance exited while adopting it; run up again" };
	const port = readPort(p);
	if (!port) return { ok: false, message: `instance pid ${m.pid} is live but has no DevToolsActivePort; run st down ${p.wt}` };
	const st = readInstanceState(p.state);
	const hookPath = st?.hookPath ?? SETTINGS_WINDOW_HOOK;
	try {
		const c = await connect(p, port);
		await c.evaluate(disarmExpression(hookPath)).catch(() => {});
		c.close();
	} catch {
		return { ok: false, message: `instance pid ${m.pid} is live but doesn't answer as ${p.vault}; run st down ${p.wt}` };
	}
	const r = await settle(p, port, m.pid, m.started, hookPath, guard);
	return r.ok ? { ok: true, message: `already up (pid ${m.pid}, port ${port})` } : r;
}

function cleanStale(p: Paths): void {
	for (const f of [p.teardownLock, p.portFile, p.state]) rmSync(f, { force: true });
}

function realDeps(p: Paths, holder: LockHolder & { cmd: string }, budget: number) {
	let ctx: SeedContext | null = null;
	let pid: number | undefined;
	let guard: FocusGuard | null = null;
	return {
		pid: () => pid,
		setPid: (n: number) => (pid = n),
		guardRef: () => guard,
		seedContext: (): SeedResult => {
			const r = buildSeedContext(p);
			if (!r.ok) return r;
			ctx = r.ctx;
			return { ok: true };
		},
		readData: () => readDataJson(p.dataJson),
		writeData: (d: Record<string, unknown>) => {
			if (!ctx) throw new StError("internal: env context missing");
			writeJsonAtomic(p.dataJson, seedAgentEnv(d, ctx, MARKER_KEY));
		},
		withFocusLock: (fn: () => Promise<Outcome>) =>
			guarded(p, holder, budget, () => pid, async (g) => {
				guard = g;
				return fn();
			}),
	};
}

// ---------------------------------------------------------------- commands ---

async function cmdUp(p: Paths, holder: LockHolder & { cmd: string }): Promise<Outcome> {
	await sweepTrash(p);
	const d = realDeps(p, holder, STEAL_BUDGET.up);
	const live = await liveMain(p);
	if (live) d.setPid(live.pid);
	return upSequence({
		wt: p.wt,
		scanLive: async () => {
			const m = await liveMain(p);
			if (m) d.setPid(m.pid);
			return !!m;
		},
		guard: (mode) => runGuard(p, mode, d.pid()),
		seedContext: d.seedContext,
		withFocusLock: d.withFocusLock,
		adopt: () => adoptLive(p, d.guardRef()),
		cleanStale: () => cleanStale(p),
		readData: d.readData,
		writeData: d.writeData,
		launch: () => launchFresh(p, d.setPid, d.guardRef, SETTINGS_WINDOW_HOOK, holder),
		log,
	});
}

async function requireUp(p: Paths): Promise<{ state: InstanceState; port: number }> {
	const state = readInstanceState(p.state);
	const m = await liveMain(p).catch((e: unknown) => {
		const hint = process.env.SANDBOX_SESSION_ID ? " ASBX agent sandboxing is on in this session and blocks ps; run st from a normal Terminal." : "";
		throw new StError(`can't list processes (${e instanceof Error ? e.message : String(e)}).${hint}`);
	});
	if (!state || !m) throw new StError(`${p.vault} isn't up (status: ${classifyInstance(!!state, !!m)}); run: npx tsx tools/smoke-test/st.ts up ${p.wt}`);
	if (!stateMatchesLive(state, m)) throw new StError(`${p.vault}'s recorded state (pid ${state.mainPid}) doesn't match the running instance (pid ${m.pid}); run: npx tsx tools/smoke-test/st.ts up ${p.wt} (it adopts the instance and rewrites the state)`);
	const port = readPort(p) ?? state.port;
	return { state, port };
}

async function cmdRestart(p: Paths, holder: LockHolder & { cmd: string }): Promise<Outcome> {
	const { state, port } = await requireUp(p);
	if (!existsSync(state.hookPath)) throw new StError(`the recorded settings hook ${state.hookPath} is missing`);
	const d = realDeps(p, holder, STEAL_BUDGET.restart);
	d.setPid(state.mainPid);
	const markersAny = async () => (await listMarkedProcesses()).some((r) => isMain(r, p.userData) || hasToken(r.command, `${MARKER_KEY}=${p.runId}`));
	return restartSequence({
		wt: p.wt,
		guard: () => runGuard(p, "live", state.mainPid),
		seedContext: d.seedContext,
		withFocusLock: d.withFocusLock,
		closeBrowser: async () => {
			const c = await connect(p, port).catch(() => null);
			if (!c) {
				log(`  port ${port} doesn't answer as ${p.vault}; skipped Browser.close`);
				return;
			}
			c.close();
			await closeBrowserAt(port).catch(() => {});
		},
		waitMainGone: async (ms) => {
			const deadline = Date.now() + ms;
			while (Date.now() < deadline) {
				if (!(await liveMain(p))) return true;
				await sleep(250);
			}
			return false;
		},
		stopMarked: async () => {
			if (!(await markersAny())) return [];
			const r = await signalMarked(p.markers, [], nodeTeardownOps(log), holder, p.teardownLock, { label: "restart" });
			rmSync(p.teardownLock, { force: true });
			if (r.status === "busy") throw new StError("another teardown holds the instance's teardown lock; not relaunching");
			if (r.status === "unreadable") throw new StError("can't read the process table; not relaunching");
			return r.left.map((x) => x.pid);
		},
		readData: d.readData,
		writeData: d.writeData,
		launch: async () => {
			rmSync(p.portFile, { force: true });
			const r = await launchFresh(p, d.setPid, d.guardRef, state.hookPath, holder);
			// The old state names a dead pid; drop it. A new instance left up (plugin didn't load) shows as orphan for `up` to adopt; a wrong-version one was stopped.
			if (!r.ok) rmSync(p.state, { force: true });
			return r.ok ? { ok: true, message: r.message.replace(" up (", " restarted (") } : { ok: false, message: r.message.replace("didn't load in the isolated instance", "didn't load after restart") };
		},
		log,
	});
}

async function cmdReload(p: Paths, holder: LockHolder & { cmd: string }, hard: boolean): Promise<Outcome> {
	const { state, port } = await requireUp(p);
	return guarded(p, holder, STEAL_BUDGET.reload, () => state.mainPid, async () => {
		const c = await connect(p, port);
		await c.evaluate(disarmExpression(state.hookPath)).catch(() => {});
		if (hard) await c.send("Page.reload", {}).catch(() => {});
		else await c.evaluate('app.commands.executeCommandById("app:reload")', 5000).catch(() => {});
		c.close();
		await sleep(1500);
		const r = await waitReady(p, port);
		await r.evaluate(disarmExpression(state.hookPath)).catch(() => {});
		r.close();
		await assertSocket(p);
		return { ok: true, message: `${p.vault} reloaded (${hard ? "Page.reload" : "app:reload"})` };
	});
}

async function cmdSettings(p: Paths, tab: string | undefined, f: ParsedArgs["flags"]): Promise<Outcome> {
	const { state, port } = await requireUp(p);
	if (!existsSync(state.hookPath)) throw new StError(`the recorded settings hook ${state.hookPath} is missing`);
	const prefix = settingsWindowTitlePrefix(p.vault);
	const c = await connect(p, port);
	try {
		if (f.close) {
			const n = await c.evaluate<number>(closeSettingsExpression(prefix));
			return { ok: true, message: `settings closed${n ? ` (destroyed ${n} hidden window(s))` : ""}` };
		}
		if (!tab) throw new StError("settings: missing <tab>");
		if (f.hidden) {
			let r: string;
			try {
				r = await c.evaluate<string>(hiddenSettingsExpression(state.hookPath, prefix, tab), 20_000);
			} catch (e) {
				const m = e instanceof Error ? e.message : String(e);
				if (/context was destroyed|connection closed|Inspected target navigated/i.test(m)) {
					return { ok: false, message: "page reloaded during settings open; hook disarmed by beforeunload (verify with st status)" };
				}
				throw e;
			}
			if (r !== "ok") return { ok: false, message: r };
		} else {
			if (frontmostPid() !== state.mainPid) return { ok: false, message: `the instance isn't frontmost, so a visible settings window would take focus; use --hidden, or run st focus ${p.wt} first` };
			await c.evaluate(disarmExpression(state.hookPath)).catch(() => {});
			await c.evaluate(closeSettingsExpression(prefix));
			await c.evaluate(`(() => { app.setting.open(); app.setting.openTabById(${JSON.stringify(tab)}); return true; })()`);
		}
		await sleep(300);
		const active = await c.evaluate<string | null>("(app.setting.activeTab && app.setting.activeTab.id) || null");
		if (active !== tab) return { ok: false, message: `settings opened on tab ${active ?? "(none)"}, not ${tab}` };
		return { ok: true, message: `settings open on ${active}${f.hidden ? " (hidden; close with --close)" : ""}` };
	} finally {
		c.close();
	}
}

/** Remove trash folders a killed `down` left for this studio. */
async function sweepTrash(p: Paths): Promise<void> {
	let entries: string[] = [];
	try {
		entries = readdirSync(p.instances);
	} catch {
		return;
	}
	// Only list processes when this studio has a trash folder (ps may be blocked).
	if (!staleTrash(entries, p.vault, new Set()).length) return;
	let rows: MarkedRow[];
	try {
		rows = await listMarkedProcesses();
	} catch (err) {
		log(`  ⚠ can't list processes (${err instanceof Error ? err.message : String(err)}); left trash folders in place`);
		return;
	}
	const live = new Set(rows.map((r) => r.pid));
	for (const e of staleTrash(entries, p.vault, live)) {
		try {
			rmSync(path.join(p.instances, e), { recursive: true, force: true });
		} catch (err) {
			log(`  ⚠ couldn't remove leftover ${path.join(p.instances, e)} (${err instanceof Error ? err.message : String(err)}); delete it by hand`);
		}
	}
}

async function cmdDown(p: Paths, holder: LockHolder & { cmd: string }): Promise<Outcome> {
	await sweepTrash(p);
	rmSync(p.teardownLock, { force: true });
	const sockBefore = socketInodeNow();
	const port = readPort(p) ?? readInstanceState(p.state)?.port ?? null;
	let close: (() => Promise<void>) | undefined;
	if (port) {
		const c = await connect(p, port).catch((e: unknown) => {
			log(`  ${e instanceof Error ? e.message : String(e)}; skipped Browser.close`);
			return null;
		});
		if (c) {
			c.close();
			close = () => closeBrowserAt(port);
		}
	}
	const r = await signalMarked(p.markers, [], nodeTeardownOps(log, close), holder, p.teardownLock, { label: `down ${p.vault}` });
	if (r.status === "unreadable") return { ok: false, message: "can't read the process table; instance files kept" };
	if (r.status === "busy") return { ok: false, message: "another teardown holds the lock; instance files kept" };
	if (r.left.length) return { ok: false, message: `marked process(es) still running: ${r.left.map((x) => x.pid).join(", ")}; instance files kept` };
	// Strip before removing the instance folder, so a failed strip leaves `down` re-runnable.
	const d = readDataJson(p.dataJson);
	if (d.ok && JSON.stringify(d.data).includes(`"${MARKER_KEY}"`)) writeJsonAtomic(p.dataJson, stripSmokeMarker(d.data));
	if (!d.ok && d.reason === "unreadable") log(`  ⚠ ${p.dataJson} is unreadable, so its ${MARKER_KEY} rows weren't removed; a non-isolated spawn will refuse it until it's fixed`);
	// Move the folder aside first: a waiting `up` may recreate it and take op.lock
	// while a long recursive delete would still be running.
	const trash = path.join(p.instances, `.trash-${p.vault}-${process.pid}-${Date.now()}`);
	try {
		renameSync(p.inst, trash);
	} catch (e) {
		// Already gone (removed outside st): the stop itself succeeded.
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
	}
	try {
		rmSync(trash, { recursive: true, force: true });
	} catch (e) {
		log(`  ⚠ stopped, but couldn't delete ${trash} (${e instanceof Error ? e.message : String(e)}); the next st down ${p.wt} or teardown retries it`);
	}
	if (sockBefore !== null && userObsidianRunning() && socketInodeNow() !== sockBefore) return { ok: false, message: `stopped, but ${CLI_SOCKET} changed while your Obsidian runs` };
	return { ok: true, message: `${p.vault} down` };
}

async function cmdStatus(wt?: string): Promise<Outcome> {
	const studios = path.join(mainRoot(), "tools/smoke-test/studios");
	const instances = path.join(studios, ".instances");
	const names = new Set<string>();
	try {
		for (const n of readdirSync(instances)) if (n.startsWith("ST-")) names.add(n.slice(3));
	} catch {
		/* none */
	}
	const rows = await listMarkedProcesses();
	for (const r of rows) {
		const m = new RegExp(`--user-data-dir=${instances.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/ST-([^/ ]+)/userdata(?: |$)`).exec(r.command);
		if (m && !r.command.includes("--type=")) names.add(m[1]);
	}
	const list = [...names].filter((n) => !wt || n === wt).sort();
	if (!list.length) return { ok: true, message: "no isolated smoke instances" };
	const lines: string[] = [];
	for (const n of list) {
		const p = pathsFor(n);
		const st = readInstanceState(p.state);
		const main = rows.find((r) => isMain(r, p.userData));
		const status = !st ? classifyInstance(false, !!main) : stateMatchesLive(st, main) ? "up" : main ? "orphan" : "dead";
		let extra = "";
		if (main) {
			const port = readPort(p);
			const up = st ? Math.round((Date.now() - st.startedAt) / 60000) : null;
			const sock = await socketProblems(p);
			extra = ` pid ${main.pid} port ${port ?? "?"}${up !== null ? ` up ${up} min` : ""} socket ${sock.length ? `PROBLEM: ${sock.join("; ")}` : "ok"}`;
		}
		lines.push(`${p.vault.padEnd(32)} ${status}${extra}`);
	}
	return { ok: true, message: lines.join("\n") };
}

async function main(argv: string[]): Promise<number> {
	if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
		log(helpText());
		return argv.length ? 0 : 2;
	}
	const a = parseArgs(argv);
	if ("error" in a) {
		log(a.error);
		return 2;
	}
	const run = async (): Promise<Outcome> => {
		if (a.cmd === "status") return cmdStatus(a.wt);
		const p = pathsFor(a.wt as string);
		if (a.cmd === "_clean-kiro") {
			const bad = validateCleanPaths(a.paths, p.studios, p.wt);
			if (bad) return { ok: false, message: bad };
			const removed = [...new Set(a.paths.map((x) => path.normalize(x)))].flatMap((x) => cleanKiroSessionRecords(x));
			return { ok: true, message: removed.length ? `removed Kiro session record(s): ${removed.join(", ")}` : "no Kiro session records to remove" };
		}
		if (a.cmd === "_guard") {
			const g = runGuard(p, "launch");
			if (g.action === "warn") log(`⚠ ${g.message}`);
			return { ok: g.action !== "refuse", message: g.action === "refuse" ? g.message : "guard ok" };
		}
		const lifecycle = a.cmd === "up" || a.cmd === "restart" || a.cmd === "reload" || a.cmd === "down" || a.cmd === "settings";
		if (lifecycle && a.cmd !== "up" && !existsSync(p.inst)) {
			if (a.cmd === "down") await sweepTrash(p);
			return a.cmd === "down" ? { ok: true, message: `${p.vault} has no isolated instance; nothing to stop` } : { ok: false, message: `${p.vault} isn't up; run: npx tsx tools/smoke-test/st.ts up ${p.wt}` };
		}
		const retry = `cd ${p.main} && npx tsx ${path.relative(p.main, __filename).startsWith("..") ? __filename : path.relative(p.main, __filename)} ${argv.join(" ")}`;
		// eval/cdp/screenshot only need CDP and ps; lifecycle commands and focus need System Events and open too.
		const pre = lifecycle || a.cmd === "focus" ? preflightCore(retry) : [];
		if (pre.length) return { ok: false, message: `preflight failed:\n- ${pre.join("\n- ")}` };
		if (lifecycle) {
			const holder = await selfHolder(`st ${a.cmd} ${p.wt}`);
			if (a.cmd === "up" && !existsSync(p.studio)) return { ok: false, message: `no studio at ${p.studio}; run tools/smoke-test/smoke-test-spawn.sh ${p.wt} --isolated` };
			const release = await waitLock(p.opLock, holder, OP_LOCK_WAIT_MS, `the ${p.vault} op lock`, a.cmd === "up");
			try {
				if (a.cmd === "up") return await cmdUp(p, holder);
				if (a.cmd === "restart") return await cmdRestart(p, holder);
				if (a.cmd === "reload") return await cmdReload(p, holder, !!a.flags.hard);
				if (a.cmd === "settings") return await cmdSettings(p, a.rest[0], a.flags);
				return await cmdDown(p, holder);
			} finally {
				// `down` removes the instance folder (and the lock in it) on success.
				if (existsSync(p.inst)) release();
			}
		}
		const { state, port } = await requireUp(p);
		if (a.cmd === "focus") {
			(await connect(p, port)).close();
			spawnSync("osascript", ["-e", `tell application "System Events" to set frontmost of (first application process whose unix id is ${state.mainPid}) to true`], { timeout: 5000 });
			return { ok: true, message: `focused ${p.vault} (pid ${state.mainPid})` };
		}
		const c = await connect(p, port);
		try {
			if (a.cmd === "eval") {
				const v = await c.evaluate(a.rest.join(" "));
				process.stdout.write(`${JSON.stringify(v === undefined ? null : v)}\n`);
				return { ok: true, message: "" };
			}
			if (a.cmd === "cdp") {
				const params = a.rest[1] ? (JSON.parse(a.rest[1]) as Record<string, unknown>) : {};
				const v = await c.send(a.rest[0], params);
				process.stdout.write(`${JSON.stringify(v ?? null)}\n`);
				return { ok: true, message: "" };
			}
			// screenshot
			const [file, selector] = a.rest;
			let clip: Record<string, number> | undefined;
			if (selector) {
				const r = await c.evaluate<{ x: number; y: number; width: number; height: number } | null>(
					`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
				);
				if (!r) return { ok: false, message: `no element matches ${selector}` };
				clip = { ...r, scale: 1 };
			}
			const shot = await c.send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
			writeFileSync(path.resolve(file), Buffer.from(shot.data, "base64"));
			return { ok: true, message: `wrote ${path.resolve(file)}` };
		} finally {
			c.close();
		}
	};
	try {
		const r = await run();
		if (r.message) (r.ok ? log : (m: string) => log(`✗ ${m}`))(r.message);
		return r.ok ? 0 : 1;
	} catch (e) {
		log(`✗ ${e instanceof Error ? e.message : String(e)}`);
		return 1;
	}
}

if (require.main === module) {
	void main(process.argv.slice(2)).then((code) => process.exit(code));
}
