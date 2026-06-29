/**
 * Settings normalization and validation utilities.
 *
 * Pure functions for validating and normalizing plugin settings values.
 * Used by plugin.ts (loadSettings) and SettingsTab.ts.
 */

import type {
	AgentEnvVar,
	CustomAgentSettings,
	AgentClientPluginSettings,
} from "../plugin";
import type { SavedSessionInfo } from "../types/session";
import type { PerLeafTabState } from "../types/tab";
import { migrateContextNoteSettings } from "./settings-migration";
import type { BaseAgentSettings } from "../types/agent";
import type { AgentConfig } from "../acp/acp-client";
import {
	DEFAULT_TITLE_STRATEGY,
	TITLE_STRATEGY_VALUES,
} from "../types/title-strategy";
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
	valid: T[],
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
	},
	customAgents: [],
	defaultAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	hasCompletedSetup: false,
	activeNoteAsDefaultContext: true,
	migrationNoticeShown: false,
	enableSystemNotifications: true,
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
	sessionHistorySource: "local",
	agentSessionMetaCache: {},
	lastUsedModels: {},
	lastUsedModes: {},
	restoreTabsOnStartup: true,
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
export function normalizeRawSettings(
	raw: Record<string, unknown>,
	D: AgentClientPluginSettings,
	migrateKey: MigrateKeyFn,
): AgentClientPluginSettings {
	// Extract agent sub-objects
	const rc = obj(raw.claude) ?? {};
	const rk = obj(raw.codex) ?? {};
	const rg = obj(raw.gemini) ?? {};
	const rki = obj(raw.kiro) ?? {};
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
		savedSessions: Array.isArray(raw.savedSessions)
			? (raw.savedSessions as SavedSessionInfo[])
			: D.savedSessions,
		sessionHistorySource:
			raw.sessionHistorySource === "agent" ||
			raw.sessionHistorySource === "local"
				? raw.sessionHistorySource
				: D.sessionHistorySource,
		agentSessionMetaCache:
			raw.agentSessionMetaCache &&
			typeof raw.agentSessionMetaCache === "object" &&
			!Array.isArray(raw.agentSessionMetaCache)
				? (raw.agentSessionMetaCache as AgentClientPluginSettings["agentSessionMetaCache"])
				: D.agentSessionMetaCache,
		lastUsedModels: strRecord(raw.lastUsedModels),
		lastUsedModes: strRecord(raw.lastUsedModes),
		restoreTabsOnStartup:
			typeof raw.restoreTabsOnStartup === "boolean"
				? raw.restoreTabsOnStartup
				: D.restoreTabsOnStartup,
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
		settingsImportOfferShown: bool(raw.settingsImportOfferShown, false),
		hasCompletedSetup: bool(raw.hasCompletedSetup, false),
	};
}
