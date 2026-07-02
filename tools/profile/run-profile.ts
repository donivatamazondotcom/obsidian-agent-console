#!/usr/bin/env npx tsx
/**
 * Obsidian-in-loop runtime profiler — Gate B-phase2 of the Agent Console
 * release quality gates, built as a STANDALONE tool.
 *
 * It is deliberately NOT wired into `npm run gate`, CI, `preversion`, or the
 * release flow. It runs on demand via `npm run profile`. Promotion to a
 * real gate later is a one-line addition (call `diffAgainstBaseline`, fail
 * on `kind === "regression"`) — the `--gate` flag already implements that
 * exit-code behaviour so the wiring is trivial when the time comes.
 *
 * Attaches to a RUNNING Obsidian over `obsidian dev:cdp` (the same
 * sandbox-exempt transport the screenshot pipeline uses — no second app is
 * spawned). It targets the fixtures `studio` vault and REFUSES to run
 * against the daily vault (GB-T03).
 *
 * Usage:
 *   npm run profile                    # profile + diff vs baseline (warn-only)
 *   npm run profile -- --update        # ratchet/seed the baseline
 *   npm run profile -- --gate          # exit non-zero on a regression
 *   npm run profile -- --vault=studio  # target vault (default: studio)
 *   npm run profile -- --no-seed       # skip seeding (studio already seeded)
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { execSync } from "node:child_process";
import {
	readFileSync,
	writeFileSync,
	existsSync,
	rmSync,
	cpSync,
	mkdirSync,
} from "node:fs";
import path from "node:path";
import { Cdp } from "../screenshots/lib/cdp";
import { toSnapshot, type MetricSnapshot, type RawMetric } from "./metrics";
import {
	diffAgainstBaseline,
	type Baseline,
	type Profile,
	type Verdict,
} from "./baseline";
import { SCENARIOS, type ProfileContext } from "./scenarios";
import {
	generateHeavySession,
	heavySavedSessionEntry,
} from "./fixtures/heavy-session";

interface Args {
	vault: string;
	update: boolean;
	gate: boolean;
	seed: boolean;
	threshold?: number;
}

function parseArgs(argv: string[]): Args {
	const a: Args = { vault: "studio", update: false, gate: false, seed: true };
	for (const arg of argv) {
		if (arg === "--update") a.update = true;
		else if (arg === "--gate") a.gate = true;
		else if (arg === "--no-seed") a.seed = false;
		else if (arg.startsWith("--vault=")) a.vault = arg.slice("--vault=".length);
		else if (arg.startsWith("--threshold="))
			a.threshold = Number(arg.slice("--threshold=".length));
	}
	return a;
}

/** The permanent (main-checkout) home of the fixtures studio + baseline. */
function mainCheckoutRoot(): string {
	// `git rev-parse --git-common-dir` resolves to <main>/.git even from a
	// worktree; its dirname is the main checkout.
	const commonDir = execSync("git rev-parse --git-common-dir", {
		encoding: "utf8",
	}).trim();
	return path.dirname(path.resolve(commonDir));
}

const BASELINE_PATH = path.join(
	path.dirname(new URL(import.meta.url).pathname),
	"profile-baseline.json",
);

function loadBaseline(): Baseline | null {
	if (!existsSync(BASELINE_PATH)) return null;
	try {
		return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
	} catch {
		return null;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Seed the heavy session into the studio's plugin dir on disk so the
 * cold-start scenario has something to restore. Mirrors the screenshot
 * setup.sh mechanism (data.template.json -> data.json, sessions.seed ->
 * sessions) then adds the heavy session + a restored-tab entry.
 */
function seedStudio(studioRoot: string): void {
	const pluginDir = path.join(
		studioRoot,
		".obsidian/plugins/agent-console",
	);
	const template = path.join(pluginDir, "data.template.json");
	const dataJson = path.join(pluginDir, "data.json");
	const sessionsSeed = path.join(pluginDir, "sessions.seed");
	const sessions = path.join(pluginDir, "sessions");

	if (existsSync(template)) cpSync(template, dataJson);
	if (existsSync(sessionsSeed)) {
		rmSync(sessions, { recursive: true, force: true });
		cpSync(sessionsSeed, sessions, { recursive: true });
	} else {
		mkdirSync(sessions, { recursive: true });
	}

	const heavy = generateHeavySession();
	const savedEntry = heavySavedSessionEntry();
	writeFileSync(
		path.join(sessions, `${heavy.sessionId}.json`),
		JSON.stringify(heavy, null, "\t"),
	);

	// Register it in savedSessions + a restored tab so restore-on-startup
	// re-adopts it. leafId must match the studio's agent-console leaf.
	const data = JSON.parse(readFileSync(dataJson, "utf8")) as Record<
		string,
		unknown
	>;
	const saved = (
		Array.isArray(data.savedSessions) ? data.savedSessions : []
	) as unknown[];
	saved.push(savedEntry);
	data.savedSessions = saved;
	data.restoreTabsOnStartup = true;

	const leafId = resolveAgentLeafId(studioRoot);
	if (leafId) {
		data.perLeafTabStates = [
			{
				leafId,
				activeTabId: "profile-tab",
				tabs: [
					{
						tabId: "profile-tab",
						agentId: heavy.agentId,
						label: savedEntry.title,
						labelIsCustom: true,
						sessionId: heavy.sessionId,
						tabOrder: 0,
						scrollPosition: 0,
						workingDirectory: savedEntry.cwd,
					},
					{
						tabId: "profile-light-tab",
						agentId: "claude-code-acp",
						label: "Debug the failing CI pipeline",
						labelIsCustom: true,
						sessionId: "seed-ci-pipeline",
						tabOrder: 1,
						scrollPosition: 0,
						workingDirectory: savedEntry.cwd,
					},
				],
			},
		];
	}
	writeFileSync(dataJson, JSON.stringify(data, null, "\t"));
}

/** Read the agent-console leaf id from the studio workspace.json (best-effort). */
function resolveAgentLeafId(studioRoot: string): string | null {
	const wsPath = path.join(studioRoot, ".obsidian/workspace.json");
	if (!existsSync(wsPath)) return null;
	try {
		const ws: unknown = JSON.parse(readFileSync(wsPath, "utf8"));
		let found: string | null = null;
		const walk = (n: unknown): void => {
			if (found || !n || typeof n !== "object") return;
			const node = n as Record<string, unknown>;
			const state = node.state as Record<string, unknown> | undefined;
			if (
				node.type === "leaf" &&
				state &&
				typeof state.type === "string" &&
				state.type.includes("agent-client")
			) {
				found = typeof node.id === "string" ? node.id : "";
				return;
			}
			for (const v of Object.values(node)) walk(v);
		};
		walk(ws);
		return found;
	} catch {
		return null;
	}
}

function b64(s: string): string {
	return Buffer.from(s, "utf8").toString("base64");
}

/** Build the live ProfileContext backed by a Cdp attached to the vault. */
function makeContext(cdp: Cdp): ProfileContext {
	const evalInPage = async <T = unknown>(js: string): Promise<T> => {
		const wrapped = `eval(atob("${b64(js)}"))`;
		const resp = await cdp.send<{ result?: { value?: T } }>(
			"Runtime.evaluate",
			{ expression: wrapped, returnByValue: true, awaitPromise: true },
		);
		return resp.result?.value as T;
	};

	const OBSERVER_INSTALL = `(function(){if(!window.__profObs){window.__profBuf=[];try{var po=new PerformanceObserver(function(l){var es=l.getEntries();for(var i=0;i<es.length;i++){var e=es[i];window.__profBuf.push({name:e.name,duration:e.duration,blockingDuration:e.blockingDuration,styleAndLayoutDuration:e.styleAndLayoutDuration,startTime:e.startTime});}});po.observe({type:"long-animation-frame",buffered:true});try{po.observe({type:"longtask",buffered:true});}catch(e2){}window.__profObs=po;}catch(e){return "OBS-ERR:"+e.message;}}return "ok";})()`;
	const OBSERVER_READ = `(function(){var b=window.__profBuf||[];window.__profBuf=[];return b;})()`;

	return {
		evalInPage,
		async snapshot(): Promise<MetricSnapshot> {
			const resp = await cdp.send<{ metrics: RawMetric[] }>(
				"Performance.getMetrics",
			);
			return toSnapshot(resp.metrics ?? []);
		},
		async installObserver(): Promise<void> {
			await evalInPage(OBSERVER_INSTALL);
		},
		async readObserver() {
			return (await evalInPage(OBSERVER_READ)) ?? [];
		},
		async reload(): Promise<void> {
			await cdp.send("Page.reload", {});
			await sleep(1500);
		},
		async waitForSelector(selectors, timeoutMs = 15_000) {
			const start = Date.now();
			const check = `(function(){var s=${JSON.stringify(selectors)};for(var i=0;i<s.length;i++){if(document.querySelector(s[i]))return s[i];}return "";})()`;
			for (;;) {
				const hit = await evalInPage<string>(check);
				if (hit) return { ms: Date.now() - start, selector: hit };
				if (Date.now() - start > timeoutMs) {
					throw new Error(
						`waitForSelector: none of ${selectors.join(", ")} appeared in ${timeoutMs}ms`,
					);
				}
				await sleep(100);
			}
		},
		sleep,
		log: (msg: string) => console.error(`  · ${msg}`),
	};
}

function fmt(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	return Math.abs(n) >= 100 || Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function renderReport(profile: Profile, verdict: Verdict): string {
	const lines: string[] = ["", "## Runtime profile", ""];
	for (const scen of SCENARIOS) {
		const m = profile[scen.id];
		if (!m) continue;
		lines.push(`### ${scen.title}`);
		lines.push(`_signal: ${scen.primarySignal}_`, "");
		lines.push("| metric | value |", "| --- | --- |");
		for (const [k, v] of Object.entries(m)) lines.push(`| ${k} | ${fmt(v)} |`);
		lines.push("");
	}
	lines.push("## Verdict", "");
	switch (verdict.kind) {
		case "ok":
			lines.push(`OK — largest change +${(verdict.maxPctChange * 100).toFixed(1)}% (within threshold).`);
			break;
		case "improvement":
			lines.push(`IMPROVEMENT — largest drop ${(verdict.maxPctDrop * 100).toFixed(1)}%.`);
			break;
		case "no-baseline":
			lines.push("NO BASELINE — nothing to compare against (run with --update to seed).");
			break;
		case "regression":
			lines.push("REGRESSION — the following metrics rose past threshold:", "");
			lines.push("| scenario | metric | baseline | measured | change |");
			lines.push("| --- | --- | --- | --- | --- |");
			for (const o of verdict.offenders) {
				lines.push(
					`| ${o.scenario} | ${o.metric} | ${fmt(o.baseline)} | ${fmt(o.measured)} | +${(o.pctChange * 100).toFixed(1)}% |`,
				);
			}
			break;
	}
	return lines.join("\n");
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const cdp = new Cdp({ vault: args.vault });

	// GB-T03: never profile the daily vault. Resolve the attached vault name
	// and abort if it is the working vault (or unresolvable).
	let vaultName = "";
	try {
		vaultName = await cdp.evaluate<string>("app.vault.getName()");
	} catch (err) {
		console.error(
			`FATAL: could not reach vault "${args.vault}" over dev:cdp — is the studio open? (${err instanceof Error ? err.message : String(err)})`,
		);
		process.exit(2);
	}
	if (vaultName === "donivatamazondotcom") {
		console.error(
			"FATAL (GB-T03): resolved the DAILY vault — refusing to profile. Open the fixtures 'studio' vault and pass --vault=studio.",
		);
		process.exit(2);
	}
	console.error(`Profiling vault "${vaultName}" (requested --vault=${args.vault}).`);

	if (args.seed) {
		const studioRoot = path.join(
			mainCheckoutRoot(),
			"tools/screenshots/fixtures/studio",
		);
		console.error(`Seeding heavy session into ${studioRoot} …`);
		seedStudio(studioRoot);
		// Hard reload so the on-disk seed is re-read (graceful reload would
		// flush the empty in-memory state over the seed first).
		await cdp.send("Page.reload", {});
		await sleep(2500);
	}

	await cdp.send("Performance.enable", {});

	const profile: Profile = {};
	for (const scen of SCENARIOS) {
		console.error(`▶ ${scen.title}`);
		const ctx = makeContext(cdp);
		try {
			profile[scen.id] = await scen.measure(ctx);
		} catch (err) {
			console.error(
				`  ! scenario "${scen.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const baseline = loadBaseline();
	const verdict = diffAgainstBaseline(profile, baseline, args.threshold);
	console.log(renderReport(profile, verdict));

	if (args.update) {
		const next: Baseline = {
			thresholdPct: args.threshold ?? baseline?.thresholdPct ?? 0.3,
			capturedAt: new Date().toISOString(),
			scenarios: profile,
			floors: baseline?.floors,
			gateExclude: baseline?.gateExclude ?? ["JSHeapUsedSize"],
		};
		writeFileSync(BASELINE_PATH, JSON.stringify(next, null, "\t") + "\n");
		console.error(`\nBaseline written to ${BASELINE_PATH}`);
	}

	if (args.gate && verdict.kind === "regression") {
		console.error("\nGate FAILED (regression).");
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
