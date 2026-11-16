/**
 * Seed a profile vault on disk: the plugin's data.template.json and
 * sessions.seed (the screenshot setup.sh mechanism), plus the 201-message
 * heavy session and two restored tabs (heavy active, light behind it).
 * Writes into the vault it is given, so the vault that is measured is the
 * vault that is seeded.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	generateHeavySession,
	heavySavedSessionEntry,
	HEAVY_MESSAGE_COUNT,
} from "./fixtures/heavy-session";
import { findAgentLeafId } from "./studio-leaf";
import { hasProbe, PROBE_PLUGIN_ID } from "./probe-plugin";

export const HEAVY_TAB_ID = "profile-tab";
export const LIGHT_TAB_ID = "profile-light-tab";
export { HEAVY_MESSAGE_COUNT };

/**
 * `configDir` is the vault's `app.vault.configDir` (read live over CDP),
 * not an assumed folder name.
 */
export function pluginDirOf(vaultRoot: string, configDir: string): string {
	return path.join(vaultRoot, configDir, "plugins", "agent-console");
}

/**
 * Null when the vault can be profiled: it holds the plugin's seed template
 * and the profiler's helper plugin. Otherwise the missing file.
 */
export function missingForProfile(vaultRoot: string, configDir: string): string | null {
	if (!existsSync(path.join(pluginDirOf(vaultRoot, configDir), "data.template.json"))) {
		return "plugins/agent-console/data.template.json";
	}
	if (!hasProbe(vaultRoot, configDir)) return `plugins/${PROBE_PLUGIN_ID}/manifest.json`;
	return null;
}

/** True when the vault can be seeded and profiled. */
export function canSeed(vaultRoot: string, configDir: string): boolean {
	return missingForProfile(vaultRoot, configDir) === null;
}

interface SavedRecord {
	recordId?: string;
	sessionId?: string;
	agentId?: string;
	cwd?: string;
	title?: string;
}

/**
 * The chat leaf id from the vault's workspace.json. Throws when there is
 * none: without it the restored tabs can't be keyed, and every scenario
 * would profile an empty chat.
 */
function resolveAgentLeafId(vaultRoot: string, configDir: string): string {
	const wsPath = path.join(vaultRoot, configDir, "workspace.json");
	const leafId = existsSync(wsPath)
		? findAgentLeafId(JSON.parse(readFileSync(wsPath, "utf8")) as unknown)
		: null;
	if (!leafId) {
		throw new Error(
			`no Agent Console chat leaf in ${wsPath} — open the chat view in this vault once, then rerun`,
		);
	}
	return leafId;
}

export function seedStudio(vaultRoot: string, configDir: string): void {
	const pluginDir = pluginDirOf(vaultRoot, configDir);
	const template = path.join(pluginDir, "data.template.json");
	const dataJson = path.join(pluginDir, "data.json");
	const sessionsSeed = path.join(pluginDir, "sessions.seed");
	const sessions = path.join(pluginDir, "sessions");

	if (!existsSync(template)) {
		throw new Error(`no data.template.json in ${pluginDir}`);
	}
	// Resolve everything that can fail before writing anything.
	const leafId = resolveAgentLeafId(vaultRoot, configDir);
	const data = JSON.parse(readFileSync(template, "utf8")) as Record<
		string,
		unknown
	>;
	const saved = (
		Array.isArray(data.savedSessions) ? data.savedSessions : []
	) as SavedRecord[];
	// Light tab: the template's first saved chat that has a message file
	// (the file stem is the record id, falling back to the session id).
	const light = saved.find((s) => {
		const stem = s.recordId ?? s.sessionId;
		return (
			typeof stem === "string" &&
			typeof s.agentId === "string" &&
			existsSync(path.join(sessionsSeed, `${stem}.json`))
		);
	});
	if (!light) {
		throw new Error(
			`no light tab: no saved session in ${template} has a message file in ${sessionsSeed}`,
		);
	}

	cpSync(template, dataJson);
	rmSync(sessions, { recursive: true, force: true });
	if (existsSync(sessionsSeed)) {
		cpSync(sessionsSeed, sessions, { recursive: true });
	} else {
		mkdirSync(sessions, { recursive: true });
	}

	const heavy = generateHeavySession();
	const heavyEntry = { ...heavySavedSessionEntry(), recordId: heavy.sessionId };
	writeFileSync(
		path.join(sessions, `${heavy.sessionId}.json`),
		JSON.stringify(heavy, null, "\t"),
	);

	data.savedSessions = [...saved, heavyEntry];
	data.restoreTabsOnStartup = true;
	data.perLeafTabStates = [
		{
			leafId,
			activeTabId: HEAVY_TAB_ID,
			tabs: [
				{
					tabId: HEAVY_TAB_ID,
					agentId: heavy.agentId,
					label: heavyEntry.title,
					labelIsCustom: true,
					sessionId: heavy.sessionId,
					recordId: heavy.sessionId,
					tabOrder: 0,
					scrollPosition: 0,
					workingDirectory: heavyEntry.cwd,
				},
				{
					tabId: LIGHT_TAB_ID,
					agentId: light.agentId,
					label: light.title ?? "Light chat",
					labelIsCustom: true,
					sessionId: light.sessionId ?? light.recordId,
					recordId: light.recordId ?? light.sessionId,
					tabOrder: 1,
					scrollPosition: 0,
					workingDirectory: light.cwd ?? heavyEntry.cwd,
				},
			],
		},
	];
	writeFileSync(dataJson, JSON.stringify(data, null, "\t"));
}
