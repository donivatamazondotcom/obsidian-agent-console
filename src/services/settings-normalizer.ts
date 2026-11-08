/**
 * Settings normalization and validation utilities.
 *
 * Pure functions for validating and normalizing plugin settings values.
 * Used by plugin.ts (loadSettings) and SettingsTab.ts.
 */

import {
	isKiroCliCommand,
	readKiroEngineSetting,
	type KiroEngineSetting,
} from "../acp/kiro-v3";
import { normalizeServerSessionCache } from "./server-session-cache";
import type {
	AgentEnvVar,
	CustomAgentSettings,
	AgentClientPluginSettings,
} from "../plugin";
import type { TabDisplay } from "../plugin";
import {
	RAIL_ICON_WIDTH,
	RAIL_NAMED_MIN,
	RAIL_NAMED_MAX,
	RAIL_DEFAULT_NAMED_WIDTH,
} from "../resolvers/tab-rail-width";
import type {
	AgentCapabilities,
	AgentCapabilityCacheEntry,
} from "../types/session";
import type { PerLeafTabState } from "../types/tab";
import type { PluginUpdateCache } from "../resolvers/update-check-decision";
import { migrateContextNoteSettings } from "./settings-migration";
import { normalizeSavedSessions } from "./session-record";
import type { BaseAgentSettings } from "../types/agent";
import type { AgentConfig } from "../acp/acp-client";
import {
	DEFAULT_TITLE_STRATEGY,
	TITLE_STRATEGY_VALUES,
} from "../types/title-strategy";
import { LANGUAGE_SETTING_VALUES } from "../i18n";
import {
	DEFAULT_MAX_SAVED_SESSIONS,
	parseMaxSavedSessions,
	type SavedSessionsCap,
} from "../resolvers/session-retention";
import { getLogger } from "../utils/logger";
import { releaseCore } from "../resolvers/whats-new";
import {
	DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
	normalizeObsidianSystemPromptSettings,
} from "../utils/obsidian-system-prompt";

// ============================================================================
// Display Settings
// ============================================================================

export const CHAT_FONT_SIZE_MIN = 10;
export const CHAT_FONT_SIZE_MAX = 30;

export const parseChatFontSize = (value: unknown): number | null => {
	if (value === null || value === undefined) {
		return null;
	}

	const numericValue = (() => {
		if (typeof value === "number") {
			return value;
		}

		if (typeof value === "string") {
			const trimmedValue = value.trim();
			if (trimmedValue.length === 0) {
				return Number.NaN;
			}
			if (!/^-?\d+$/.test(trimmedValue)) {
				return Number.NaN;
			}
			return Number.parseInt(trimmedValue, 10);
		}

		return Number.NaN;
	})();

	if (!Number.isFinite(numericValue)) {
		return null;
	}

	return Math.min(
		CHAT_FONT_SIZE_MAX,
		Math.max(CHAT_FONT_SIZE_MIN, Math.round(numericValue)),
	);
};

/**
 * Parse a computed CSS font-size value (e.g. `"13.6px"` read back from
 * `getComputedStyle(el).fontSize`) into whole pixels. Used to show the chat
 * area's *effective* size in the settings field's placeholder when the user
 * has not set an explicit override (`fontSize === null`), so the field always
 * communicates the size actually in use rather than just a range hint.
 *
 * Returns the rounded px, or `null` when the value can't be parsed (caller
 * then falls back to the range hint). NOT clamped to CHAT_FONT_SIZE_MIN/MAX —
 * the display must reflect the true rendered size even if a theme pushes it
 * outside the range allowed for a manual override.
 */
export const parseComputedFontSizePx = (
	value: string | number | null | undefined,
): number | null => {
	const numericValue =
		typeof value === "number" ? value : Number.parseFloat(String(value));

	if (!Number.isFinite(numericValue) || numericValue <= 0) {
		return null;
	}

	return Math.round(numericValue);
};

// ============================================================================
// Settings Utilities
// ============================================================================

export const sanitizeArgs = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
	}
	if (typeof value === "string") {
		return value
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
};

// Convert stored env structures into a deduplicated list
export const normalizeEnvVars = (value: unknown): AgentEnvVar[] => {
	const pairs: AgentEnvVar[] = [];
	if (!value) {
		return pairs;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (entry && typeof entry === "object") {
				// Type guard: check if entry has key and value properties
				const entryObj = entry as Record<string, unknown>;
				const key = "key" in entryObj ? entryObj.key : undefined;
				const val = "value" in entryObj ? entryObj.value : undefined;
				if (typeof key === "string" && key.trim().length > 0) {
					pairs.push({
						key: key.trim(),
						value: typeof val === "string" ? val : "",
					});
				}
			}
		}
	} else if (typeof value === "object") {
		for (const [key, val] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (typeof key === "string" && key.trim().length > 0) {
				pairs.push({
					key: key.trim(),
					value: typeof val === "string" ? val : "",
				});
			}
		}
	}

	const seen = new Set<string>();
	return pairs.filter((pair) => {
		if (seen.has(pair.key)) {
			return false;
		}
		seen.add(pair.key);
		return true;
	});
};

// Rebuild a custom agent entry with defaults and cleaned values
export const normalizeCustomAgent = (
	agent: Record<string, unknown>,
): CustomAgentSettings => {
	const rawId =
		agent && typeof agent.id === "string" && agent.id.trim().length > 0
			? agent.id.trim()
			: "custom-agent";
	const rawDisplayName =
		agent &&
		typeof agent.displayName === "string" &&
		agent.displayName.trim().length > 0
			? agent.displayName.trim()
			: rawId;
	return {
		id: rawId,
		displayName: rawDisplayName,
		command:
			agent &&
			typeof agent.command === "string" &&
			agent.command.trim().length > 0
				? agent.command.trim()
				: "",
		args: sanitizeArgs(agent?.args),
		env: normalizeEnvVars(agent?.env),
		defaultWorkingDirectory:
			agent && typeof agent.defaultWorkingDirectory === "string"
				? agent.defaultWorkingDirectory.trim()
				: "",
		// Kiro CLI engine: persisted only when pinned; absent means Default.
		...(() => {
			const engine = readKiroEngineSetting(agent ?? {});
			return engine === "default" ? {} : { engine };
		})(),
	};
};

// Ensure custom agent IDs are unique within the collection
export const ensureUniqueCustomAgentIds = (
	agents: CustomAgentSettings[],
): CustomAgentSettings[] => {
	const seen = new Set<string>();
	return agents.map((agent) => {
		const base =
			agent.id && agent.id.trim().length > 0
				? agent.id.trim()
				: "custom-agent";
		let candidate = base;
		let suffix = 2;
		while (seen.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		seen.add(candidate);
		return { ...agent, id: candidate };
	});
};

/**
 * Convert BaseAgentSettings to AgentConfig for process execution.
 *
 * Transforms the storage format (BaseAgentSettings) to the runtime format (AgentConfig)
 * needed by AcpClient.initialize().
 */
const CAPABILITY_KEYS: readonly (keyof AgentCapabilities)[] = [
	"listsSessions",
	"restoresViaLoad",
	"restoresViaResume",
	"forks",
	"closesSessions",
	"deletesSessions",
	"reportsModels",
];

/**
 * Validate the persisted capability cache at the deserialize edge (I260).
 * An entry missing any capability boolean, or without a `learnedAt` string,
 * is dropped and logged, never coerced: a coerced `false` would bring back
 * the wrong "doesn't keep a session list" tooltip this cache exists to fix.
 */
/**
 * I270: before the V2 pin, a Kiro "V2" launch passed no engine flag and ran
 * whatever Kiro's own setting said, so its capability entry could record
 * V3's session list. A pinned V2 can't list, so an entry for a V2 launch of
 * kiro-cli that claims to is from such a launch. Standing rule: if kiro-cli
 * V2 ever gains a list, this drops the entry on each load and the next
 * connect rewrites it (accepted).
 */
function isUnpinnedKiroV2Entry(key: string, caps: AgentCapabilities): boolean {
	if (!caps.listsSessions || !key.startsWith("v2|")) return false;
	return isKiroCliCommand(key.slice("v2|".length));
}

/** Logs once that the pre-I270 agent-id-keyed cache is being dropped. */
function warnDroppedAgentSessionMetaCache(old: unknown): undefined {
	if (old && typeof old === "object" && Object.keys(old).length > 0) {
		console.warn(
			"[Agent Console] Dropping the old per-agent server-session cache; it refills on the next connect",
		);
	}
	return undefined;
}

export function normalizeAgentCapabilityCache(
	raw: unknown,
): Record<string, AgentCapabilityCacheEntry> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, AgentCapabilityCacheEntry> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const entry = value as {
			capabilities?: Record<string, unknown>;
			learnedAt?: unknown;
		} | null;
		const caps = entry?.capabilities;
		const valid =
			!!caps &&
			typeof caps === "object" &&
			typeof entry.learnedAt === "string" &&
			CAPABILITY_KEYS.every((k) => typeof caps[k] === "boolean");
		if (!valid) {
			console.warn(
				`[Agent Console] Dropping malformed capability cache entry for "${key}"`,
			);
			continue;
		}
		const capabilities = Object.fromEntries(
			CAPABILITY_KEYS.map((k) => [k, caps[k] as boolean]),
		) as unknown as AgentCapabilities;
		if (isUnpinnedKiroV2Entry(key, capabilities)) {
			console.warn(
				`[Agent Console] Dropping capability cache entry for "${key}": a Kiro V2 launch can't list sessions, so it was learned from a launch that ran V3`,
			);
			continue;
		}
		out[key] = { capabilities, learnedAt: entry.learnedAt as string };
	}
	return out;
}

export const toAgentConfig = (
	settings: BaseAgentSettings,
	workingDirectory: string,
): AgentConfig => {
	// Convert AgentEnvVar[] to Record<string, string> for process.spawn()
	const env = settings.env.reduce(
		(acc, { key, value }) => {
			acc[key] = value;
			return acc;
		},
		{} as Record<string, string>,
	);

	return {
		id: settings.id,
		displayName: settings.displayName,
		command: settings.command,
		args: settings.args,
		env,
		workingDirectory,
	};
};

// ============================================================================
// Settings Loading Helpers
// ============================================================================

/** Extract a string value, falling back to default if not a string */
export function str(raw: unknown, fallback: string): string {
	return typeof raw === "string" ? raw : fallback;
}

/**
 * Max saved chats (I202). An unknown value falls back to the default and is
 * logged, never coerced silently.
 */
function readMaxSavedSessions(raw: unknown): SavedSessionsCap {
	const { cap, valid } = parseMaxSavedSessions(raw);
	if (!valid) {
		getLogger().warn(
			`[Settings] Ignoring invalid maxSavedSessions ${JSON.stringify(raw)}; using ${String(cap)}`,
		);
	}
	return cap;
}

/**
 * Tab display ([[Agent Console Vertical Tab Rail]]). A missing key (every
 * install before the rail) is horizontal without a log; any other invalid
 * value is logged, never coerced silently.
 */
function readTabDisplay(raw: unknown, fallback: TabDisplay): TabDisplay {
	if (raw === undefined) return fallback;
	if (raw === "horizontal" || raw === "vertical") return raw;
	getLogger().warn(
		`[Settings] Ignoring invalid tabDisplay ${JSON.stringify(raw)}; using ${fallback}`,
	);
	return fallback;
}

/**
 * `lastSeenVersion` (I300): the newest release core whose "What's new"
 * highlights the user dismissed. Missing (every install before the card) →
 * undefined without a log; valid semver → its release core; anything else
 * present is logged and dropped, never coerced.
 */
function readLastSeenVersion(raw: unknown): string | undefined {
	if (raw === undefined) return undefined;
	const core = typeof raw === "string" ? releaseCore(raw) : undefined;
	if (core === undefined) {
		getLogger().warn(
			`[Settings] Ignoring invalid lastSeenVersion ${JSON.stringify(raw)}`,
		);
	}
	return core;
}

/**
 * Rail widths are whole pixels: 60..260 with names, and 32 (icon-only) for
 * `tabRailWidth` only. A present but invalid value is logged and replaced by
 * the default – never clamped into range, so a bad write can't pass as a
 * real choice.
 */
function readRailWidth(
	key: "tabRailWidth" | "tabRailNamedWidth",
	raw: unknown,
	fallback: number,
): number {
	if (raw === undefined) return fallback;
	const valid =
		typeof raw === "number" &&
		Number.isInteger(raw) &&
		((key === "tabRailWidth" && raw === RAIL_ICON_WIDTH) ||
			(raw >= RAIL_NAMED_MIN && raw <= RAIL_NAMED_MAX));
	if (valid) return raw;
	getLogger().warn(
		`[Settings] Ignoring invalid ${key} ${JSON.stringify(raw)}; using ${String(fallback)}`,
	);
	return fallback;
}

/** Extract a boolean value, falling back to default if not a boolean */
export function bool(raw: unknown, fallback: boolean): boolean {
	return typeof raw === "boolean" ? raw : fallback;
}

/** Extract a number value with optional minimum, falling back to default */
export function num(raw: unknown, fallback: number, min?: number): number {
	if (typeof raw !== "number") return fallback;
	if (min !== undefined && raw < min) return fallback;
	return raw;
}

/** Extract a value that must be one of the valid options */
export function enumVal<T extends string>(
	raw: unknown,
	valid: readonly T[],
	fallback: T,
): T {
	return valid.includes(raw as T) ? (raw as T) : fallback;
}

/** Extract a plain object, or return null */
export function obj(raw: unknown): Record<string, unknown> | null {
	return raw && typeof raw === "object" && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: null;
}

/** Extract a Record<string, string> with validated entries */
export function strRecord(raw: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	const o = obj(raw);
	if (!o) return result;
	for (const [key, value] of Object.entries(o)) {
		if (
			typeof key === "string" &&
			key.length > 0 &&
			typeof value === "string" &&
			value.length > 0
		) {
			result[key] = value;
		}
	}
	return result;
}

/** Extract an {x, y} point, or return null if invalid */
export function xyPoint(raw: unknown): { x: number; y: number } | null {
	const o = obj(raw);
	if (!o || typeof o.x !== "number" || typeof o.y !== "number") return null;
	return { x: o.x, y: o.y };
}

/**
 * Validate the saved plugin update check result at the deserialize edge.
 * Absent → undefined. Malformed → dropped with a warning, never coerced, so a
 * corrupt entry costs one extra GitHub fetch instead of a wrong answer.
 * See [[Cache the plugin update check across reloads]].
 */
export function parsePluginUpdateCache(
	raw: unknown,
): PluginUpdateCache | undefined {
	if (raw === undefined) return undefined;
	const o = obj(raw);
	const isVersion = (v: unknown): v is string | null =>
		v === null || typeof v === "string";
	const isTime = (v: unknown): v is number =>
		typeof v === "number" && Number.isFinite(v);
	if (
		!o ||
		!isTime(o.checkedAt) ||
		!isVersion(o.latestStable) ||
		(o.latestPrerelease !== undefined && !isVersion(o.latestPrerelease)) ||
		(o.failedAt !== undefined && !isTime(o.failedAt))
	) {
		console.warn(
			"[Agent Console] Dropping malformed pluginUpdateCheck from data.json:",
			raw,
		);
		return undefined;
	}
	return {
		checkedAt: o.checkedAt,
		latestStable: o.latestStable,
		...(o.latestPrerelease !== undefined
			? { latestPrerelease: o.latestPrerelease }
			: {}),
		...(o.failedAt !== undefined ? { failedAt: o.failedAt } : {}),
	};
}

// ============================================================================
// Full settings normalization
// ============================================================================

/**
 * Canonical default plugin settings.
 *
 * Relocated here from plugin.ts so that normalizeRawSettings (and the
 * settings-import adapter that reuses it) can obtain defaults without
 * importing the plugin entry module — which would create a circular
 * dependency (plugin.ts registers the import adapter) and pull the entire
 * plugin module graph into unit tests.
 */
export const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKeySecretId: "",
		command: "claude-agent-acp",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKeySecretId: "",
		command: "codex-acp",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKeySecretId: "",
		command: "gemini",
		args: ["--experimental-acp"],
		env: [],
	},
	kiro: {
		id: "kiro-cli",
		displayName: "Kiro CLI",
		command: "kiro-cli",
		args: ["acp"],
		env: [],
		engine: "default",
	},
	opencode: {
		id: "opencode-acp",
		displayName: "OpenCode",
		command: "opencode",
		args: ["acp"],
		env: [],
	},
	customAgents: [],
	defaultAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	hasCompletedSetup: false,
	activeNoteAsDefaultContext: true,
	migrationNoticeShown: false,
	enableSystemNotifications: true,
	language: "auto",
	debugMode: false,
	nodePath: "",
	defaultWorkingDirectory: "",
	exportSettings: {
		defaultFolder: "Agent Console",
		filenameTemplate: "agent_console_{date}_{time}",
		autoExportOnNewChat: false,
		autoExportOnCloseChat: false,
		openFileAfterExport: true,
		includeImages: true,
		imageLocation: "obsidian",
		imageCustomFolder: "Agent Console",
		frontmatterTag: "agent-console",
	},
	windowsWslMode: false,
	windowsWslDistribution: undefined,
	sendMessageShortcut: "enter",
	chatViewLocation: "right",
	titleStrategy: DEFAULT_TITLE_STRATEGY,
	obsidianSystemPrompt: DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
	displaySettings: {
		showEmojis: true,
		fontSize: null,
	},
	savedSessions: [],
	maxSavedSessions: DEFAULT_MAX_SAVED_SESSIONS,
	sessionHistorySource: "local",
	serverSessionCache: {},
	agentCapabilityCache: {},
	lastUsedModels: {},
	lastUsedModes: {},
	lastUsedThoughtLevels: {},
	restoreTabsOnStartup: true,
	tabDisplay: "horizontal",
	tabRailWidth: RAIL_ICON_WIDTH,
	tabRailNamedWidth: RAIL_DEFAULT_NAMED_WIDTH,
	confirmCloseWithMultipleTabs: true,
	quickPromptsFolder: "Quick Prompts",
};

/**
 * Callback that resolves an agent's API-key secret id, isolating secret
 * side-effects (reading/writing app.secretStorage, showing Notices) from the
 * otherwise-pure mapping below.
 *
 * - loadSettings injects the plugin's migrateLegacyApiKey (migrates legacy
 *   plaintext apiKey → secretStorage, collision-safe).
 * - The settings-import adapter injects its own (copy a secret id by
 *   reference, or migrate a source plaintext apiKey), per
 *   [[Agent Console Settings Migration]].
 *
 * Signature mirrors migrateLegacyApiKey minus its onMigrate callback (the
 * caller owns the "did a migration happen?" flag).
 */
export type MigrateKeyFn = (
	defaultSecretId: string,
	fallbackSecretId: string,
	currentSecretId: string,
	legacyApiKey: string,
	agentLabel: string,
) => string;

/**
 * Normalize a raw (untyped) data.json-shaped object into typed plugin
 * settings, applying every known legacy-field migration.
 *
 * This is the single source of truth for the raw → typed mapping, shared by
 * plugin.ts loadSettings (its own data.json) and the settings-import adapter
 * (a source plugin's data.json). It is pure: no I/O, no this, no Notices —
 * secret resolution is delegated to migrateKey.
 *
 * Behavior is identical to the former inline loadSettings body; see
 * [[Agent Console Settings Migration]] § "the normalizer IS the migration
 * logic".
 */
/**
 * The built-in Kiro agent's stored engine choice, with the one-time D1
 * migration: before `kiroEngineDefaultMigrated` is set, a stored "v2" is the
 * placeholder every load used to save (no released version shipped the
 * setting), so it becomes "default". After the flag, the stored choice stands.
 */
function migrateKiroEngine(
	rki: Record<string, unknown>,
	raw: Record<string, unknown>,
): KiroEngineSetting {
	const stored = readKiroEngineSetting(rki);
	if (raw.kiroEngineDefaultMigrated === true) return stored;
	return stored === "v2" ? "default" : stored;
}

export function normalizeRawSettings(
	raw: Record<string, unknown>,
	D: AgentClientPluginSettings,
	migrateKey: MigrateKeyFn,
	/**
	 * Where a dropped corrupt `savedSessions` entry is reported (I269). The
	 * plugin passes its logger; the import preview, which parses another
	 * plugin's data and never imports its history, leaves the no-op.
	 */
	warnSession: (message: string, entry: unknown) => void = () => {},
): AgentClientPluginSettings {
	// Extract agent sub-objects
	const rc = obj(raw.claude) ?? {};
	const rk = obj(raw.codex) ?? {};
	const rg = obj(raw.gemini) ?? {};
	const rki = obj(raw.kiro) ?? {};
	const rop = obj(raw.opencode) ?? {};
	const re = obj(raw.exportSettings) ?? {};
	const rd = obj(raw.displaySettings) ?? {};

	// Normalize custom agents
	const customAgents = Array.isArray(raw.customAgents)
		? ensureUniqueCustomAgentIds(
				raw.customAgents.map((a: unknown) =>
					normalizeCustomAgent(obj(a) ?? {}),
				),
			)
		: [];

	// Migration: defaultAgentId ← activeAgentId (old name)
	const availableAgentIds = [
		D.claude.id,
		D.codex.id,
		D.gemini.id,
		D.kiro.id,
		...customAgents.map((a) => a.id),
	];
	const rawDefaultId =
		str(raw.defaultAgentId, "") || str(raw.activeAgentId, "");
	const defaultAgentId =
		rawDefaultId && availableAgentIds.includes(rawDefaultId)
			? rawDefaultId
			: availableAgentIds[0] || D.claude.id;

	const ctxMig = migrateContextNoteSettings(raw, D);

	return {
		claude: {
			id: D.claude.id, // Fixed — never from raw
			displayName: str(rc.displayName, D.claude.displayName),
			apiKeySecretId: migrateKey(
				"claude-api-key",
				"agent-client-claude-api-key",
				str(rc.apiKeySecretId, D.claude.apiKeySecretId),
				str(rc.apiKey, ""),
				"Claude",
			),
			// Migration: claude.command ← claudeCodeAcpCommandPath (old name)
			command:
				str(rc.command, "") ||
				str(raw.claudeCodeAcpCommandPath, "") ||
				D.claude.command,
			args: sanitizeArgs(rc.args),
			env: normalizeEnvVars(rc.env),
			defaultWorkingDirectory: str(rc.defaultWorkingDirectory, ""),
		},
		codex: {
			id: D.codex.id,
			displayName: str(rk.displayName, D.codex.displayName),
			apiKeySecretId: migrateKey(
				"openai-api-key",
				"agent-client-openai-api-key",
				str(rk.apiKeySecretId, D.codex.apiKeySecretId),
				str(rk.apiKey, ""),
				"Codex",
			),
			command: str(rk.command, "") || D.codex.command,
			args: sanitizeArgs(rk.args),
			env: normalizeEnvVars(rk.env),
			defaultWorkingDirectory: str(rk.defaultWorkingDirectory, ""),
		},
		gemini: {
			id: D.gemini.id,
			displayName: str(rg.displayName, D.gemini.displayName),
			apiKeySecretId: migrateKey(
				"gemini-api-key",
				"agent-client-gemini-api-key",
				str(rg.apiKeySecretId, D.gemini.apiKeySecretId),
				str(rg.apiKey, ""),
				"Gemini",
			),
			// Migration: gemini.command ← geminiCommandPath (old name)
			command:
				str(rg.command, "") ||
				str(raw.geminiCommandPath, "") ||
				D.gemini.command,
			args:
				sanitizeArgs(rg.args).length > 0
					? sanitizeArgs(rg.args)
					: D.gemini.args,
			env: normalizeEnvVars(rg.env),
			defaultWorkingDirectory: str(rg.defaultWorkingDirectory, ""),
		},
		kiro: {
			id: D.kiro.id,
			displayName: str(rki.displayName, D.kiro.displayName),
			command: str(rki.command, "") || D.kiro.command,
			args:
				sanitizeArgs(rki.args).length > 0
					? sanitizeArgs(rki.args)
					: D.kiro.args,
			env: normalizeEnvVars(rki.env),
			defaultWorkingDirectory: str(rki.defaultWorkingDirectory, ""),
			engine: migrateKiroEngine(rki, raw),
		},
		opencode: {
			id: D.opencode.id,
			displayName: str(rop.displayName, D.opencode.displayName),
			command: str(rop.command, "") || D.opencode.command,
			args:
				sanitizeArgs(rop.args).length > 0
					? sanitizeArgs(rop.args)
					: D.opencode.args,
			env: normalizeEnvVars(rop.env),
			defaultWorkingDirectory: str(rop.defaultWorkingDirectory, ""),
		},
		customAgents,
		defaultAgentId,
		autoAllowPermissions: bool(
			raw.autoAllowPermissions,
			D.autoAllowPermissions,
		),
		// Migration (Decision #20): autoMentionActiveNote → activeNoteAsDefaultContext
		activeNoteAsDefaultContext: ctxMig.activeNoteAsDefaultContext,
		migrationNoticeShown: ctxMig.migrationNoticeShown,
		enableSystemNotifications: bool(
			raw.enableSystemNotifications,
			D.enableSystemNotifications,
		),
		language: enumVal(raw.language, LANGUAGE_SETTING_VALUES, D.language),
		debugMode: bool(raw.debugMode, D.debugMode),
		nodePath: str(raw.nodePath, D.nodePath),
		defaultWorkingDirectory: str(
			raw.defaultWorkingDirectory,
			D.defaultWorkingDirectory,
		),
		exportSettings: {
			defaultFolder: str(
				re.defaultFolder,
				D.exportSettings.defaultFolder,
			),
			filenameTemplate: str(
				re.filenameTemplate,
				D.exportSettings.filenameTemplate,
			),
			autoExportOnNewChat: bool(
				re.autoExportOnNewChat,
				D.exportSettings.autoExportOnNewChat,
			),
			autoExportOnCloseChat: bool(
				re.autoExportOnCloseChat,
				D.exportSettings.autoExportOnCloseChat,
			),
			openFileAfterExport: bool(
				re.openFileAfterExport,
				D.exportSettings.openFileAfterExport,
			),
			includeImages: bool(
				re.includeImages,
				D.exportSettings.includeImages,
			),
			imageLocation: enumVal(
				re.imageLocation,
				["obsidian", "custom", "base64"],
				D.exportSettings.imageLocation,
			),
			imageCustomFolder: str(
				re.imageCustomFolder,
				D.exportSettings.imageCustomFolder,
			),
			frontmatterTag: str(
				re.frontmatterTag,
				D.exportSettings.frontmatterTag,
			),
		},
		windowsWslMode: bool(raw.windowsWslMode, D.windowsWslMode),
		windowsWslDistribution: str(
			raw.windowsWslDistribution,
			D.windowsWslDistribution as string,
		),
		sendMessageShortcut: enumVal(
			raw.sendMessageShortcut,
			["enter", "cmd-enter"],
			D.sendMessageShortcut,
		),
		chatViewLocation: enumVal(
			raw.chatViewLocation,
			["right", "left"],
			D.chatViewLocation,
		),
		// F03 — AI Session Rename. A missing key (fresh install or pre-F03
		// upgrade) falls back to D.titleStrategy = "agent-suggested" (D1).
		titleStrategy: enumVal(
			raw.titleStrategy,
			TITLE_STRATEGY_VALUES,
			D.titleStrategy,
		),
		obsidianSystemPrompt: normalizeObsidianSystemPromptSettings(
			raw.obsidianSystemPrompt,
		),
		displaySettings: {
			showEmojis: bool(rd.showEmojis, D.displaySettings.showEmojis),
			fontSize: parseChatFontSize(rd.fontSize),
		},
		// I269: parse at the edge and run the one-time record-id migration.
		savedSessions: Array.isArray(raw.savedSessions)
			? normalizeSavedSessions(raw.savedSessions, warnSession)
			: D.savedSessions,
		maxSavedSessions: readMaxSavedSessions(raw.maxSavedSessions),
		sessionHistorySource:
			raw.sessionHistorySource === "agent" ||
			raw.sessionHistorySource === "local"
				? raw.sessionHistorySource
				: D.sessionHistorySource,
		// I270: keyed by launch. The old agent-id-keyed `agentSessionMetaCache`
		// can't be mapped to launches reliably; it's a cache, so it is dropped
		// here and refills on the next connect.
		serverSessionCache: normalizeServerSessionCache(
			raw.serverSessionCache ??
				warnDroppedAgentSessionMetaCache(raw.agentSessionMetaCache),
			(message) => console.warn(`[Agent Console] ${message}`),
		),
		agentCapabilityCache: normalizeAgentCapabilityCache(
			raw.agentCapabilityCache,
		),
		lastUsedModels: strRecord(raw.lastUsedModels),
		lastUsedModes: strRecord(raw.lastUsedModes),
		lastUsedThoughtLevels: strRecord(raw.lastUsedThoughtLevels),
		restoreTabsOnStartup:
			typeof raw.restoreTabsOnStartup === "boolean"
				? raw.restoreTabsOnStartup
				: D.restoreTabsOnStartup,
		tabDisplay: readTabDisplay(raw.tabDisplay, D.tabDisplay),
		tabRailWidth: readRailWidth("tabRailWidth", raw.tabRailWidth, D.tabRailWidth),
		tabRailNamedWidth: readRailWidth(
			"tabRailNamedWidth",
			raw.tabRailNamedWidth,
			D.tabRailNamedWidth,
		),
		confirmCloseWithMultipleTabs:
			typeof raw.confirmCloseWithMultipleTabs === "boolean"
				? raw.confirmCloseWithMultipleTabs
				: D.confirmCloseWithMultipleTabs,
		quickPromptsFolder: str(
			raw.quickPromptsFolder,
			D.quickPromptsFolder,
		),
		// Type-level coercion only — record-level validation happens inside
		// SessionStorage.loadTabState (so the service can return null on
		// corruption rather than silently dropping malformed records here).
		perLeafTabStates: Array.isArray(raw.perLeafTabStates)
			? (raw.perLeafTabStates as PerLeafTabState[])
			: undefined,
		legacySessionsMigrated: bool(raw.legacySessionsMigrated, false),
		kiroEngineDefaultMigrated: true,
		settingsImportOfferShown: bool(raw.settingsImportOfferShown, false),
		pluginUpdateCheck: parsePluginUpdateCache(raw.pluginUpdateCheck),
		lastSeenVersion: readLastSeenVersion(raw.lastSeenVersion),
		hasCompletedSetup: bool(raw.hasCompletedSetup, false),
	};
}

/**
 * Defaults that only a true fresh install (no data.json yet) gets, applied by
 * `loadSettings` before its first save. Existing installs never pass through
 * here, so a data.json without one of these keys keeps the normalizer default
 * (I299: a missing `tabDisplay` stays horizontal for existing users).
 *
 * - `tabDisplay: "vertical"` – new users start on the tab rail; `tabRailWidth`
 *   keeps its default 32 (icons only).
 * - `lastSeenVersion` – the running version's release core (I300), so new
 *   users never see the "What's new" card. Left unset if `version` isn't
 *   semver.
 */
export function applyFreshInstallDefaults(
	settings: AgentClientPluginSettings,
	version?: string,
): AgentClientPluginSettings {
	const lastSeenVersion = releaseCore(version);
	return {
		...settings,
		tabDisplay: "vertical",
		...(lastSeenVersion !== undefined ? { lastSeenVersion } : {}),
	};
}
