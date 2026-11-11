/**
 * Local end-to-end check of the isolated capture harness. Never runs in CI.
 *
 *   AC_CAPTURE_VERIFY=1 npx tsx tools/lib/isolated-verify.ts
 *
 * 1. A normal run: launch, trust the vault off camera, capture one
 *    screenshot, tear down. Asserts at most one focus steal, a non-blank
 *    capture, the user's CLI socket unchanged, and no leftovers.
 * 2. SIGINT mid-take and SIGKILL of the recorder (the watchdog must clean up).
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Tests.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { log, logError } from "./cli-log";
import { materializeRun } from "./fixtures-vault";
import {
	RUN_PARENT,
	listMarkedProcesses,
	loginShell,
	socketInode,
	userObsidianVersion,
	versionWarning,
	withIsolatedRun,
} from "./isolated-instance";

const REPO = path.resolve(__dirname, "../..");
const mode = process.argv[2] ?? "all";

async function oneRun(hangMs = 0): Promise<{ ok: boolean; problems: string[]; steals: number; bytes: number }> {
	const shell = loginShell();
	let bytes = 0;
	const res = await withIsolatedRun(
		{
			repoRoot: REPO,
			profile: "screenshot",
			takes: 1,
			perTakeMs: 3 * 60_000,
			log: (m) => log(`  ${m}`),
			materialize: (runRoot, runId) =>
				materializeRun({ repoRoot: REPO, runRoot, profile: "screenshot", ctx: { runId, realHome: process.env.HOME ?? "", loginPath: shell.path, resolveCommand: shell.resolve } }),
		},
		async (t) => {
			const browser = await chromium.connectOverCDP(`http://127.0.0.1:${t.port}`);
			t.setCloseBrowser(async () => {
				const b = await browser.newBrowserCDPSession();
				await b.send("Browser.close").catch(() => {});
			});
			let page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("index.html"));
			for (let i = 0; i < 80 && !page; i++) {
				await sleep(250);
				page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("index.html"));
			}
			if (!page) throw new Error("no workspace page");
			await page.waitForSelector(".workspace", { timeout: 40_000 });
			const trust = page.getByRole("button", { name: /Trust author and enable plugins/i });
			await trust.waitFor({ timeout: 30_000 }).then(() => trust.click()).catch(() => {});
			await page.waitForSelector(".agent-console-ribbon-icon", { timeout: 30_000 });
			const ver = (await (await browser.newBrowserCDPSession()).send("Browser.getVersion")) as { userAgent: string };
			const w = versionWarning(ver.userAgent, userObsidianVersion());
			if (w) log(`  warning: ${w}`);
			if (hangMs) await sleep(hangMs);
			const cdp = await page.context().newCDPSession(page);
			const shot = (await cdp.send("Page.captureScreenshot", { format: "png" }));
			bytes = Buffer.from(shot.data, "base64").length;
			return bytes > 20_000;
		},
	);
	return { ...res, bytes };
}

async function leftovers(): Promise<string[]> {
	const rows = await listMarkedProcesses();
	const procs = rows.filter((r) => r.command.includes(`--user-data-dir=${RUN_PARENT}/`) || / AC_VIDEO_RUN=r/.test(r.command) || r.command.includes("isolated-watchdog.ts"));
	const files = existsSync(RUN_PARENT) ? readdirSync(RUN_PARENT).filter((f) => f.startsWith("r")) : [];
	return [...procs.map((r) => `process ${r.pid}: ${r.command.slice(0, 80)}`), ...files.map((f) => `file ${f}`)];
}

async function childCase(signal: "SIGINT" | "SIGKILL"): Promise<string[]> {
	const child = spawn(process.execPath, ["--import", "tsx", __filename, "hang"], { stdio: "ignore", env: { ...process.env, AC_CAPTURE_VERIFY: "1" } });
	for (let i = 0; i < 120; i++) {
		await sleep(500);
		const rows = await listMarkedProcesses();
		if (rows.some((r) => r.command.includes(`--user-data-dir=${RUN_PARENT}/`) && !r.command.includes("--type="))) break;
	}
	await sleep(8000);
	child.kill(signal);
	for (let i = 0; i < 40; i++) {
		await sleep(1000);
		if (!(await leftovers()).length) return [];
	}
	return leftovers();
}

async function main(): Promise<void> {
	if (process.env.AC_CAPTURE_VERIFY !== "1") {
		log("skipped: set AC_CAPTURE_VERIFY=1 to run (launches an isolated Obsidian; macOS only)");
		return;
	}
	if (mode === "hang") {
		await oneRun(60_000);
		return;
	}
	const ino = socketInode();
	const failures: string[] = [];
	log("1. normal run");
	const r = await oneRun();
	log(`   ok=${r.ok} steals=${r.steals} capture=${r.bytes} bytes problems=${JSON.stringify(r.problems)}`);
	if (!r.ok) failures.push("normal run failed");
	if (r.steals > 1) failures.push(`expected at most 1 focus steal, saw ${r.steals}`);
	for (const s of ["SIGINT", "SIGKILL"] as const) {
		log(`2. recorder ${s} mid-take`);
		const left = await childCase(s);
		log(`   leftovers: ${left.length ? left.join("; ") : "none"}`);
		if (left.length) failures.push(`${s}: ${left.length} leftover(s)`);
	}
	if (socketInode() !== ino) failures.push("the user's Obsidian CLI socket changed");
	if (failures.length) {
		logError(`FAIL\n- ${failures.join("\n- ")}`);
		process.exitCode = 1;
	} else log("PASS");
}

void main();
