import type { App } from "obsidian";
import type { AgentClientPluginSettings } from "../../plugin";
import {
	DEFAULT_SETTINGS,
	normalizeRawSettings,
	obj,
	str,
	type MigrateKeyFn,
} from "../settings-normalizer";
import type {
	ImportAgentPreview,
	ImportPreview,
	ImportSource,
} from "./ImportSource";

const SOURCE_ID = "agent-client";
const SOURCE_DISPLAY = "Agent Client";

/** Built-in agent slots that carry an API key. */
const KEY_SLOTS: ReadonlyArray<{ key: "claude" | "codex" | "gemini" }> = [
	{ key: "claude" },
	{ key: "codex" },
	{ key: "gemini" },
];

export interface AgentClientAdapterDeps {
	app: App;
	/**
	 * Real key migrator used by apply() — inject the plugin's
	 * migrateLegacyApiKey (writes plaintext → secretStorage, collision-safe;
	 * returns an existing apiKeySecretId unchanged).
	 */
	migrateKey: MigrateKeyFn;
	/** Defaults to DEFAULT_SETTINGS; overridable for tests. */
	defaults?: AgentClientPluginSettings;
}

/**
 * Import source for the upstream RAIT-09 "agent-client" plugin (shared
 * data.json lineage). Reads `<configDir>/plugins/agent-client/data.json` via
 * the adapter API (not the Vault note API — the file lives under .obsidian).
 */
export function createAgentClientAdapter(
	deps: AgentClientAdapterDeps,
): ImportSource {
	const { app, migrateKey } = deps;
	const defaults = deps.defaults ?? DEFAULT_SETTINGS;
	const sourcePath = `${app.vault.configDir}/plugins/${SOURCE_ID}/data.json`;

	async function readRaw(): Promise<Record<string, unknown> | null> {
		try {
			if (!(await app.vault.adapter.exists(sourcePath))) return null;
			const parsed: unknown = JSON.parse(
				await app.vault.adapter.read(sourcePath),
			);
			return obj(parsed);
		} catch {
			// Fail soft: missing / unreadable / malformed must never throw into
			// first-run. Treat as "no source".
			return null;
		}
	}

	function buildAgentPreviews(
		raw: Record<string, unknown>,
		normalized: AgentClientPluginSettings,
	): ImportAgentPreview[] {
		return KEY_SLOTS.map(({ key }) => {
			const slot = obj(raw[key]) ?? {};
			const secretId = str(slot.apiKeySecretId, "");
			const plaintext = str(slot.apiKey, "").trim();
			let keyStatus: ImportAgentPreview["keyStatus"];
			if (secretId) {
				keyStatus =
					app.secretStorage.getSecret(secretId) === null
						? "needs-relink"
						: "by-reference";
			} else if (plaintext) {
				keyStatus = "will-migrate-plaintext";
			} else {
				keyStatus = "none";
			}
			const n = normalized[key];
			return {
				key,
				displayName: n.displayName,
				command: n.command,
				keyStatus,
			};
		});
	}

	/**
	 * Importable agent-config slice. Excludes fork-only fields (kiro,
	 * restoreTabsOnStartup, perLeafTabStates, savedSessions,
	 * lastUsedModels/Modes, migrationNoticeShown, legacySessionsMigrated) so
	 * the caller's `{ ...current, ...slice }` merge preserves them.
	 */
	function importableSlice(
		s: AgentClientPluginSettings,
	): Partial<AgentClientPluginSettings> {
		return {
			claude: s.claude,
			codex: s.codex,
			gemini: s.gemini,
			customAgents: s.customAgents,
			defaultAgentId: s.defaultAgentId,
			autoAllowPermissions: s.autoAllowPermissions,
			activeNoteAsDefaultContext: s.activeNoteAsDefaultContext,
			enableSystemNotifications: s.enableSystemNotifications,
			debugMode: s.debugMode,
			nodePath: s.nodePath,
			exportSettings: s.exportSettings,
			displaySettings: s.displaySettings,
			sendMessageShortcut: s.sendMessageShortcut,
			chatViewLocation: s.chatViewLocation,
			windowsWslMode: s.windowsWslMode,
			windowsWslDistribution: s.windowsWslDistribution,
		};
	}

	return {
		id: SOURCE_ID,
		displayName: SOURCE_DISPLAY,

		async detect(): Promise<boolean> {
			return (await readRaw()) !== null;
		},

		async preview(): Promise<ImportPreview | null> {
			const raw = await readRaw();
			if (!raw) return null;
			// Dry normalization (identity key migrator — no secret writes) just to
			// compute displayName / command / defaultAgentId for the preview.
			const dryKey: MigrateKeyFn = (_d, _f, current) => current;
			const normalized = normalizeRawSettings(raw, defaults, dryKey);
			return {
				sourceId: SOURCE_ID,
				sourceDisplayName: SOURCE_DISPLAY,
				agents: buildAgentPreviews(raw, normalized),
				customAgentCount: normalized.customAgents.length,
				defaultAgentId: normalized.defaultAgentId,
				raw,
			};
		},

		async apply(
			preview: ImportPreview,
		): Promise<Partial<AgentClientPluginSettings>> {
			// Re-normalize with the REAL key migrator (writes plaintext →
			// secretStorage, collision-safe; ports apiKeySecretId by reference).
			const normalized = normalizeRawSettings(
				preview.raw,
				defaults,
				migrateKey,
			);
			return importableSlice(normalized);
		},
	};
}
