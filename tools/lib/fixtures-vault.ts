/**
 * Materialize the `studio` fixtures vault into a throwaway run folder for an
 * isolated Obsidian instance (screenshots and demo videos).
 *
 * Shared by both capture pipelines so the copy rules, the build deploy and the
 * `data.json` seeding live in one place. Two seeding profiles:
 *
 * - `screenshot`: the template plus per-agent environment only, so captured
 *   output matches today's committed shots (`/tmp/notes` paths, Claude Code as
 *   the default agent, vault folder named `studio`).
 * - `video`: the screenshot seeding plus the demo-video overrides (hermetic
 *   `video-demo` Kiro agent, pinned engine, English UI, no What's-new card).
 *
 * Specs: [[Agent Console Isolated Screenshot Capture]] § Screenshot seeding,
 * [[Agent Console Demo Video Automation]] § Isolated instance seeding.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	copyFileSync,
	lstatSync,
	unlinkSync,
} from "node:fs";
import path from "node:path";

/**
 * The fixture vault's config folder, found by where its `app.json` lives
 * (Obsidian's default is a dot-folder; the vault decides, not this code).
 */
export function configDirOf(vault: string): string {
	const d = readdirSync(vault).find((n) => existsSync(path.join(vault, n, "app.json")));
	if (!d) throw new Error(`configDirOf: no config folder with app.json in ${vault}`);
	return d;
}

/** Relative paths (from the vault root) never copied into a run vault. */
export function fixtureExcludes(configDir: string): string[] {
	const plug = `${configDir}/plugins/agent-console`;
	return [
		`${plug}/main.js`,
		`${plug}/styles.css`,
		`${plug}/manifest.json`,
		`${plug}/sessions`,
		`${plug}/data.json`,
		`${configDir}/workspace.json`,
		`${configDir}/workspace-mobile.json`,
		".DS_Store",
	];
}

/** Build artifacts deployed from the repo root into the run vault's plugin folder. */
export const BUILD_ARTIFACTS: readonly string[] = ["main.js", "styles.css", "manifest.json"];

/** Agent config keys in `data.json` that hold a single built-in agent. */
export const BUILTIN_AGENT_KEYS: readonly string[] = [
	"claude",
	"codex",
	"gemini",
	"kiro",
	"opencode",
	"antigravity",
];

/** The working directory the committed screenshots show. */
export const SCREENSHOT_CWD = "/tmp/notes";

export const pluginRel = (configDir: string): string => `${configDir}/plugins/agent-console`;

export interface EnvVar {
	key: string;
	value: string;
}

export interface AgentConfigLike {
	command?: string;
	env?: EnvVar[];
	[k: string]: unknown;
}

export interface SeedContext {
	runId: string;
	/** The user's real home folder (the instance itself runs under a fake one). */
	realHome: string;
	/** The user's login-shell PATH. */
	loginPath: string;
	/** Resolve a bare command name to an absolute path with the user's login shell. */
	resolveCommand: (cmd: string) => string;
}

export interface VideoOverrides {
	manifestVersion: string;
	vaultPath: string;
	kiroEngine: "v2" | "v3";
	kiroAgent: string;
	autoAllowPermissions: boolean;
}

/** True when `rel` (posix, vault-relative) is excluded or lies under an excluded folder. */
export function isExcluded(rel: string, excludes: readonly string[]): boolean {
	const norm = rel.split(path.sep).join("/");
	return excludes.some(
		(e) => norm === e || norm.startsWith(`${e}/`) || path.posix.basename(norm) === e,
	);
}

/** Copy the fixtures vault to `dest`, skipping {@link fixtureExcludes}. `dest` must not exist. */
export function copyFixtureVault(src: string, dest: string): void {
	if (existsSync(dest)) throw new Error(`copyFixtureVault: ${dest} already exists`);
	const excludes = fixtureExcludes(configDirOf(src));
	cpSync(src, dest, {
		recursive: true,
		dereference: true,
		filter: (from) => {
			const rel = path.relative(src, from);
			return rel === "" || !isExcluded(rel, excludes);
		},
	});
}

/**
 * Deploy the repo-root build artifacts into `pluginDir`. Removes any existing
 * entry first so a stale symlink is never written through.
 */
export function deployBuild(repoRoot: string, pluginDir: string): void {
	mkdirSync(pluginDir, { recursive: true });
	for (const f of BUILD_ARTIFACTS) {
		const from = path.join(repoRoot, f);
		if (!existsSync(from)) throw new Error(`deployBuild: missing build artifact ${from} (run npm run build)`);
		const to = path.join(pluginDir, f);
		if (existsSync(to) || isSymlink(to)) unlinkSync(to);
		copyFileSync(from, to);
	}
}

function isSymlink(p: string): boolean {
	try {
		return lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Seed `sessions/` from `sessions.seed/` when the seed exists. */
export function seedSessions(pluginDir: string): void {
	const seed = path.join(pluginDir, "sessions.seed");
	const live = path.join(pluginDir, "sessions");
	rmSync(live, { recursive: true, force: true });
	if (existsSync(seed)) cpSync(seed, live, { recursive: true });
}

function withEnv(env: EnvVar[] | undefined, add: EnvVar[]): EnvVar[] {
	const keys = new Set(add.map((e) => e.key));
	return [...(env ?? []).filter((e) => !keys.has(e.key)), ...add];
}

function seedAgent(agent: AgentConfigLike, ctx: SeedContext): AgentConfigLike {
	const out: AgentConfigLike = { ...agent };
	if (typeof out.command === "string" && out.command && !path.isAbsolute(out.command)) {
		out.command = ctx.resolveCommand(out.command);
	}
	const env = (out.env ?? []).map((e) =>
		e.key === "CLAUDE_CODE_EXECUTABLE" && e.value && !path.isAbsolute(e.value)
			? { key: e.key, value: ctx.resolveCommand(e.value) }
			: e,
	);
	out.env = withEnv(env, [
		{ key: "HOME", value: ctx.realHome },
		{ key: "PATH", value: ctx.loginPath },
		{ key: "AC_VIDEO_RUN", value: ctx.runId },
	]);
	return out;
}

/**
 * Screenshot seeding: the template plus per-agent `command`/`env` only. Pure;
 * returns a new object.
 */
export function seedScreenshotData(
	template: Record<string, unknown>,
	ctx: SeedContext,
): Record<string, unknown> {
	const d: Record<string, unknown> = structuredClone(template);
	for (const k of BUILTIN_AGENT_KEYS) {
		const a = d[k];
		if (a && typeof a === "object") d[k] = seedAgent(a as AgentConfigLike, ctx);
	}
	if (Array.isArray(d.customAgents)) {
		d.customAgents = (d.customAgents as AgentConfigLike[]).map((a) => seedAgent(a, ctx));
	}
	return d;
}

/**
 * What settings shots show instead of the seeded values: each built-in
 * agent's template `command` with an empty environment (the plugin default),
 * plus the template's custom agents, also with an empty environment. The template's env (Claude Code via
 * Bedrock, for the fixtures agent to run) is setup, not docs. Pure.
 */
export function templateAgentConfig(template: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of BUILTIN_AGENT_KEYS) {
		const a = template[k] as AgentConfigLike | undefined;
		if (a && typeof a === "object") out[k] = { command: a.command ?? "", env: [] };
	}
	out.customAgents = Array.isArray(template.customAgents)
		? (template.customAgents as AgentConfigLike[]).map((a) => ({ ...structuredClone(a), env: [] }))
		: [];
	return out;
}

/**
 * The seeded run's own agent values that its template doesn't have (resolved
 * commands, HOME, PATH, the run marker), every env var name with an
 * underscore (settings shots show an empty environment; "HOME" and "PATH"
 * are skipped because they match the "Path" row label case-insensitively),
 * plus `extras` such as the run id and run folder. A settings shot must show
 * none of them. Pure.
 */
export function seededText(
	data: Record<string, unknown>,
	template: Record<string, unknown>,
	extras: readonly string[] = [],
): string[] {
	const out = new Set<string>();
	const add = (a: AgentConfigLike | undefined, t: AgentConfigLike | undefined) => {
		if (!a || typeof a !== "object") return;
		if (typeof a.command === "string" && a.command && a.command !== t?.command) out.add(a.command);
		const tEnv = new Map((t?.env ?? []).map((e) => [e.key, e.value]));
		for (const e of a.env ?? []) {
			if (e.value && tEnv.get(e.key) !== e.value) out.add(e.value);
			if (e.key.includes("_")) out.add(e.key);
		}
	};
	for (const k of BUILTIN_AGENT_KEYS) add(data[k] as AgentConfigLike | undefined, template[k] as AgentConfigLike | undefined);
	const tCustom = Array.isArray(template.customAgents) ? (template.customAgents as AgentConfigLike[]) : [];
	if (Array.isArray(data.customAgents)) {
		for (const a of data.customAgents as AgentConfigLike[]) add(a, tCustom.find((c) => c.id === a.id));
	}
	for (const x of extras) if (x) out.add(x);
	return [...out];
}

/** Video seeding: screenshot seeding plus the demo-video overrides. Pure. */
export function seedVideoData(
	template: Record<string, unknown>,
	ctx: SeedContext,
	v: VideoOverrides,
): Record<string, unknown> {
	const d = seedScreenshotData(template, ctx);
	Object.assign(d, {
		lastSeenVersion: v.manifestVersion,
		language: "en",
		restoreTabsOnStartup: false,
		defaultAgentId: "kiro-cli",
		kiroEngineDefaultMigrated: true,
		kiroV3UpdateTipDismissed: true,
		defaultWorkingDirectory: v.vaultPath,
		tabDisplay: "horizontal",
		autoAllowPermissions: v.autoAllowPermissions,
	});
	const kiro = (d.kiro ?? {}) as AgentConfigLike;
	d.kiro = { ...kiro, args: ["acp", "--agent", v.kiroAgent], engine: v.kiroEngine };
	if (Array.isArray(d.savedSessions)) {
		d.savedSessions = (d.savedSessions as Record<string, unknown>[]).map((s) =>
			"cwd" in s ? { ...s, cwd: v.vaultPath } : s,
		);
	}
	return d;
}

/** The `obsidian.json` written into the run's user-data folder. */
export function obsidianJson(vaultPath: string, runId: string, now: number): string {
	const id = `ac0v1de0${runId.replace(/[^0-9a-f]/gi, "").slice(-8).padStart(8, "0")}`.slice(0, 16);
	return JSON.stringify({ vaults: { [id]: { path: vaultPath, ts: now, open: true } }, cli: false });
}

export interface MaterializeOptions {
	repoRoot: string;
	/** Run root, e.g. `/tmp/agent-console-video/<run-id>`. Must not exist. */
	runRoot: string;
	profile: "screenshot" | "video";
	ctx: SeedContext;
	/** Video profile only. */
	video?: Omit<VideoOverrides, "vaultPath" | "manifestVersion">;
	now?: number;
}

export interface MaterializedRun {
	vault: string;
	userData: string;
	home: string;
	pluginDir: string;
}

/** Materialize a full run folder: vault copy, build, sessions, data.json, workspace, user data. */
export function materializeRun(o: MaterializeOptions): MaterializedRun {
	const fixtures = path.join(o.repoRoot, "tools/screenshots/fixtures");
	const vaultName = o.profile === "screenshot" ? "studio" : "notes";
	const vault = path.join(o.runRoot, vaultName);
	const userData = path.join(o.runRoot, "userdata");
	const home = path.join(o.runRoot, "home");
	if (existsSync(o.runRoot)) throw new Error(`materializeRun: ${o.runRoot} already exists`);
	mkdirSync(userData, { recursive: true });
	mkdirSync(home, { recursive: true });
	copyFixtureVault(path.join(fixtures, "studio"), vault);
	const configDir = configDirOf(vault);
	const pluginDir = path.join(vault, pluginRel(configDir));
	deployBuild(o.repoRoot, pluginDir);
	seedSessions(pluginDir);
	const template = JSON.parse(readFileSync(path.join(pluginDir, "data.template.json"), "utf8")) as Record<string, unknown>;
	let data: Record<string, unknown>;
	if (o.profile === "screenshot") {
		mkdirSync(SCREENSHOT_CWD, { recursive: true });
		data = seedScreenshotData(template, o.ctx);
	} else {
		if (!o.video) throw new Error("materializeRun: video profile needs video overrides");
		const manifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8")) as { version: string };
		data = seedVideoData(template, o.ctx, { ...o.video, vaultPath: vault, manifestVersion: manifest.version });
	}
	writeFileSync(path.join(pluginDir, "data.json"), JSON.stringify(data, null, "\t"));
	copyFileSync(path.join(fixtures, "workspace.template.json"), path.join(vault, configDir, "workspace.json"));
	writeFileSync(path.join(userData, "obsidian.json"), obsidianJson(vault, o.ctx.runId, o.now ?? Date.now()));
	return { vault, userData, home, pluginDir };
}
