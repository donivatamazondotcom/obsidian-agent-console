/**
 * Pure functions for session state updates.
 *
 * These functions are extracted from useSession to keep the hook thin
 * and to allow independent testing. They handle session config restoration
 * and legacy mode/model management.
 */

import type {
	ChatSession,
	SessionConfigOption,
	SessionResult,
} from "../types/session";
import { flattenConfigSelectOptions } from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { AgentClientPluginSettings } from "../plugin";

// ============================================================================
// Legacy Config Helpers
// ============================================================================

/**
 * Apply a legacy mode/model value to the session state.
 * Used for both optimistic updates and rollbacks.
 */
export function applyLegacyValue(
	prev: ChatSession,
	kind: "mode" | "model",
	value: string,
): ChatSession {
	if (kind === "mode") {
		if (!prev.modes) return prev;
		return { ...prev, modes: { ...prev.modes, currentModeId: value } };
	}
	if (!prev.models) return prev;
	return { ...prev, models: { ...prev.models, currentModelId: value } };
}

// ============================================================================
// Config Restore Helpers
// ============================================================================

/**
 * Try to restore a saved config option value by category.
 * Returns updated configOptions if restored, or the original if unchanged.
 */
export async function tryRestoreConfigOption(
	agentClient: AcpClient,
	sessionId: string,
	configOptions: SessionConfigOption[],
	category: string,
	savedValue: string | undefined,
): Promise<SessionConfigOption[]> {
	if (!savedValue) return configOptions;

	const option = configOptions.find((o) => o.category === category);
	if (!option) return configOptions;
	if (savedValue === option.currentValue) return configOptions;
	if (
		!flattenConfigSelectOptions(option.options).some(
			(o) => o.value === savedValue,
		)
	)
		return configOptions;

	try {
		return await agentClient.setSessionConfigOption(
			sessionId,
			option.id,
			savedValue,
		);
	} catch {
		return configOptions;
	}
}

/** Saved per-agent picks to re-apply on a new or loaded session. */
export interface SavedConfigPicks {
	model?: string;
	thoughtLevel?: string;
	mode?: string;
}

/**
 * Re-apply saved config-option picks in dependency order: model, then
 * thought level, then mode. The thought-level option can depend on the model
 * (Kiro CLI V3 offers `effortLevel` only for models that support effort), so
 * it is looked up in the options the model change returned. Each step is
 * skipped when its option is absent or the value isn't offered.
 */
export async function restoreConfigOptions(
	agentClient: AcpClient,
	sessionId: string,
	configOptions: SessionConfigOption[],
	saved: SavedConfigPicks,
): Promise<SessionConfigOption[]> {
	let restored = configOptions;
	restored = await tryRestoreConfigOption(agentClient, sessionId, restored, "model", saved.model);
	restored = await tryRestoreConfigOption(agentClient, sessionId, restored, "thought_level", saved.thoughtLevel);
	restored = await tryRestoreConfigOption(agentClient, sessionId, restored, "mode", saved.mode);
	return restored;
}

/** The saved picks for one agent, read from the settings snapshot. */
export function savedConfigPicks(
	settings: Pick<
		AgentClientPluginSettings,
		"lastUsedModels" | "lastUsedThoughtLevels" | "lastUsedModes"
	>,
	agentId: string,
): SavedConfigPicks {
	return {
		model: settings.lastUsedModels?.[agentId],
		thoughtLevel: settings.lastUsedThoughtLevels?.[agentId],
		mode: settings.lastUsedModes?.[agentId],
	};
}

/** Settings key that remembers each config-option category per agent. */
export const CONFIG_PICK_SETTINGS_KEY = {
	model: "lastUsedModels",
	thought_level: "lastUsedThoughtLevels",
	mode: "lastUsedModes",
} as const;

/**
 * Restore last used mode/model via legacy APIs.
 * Only called when configOptions is not available.
 *
 * Returns the final modes/models state after restoration (or the originals
 * if no restoration was needed or if the agent-side calls failed).
 * The caller is responsible for applying these to session state.
 * This function has no side effects on React state so callers can sequence
 * the restore BEFORE marking the session as "ready", avoiding a UI race
 * where the dropdown briefly shows the agent's default mode/model before
 * the user's saved selection is re-applied.
 */
export async function restoreLegacyConfig(
	agentClient: AcpClient,
	sessionResult: SessionResult,
	savedModelId: string | undefined,
	savedModeId: string | undefined,
): Promise<{
	modes: SessionResult["modes"];
	models: SessionResult["models"];
}> {
	let modes = sessionResult.modes;
	let models = sessionResult.models;

	if (!sessionResult.sessionId) return { modes, models };

	// Legacy model restore
	if (models && savedModelId) {
		if (
			savedModelId !== models.currentModelId &&
			models.availableModels.some((m) => m.modelId === savedModelId)
		) {
			try {
				await agentClient.setSessionModel(
					sessionResult.sessionId,
					savedModelId,
				);
				models = { ...models, currentModelId: savedModelId };
			} catch {
				// Agent default is fine as fallback
			}
		}
	}

	// Legacy mode restore
	if (modes && savedModeId) {
		if (
			savedModeId !== modes.currentModeId &&
			modes.availableModes.some((m) => m.id === savedModeId)
		) {
			try {
				await agentClient.setSessionMode(
					sessionResult.sessionId,
					savedModeId,
				);
				modes = { ...modes, currentModeId: savedModeId };
			} catch {
				// Agent default is fine as fallback
			}
		}
	}

	return { modes, models };
}

/** A model the agent reports as current but doesn't offer (I217). */
export interface UnofferedModel {
	configId: string;
	rejected: string;
	fallback: { value: string; name: string };
}

/**
 * The model option's current value when it isn't among the offered values,
 * with the first offered value as the fallback (the agent's preferred order).
 * Kiro CLI V3 accepts any `_meta.kiro.modelId` without checking it, so a
 * retired saved model shows up here instead of failing at create time.
 * Null when there is no model option, no offered values, or nothing wrong.
 */
export function findUnofferedModel(
	configOptions: SessionConfigOption[] | undefined,
): UnofferedModel | null {
	const option = configOptions?.find(
		(o) => o.id === "model" || o.category === "model",
	);
	if (!option) return null;
	const offered = flattenConfigSelectOptions(option.options);
	if (offered.length === 0) return null;
	if (offered.some((o) => o.value === option.currentValue)) return null;
	return {
		configId: option.id,
		rejected: option.currentValue,
		fallback: { value: offered[0].value, name: offered[0].name || offered[0].value },
	};
}

/** Config-option category for each saved pick. */
const PICK_CATEGORY: Record<keyof SavedConfigPicks, string> = {
	model: "model",
	thoughtLevel: "thought_level",
	mode: "mode",
};

/**
 * Saved picks sent as session inputs whose option hadn't appeared yet, checked
 * against a new config snapshot. Each pick whose option is now present is
 * resolved – re-applied if the server reports a different, offered value –
 * and the rest stay pending. Model first, so a dependent option (Kiro V3
 * effort) is corrected after it. Kiro CLI V3 drops `_meta.kiro.effortLevel`
 * when its model list is still loading (I217), which is what this catches.
 */
export function reconcilePendingPicks(
	configOptions: SessionConfigOption[] | undefined,
	pending: SavedConfigPicks,
): {
	apply: Array<{ configId: string; value: string }>;
	stillPending: SavedConfigPicks;
} {
	const apply: Array<{ configId: string; value: string }> = [];
	const stillPending: SavedConfigPicks = {};
	for (const key of ["model", "thoughtLevel", "mode"] as const) {
		const value = pending[key];
		if (!value) continue;
		const option = configOptions?.find((o) => o.category === PICK_CATEGORY[key]);
		if (!option) {
			stillPending[key] = value;
			continue;
		}
		if (
			option.currentValue !== value &&
			flattenConfigSelectOptions(option.options).some((o) => o.value === value)
		) {
			apply.push({ configId: option.id, value });
		}
	}
	return { apply, stillPending };
}
