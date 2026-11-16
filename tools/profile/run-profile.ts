#!/usr/bin/env npx tsx
/**
 * Obsidian-in-loop runtime profiler — Gate B-phase2 of the Agent Console
 * release quality gates, built as a STANDALONE tool.
 *
 * It is deliberately NOT wired into `npm run gate`, CI, `preversion`, or the
 * release flow. It runs on demand via `npm run profile`, and the release
 * recipe records a history point by hand (RELEASING.md step 1d). `--gate`
 * already gives the exit-code behaviour a future blocking gate would use.
 *
 * Attaches to a RUNNING Obsidian over `obsidian dev:cdp` (the same
 * sandbox-exempt transport the screenshot pipeline uses — no second app is
 * spawned). GB-T03: it attaches only to a disposable vault (`studio` or
 * `ST-*`), the one requested, and seeds that same vault at its own base
 * path (`vault-guard.ts`). Each run hard-reloads the vault several times.
 *
 * A run is INCOMPLETE when any scenario fails in any pass, or measures
 * nothing the baseline has. An incomplete run prints why, exits 1, and is
 * never recorded or written as a baseline.
 *
 * Usage:
 *   npm run profile                     # profile + diff vs baseline (warn-only)
 *   npm run profile -- --update         # ratchet/seed the step baseline
 *   npm run profile -- --record         # median-of-5, append a history point
 *   npm run profile -- --record --runs=7  # median-of-7
 *   npm run profile -- --trend          # print the over-time trend (offline)
 *   npm run profile -- --update-golden  # (re)set the immutable drift anchor
 *   npm run profile -- --gate           # exit non-zero on a step regression
 *   npm run profile -- --vault=ST-foo   # target vault (default: studio)
 *   npm run profile -- --no-seed        # skip seeding (vault already seeded)
 *   npm run profile -- --record --sha=<sha>  # override the recorded sha
 *
 * See tools/profile/README.md. Spec: [[Agent Console Release Quality Gates]]
 * § Gate B-phase2.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	readFileSync,
	writeFileSync,
	appendFileSync,
	existsSync,
	realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Cdp } from "../screenshots/lib/cdp";
import { toSnapshot, type MetricSnapshot, type RawMetric, type ObserverEntry } from "./metrics";
import {
	diffAgainstBaseline,
	missingFromProfile,
	type Baseline,
	type Profile,
	type Verdict,
} from "./baseline";
import { SCENARIOS, type ProfileContext } from "./scenarios";
import { seedStudio, canSeed, pluginDirOf } from "./seed";
import { checkProfileTarget, visibilityProblem } from "./vault-guard";
import {
	MARK_OLD_DOCUMENT_JS,
	IS_NEW_DOCUMENT_JS,
	OBSERVER_INSTALL_JS,
	OBSERVER_READ_JS,
	PRE_HELD,
	awaitCheckJs,
	parseWaitHit,
	type WaitHit,
} from "./page-js";
import {
	medianProfile,
	parseHistory,
	serializeEntry,
	formatTrend,
	TREND_METRICS,
	type HistoryEntry,
} from "./history";

interface Args {
	vault: string;
	update: boolean;
	gate: boolean;
	seed: boolean;
	record: boolean;
	runs: number;
	trend: boolean;
	updateGolden: boolean;
	threshold?: number;
	/** Override the recorded git sha (default: the sha of the checkout main.js resolves into). */
	sha?: string;
}

/** Parse CLI args. Throws on a malformed value instead of guessing. */
export function parseArgs(argv: string[]): Args {
	const a: Args = {
		vault: "studio",
		update: false,
		gate: false,
		seed: true,
		record: false,
		runs: 5,
		trend: false,
		updateGolden: false,
	};
	for (const arg of argv) {
		if (arg === "--update") a.update = true;
		else if (arg === "--gate") a.gate = true;
		else if (arg === "--no-seed") a.seed = false;
		else if (arg === "--record") a.record = true;
		else if (arg === "--trend") a.trend = true;
		else if (arg === "--update-golden") a.updateGolden = true;
		else if (arg.startsWith("--vault=")) a.vault = arg.slice("--vault=".length);
		else if (arg.startsWith("--sha=")) a.sha = arg.slice("--sha=".length);
		else if (arg.startsWith("--runs=")) {
			const n = Number(arg.slice("--runs=".length));
			if (!Number.isInteger(n) || n < 1) throw new Error(`--runs must be a whole number >= 1, got ${arg}`);
			a.runs = n;
		} else if (arg.startsWith("--threshold=")) {
			const t = Number(arg.slice("--threshold=".length));
			if (!Number.isFinite(t) || t <= 0) throw new Error(`--threshold must be a fraction > 0 (0.3 = +30%), got ${arg}`);
			a.threshold = t;
		} else {
			throw new Error(`unknown argument ${arg}`);
		}
	}
	return a;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(HERE, "profile-baseline.json");
const HISTORY_PATH = path.join(HERE, "profile-history.jsonl");
const GOLDEN_PATH = path.join(HERE, "profile-golden.json");
/**
 * Drift threshold vs the immutable golden anchor — looser than the step
 * threshold and WARN-only: slow compounding drift is surfaced, never
 * blocks a release. (Step regression vs the ratcheting baseline is what
 * `--gate` blocks on.)
 */
const DRIFT_THRESHOLD = 0.5;
/** Kill an `obsidian` CLI call after this long (a hung call can't stall a run). */
const CLI_CALL_TIMEOUT_MS = 20_000;

function loadJson<T>(p: string): T | null {
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf8")) as T;
	} catch {
		return null;
	}
}

/**
 * Provenance for a history point, measured from the vault being profiled:
 * the version and bytes of the `main.js` it loads (a symlink resolves to
 * its checkout), and the Obsidian build (wallMs includes Obsidian's boot).
 */
function resolveProvenance(
	vaultRoot: string,
	configDir: string,
	userAgent: string,
	shaOverride: string | undefined,
): Pick<HistoryEntry, "gitSha" | "appVersion" | "host" | "buildHash" | "obsidianVersion"> {
	const pluginDir = pluginDirOf(vaultRoot, configDir);
	const buildHash = mainJsHash(vaultRoot, configDir);
	let gitSha = "unknown";
	try {
		const mainJs = realpathSync(path.join(pluginDir, "main.js"));
		gitSha = execFileSync("git", ["-C", path.dirname(mainJs), "rev-parse", "--short", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		/* leave unknown */
	}
	const manifest = loadJson<{ version?: string }>(path.join(pluginDir, "manifest.json"));
	return {
		gitSha: shaOverride ?? gitSha,
		appVersion: manifest?.version ?? "unknown",
		host: os.hostname(),
		buildHash,
		obsidianVersion: /obsidian\/([\d.]+)/.exec(userAgent)?.[1] ?? "unknown",
	};
}

/** sha256 (12 hex) of the main.js the vault loads; "unknown" if unreadable. */
function mainJsHash(vaultRoot: string, configDir: string): string {
	try {
		const mainJs = realpathSync(path.join(pluginDirOf(vaultRoot, configDir), "main.js"));
		return createHash("sha256").update(readFileSync(mainJs)).digest("hex").slice(0, 12);
	} catch {
		return "unknown";
	}
}

/** Local calendar date (YYYY-MM-DD), not UTC. */
function localDate(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Read history and print the trend for every stable metric. No live run. */
function printTrend(): void {
	if (!existsSync(HISTORY_PATH)) {
		out("No profile history yet — run `npm run profile -- --record` first.");
		return;
	}
	const entries = parseHistory(readFileSync(HISTORY_PATH, "utf8"));
	if (entries.length === 0) {
		out("Profile history is empty or unreadable.");
		return;
	}
	const lines: string[] = ["", "## Runtime profile — trend", ""];
	for (const scen of SCENARIOS) {
		const metrics = TREND_METRICS[scen.id] ?? [];
		const rows: string[] = [];
		for (const metric of metrics) {
			const t = formatTrend(entries, scen.id, metric);
			if (t) rows.push(`- ${metric}: ${t}`);
		}
		if (rows.length) lines.push(`### ${scen.title}`, ...rows, "");
	}
	const last = entries[entries.length - 1];
	lines.push(
		`_${entries.length} recorded point(s); latest host ${last.host}, Obsidian ${last.obsidianVersion ?? "unknown"}._`,
	);
	out(lines.join("\n"));
}

function sleep(ms: number): Promise<void> {
	return delay(ms).then(() => undefined);
}

/** Report output (stdout). Progress and errors go to stderr. */
function out(text: string): void {
	process.stdout.write(`${text}\n`);
}

function b64(s: string): string {
	return Buffer.from(s, "utf8").toString("base64");
}

interface VaultId {
	name: string;
	base: string;
}

function sameVault(raw: unknown, expected: VaultId): boolean {
	if (typeof raw !== "string" || raw === "") return false;
	try {
		const v = JSON.parse(raw) as Partial<VaultId>;
		return v.name === expected.name && v.base === expected.base;
	} catch {
		return false;
	}
}

/**
 * Build the live ProfileContext backed by a Cdp attached to the vault.
 * `expected` is the vault the guard approved: reload() refuses any page
 * that isn't it, because the CLI routes each call to a vault separately.
 */
function makeContext(cdp: Cdp, expected: VaultId): ProfileContext {
	const evaluate = async <T>(js: string, retries: number): Promise<T> => {
		const wrapped = `eval(atob("${b64(js)}"))`;
		const resp = await cdp.send<{ result?: { value?: T } }>(
			"Runtime.evaluate",
			{ expression: wrapped, returnByValue: true, awaitPromise: true },
			retries,
		);
		return resp.result?.value as T;
	};
	// Reads may be retried on a dropped reply; anything that acts or times
	// is sent once, so a retry can't repeat it or report a late time.
	const evalInPage = <T = unknown>(js: string): Promise<T> => evaluate<T>(js, 4);
	const act = <T = unknown>(js: string): Promise<T> => evaluate<T>(js, 0);

	return {
		evalInPage,
		act,
		async snapshot(): Promise<MetricSnapshot> {
			const resp = await cdp.send<{ metrics: RawMetric[] }>("Performance.getMetrics");
			return toSnapshot(resp.metrics ?? []);
		},
		async installObserver(): Promise<void> {
			const type = await evalInPage<string>(OBSERVER_INSTALL_JS);
			if (typeof type !== "string" || type.startsWith("OBS-ERR")) {
				throw new Error(`long-frame observer: ${String(type)}`);
			}
		},
		async readObserver(): Promise<ObserverEntry[]> {
			return (await evalInPage<ObserverEntry[]>(OBSERVER_READ_JS)) ?? [];
		},
		async reload(): Promise<void> {
			// Wait for the NEW document, not a fixed sleep. Page.reload is not
			// idempotent, so it is sent once (no retry); an empty response is
			// a dropped reply, and the sentinel below confirms the reload.
			// The mark returns the page's vault: never reload a page that
			// isn't the vault the guard approved.
			const marked = await evalInPage<string>(MARK_OLD_DOCUMENT_JS);
			if (!sameVault(marked, expected)) {
				throw new Error(
					`reload: refusing — this call reached ${String(marked)}, not vault "${expected.name}" at ${expected.base}`,
				);
			}
			try {
				await cdp.send("Page.reload", {}, 0);
			} catch (err) {
				if (!/empty output/.test(err instanceof Error ? err.message : String(err))) throw err;
			}
			const deadline = Date.now() + 30_000;
			let seen = "";
			for (;;) {
				await sleep(50);
				try {
					seen = await evalInPage<string>(IS_NEW_DOCUMENT_JS);
					if (seen) {
						if (!sameVault(seen, expected)) {
							throw new Error(`reload: the new page is ${seen}, not vault "${expected.name}"`);
						}
						return;
					}
				} catch (err) {
					if (err instanceof Error && err.message.startsWith("reload:")) throw err;
					/* mid-navigation: the old context is gone; poll again */
				}
				if (Date.now() > deadline) {
					throw new Error("reload: the new document never appeared in 30s");
				}
			}
		},
		async waitFor(checkJs, timeoutMs, what, opts = {}): Promise<WaitHit> {
			// In-page MutationObserver waits, in slices short enough for the
			// CLI call timeout; the hit's pageMs is the mutation that made the
			// check hold. Only the FIRST slice can fail on "already held":
			// later slices start after the earlier one saw it false.
			const deadline = Date.now() + timeoutMs;
			let first = true;
			let lastErr = "";
			for (;;) {
				const slice = Math.max(100, Math.min(5_000, deadline - Date.now()));
				try {
					const v = await act<string>(awaitCheckJs(checkJs, slice, first && opts.failIfHeld === true));
					if (v === PRE_HELD) {
						throw new Error(`${what}: already true when the wait started, so it can't be timed`);
					}
					first = false;
					const hit = parseWaitHit(v);
					if (hit) return hit;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					if (msg.includes("already true when the wait started")) throw err;
					lastErr = msg;
					await sleep(100);
				}
				if (Date.now() >= deadline) {
					throw new Error(
						`timed out after ${timeoutMs}ms waiting for ${what}${lastErr ? ` (last error: ${lastErr})` : ""}`,
					);
				}
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

interface ScenarioFailure {
	pass: number;
	scenario: string;
	error: string;
}

function renderReport(
	profile: Profile,
	verdict: Verdict,
	baselineExists: boolean,
	incomplete: string[],
): string {
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
	if (incomplete.length > 0) {
		lines.push("## INCOMPLETE — not recorded, not written as a baseline", "");
		for (const why of incomplete) lines.push(`- ${why}`);
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
			lines.push(
				baselineExists
					? "NO COMPARISON — the baseline shares no metric with this run."
					: "NO BASELINE — nothing to compare against (run with --update to seed).",
			);
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

/** Run all scenarios once. Failures are returned, never swallowed. */
async function runOnce(
	cdp: Cdp,
	expected: VaultId,
	pass: number,
	visibility: string[],
): Promise<{ profile: Profile; failed: ScenarioFailure[] }> {
	const profile: Profile = {};
	const failed: ScenarioFailure[] = [];
	for (const scen of SCENARIOS) {
		console.error(`▶ ${scen.title}`);
		const ctx = makeContext(cdp, expected);
		try {
			profile[scen.id] = await scen.measure(ctx);
			// Visibility right after each scenario (cold start's reload makes a
			// before-check meaningless): a hidden page renders no frames.
			visibility.push(String(await ctx.evalInPage<string>("document.visibilityState")));
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			console.error(`  ! scenario "${scen.id}" failed: ${error}`);
			failed.push({ pass, scenario: scen.id, error });
		}
	}
	return { profile, failed };
}

/** Format the golden-drift warning (never blocks — informational). */
function renderDrift(verdict: Verdict): string {
	if (verdict.kind !== "regression") return "";
	const lines = [
		"",
		"## Drift vs golden anchor (WARNING — never blocks)",
		"",
		"| scenario | metric | golden | measured | change |",
		"| --- | --- | --- | --- | --- |",
	];
	for (const o of verdict.offenders) {
		lines.push(
			`| ${o.scenario} | ${o.metric} | ${fmt(o.baseline)} | ${fmt(o.measured)} | +${(o.pctChange * 100).toFixed(1)}% |`,
		);
	}
	return lines.join("\n");
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	// --trend is offline: read the history file, print, done. No Obsidian.
	if (args.trend) {
		printTrend();
		return;
	}

	const cdp = new Cdp({ vault: args.vault, commandTimeoutMs: CLI_CALL_TIMEOUT_MS });

	// GB-T03: resolve which vault dev:cdp attached to, and refuse anything
	// but a disposable vault that is the one requested and seedable at its
	// own base path. Runs before any write or reload.
	let attached: { name?: string; base?: string; ua?: string; configDir?: string } = {};
	try {
		const resp = await cdp.send<{ result?: { value?: string } }>("Runtime.evaluate", {
			expression:
				'JSON.stringify({name:app.vault.getName(),base:(app.vault.adapter.getBasePath?app.vault.adapter.getBasePath():""),ua:navigator.userAgent,configDir:app.vault.configDir})',
			returnByValue: true,
		});
		attached = JSON.parse(resp.result?.value ?? "{}") as typeof attached;
	} catch (err) {
		console.error(
			`FATAL: could not reach vault "${args.vault}" over dev:cdp — is it open? (${err instanceof Error ? err.message : String(err)})`,
		);
		process.exit(2);
	}
	const vaultRoot = attached.base ?? "";
	const configDir = attached.configDir ?? "";
	const refusal = checkProfileTarget(
		{ requested: args.vault, resolvedName: attached.name ?? "", basePath: vaultRoot },
		(base) => configDir !== "" && canSeed(base, configDir),
	);
	if (refusal) {
		console.error(`FATAL (GB-T03): ${refusal}`);
		process.exit(2);
	}
	console.error(`Profiling vault "${attached.name}" at ${vaultRoot}.`);
	const expected: VaultId = { name: attached.name ?? "", base: vaultRoot };
	const buildHashBefore = mainJsHash(vaultRoot, configDir);

	if (args.seed) {
		console.error(`Seeding the heavy session into ${vaultRoot} …`);
		seedStudio(vaultRoot, configDir);
		// Hard reload so the on-disk seed is re-read (graceful reload would
		// flush the in-memory state over the seed first).
		await makeContext(cdp, expected).reload();
	}

	await cdp.send("Performance.enable", {});

	// median-of-N when recording (tames the sub-100ms duration jitter,
	// GB-T05); a single pass otherwise.
	const passes = args.record ? args.runs : 1;
	const runs: Profile[] = [];
	const failures: ScenarioFailure[] = [];
	const visibility: string[] = [];
	for (let p = 0; p < passes; p++) {
		if (passes > 1) console.error(`— pass ${p + 1}/${passes} —`);
		const { profile, failed } = await runOnce(cdp, expected, p + 1, visibility);
		runs.push(profile);
		failures.push(...failed);
	}
	const buildHashAfter = mainJsHash(vaultRoot, configDir);
	const profile = passes > 1 ? medianProfile(runs) : runs[0];

	const baseline = loadJson<Baseline>(BASELINE_PATH);
	const hiddenReason = visibilityProblem(visibility);
	const incomplete = [
		...(hiddenReason ? [hiddenReason] : []),
		...(buildHashBefore !== buildHashAfter
			? [`main.js changed during the run (${buildHashBefore} -> ${buildHashAfter}); rebuild, then rerun`]
			: []),
		...failures.map((f) => `pass ${f.pass}: ${f.scenario} failed — ${f.error}`),
		...missingFromProfile(profile, baseline, SCENARIOS.map((s) => s.id)).map(
			(s) => `${s}: in the baseline but not measured`,
		),
	];
	const verdict = diffAgainstBaseline(profile, baseline, args.threshold);
	out(renderReport(profile, verdict, baseline !== null, incomplete));

	// Drift vs the immutable golden anchor — warn-only, never blocks.
	const golden = loadJson<Baseline>(GOLDEN_PATH);
	if (golden) {
		const driftReport = renderDrift(diffAgainstBaseline(profile, golden, DRIFT_THRESHOLD));
		if (driftReport) out(driftReport);
	}

	if (incomplete.length > 0) {
		if (args.record || args.update || args.updateGolden) {
			console.error("\nNothing recorded or written: the run is incomplete.");
		}
		process.exit(1);
	}

	if (args.record) {
		const prov = resolveProvenance(vaultRoot, configDir, attached.ua ?? "", args.sha);
		const entry: HistoryEntry = {
			date: localDate(),
			recordedAt: new Date().toISOString(),
			...prov,
			medianOf: passes,
			scenarios: profile,
		};
		appendFileSync(HISTORY_PATH, serializeEntry(entry) + "\n");
		console.error(
			`\nRecorded history point (${prov.appVersion}@${prov.gitSha}, main.js ${prov.buildHash}, Obsidian ${prov.obsidianVersion}, median-of-${passes}) -> ${HISTORY_PATH}`,
		);
	}

	if (args.update) {
		const next: Baseline = {
			thresholdPct: args.threshold ?? baseline?.thresholdPct ?? 0.3,
			capturedAt: new Date().toISOString(),
			scenarios: profile,
			floors: baseline?.floors,
			gateExclude: baseline?.gateExclude,
		};
		writeFileSync(BASELINE_PATH, JSON.stringify(next, null, "\t") + "\n");
		console.error(`\nBaseline written to ${BASELINE_PATH}`);
	}

	if (args.updateGolden) {
		const goldenNext: Baseline = {
			thresholdPct: DRIFT_THRESHOLD,
			capturedAt: new Date().toISOString(),
			scenarios: profile,
			floors: baseline?.floors,
			gateExclude: baseline?.gateExclude,
		};
		writeFileSync(GOLDEN_PATH, JSON.stringify(goldenNext, null, "\t") + "\n");
		console.error(
			`\nGolden anchor written to ${GOLDEN_PATH} (immutable drift reference — update rarely, on purpose).`,
		);
	}

	if (args.gate && verdict.kind === "regression") {
		console.error("\nGate FAILED (step regression vs baseline).");
		process.exit(1);
	}
}

// Run only as a script, so tests can import parseArgs.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err);
		process.exit(2);
	});
}
