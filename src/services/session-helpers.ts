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
import { toAgentConfig } from "./settings-normalizer";

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
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
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
	// Search in custom agents
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
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
 * Prefers the live session id; falls back to the persisted id so a
 * restored, not-yet-reconnected tab keeps its prior sessionId instead of
 * being clobbered to null by the post-restore save (I59).
 */
export function resolveSessionIdForSave(
	liveId: string | null,
	persistedId: string | null,
): string | null {
	return liveId ?? persistedId;
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
