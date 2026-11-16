/**
 * The profiler's helper plugin: the committed main.js arms the cold-start
 * wait in onload (before the restore), is inert unless armed, matches its
 * generator, is disarmed on exit, and never travels in fixture copies.
 *
 * Spec: [[I379 The runtime profiler never reached main, so release step 3.5b measured nothing]].
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	ACTIVE_ROWS,
	fixtureProbeDir,
	PROBE_PLUGIN_ID,
	armProbe,
	disarmProbe,
	hasProbe,
	probePluginDirOf,
	probePluginSource,
} from "../probe-plugin";
import { collectArmedJs, parseWaitHit } from "../page-js";
import { HEAVY_MESSAGE_COUNT } from "../fixtures/heavy-session";
import { canSeed } from "../seed";
import { fixtureExcludes } from "../../lib/fixtures-vault";

type W = Record<string, unknown>;
const w = window as unknown as W;
const REPO = path.resolve(__dirname, "..", "..", "..");

function run<T>(js: string): T {
	return new Function(`return ${js}`)() as T;
}

/** Load the COMMITTED main.js the way Obsidian does, with a fake Plugin. */
async function loadCommitted(data: unknown): Promise<void> {
	const src = readFileSync(path.join(fixtureProbeDir(), "main.js"), "utf8");
	class Plugin {
		loadData(): Promise<unknown> {
			return Promise.resolve(data);
		}
	}
	const mod: { exports: unknown } = { exports: {} };
	new Function("require", "module", "exports", src)(
		(id: string) => (id === "obsidian" ? { Plugin } : undefined),
		mod,
		mod.exports,
	);
	const Cls = mod.exports as new () => { onload(): Promise<void> };
	await new Cls().onload();
}

function restoreRows(): void {
	let s = "";
	for (let i = 0; i < HEAVY_MESSAGE_COUNT; i++) s += '<div class="agent-client-message-row"></div>';
	document.body.innerHTML = `<div class="agent-client-tab-panel">${s}</div>`;
}

beforeEach(() => {
	document.body.innerHTML = '<div class="agent-client-tab-panel"></div>';
	delete w.__profArm;
	delete w.__profArmSource;
});
afterEach(() => {
	delete w.__profArm;
	delete w.__profArmSource;
});

describe("helper plugin (committed main.js)", () => {
	it("times a restore that lands after onload and before the profiler's first evaluate", async () => {
		await loadCommitted({ armed: true });
		restoreRows(); // the restore, before any profiler call reaches the page
		await Promise.resolve();
		const hit = parseWaitHit(await run<Promise<string>>(collectArmedJs(500)));
		expect(hit?.detail).toBe(ACTIVE_ROWS);
		expect(hit?.armedAt).toBeLessThanOrEqual(hit?.pageMs ?? -1);
		expect(w.__profArmSource).toBe("helper");
	});

	it("stays inert when not armed", async () => {
		for (const data of [null, undefined, {}, { armed: false }, { armed: "true" }]) {
			await loadCommitted(data);
			expect(w.__profArm).toBeUndefined();
			expect(w.__profArmSource).toBeUndefined();
		}
	});

	it("matches its generator (regenerate with npm run profile:gen-probe)", () => {
		expect(readFileSync(path.join(fixtureProbeDir(), "main.js"), "utf8")).toBe(probePluginSource());
		const manifest = JSON.parse(readFileSync(path.join(fixtureProbeDir(), "manifest.json"), "utf8")) as { id: string };
		expect(manifest.id).toBe(PROBE_PLUGIN_ID);
	});

	it("is enabled in the fixture vault, before agent-console", () => {
		const list = JSON.parse(
			readFileSync(path.join(fixtureProbeDir(), "..", "..", "community-plugins.json"), "utf8"),
		) as string[];
		expect(list.indexOf(PROBE_PLUGIN_ID)).toBeGreaterThanOrEqual(0);
		expect(list.indexOf(PROBE_PLUGIN_ID)).toBeLessThan(list.indexOf("agent-console"));
	});
});

describe("arming on disk", () => {
	let vault: string;
	beforeEach(() => {
		vault = mkdtempSync(path.join(tmpdir(), "probe-"));
		mkdirSync(probePluginDirOf(vault, ".obsidian"), { recursive: true });
	});
	afterEach(() => rmSync(vault, { recursive: true, force: true }));

	const armed = () =>
		JSON.parse(readFileSync(path.join(probePluginDirOf(vault, ".obsidian"), "data.json"), "utf8")) as { armed: boolean };

	it("arms and disarms", () => {
		armProbe(vault, ".obsidian");
		expect(armed().armed).toBe(true);
		disarmProbe(vault, ".obsidian");
		expect(armed().armed).toBe(false);
	});

	it("disarms when the process ends with process.exit(1)", () => {
		const script =
			`import { armProbeUntilExit } from ${JSON.stringify(path.join(REPO, "tools/profile/probe-plugin.ts"))};` +
			`armProbeUntilExit(${JSON.stringify(vault)}, ".obsidian"); process.exit(1);`;
		try {
			execFileSync("npx", ["tsx", "--eval", script], { cwd: REPO, stdio: "ignore" });
		} catch {
			/* exit 1 is the point */
		}
		expect(armed().armed).toBe(false);
	});

	it("canSeed refuses a vault without the helper", () => {
		const plug = path.join(vault, ".obsidian", "plugins", "agent-console");
		mkdirSync(plug, { recursive: true });
		execFileSync("touch", [path.join(plug, "data.template.json")]);
		expect(hasProbe(vault, ".obsidian")).toBe(false);
		expect(canSeed(vault, ".obsidian")).toBe(false);
		execFileSync("touch", [path.join(probePluginDirOf(vault, ".obsidian"), "manifest.json")]);
		expect(canSeed(vault, ".obsidian")).toBe(true);
	});
});

describe("an armed data.json never travels", () => {
	const rel = `.obsidian/plugins/${PROBE_PLUGIN_ID}/data.json`;

	it("is excluded from isolated run vaults", () => {
		expect(fixtureExcludes(".obsidian")).toContain(rel);
	});

	it("is excluded from smoke studios", () => {
		const sh = readFileSync(path.join(REPO, "tools/smoke-test/smoke-test-spawn.sh"), "utf8");
		expect(sh).toContain(`--exclude '${rel}'`);
	});

	it("is not in the committed fixture", () => {
		expect(existsSync(path.join(fixtureProbeDir(), "data.json"))).toBe(false);
	});
});
