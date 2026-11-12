#!/usr/bin/env npx tsx
/**
 * Screenshot automation CLI entry point.
 *
 * Usage:
 *   npm run docs:screenshots           # all entries
 *   npm run docs:screenshots -- <name>  # single entry
 *   npm run docs:screenshots -- a,b,c   # several entries, one launch
 *
 * By default the capture runs in an isolated Obsidian instance (separate
 * user data, fake HOME, mock keychain) driven over a direct CDP session, so it
 * never takes the user's screen or touches their own Obsidian. Entries that
 * still need the real screen (settings window, native popups, screen-capture
 * heroes) are skipped and listed. `SCREENSHOT_LEGACY=1` runs the old path:
 * the `studio` window inside the user's Obsidian via the `obsidian` CLI.
 *
 * Run from a normal terminal: the isolated launcher needs `open` and `ps`,
 * which the agent sandbox blocks.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]].
 * Spec: [[Agent Console Screenshot Automation]] § Architecture Impact.
 */
import {
	readFileSync,
	mkdtempSync,
	unlinkSync,
	writeFileSync,
	statSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { log, logError } from "../lib/cli-log";
import { parseManifest, validateManifest } from "./lib/manifest";
import { captureAll, needsScreen, selectEntries, type OrchestratorDeps } from "./lib/orchestrator";
import { Cdp, type CdpTransport } from "./lib/cdp";
import { chromium, type Browser } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";
import { materializeRun } from "../lib/fixtures-vault";
import { FOCUS_STEAL_BUDGET, loginShell, userObsidianVersion, withIsolatedRun } from "../lib/isolated-instance";
import { appVersionProblem, pinDriftNote, readAppPin, readInstanceAppVersion, resolveAppAsar } from "../lib/obsidian-app";
import { addDropShadow } from "./lib/shadow";
import { captureDpr, isolatedRunProblems, nothingToCaptureMessage, reportRun } from "./lib/run-report";
import { frameImage as applyFrame, chromeOnlyFrame } from "./lib/frame";
import { encodeGif, frameFileName } from "./lib/encode-gif";

async function main() {
	const repoRoot = path.resolve(__dirname, "../..");
	const fixtureRoot = path.resolve(__dirname, "fixtures");
	const manifestPath = path.resolve(__dirname, "manifest.json");

	// Parse args: optional filter name
	const filter = process.argv[2] || undefined;

	// Read and validate manifest
	const manifestJson = readFileSync(manifestPath, "utf-8");
	const manifest = parseManifest(manifestJson);
	validateManifest(manifest, fixtureRoot);

	// Create temp dir for raw captures
	const tmpDir = mkdtempSync(path.join(tmpdir(), "screenshots-"));

	const capture = async (cdp: Cdp, isolated: boolean) => {

		// Window sized to fit the tabs + active note + full chat transcript AND
		// the composer (showing its context-note pill + an example draft message).
		// Height covers the messages viewport (transcript ~539px) plus the composer
		// (~149px) and header chrome (~150px). The chat scroll container's ~120px bottom
		// padding harmlessly overflows behind the composer (scroll-to-bottom button
		// is hidden), so ~760px shows the full transcript + composer snugly. The drop shadow adds the
		// surrounding background. Was 1920x1200 — far too large.
		// Clear any stale device-metrics override left in the running Obsidian by a
		// prior run — it survives setup.sh's plugin reload and persists across
		// separate invocations. Without this, the previous run's
		// deviceScaleFactor:1 override pins window.devicePixelRatio to 1 here, so we
		// detect the wrong DPR and capture at half resolution on a retina display,
		// dropping fine detail like tooltip text (I11).
		await cdp.clearViewport();

		// Device pixel ratio: env override, else detect the REAL value from the live
		// window (now that the stale override is cleared). The capture PNG is in
		// device pixels but getBoundingClientRect returns CSS px; the crop is scaled
		// by this DPR, which MUST match the viewport's deviceScaleFactor below.
		const dpr = await captureDpr(process.env, cdp.isolated, () => cdp.evaluate<number>("window.devicePixelRatio"));

		// Apply the capture viewport at the REAL device scale factor. Forcing
		// deviceScaleFactor:1 on a dpr=2 display halved the captured resolution and
		// dropped fine detail (I11); the crop region (CSS px) is unchanged, only
		// fidelity improves. Must be set AFTER DPR detection (setting it first with
		// deviceScaleFactor:1 was the bug — it pinned the detected DPR to 1).
		await cdp.setViewport(1400, 760, dpr);

		// Wire up real deps
		const sharp = (await import("sharp")).default;
		const deps: OrchestratorDeps = {
			cdp,
			sharp: (input: string | Buffer) => sharp(input),
			repoRoot,
			fixtureRoot,
			tmpDir,
			readFile: (p, enc) => readFileSync(p, enc as BufferEncoding),
			devicePixelRatio: dpr,
			postProcess: (output) => addDropShadow(output),
			frameImage: (output, opts) => applyFrame(output, opts),
			chromeFrame: (input, opts) => chromeOnlyFrame(input, opts),
			// Content guard: decode the final webp to raw RGB(A) pixels so the
			// orchestrator can count distinct colors and reject blank/degraded
			// captures (I11 follow-up). Read after postProcess (the shadow margin
			// collapses to a single color, matching the committed-file calibration).
			loadRaw: async (p) => {
				const { data, info } = (await sharp(p)
					.raw()
					.toBuffer({ resolveWithObject: true })) as {
					data: Buffer;
					info: { channels: number };
				};
				return { data, channels: info.channels };
			},
			unlink: (p) => unlinkSync(p),
			// v2 animation path: encode cropped PNG frames into a looping GIF via
			// ffmpeg (palettegen/paletteuse). Frames are written to a temp dir, two
			// ffmpeg passes run, and the output size is asserted against maxBytes.
			encodeGif: (opts) =>
				encodeGif(opts, {
					makeWorkDir: () =>
						mkdtempSync(path.join(tmpdir(), "gif-frames-")),
					writeFrame: (dir, index, buffer) =>
						writeFileSync(path.join(dir, frameFileName(index)), buffer),
					runFfmpeg: (args) =>
						new Promise<void>((resolve, reject) => {
							const proc = spawn("ffmpeg", args, { stdio: "ignore" });
							proc.on("close", (code) =>
								code === 0
									? resolve()
									: reject(
											new Error(
												`ffmpeg exited with code ${code}`,
											),
										),
							);
							proc.on("error", reject);
						}),
					statBytes: (p) => statSync(p).size,
				}),
		};

		log(
			`📸 Capturing ${filter ? `"${filter}"` : `all ${manifest.entries.length} entries`}${isolated ? " in an isolated Obsidian" : ""}...`,
		);
		return captureAll(manifest.entries, deps, {
			filter,
			skip: isolated ? needsScreen : undefined,
			// One line per entry, so a focus-guard restore can be tied to the entry that caused it.
			onEntry: (e, i, n) => log(`  ▶ [${i}/${n}] ${e.name}`),
		});
	};

	const legacy = process.env.SCREENSHOT_LEGACY === "1";
	if (!legacy) {
		const why = nothingToCaptureMessage(selectEntries(manifest.entries, filter), needsScreen);
		if (why) {
			logError(`❌ ${why}`);
			process.exit(1);
		}
	}
	const results = legacy
		? await runLegacy(capture, repoRoot)
		: await runIsolated(capture, repoRoot);
	if (!results) process.exit(1);

	const report = reportRun(results, runProblems);
	for (const l of report.lines) log(l);
	for (const e of report.errors) logError(e);
	process.exit(report.exitCode);
}

main().catch((err) => {
	logError(err);
	process.exit(1);
});

type Results = Awaited<ReturnType<typeof captureAll>>;

/** Run-level failures reported after the per-entry results (focus budget, leftovers). */
const runProblems: string[] = [];

/** The old path: the `studio` window in the user's Obsidian, via the obsidian CLI. */
async function runLegacy(capture: (cdp: Cdp, isolated: boolean) => Promise<Results>, repoRoot: string): Promise<Results> {
	await new Promise<void>((resolve, reject) => {
		const p = spawn("bash", [path.join(repoRoot, "tools/screenshots/setup.sh")], { stdio: "inherit" });
		p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`setup.sh exited ${code}`))));
		p.on("error", reject);
	});
	return capture(new Cdp({ vault: process.env.SCREENSHOT_VAULT || "studio" }), false);
}

/** Set once the workspace page is up: reports renderer focus calls when the guard restores focus. */
let onSteal: (() => Promise<void>) | undefined;

/** The default path: a fresh isolated Obsidian for this run. */
async function runIsolated(capture: (cdp: Cdp, isolated: boolean) => Promise<Results>, repoRoot: string): Promise<Results | null> {
	const shell = loginShell();
	const pin = readAppPin(repoRoot);
	const appAsar = await resolveAppAsar(pin);
	const drift = pinDriftNote(userObsidianVersion(), pin);
	if (drift) log(`  note: ${drift}`);
	let results: Results | null = null;
	const run = await withIsolatedRun(
		{
			repoRoot,
			profile: "screenshot",
			takes: 1,
			perTakeMs: 45 * 60_000,
			log: (m) => {
				log(`  ${m}`);
				if (m.includes("restored focus")) void onSteal?.();
			},
			appAsar,
			materialize: (runRoot, runId) =>
				materializeRun({ repoRoot, runRoot, profile: "screenshot", ctx: { runId, realHome: process.env.HOME ?? "", loginPath: shell.path, resolveCommand: shell.resolve } }),
		},
		async (take) => {
			const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${take.port}`);
			browser.on("disconnected", () => log("  the CDP connection to the isolated Obsidian closed"));
			take.setCloseBrowser(async () => {
				const b = await browser.newBrowserCDPSession();
				await b.send("Browser.close").catch(() => {});
			});
			let page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("index.html"));
			for (let i = 0; i < 120 && !page; i++) {
				await sleep(250);
				page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("index.html"));
			}
			if (!page) throw new Error("the isolated Obsidian has no workspace window");
			// Record who calls window.focus() in the renderer, so an extra focus
			// steal names its caller, not just the entry it happened in.
			await page.evaluate(() => {
				const w = window as unknown as { focus: () => void; __focusCalls?: string[] };
				const orig = w.focus;
				w.__focusCalls = [];
				w.focus = (): void => {
					const stack = new Error().stack ?? "";
					w.__focusCalls?.push(`${new Date().toISOString().slice(11, 19)} ${stack.split("\n").slice(2, 6).map((l) => l.trim()).join(" < ")}`);
					orig.call(window);
				};
			});
			onSteal = async () => {
				const calls = await page?.evaluate(() => (window as unknown as { __focusCalls?: string[] }).__focusCalls?.splice(0) ?? []).catch(() => []);
				log(`    window.focus() calls since the last steal: ${calls?.length ? calls.join("; ") : "none (the steal came from the main process or a new window)"}`);
			};
			page.on("crash", () => log("  the isolated Obsidian's workspace page crashed"));
			page.on("close", () => log("  the isolated Obsidian's workspace page closed"));
			await page.waitForSelector(".workspace", { timeout: 40_000 });
			const appProblem = appVersionProblem(await readInstanceAppVersion(page), pin);
			if (appProblem) throw new Error(appProblem);
			log(`  isolated Obsidian ${pin.version} (pinned in fixtures)`);
			for (let attempt = 0; attempt < 2; attempt++) {
				const trust = page.getByRole("button", { name: /Trust author and enable plugins/i });
				await trust.waitFor({ timeout: 30_000 }).then(() => trust.click()).catch(() => {});
				if (await page.waitForSelector(".agent-console-ribbon-icon", { timeout: 20_000 }).then(() => true, () => false)) break;
				if (attempt === 1) throw new Error("Agent Console didn't load in the isolated Obsidian");
			}
			// Obsidian opens a settings window after the trust click. While it is
			// open every modal, prompt and notice mounts there, off this page.
			// captureEntry closes a stray one too; this logs which tab it was.
			const settingsTab = await page.evaluate(() => {
				const w = window as unknown as { activeDocument?: Document; app: { setting: { activeTab?: { id?: string } | null; close(): void } } };
				if (!w.activeDocument || w.activeDocument === document) return null;
				const id = w.app.setting.activeTab?.id ?? "unknown";
				w.app.setting.close();
				return id;
			});
			if (settingsTab) log(`  closed the settings window Obsidian opened after the trust prompt (tab: ${settingsTab})`);
			await page.evaluate(() => {
				(window.require("@electron/remote") as { getCurrentWindow(): { setContentSize(w: number, h: number): void } }).getCurrentWindow().setContentSize(1600, 1000);
				return true;
			});
			await sleep(800);
			const session = await page.context().newCDPSession(page);
			const transport: CdpTransport = { send: (method, params) => session.send(method as never, params as never) };
			results = await capture(new Cdp({ vault: "studio", transport }), true);
			return true;
		},
	);
	log(`  focus steals: ${run.steals} (budget ${FOCUS_STEAL_BUDGET})`);
	runProblems.push(...isolatedRunProblems(run, FOCUS_STEAL_BUDGET));
	return results;
}
