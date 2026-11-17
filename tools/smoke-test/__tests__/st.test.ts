// Unit tests for the `st` smoke driver's pure parts and sequencers.
// Spec: [[Isolated smoke-test instances]] (§ st, § Mode guard G, § Agent
// environment, § Teardown, § Settings windows).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	STATE_SCHEMA,
	classifyInstance,
	guardDecision,
	helpText,
	hiddenSettingsExpression,
	parseArgs,
	readDataJson,
	readInstanceState,
	restartSequence,
	staleAsars,
	stateMatchesLive,
	stripSmokeMarker,
	upSequence,
	validateCleanPaths,
	workspaceCandidates,
	type RestartDeps,
	type UpDeps,
} from "../st";

describe("parseArgs", () => {
	it("parses public commands and flags", () => {
		expect(parseArgs(["up", "a"])).toMatchObject({ cmd: "up", wt: "a" });
		expect(parseArgs(["reload", "a", "--hard"])).toMatchObject({ cmd: "reload", wt: "a", flags: { hard: true } });
		expect(parseArgs(["eval", "a", "1+1"])).toMatchObject({ cmd: "eval", wt: "a", rest: ["1+1"] });
		expect(parseArgs(["settings", "a", "appearance", "--hidden"])).toMatchObject({ cmd: "settings", rest: ["appearance"], flags: { hidden: true } });
		expect(parseArgs(["settings", "a", "--close"])).toMatchObject({ cmd: "settings", flags: { close: true } });
		expect(parseArgs(["status"])).toMatchObject({ cmd: "status", wt: undefined });
	});
	it("parses internal commands", () => {
		expect(parseArgs(["_guard", "a"])).toMatchObject({ cmd: "_guard", wt: "a" });
		expect(parseArgs(["_clean-kiro", "a", "--path", "/p", "--path", "/q"])).toMatchObject({ cmd: "_clean-kiro", wt: "a", paths: ["/p", "/q"] });
	});
	it("rejects unknown commands, missing worktree, bad flag combos and a bad worktree name", () => {
		expect(parseArgs(["nope", "a"])).toHaveProperty("error");
		expect(parseArgs(["up"])).toHaveProperty("error");
		expect(parseArgs(["settings", "a", "x", "--hidden", "--close"])).toHaveProperty("error");
		expect(parseArgs(["settings", "a"])).toHaveProperty("error");
		expect(parseArgs(["up", "../x"])).toHaveProperty("error");
		expect(parseArgs(["reload", "a", "--bogus"])).toHaveProperty("error");
	});
	it("keeps internal commands out of help", () => {
		const h = helpText();
		expect(h).toContain("up <wt>");
		expect(h).not.toContain("_guard");
		expect(h).not.toContain("_clean-kiro");
	});
});

describe("workspaceCandidates", () => {
	const t = (type: string, url: string, title: string) => ({ id: title, type, url, title, webSocketDebuggerUrl: `ws://${title}` });
	it("keeps page targets on index.html that aren't this vault's settings window", () => {
		const out = workspaceCandidates(
			[
				t("page", "app://obsidian.md/index.html", "ST-a - Obsidian 1.15.0"),
				t("page", "about:blank", "pop"),
				t("page", "app://obsidian.md/index.html", "Settings - ST-a - Obsidian 1.15.0"),
				t("service_worker", "app://obsidian.md/index.html", "sw"),
			],
			"ST-a",
		);
		expect(out.map((x) => x.title)).toEqual(["ST-a - Obsidian 1.15.0"]);
	});
});

describe("classifyInstance", () => {
	it("reports up, dead, orphan and none", () => {
		expect(classifyInstance(true, true)).toBe("up");
		expect(classifyInstance(true, false)).toBe("dead");
		expect(classifyInstance(false, true)).toBe("orphan");
		expect(classifyInstance(false, false)).toBe("none");
	});
});

describe("guardDecision (G)", () => {
	let calls = 0;
	const cli = (answer: string | null) => () => {
		calls++;
		return answer;
	};
	beforeEach(() => (calls = 0));
	it("refuses an entry with open: true without calling the CLI", () => {
		expect(guardDecision({ entry: { open: true }, socketExists: true, cliAnswer: cli("x") }, "ST-a").action).toBe("refuse");
		expect(calls).toBe(0);
	});
	it("refuses when the user's CLI answers as this vault", () => {
		expect(guardDecision({ entry: {}, socketExists: true, cliAnswer: cli("ST-a") }, "ST-a").action).toBe("refuse");
	});
	it("warns for a stale entry that isn't open now", () => {
		expect(guardDecision({ entry: {}, socketExists: true, cliAnswer: cli("donivatamazondotcom") }, "ST-a").action).toBe("warn");
	});
	it("never calls the CLI when the socket is absent or there is no entry", () => {
		expect(guardDecision({ entry: {}, socketExists: false, cliAnswer: cli("ST-a") }, "ST-a").action).toBe("warn");
		expect(guardDecision({ entry: null, socketExists: true, cliAnswer: cli("ST-a") }, "ST-a").action).toBe("ok");
		expect(calls).toBe(0);
	});
});

describe("stateMatchesLive", () => {
	it("needs the same pid and start time", () => {
		const s = { mainPid: 5, mainStarted: "Tue Nov 10 20:41:00 2026" };
		expect(stateMatchesLive(s, { pid: 5, started: "Tue Nov 10 20:41:00 2026" })).toBe(true);
		expect(stateMatchesLive(s, { pid: 6, started: "Tue Nov 10 20:41:00 2026" })).toBe(false);
		expect(stateMatchesLive(s, { pid: 5, started: "Wed Nov 11 01:00:00 2026" })).toBe(false);
		expect(stateMatchesLive(s, undefined)).toBe(false);
		expect(stateMatchesLive(null, { pid: 5, started: "x" })).toBe(false);
	});
});

describe("stripSmokeMarker", () => {
	it("removes AC_SMOKE_RUN rows from every agent and keeps everything else", () => {
		const d = {
			kiro: { command: "/k", env: [{ key: "HOME", value: "/u" }, { key: "AC_SMOKE_RUN", value: "st-a" }] },
			customAgents: [{ id: "c", env: [{ key: "AC_SMOKE_RUN", value: "st-a" }, { key: "X", value: "1" }] }],
			other: 1,
		};
		const out = stripSmokeMarker(d);
		expect(JSON.stringify(out)).not.toContain("AC_SMOKE_RUN");
		expect(out.kiro).toEqual({ command: "/k", env: [{ key: "HOME", value: "/u" }] });
		expect(out.other).toBe(1);
		expect(JSON.stringify(d)).toContain("AC_SMOKE_RUN");
	});
});

describe("staleAsars", () => {
	it("lists every Obsidian asar except the pinned one (Obsidian self-updates into persistent user data)", () => {
		expect(staleAsars(["obsidian-1.15.1.asar", "obsidian-1.15.0.asar", "obsidian.json", "obsidian-1.14.9.asar.tmp"], "1.15.0")).toEqual(["obsidian-1.15.1.asar"]);
		expect(staleAsars(["obsidian-1.15.0.asar"], "1.15.0")).toEqual([]);
	});
});

describe("readDataJson / readInstanceState", () => {
	let dir: string;
	beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "st-data-"))));
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	it("reports missing and unreadable without touching the file", () => {
		expect(readDataJson(path.join(dir, "data.json"))).toEqual({ ok: false, reason: "missing" });
		writeFileSync(path.join(dir, "data.json"), '{"a":');
		expect(readDataJson(path.join(dir, "data.json"))).toEqual({ ok: false, reason: "unreadable" });
		expect(readFileSync(path.join(dir, "data.json"), "utf8")).toBe('{"a":');
	});
	it("refuses a newer state schema", () => {
		const f = path.join(dir, "state.json");
		writeFileSync(f, JSON.stringify({ schema: STATE_SCHEMA + 1 }));
		expect(() => readInstanceState(f)).toThrow(/newer/);
		writeFileSync(f, JSON.stringify({ schema: STATE_SCHEMA, mainPid: 3 }));
		expect(readInstanceState(f)?.mainPid).toBe(3);
		expect(readInstanceState(path.join(dir, "none.json"))).toBeNull();
	});
});

describe("validateCleanPaths (_clean-kiro)", () => {
	let base: string;
	let studios: string;
	beforeEach(() => {
		base = realpathSync(mkdtempSync(path.join(tmpdir(), "st-clean-")));
		studios = path.join(base, "studios");
		mkdirSync(studios);
	});
	afterEach(() => rmSync(base, { recursive: true, force: true }));
	it("accepts the studio path and the realpath form after the studio is deleted", () => {
		expect(validateCleanPaths([path.join(studios, "ST-a")], studios, "a")).toBeNull();
		expect(validateCleanPaths([path.join(realpathSync(studios), "ST-a", "sub")], studios, "a")).toBeNull();
	});
	it("refuses empty, relative and outside paths", () => {
		expect(validateCleanPaths([""], studios, "a")).toMatch(/empty/);
		expect(validateCleanPaths(["studios/ST-a"], studios, "a")).toMatch(/absolute/);
		expect(validateCleanPaths([path.join(studios, "ST-ab")], studios, "a")).toMatch(/outside/);
		expect(validateCleanPaths(["/"], studios, "a")).toMatch(/outside/);
		expect(validateCleanPaths([], studios, "a")).toMatch(/--path/);
	});
});

describe("hiddenSettingsExpression", () => {
	const e = hiddenSettingsExpression("/hook.cjs", "Settings - ST-a - ", "appearance");
	it("arms after registering a beforeunload disarm and cleans both up in finally", () => {
		expect(e.indexOf('addEventListener("beforeunload"')).toBeGreaterThan(-1);
		expect(e.indexOf('addEventListener("beforeunload"')).toBeLessThan(e.indexOf("hook.armOnce()"));
		const fin = e.slice(e.indexOf("finally"));
		expect(fin).toContain("hook.disarm()");
		expect(fin).toContain('removeEventListener("beforeunload"');
	});
	it("keeps the reuse rule, the show conceal and the hook path", () => {
		expect(e).toContain("400");
		expect(e).toContain('sw.on("show"');
		expect(e).toContain('"/hook.cjs"');
		expect(e).toContain('"Settings - ST-a - "');
	});
});

// ------------------------------------------------------------ sequencers ----

function fakeRestart(over: Partial<RestartDeps> = {}) {
	const log: string[] = [];
	const deps: RestartDeps = {
		guard: () => ({ action: "ok", message: "" }),
		seedContext: () => {
			log.push("seed");
			return { ok: true };
		},
		closeBrowser: async () => void log.push("close"),
		waitMainGone: async () => true,
		stopMarked: async () => [],
		readData: () => ({ ok: true, data: {} }),
		writeData: () => void log.push("write"),
		launch: async () => void log.push("launch"),
		log: (m) => void log.push(`log:${m}`),
		...over,
	};
	return { deps, log };
}

describe("restartSequence", () => {
	it("refuses before the quit when G refuses", async () => {
		const { deps, log } = fakeRestart({ guard: () => ({ action: "refuse", message: "both writers" }) });
		expect(await restartSequence(deps)).toMatchObject({ ok: false });
		expect(log).not.toContain("close");
	});
	it("quits, injects, relaunches", async () => {
		const { deps, log } = fakeRestart();
		expect(await restartSequence(deps)).toMatchObject({ ok: true });
		expect(log.filter((l) => !l.startsWith("log:"))).toEqual(["seed", "close", "write", "launch"]);
	});
	it("T12b: a marked process surviving SIGKILL → non-zero naming it, no write, no relaunch", async () => {
		const { deps, log } = fakeRestart({ waitMainGone: async () => false, stopMarked: async () => [4242] });
		const r = await restartSequence(deps);
		expect(r.ok).toBe(false);
		expect(r.message).toContain("4242");
		expect(log).not.toContain("write");
		expect(log).not.toContain("launch");
	});
	it("prints the forced-quit line only when the main process had to be killed", async () => {
		const { deps, log } = fakeRestart({ waitMainGone: async () => false, stopMarked: async () => [] });
		expect((await restartSequence(deps)).ok).toBe(true);
		expect(log.some((l) => l.includes("forced quit"))).toBe(true);
	});
	it("a clean quit with leftover agent processes stops them without claiming a forced quit", async () => {
		let stopped = 0;
		const { deps, log } = fakeRestart({ stopMarked: async () => (stopped++, []) });
		expect((await restartSequence(deps)).ok).toBe(true);
		expect(stopped).toBe(1);
		expect(log.some((l) => l.includes("forced quit"))).toBe(false);
	});
	it("a leftover agent that survives SIGKILL after a clean quit blocks the relaunch", async () => {
		const { deps, log } = fakeRestart({ stopMarked: async () => [77] });
		const r = await restartSequence(deps);
		expect(r.ok).toBe(false);
		expect(r.message).toContain("77");
		expect(log).not.toContain("launch");
	});
	it("doesn't write or launch on an unreadable data.json", async () => {
		const { deps, log } = fakeRestart({ readData: () => ({ ok: false, reason: "unreadable" }) });
		expect((await restartSequence(deps)).ok).toBe(false);
		expect(log).not.toContain("write");
		expect(log).not.toContain("launch");
	});
});

function fakeUp(scans: boolean[], over: Partial<UpDeps> = {}) {
	const log: string[] = [];
	let i = 0;
	const deps: UpDeps = {
		scanLive: async () => scans[Math.min(i++, scans.length - 1)],
		guard: () => {
			log.push("guard");
			return { action: "ok", message: "" };
		},
		seedContext: () => {
			log.push("seed");
			return { ok: true };
		},
		withFocusLock: async (fn) => {
			log.push("focus.lock");
			return fn();
		},
		adopt: async () => {
			log.push("adopt");
			return { ok: true, message: "already up" };
		},
		cleanStale: () => void log.push("clean"),
		readData: () => ({ ok: true, data: {} }),
		writeData: () => void log.push("write"),
		launch: async () => {
			log.push("launch");
			return { ok: true, message: "up" };
		},
		log: (m) => void log.push(`log:${m}`),
		...over,
	};
	return { deps, log };
}

describe("upSequence", () => {
	const steps = (l: string[]) => l.filter((x) => !x.startsWith("log:"));
	it("fresh: G and seed before focus.lock, then clean, write, launch", async () => {
		const { deps, log } = fakeUp([false, false]);
		expect((await upSequence(deps)).ok).toBe(true);
		expect(steps(log)).toEqual(["guard", "seed", "focus.lock", "clean", "write", "launch"]);
	});
	it("live at the pre-lock scan: no seed, no write; adoption runs under focus.lock", async () => {
		const { deps, log } = fakeUp([true]);
		expect((await upSequence(deps)).ok).toBe(true);
		expect(steps(log)).toEqual(["guard", "focus.lock", "adopt"]);
	});
	it("an instance appearing between the scans is adopted and the context discarded", async () => {
		const { deps, log } = fakeUp([false, true]);
		expect((await upSequence(deps)).ok).toBe(true);
		expect(steps(log)).toEqual(["guard", "seed", "focus.lock", "adopt"]);
	});
	it("G refusal launches nothing and never takes focus.lock", async () => {
		const { deps, log } = fakeUp([false], { guard: () => ({ action: "refuse", message: "open in your Obsidian" }) });
		expect((await upSequence(deps)).ok).toBe(false);
		expect(log).not.toContain("focus.lock");
		expect(log).not.toContain("launch");
	});
	it("G only warns on adoption", async () => {
		const { deps, log } = fakeUp([true], { guard: () => ({ action: "refuse", message: "both writers" }) });
		expect((await upSequence(deps)).ok).toBe(true);
		expect(log).toContain("adopt");
		expect(log.some((l) => l.includes("both writers"))).toBe(true);
	});
	it("missing or unreadable data.json: no write, no launch", async () => {
		for (const reason of ["missing", "unreadable"] as const) {
			const { deps, log } = fakeUp([false, false], { readData: () => ({ ok: false, reason }) });
			const r = await upSequence(deps);
			expect(r.ok).toBe(false);
			expect(r.message).toMatch(reason === "missing" ? /smoke-test-teardown\.sh .*then.*smoke-test-spawn\.sh/ : /unreadable/);
			expect(log).not.toContain("write");
			expect(log).not.toContain("launch");
		}
	});
	it("a too-slow login shell stops before the lock", async () => {
		const { deps, log } = fakeUp([false], { seedContext: () => ({ ok: false, message: "login shell too slow" }) });
		expect((await upSequence(deps)).ok).toBe(false);
		expect(log).not.toContain("focus.lock");
	});
});
