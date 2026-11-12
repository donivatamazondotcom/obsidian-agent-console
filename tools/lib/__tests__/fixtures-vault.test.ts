import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	configDirOf,
	fixtureExcludes,
	copyFixtureVault,
	deployBuild,
	isExcluded,
	materializeRun,
	obsidianJson,
	seedScreenshotData,
	seedVideoData,
	type SeedContext,
} from "../fixtures-vault";
import { normalizeRawSettings, DEFAULT_SETTINGS, type MigrateKeyFn } from "../../../src/services/settings-normalizer";

const idKey: MigrateKeyFn = (d, _f, c) => c || d;

const REPO = path.resolve(__dirname, "../../..");
const ctx: SeedContext = {
	runId: "r123",
	realHome: "/Users/someone",
	loginPath: "/usr/bin:/Users/someone/.local/bin",
	resolveCommand: (c) => `/abs/${c}`,
};

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "fv-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("excludes", () => {
	it("covers every exclude in the smoke-test spawn script", () => {
		const script = readFileSync(path.join(REPO, "tools/smoke-test/smoke-test-spawn.sh"), "utf8");
		const smoke = [...script.matchAll(/--exclude '([^']+)'/g)].map((m) => m[1]);
		expect(smoke.length).toBeGreaterThan(0);
		const ex = fixtureExcludes(configDirOf(path.join(REPO, "tools/screenshots/fixtures/studio")));
		for (const e of smoke) expect(ex).toContain(e);
	});
	it("matches nested paths and basenames", () => {
		const ex = fixtureExcludes("cfg");
		expect(isExcluded("cfg/plugins/agent-console/sessions/a.json", ex)).toBe(true);
		expect(isExcluded("Library/.DS_Store", ex)).toBe(true);
		expect(isExcluded("Welcome.md", ex)).toBe(false);
	});
});

describe("copy and deploy", () => {
	it("skips excluded files and never writes through a symlink", () => {
		const src = path.join(tmp, "src");
		const plug = path.join(src, "cfg/plugins/agent-console");
		mkdirSync(plug, { recursive: true });
		writeFileSync(path.join(src, "cfg/app.json"), "{}");
		writeFileSync(path.join(src, "Welcome.md"), "hi");
		writeFileSync(path.join(plug, "data.json"), "{}");
		writeFileSync(path.join(src, "cfg/workspace.json"), "{}");
		const repo = path.join(tmp, "repo");
		mkdirSync(repo);
		for (const f of ["main.js", "styles.css", "manifest.json"]) writeFileSync(path.join(repo, f), `new-${f}`);
		const outside = path.join(tmp, "outside.js");
		writeFileSync(outside, "do-not-touch");
		symlinkSync(outside, path.join(plug, "main.js"));

		const dest = path.join(tmp, "dest");
		copyFixtureVault(src, dest);
		const dplug = path.join(dest, "cfg/plugins/agent-console");
		expect(existsSync(path.join(dest, "Welcome.md"))).toBe(true);
		expect(existsSync(path.join(dplug, "data.json"))).toBe(false);
		expect(existsSync(path.join(dest, "cfg/workspace.json"))).toBe(false);
		expect(existsSync(path.join(dplug, "main.js"))).toBe(false);

		symlinkSync(outside, path.join(dplug, "main.js"));
		deployBuild(repo, dplug);
		expect(lstatSync(path.join(dplug, "main.js")).isSymbolicLink()).toBe(false);
		expect(readFileSync(path.join(dplug, "main.js"), "utf8")).toBe("new-main.js");
		expect(readFileSync(outside, "utf8")).toBe("do-not-touch");
	});
	it("fails when a build artifact is missing", () => {
		const repo = path.join(tmp, "repo");
		mkdirSync(repo);
		expect(() => deployBuild(repo, path.join(tmp, "p"))).toThrow(/missing build artifact/);
	});
});

describe("screenshot seeding", () => {
	const template = {
		defaultAgentId: "claude-code-acp",
		defaultWorkingDirectory: "/tmp/notes",
		claude: { command: "claude-agent-acp", env: [{ key: "CLAUDE_CODE_EXECUTABLE", value: "claude" }, { key: "AWS_REGION", value: "us-west-2" }] },
		gemini: { command: "gemini", env: [] },
		opencode: { command: "/opt/opencode", env: [{ key: "HOME", value: "/old" }] },
		customAgents: [{ id: "x", command: "mytool", env: [] }],
		savedSessions: [{ id: "s1", cwd: "/tmp/notes" }],
	};
	it("changes only agent command and env", () => {
		const d = seedScreenshotData(template, ctx);
		const claude = d.claude as { command: string; env: { key: string; value: string }[] };
		expect(claude.command).toBe("/abs/claude-agent-acp");
		expect(claude.env).toEqual([
			{ key: "CLAUDE_CODE_EXECUTABLE", value: "/abs/claude" },
			{ key: "AWS_REGION", value: "us-west-2" },
			{ key: "HOME", value: "/Users/someone" },
			{ key: "PATH", value: ctx.loginPath },
			{ key: "AC_VIDEO_RUN", value: "r123" },
		]);
		const oc = d.opencode as { command: string; env: { key: string; value: string }[] };
		expect(oc.command).toBe("/opt/opencode");
		expect(oc.env.filter((e) => e.key === "HOME")).toEqual([{ key: "HOME", value: "/Users/someone" }]);
		expect((d.customAgents as { command: string }[])[0].command).toBe("/abs/mytool");
		expect(d.defaultAgentId).toBe("claude-code-acp");
		expect(d.defaultWorkingDirectory).toBe("/tmp/notes");
		expect(d.savedSessions).toEqual([{ id: "s1", cwd: "/tmp/notes" }]);
		expect(template.claude.command).toBe("claude-agent-acp");
	});
});

describe("video seeding through the real normalizer", () => {
	it("keeps the pinned engine, run marker, tip flag and rewritten cwds", () => {
		const template = JSON.parse(
			readFileSync(path.join(REPO, "tools/screenshots/fixtures/studio", configDirOf(path.join(REPO, "tools/screenshots/fixtures/studio")), "plugins/agent-console/data.template.json"), "utf8"),
		) as Record<string, unknown>;
		const d = seedVideoData(template, ctx, {
			manifestVersion: "9.9.9",
			vaultPath: "/tmp/agent-console-video/r123/notes",
			kiroEngine: "v2",
			kiroAgent: "video-demo",
			autoAllowPermissions: false,
		});
		const n = normalizeRawSettings(d, DEFAULT_SETTINGS, idKey) as unknown as Record<string, unknown>;
		const kiro = n.kiro as { engine: string; args: string[]; env: { key: string; value: string }[] };
		expect(kiro.engine).toBe("v2");
		expect(kiro.args).toEqual(["acp", "--agent", "video-demo"]);
		expect(kiro.env).toContainEqual({ key: "AC_VIDEO_RUN", value: "r123" });
		expect(n.kiroV3UpdateTipDismissed).toBe(true);
		expect(n.defaultAgentId).toBe("kiro-cli");
		for (const s of (n.savedSessions as { cwd?: string }[]) ?? []) if (s.cwd) expect(s.cwd).toBe("/tmp/agent-console-video/r123/notes");
	});
});

describe("materializeRun", () => {
	it("builds a screenshot run from the real fixtures", () => {
		const repo = path.join(tmp, "repo");
		mkdirSync(path.join(repo, "tools/screenshots"), { recursive: true });
		// real fixtures, fake build artifacts
		const { cpSync } = require("node:fs") as typeof import("node:fs");
		cpSync(path.join(REPO, "tools/screenshots/fixtures"), path.join(repo, "tools/screenshots/fixtures"), { recursive: true, dereference: false, filter: (f: string) => !f.endsWith("main.js") && !f.endsWith("styles.css") && !f.endsWith("manifest.json") });
		for (const f of ["main.js", "styles.css"]) writeFileSync(path.join(repo, f), f);
		writeFileSync(path.join(repo, "manifest.json"), JSON.stringify({ id: "agent-console", version: "2.4.0" }));
		const runRoot = path.join(tmp, "run");
		const r = materializeRun({ repoRoot: repo, runRoot, profile: "screenshot", ctx, now: 1 });
		expect(path.basename(r.vault)).toBe("studio");
		expect(JSON.parse(readFileSync(path.join(r.pluginDir, "manifest.json"), "utf8")).version).toBe("2.4.0");
		const ws = JSON.parse(readFileSync(path.join(r.vault, configDirOf(r.vault), "workspace.json"), "utf8"));
		expect(ws.lastOpenFiles).toEqual(["Welcome.md"]);
		const oj = JSON.parse(readFileSync(path.join(r.userData, "obsidian.json"), "utf8"));
		expect(oj.cli).toBe(false);
		expect(Object.values(oj.vaults)).toEqual([{ path: r.vault, ts: 1, open: true }]);
		expect(existsSync("/tmp/notes")).toBe(true);
		expect(() => materializeRun({ repoRoot: repo, runRoot, profile: "screenshot", ctx })).toThrow(/already exists/);
	});
	it("writes a 16-character vault id", () => {
		const id = Object.keys(JSON.parse(obsidianJson("/v", "r1234abcd", 0)).vaults)[0];
		expect(id).toHaveLength(16);
	});
});
