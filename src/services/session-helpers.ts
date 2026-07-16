/**
 * Pure helper functions for agent session management.
 * Extracted from useSession hook for reusability and testability.
 */

import type { AgentClientPluginSettings } from "../plugin";
import type {
	BaseAgentSettings,
	ClaudeAgentSettings,
	GeminiAgentSettings,
	CodexAgentSettings,
} from "../types/agent";
import type { ChatSession, SavedSessionInfo } from "../types/session";
import type { AgentCandidate } from "./agent-detection";
import { toAgentConfig } from "./settings-normalizer";
import {
	resolveAgentWorkingDirectory,
	type ResolvedAgentWorkingDirectory,
} from "../utils/working-directory";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent information for display.
 * (Inlined from SwitchAgentUseCase)
 */
export interface AgentDisplayInfo {
	/** Unique agent ID */
	id: string;
	/** Display name for UI */
	displayName: string;
}

// ============================================================================
// Helper Functions (Inlined from SwitchAgentUseCase)
// ============================================================================

/**
 * Get the default agent ID from settings (for new views).
 */
export function getDefaultAgentId(settings: AgentClientPluginSettings): string {
	return settings.defaultAgentId || settings.claude.id;
}

/**
 * Get list of all available agents from settings.
 */
export function getAvailableAgentsFromSettings(
	settings: AgentClientPluginSettings,
): AgentDisplayInfo[] {
	return [
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		{
			id: settings.kiro.id,
			displayName: settings.kiro.displayName || settings.kiro.id,
		},
		{
			id: settings.opencode.id,
			displayName: settings.opencode.displayName || settings.opencode.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
}

/**
 * Build the agent-detection candidate list (id + command) from the SINGLE
 * agent-enumeration source ({@link getAvailableAgentsFromSettings}), so the set
 * of agents detection probes can never drift from the set the landing
 * "New chat with an agent" picker offers.
 *
 * This covers every built-in AND every custom agent. Before I171, the probe in
 * plugin.ts hardcoded its own built-in-only candidate list, so custom agents
 * were never detection candidates and the detection-gated picker
 * (deriveAgentPickerOptions) always filtered them out — same class of bug as
 * I167 (a second hardcoded built-in list drifting from the enumeration source).
 *
 * Blank-command agents are dropped here (detectAvailableAgents also skips them,
 * but excluding them keeps the candidate list honest). Pure — unit-testable
 * without a plugin/Obsidian harness.
 */
export function buildAgentDetectionCandidates(
	settings: AgentClientPluginSettings,
): AgentCandidate[] {
	return getAvailableAgentsFromSettings(settings)
		.map((a) => {
			const agentSettings = findAgentSettings(settings, a.id);
			const command = agentSettings?.command ?? "";
			return { id: a.id, command };
		})
		.filter((c) => c.id.length > 0 && c.command.trim().length > 0);
}

/**
 * Build the option list for the "Default agent" settings dropdown from the
 * single agent-enumeration source ({@link getAvailableAgentsFromSettings}), so
 * the dropdown can never drift from the header agent picker. Each option is
 * `{ id, label }` where the label is `"<Display Name> (<id>)"`. Deduplicates by
 * id (a custom agent whose id collides with a built-in yields one option — the
 * dropdown value must be unique), keeping the first occurrence.
 *
 * Pure + exported so the enumeration is unit-testable without a SettingsTab /
 * Obsidian harness. See I167 (OpenCode built-in absent from the Default-agent
 * dropdown) — the bug was a second, hardcoded built-in list in SettingsTab.
 */
export function agentOptionsFromSettings(
	settings: AgentClientPluginSettings,
): { id: string; label: string }[] {
	const seen = new Set<string>();
	return getAvailableAgentsFromSettings(settings)
		.filter((a) => a.id && a.id.length > 0)
		.map(({ id, displayName }) => ({
			id,
			label: `${displayName} (${id})`,
		}))
		.filter(({ id }) => {
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
}

/**
 * Index of the agent that is the tab's *current* selection, for marking the
 * switch-agent menu (I105). Returns the FIRST entry whose id matches, so a
 * duplicate id (e.g. a custom agent colliding a built-in id) can never produce
 * two checkmarks — at most one row is marked. Returns -1 when there is no
 * agentId or no match (nothing checked), never marking a non-current row.
 *
 * Configured agents are NOT de-duplicated here: a user-configured agent must
 * stay visible in the menu even when its id collides a built-in. The collision
 * is a settings smell (the built-in shadows it in findAgentSettings); surfacing
 * it is better than silently hiding the user's agent.
 */
export function indexOfCurrentAgent(
	agents: AgentDisplayInfo[],
	agentId: string | null | undefined,
): number {
	if (!agentId) return -1;
	return agents.findIndex((agent) => agent.id === agentId);
}

/**
 * All agent ids currently in use EXCEPT the custom agent at `excludeIndex`
 * (pass -1 to exclude none). Includes the four built-in ids plus every other
 * custom agent's id. Used to validate a custom agent id for uniqueness (I105
 * prevention) so a custom agent can't be saved with an id that collides a
 * built-in (where findAgentSettings would shadow it) or another custom agent.
 */
export function collectAgentIdsExcept(
	settings: AgentClientPluginSettings,
	excludeIndex: number,
): string[] {
	const ids = [
		settings.claude.id,
		settings.codex.id,
		settings.gemini.id,
		settings.kiro.id,
	];
	settings.customAgents.forEach((agent, i) => {
		if (i !== excludeIndex) ids.push(agent.id);
	});
	return ids;
}

/**
 * Resolve a unique agent id from a desired candidate against the set of taken
 * ids. Returns the candidate unchanged when free; otherwise appends `-2`, `-3`,
 * … until unique (same suffix style as the auto-generated custom-agent ids).
 * Pure — the UI decides whether to surface that the id was adjusted (I105).
 */
export function resolveUniqueAgentId(
	candidate: string,
	takenIds: Iterable<string>,
): string {
	const taken = new Set(takenIds);
	if (!taken.has(candidate)) return candidate;
	let counter = 2;
	let next = `${candidate}-${counter}`;
	while (taken.has(next)) {
		counter += 1;
		next = `${candidate}-${counter}`;
	}
	return next;
}

/**
 * Get the currently active agent information from settings.
 */
export function getCurrentAgent(
	settings: AgentClientPluginSettings,
	agentId?: string,
): AgentDisplayInfo {
	const activeId = agentId || getDefaultAgentId(settings);
	const agents = getAvailableAgentsFromSettings(settings);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
		}
	);
}

// ============================================================================
// Helper Functions (Inlined from ManageSessionUseCase)
// ============================================================================

/**
 * Find agent settings by ID from plugin settings.
 */
export function findAgentSettings(
	settings: AgentClientPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === settings.claude.id) {
		return settings.claude;
	}
	if (agentId === settings.codex.id) {
		return settings.codex;
	}
	if (agentId === settings.gemini.id) {
		return settings.gemini;
	}
	if (agentId === settings.kiro.id) {
		return settings.kiro;
	}
	if (agentId === settings.opencode.id) {
		return settings.opencode;
	}
	// Search in custom agents
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
}

/**
 * Resolve the working directory a NEW chat with `agentId` should launch in.
 *
 * Looks up the agent's per-agent default, then applies the standard precedence
 * (per-agent default → global default → vault root) via
 * `resolveAgentWorkingDirectory`. An unknown `agentId` is treated as having no
 * per-agent default (falls back to global → vault).
 *
 * This is the single resolver shared by the mount-time cwd resolution and the
 * agent-switch path (I131), so both agree on which directory a fresh session
 * with a given agent uses. Pure and total — never throws.
 *
 * @param settings   Plugin settings (source of per-agent + global defaults).
 * @param agentId    The agent the new chat will use.
 * @param vaultRoot  The vault base path — the final fallback.
 * @param dirExists  Existence predicate (injectable for tests).
 */
export function resolveCwdForAgent(
	settings: AgentClientPluginSettings,
	agentId: string,
	vaultRoot: string,
	dirExists?: (p: string) => boolean,
): ResolvedAgentWorkingDirectory {
	const agentSettings = findAgentSettings(settings, agentId);
	return resolveAgentWorkingDirectory(
		agentSettings?.defaultWorkingDirectory ?? "",
		settings.defaultWorkingDirectory,
		vaultRoot,
		dirExists,
	);
}

/**
 * Build AgentConfig with API key injection intent for known agents.
 *
 * For built-in agents, attaches an `apiKey` intent (secretId + envVarName)
 * to the config. AcpClient.initialize() resolves the secret value from
 * Obsidian's secret storage just before spawn.
 *
 * Custom agents pass through unchanged (they manage env vars directly).
 */
export function buildAgentConfigWithApiKey(
	settings: AgentClientPluginSettings,
	agentSettings: BaseAgentSettings,
	agentId: string,
	workingDirectory: string,
) {
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);

	if (agentId === settings.claude.id) {
		const claudeSettings = agentSettings as ClaudeAgentSettings;
		return {
			...baseConfig,
			apiKey: {
				secretId: claudeSettings.apiKeySecretId,
				envVarName: "ANTHROPIC_API_KEY",
			},
		};
	}
	if (agentId === settings.codex.id) {
		const codexSettings = agentSettings as CodexAgentSettings;
		return {
			...baseConfig,
			apiKey: {
				secretId: codexSettings.apiKeySecretId,
				envVarName: "OPENAI_API_KEY",
			},
		};
	}
	if (agentId === settings.gemini.id) {
		const geminiSettings = agentSettings as GeminiAgentSettings;
		return {
			...baseConfig,
			apiKey: {
				secretId: geminiSettings.apiKeySecretId,
				envVarName: "GEMINI_API_KEY",
			},
		};
	}

	// Custom agents — no API key injection
	return baseConfig;
}

// ============================================================================
// Initial State
// ============================================================================

/**
 * Create initial session state.
 */
export function createInitialSession(
	agentId: string,
	agentDisplayName: string,
	workingDirectory: string,
): ChatSession {
	return {
		sessionId: null,
		state: "disconnected",
		agentId,
		agentDisplayName,
		authMethods: [],
		availableCommands: undefined,
		modes: undefined,
		models: undefined,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory,
	};
}

// ============================================================================
// Tab Persistence (I59)
// ============================================================================

/**
 * Resolve the sessionId to persist for a tab.
 *
 * A restored id always survives while its tab is inert. A live id supersedes
 * that restored id after reconnect. For a deliberately fresh tab, however,
 * eager acquisition may create a live session before any transcript exists;
 * keep that id runtime-only until the first message so restart does not create
 * an orphan tab slice or a false "history not stored locally" recovery state.
 */
export function resolveSessionIdForSave(
	liveId: string | null,
	persistedId: string | null,
	hasMessages = true,
): string | null {
	if (liveId !== null && (persistedId !== null || hasMessages)) return liveId;
	return persistedId;
}

/**
 * Decide the saved-session record to rewrite when a tab is renamed (I73).
 *
 * Resolves the tab's sessionId (live, falling back to persisted — same
 * contract as {@link resolveSessionIdForSave}). If a saved session exists
 * for that id, returns the record with the new title and a bumped
 * updatedAt; otherwise returns null (no resolvable session, or a tab whose
 * session is not in history — nothing to sync).
 *
 * I73: handleRenameTab previously read the live sessionId map only, so a
 * restored-but-not-reconnected tab (live id null, persisted id present)
 * skipped the history-title write and the rename was lost from session
 * history on the next reload.
 */
export function resolveRenamedSessionWrite(
	liveId: string | null,
	persistedId: string | null,
	savedSessions: SavedSessionInfo[],
	newTitle: string,
	now: string,
): SavedSessionInfo | null {
	const sessionId = resolveSessionIdForSave(liveId, persistedId);
	if (!sessionId) return null;
	const saved = savedSessions.find((s) => s.sessionId === sessionId);
	if (!saved) return null;
	return { ...saved, title: newTitle, updatedAt: now };
}
