/**
 * Sub-hook for managing agent session lifecycle and configuration.
 *
 * Handles session creation, restart, close, config/mode/model management,
 * and session-level update processing.
 */

import * as React from "react";
const { useState, useCallback, useRef } = React;

import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SessionUpdate,
	SessionConfigOption,
} from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { ISettingsAccess } from "../services/settings-service";
import type { ErrorInfo } from "../types/errors";
import { getLogger } from "../utils/logger";
import { extractErrorMessage } from "../utils/error-utils";
import {
	type AgentDisplayInfo,
	getDefaultAgentId,
	getAvailableAgentsFromSettings,
	getCurrentAgent,
	findAgentSettings,
	buildAgentConfigWithApiKey,
	createInitialSession,
} from "../services/session-helpers";
import {
	applyLegacyValue,
	tryRestoreConfigOption,
	restoreLegacyConfig,
} from "../services/session-state";
import { reloadSessionFlow } from "./reloadSessionFlow";

// ============================================================================
// Types
// ============================================================================

export interface UseAgentSessionReturn {
	session: ChatSession;
	isReady: boolean;

	// Session lifecycle
	createSession: (
		overrideAgentId?: string,
		overrideCwd?: string,
	) => Promise<string | null>;
	restartSession: (
		newAgentId?: string,
		overrideCwd?: string,
	) => Promise<void>;
	closeSession: () => Promise<void>;
	forceRestartAgent: () => Promise<void>;
	/**
	 * Soft reload: disconnect the subprocess, re-initialize (fresh harness,
	 * MCP reloaded), and resume the SAME session when the agent supports
	 * `loadSession`. Falls back to a fresh session otherwise. Never clears the
	 * transcript. Returns `{ resumed }` so the caller can pick the notice.
	 */
	reloadSession: (
		setIgnoreUpdates?: (ignore: boolean) => void,
	) => Promise<{ resumed: boolean }>;
	cancelOperation: () => Promise<void>;
	getAvailableAgents: () => AgentDisplayInfo[];

	/**
	 * Switch the tab's agent WITHOUT creating a session. Used when the user
	 * switches agent on an idle, no-session tab: updates session.agentId (the
	 * source of truth the lazy acquisition reads) and resets stale session
	 * fields, but defers actual connection to the lazy path's first-send
	 * acquisition. Avoids the eager createSession that desyncs the lazy state
	 * machine and clobbers the switch on first message.
	 */
	setAgentWithoutSession: (agentId: string) => void;
	updateSessionFromLoad: (
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
		configOptions?: SessionConfigOption[],
	) => Promise<void>;

	/** Propagate cached initialize() capabilities into session state
	 * without creating a session (I54 — fresh-tab image paste). */
	applyInitCapabilities: () => void;

	// Config
	setMode: (modeId: string) => Promise<void>;
	setModel: (modelId: string) => Promise<void>;
	setConfigOption: (configId: string, value: string) => Promise<void>;

	/** Handle session-level updates (commands, mode, config, usage, error) */
	handleSessionUpdate: (update: SessionUpdate) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAgentSession(
	agentClient: AcpClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
	setErrorInfo: (error: ErrorInfo | null) => void,
	initialAgentId?: string,
): UseAgentSessionReturn {
	// ============================================================
	// Session State
	// ============================================================

	const initialSettings = settingsAccess.getSnapshot();
	const effectiveInitialAgentId =
		initialAgentId || getDefaultAgentId(initialSettings);
	const initialAgent = getCurrentAgent(
		initialSettings,
		effectiveInitialAgentId,
	);

	const [session, setSession] = useState<ChatSession>(() =>
		createInitialSession(
			effectiveInitialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
	);

	const isReady = session.state === "ready";

	// Ref for accessing latest session in callbacks without deps
	const sessionRef = useRef(session);
	sessionRef.current = session;

	// ============================================================
	// Session Update Handler (session-level only)
	// ============================================================

	const handleSessionUpdate = useCallback(
		(update: SessionUpdate) => {
			switch (update.type) {
				case "available_commands_update":
					setSession((prev) => ({
						...prev,
						availableCommands: update.commands,
					}));
					break;
				case "current_mode_update":
					setSession((prev) => {
						if (!prev.modes) return prev;
						return {
							...prev,
							modes: {
								...prev.modes,
								currentModeId: update.currentModeId,
							},
						};
					});
					break;
				case "config_option_update":
					setSession((prev) => ({
						...prev,
						configOptions: update.configOptions,
					}));
					break;
				case "usage_update":
					setSession((prev) => ({
						...prev,
						usage: {
							used: update.used,
							size: update.size,
							cost: update.cost ?? undefined,
						},
					}));
					break;
				case "process_error":
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: update.error.title || "Agent Error",
						message: update.error.message || "An error occurred",
						suggestion: update.error.suggestion,
					});
					break;
			}
		},
		[setErrorInfo],
	);

	// ============================================================
	// Session Lifecycle
	// ============================================================

	const createSession = useCallback(
		async (overrideAgentId?: string, overrideCwd?: string) => {
			const effectiveCwd = overrideCwd || workingDirectory;
			const settings = settingsAccess.getSnapshot();
			const agentId = overrideAgentId || getDefaultAgentId(settings);
			const currentAgent = getCurrentAgent(settings, agentId);

			setSession((prev) => ({
				...prev,
				sessionId: null,
				state: "initializing",
				agentId: agentId,
				agentDisplayName: currentAgent.displayName,
				authMethods: [],
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
				usage: undefined,
				promptCapabilities: prev.promptCapabilities,
				agentCapabilities: prev.agentCapabilities,
				capabilities: prev.capabilities,
				agentInfo: prev.agentInfo,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			}));
			setErrorInfo(null);

			try {
				const agentSettings = findAgentSettings(settings, agentId);

				if (!agentSettings) {
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: "Agent Not Found",
						message: `Agent with ID "${agentId}" not found in settings`,
						suggestion:
							"Please check your agent configuration in settings.",
					});
					return null;
				}

				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					agentId,
					effectiveCwd,
				);

				const initResult =
					!agentClient.isInitialized() ||
					agentClient.getCurrentAgentId() !== agentId
						? await agentClient.initialize(agentConfig)
						: null;

				const sessionResult =
					await agentClient.newSession(effectiveCwd);

				// Pre-compute restored modes/models/configOptions BEFORE
				// marking state as "ready" to avoid a UI race: without this,
				// the dropdowns briefly show the agent's default values and
				// a message sent during the window hits the agent in the
				// wrong mode. With this, the first render after session
				// creation already shows the user's saved selection.
				let finalModes = sessionResult.modes;
				let finalModels = sessionResult.models;
				let finalConfigOptions = sessionResult.configOptions;

				if (sessionResult.configOptions && sessionResult.sessionId) {
					let configOptions = sessionResult.configOptions;
					configOptions = await tryRestoreConfigOption(
						agentClient,
						sessionResult.sessionId,
						configOptions,
						"model",
						settings.lastUsedModels[agentId],
					);
					configOptions = await tryRestoreConfigOption(
						agentClient,
						sessionResult.sessionId,
						configOptions,
						"mode",
						settings.lastUsedModes[agentId],
					);
					finalConfigOptions = configOptions;
				} else if (sessionResult.sessionId) {
					const restored = await restoreLegacyConfig(
						agentClient,
						sessionResult,
						settings.lastUsedModels[agentId],
						settings.lastUsedModes[agentId],
					);
					finalModes = restored.modes;
					finalModels = restored.models;
				}

				setSession((prev) => ({
					...prev,
					sessionId: sessionResult.sessionId,
					state: "ready",
					authMethods: initResult?.authMethods ?? [],
					modes: finalModes,
					models: finalModels,
					configOptions: finalConfigOptions,
					promptCapabilities: initResult
						? initResult.promptCapabilities
						: (agentClient.getInitializeResult()
								?.promptCapabilities ??
							prev.promptCapabilities),
					agentCapabilities: initResult
						? initResult.agentCapabilities
						: (agentClient.getInitializeResult()
								?.agentCapabilities ??
							prev.agentCapabilities),
					capabilities: initResult
						? initResult.capabilities
						: (agentClient.getInitializeResult()?.capabilities ??
							prev.capabilities),
					agentInfo: initResult
						? initResult.agentInfo
						: prev.agentInfo,
					lastActivityAt: new Date(),
				}));

				return sessionResult.sessionId;
			} catch (error) {
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: "Session Creation Failed",
					message: `Failed to create new session: ${extractErrorMessage(error)}`,
					suggestion:
						"Please check the agent configuration and try again.",
				});
				return null;
			}
		},
		[agentClient, settingsAccess, workingDirectory, setErrorInfo],
	);

	const restartSession = useCallback(
		async (newAgentId?: string, overrideCwd?: string) => {
			await createSession(newAgentId, overrideCwd);
		},
		[createSession],
	);

	const closeSession = useCallback(async () => {
		const s = sessionRef.current;
		if (s.sessionId) {
			try {
				await agentClient.cancel(s.sessionId);
			} catch (error) {
				getLogger().warn("Failed to cancel session:", error);
			}
		}
		try {
			await agentClient.disconnect();
		} catch (error) {
			getLogger().warn("Failed to disconnect:", error);
		}
		setSession((prev) => ({
			...prev,
			sessionId: null,
			state: "disconnected",
		}));
	}, [agentClient]);

	const forceRestartAgent = useCallback(async () => {
		const currentAgentId = sessionRef.current.agentId;
		await agentClient.disconnect();
		await createSession(currentAgentId);
	}, [agentClient, createSession]);

	const cancelOperation = useCallback(async () => {
		const s = sessionRef.current;
		if (!s.sessionId) return;
		try {
			await agentClient.cancel(s.sessionId);
			setSession((prev) => ({ ...prev, state: "ready" }));
		} catch (error) {
			getLogger().warn("Failed to cancel operation:", error);
			setSession((prev) => ({ ...prev, state: "ready" }));
		}
	}, [agentClient]);

	const getAvailableAgents = useCallback(() => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	// Switch the tab's agent without creating a session (idle-switch path).
	// Updates session.agentId — the source of truth the lazy acquisition
	// reads via selectAcquisitionAgent — and clears stale per-agent session
	// fields so the previous agent's modes/models/capabilities don't leak.
	// No ACP call; the lazy path connects to this agent on first send.
	const setAgentWithoutSession = useCallback(
		(agentId: string) => {
			const settings = settingsAccess.getSnapshot();
			const nextAgent = getCurrentAgent(settings, agentId);
			setSession((prev) => ({
				...prev,
				agentId,
				agentDisplayName: nextAgent.displayName,
				sessionId: null,
				state: "disconnected",
				authMethods: [],
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
				usage: undefined,
				promptCapabilities: undefined,
				agentCapabilities: undefined,
				capabilities: undefined,
				agentInfo: undefined,
				lastActivityAt: new Date(),
			}));
			setErrorInfo(null);
		},
		[settingsAccess, setErrorInfo],
	);

	const updateSessionFromLoad = useCallback(
		async (
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
			configOptions?: SessionConfigOption[],
		) => {
			// Pre-compute restored config BEFORE marking ready to avoid a UI
			// race where the dropdowns briefly show the agent's current values
			// before the user's saved selection is re-applied. See the matching
			// refactor in createSession for the rationale.
			const s = sessionRef.current;
			const settings = settingsAccess.getSnapshot();
			const agentId = s.agentId;

			let finalModes = modes;
			let finalModels = models;
			let finalConfigOptions = configOptions;

			if (configOptions && sessionId) {
				let restored = configOptions;
				restored = await tryRestoreConfigOption(
					agentClient,
					sessionId,
					restored,
					"model",
					settings.lastUsedModels[agentId],
				);
				restored = await tryRestoreConfigOption(
					agentClient,
					sessionId,
					restored,
					"mode",
					settings.lastUsedModes[agentId],
				);
				finalConfigOptions = restored;
			} else if (sessionId && modes) {
				const restored = await restoreLegacyConfig(
					agentClient,
					{ sessionId, modes, models, configOptions: undefined },
					settings.lastUsedModels[agentId],
					settings.lastUsedModes[agentId],
				);
				finalModes = restored.modes;
				finalModels = restored.models;
			}

			setSession((prev) => ({
				...prev,
				sessionId,
				state: "ready",
				modes: finalModes ?? prev.modes,
				models: finalModels ?? prev.models,
				configOptions: finalConfigOptions ?? prev.configOptions,
				// LoadSessionResponse carries no capabilities; recover them
				// from the cached init result so restored tabs match fresh
				// tabs (I47 — screenshot paste in restored tabs).
				promptCapabilities:
					agentClient.getInitializeResult()?.promptCapabilities ??
					prev.promptCapabilities,
				agentCapabilities:
					agentClient.getInitializeResult()?.agentCapabilities ??
					prev.agentCapabilities,
				capabilities:
					agentClient.getInitializeResult()?.capabilities ??
					prev.capabilities,
				lastActivityAt: new Date(),
			}));
		},
		[agentClient, settingsAccess],
	);

	const reloadSession = useCallback(async (
		setIgnoreUpdates?: (ignore: boolean) => void,
	): Promise<{
		resumed: boolean;
	}> => {
		const prev = sessionRef.current;
		const sessionId = prev.sessionId;
		const agentId = prev.agentId;
		const canResume = prev.capabilities?.restoresViaLoad === true;
		const effectiveCwd = workingDirectory;

		return reloadSessionFlow({
			sessionId,
			canResume,
			setIgnoreUpdates,
			// Soft reload: disconnect → re-init (fresh harness) → resume same id.
			resumeSameSession: async (sid: string) => {
				setSession((p) => ({ ...p, state: "initializing" }));
				setErrorInfo(null);
				await agentClient.disconnect();

				const settings = settingsAccess.getSnapshot();
				const agentSettings = findAgentSettings(settings, agentId);
				if (!agentSettings) {
					throw new Error(
						`Agent with ID "${agentId}" not found in settings`,
					);
				}
				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					agentId,
					effectiveCwd,
				);
				await agentClient.initialize(agentConfig);
				const result = await agentClient.loadSession(sid, effectiveCwd);
				await updateSessionFromLoad(
					result.sessionId,
					result.modes,
					result.models,
					result.configOptions,
				);
			},
			// Fresh session under a fresh harness. Transcript stays on screen
			// (local history); the caller never clears it on a soft reload.
			freshSession: async () => {
				await agentClient.disconnect();
				await createSession(agentId, effectiveCwd);
			},
		});
	}, [
		agentClient,
		settingsAccess,
		workingDirectory,
		createSession,
		updateSessionFromLoad,
		setErrorInfo,
	]);

	// ============================================================
	// Config (including legacy)
	// ============================================================

	const setLegacyConfigValue = useCallback(
		async (kind: "mode" | "model", value: string) => {
			const s = sessionRef.current;
			if (!s.sessionId) {
				getLogger().debug(`Cannot set ${kind}: no active session`);
				return;
			}

			const previousValue =
				kind === "mode"
					? s.modes?.currentModeId
					: s.models?.currentModelId;

			setSession((prev) => applyLegacyValue(prev, kind, value));

			try {
				if (kind === "mode") {
					await agentClient.setSessionMode(s.sessionId, value);
				} else {
					await agentClient.setSessionModel(s.sessionId, value);
				}

				if (s.agentId) {
					const persistKey =
						kind === "mode" ? "lastUsedModes" : "lastUsedModels";
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						[persistKey]: {
							...currentSettings[persistKey],
							[s.agentId]: value,
						},
					});
				}
			} catch (error) {
				getLogger().error(`Failed to set ${kind}:`, error);
				if (previousValue) {
					setSession((prev) =>
						applyLegacyValue(prev, kind, previousValue),
					);
				}
			}
		},
		[agentClient, settingsAccess],
	);

	const setMode = useCallback(
		(modeId: string) => setLegacyConfigValue("mode", modeId),
		[setLegacyConfigValue],
	);

	const setModel = useCallback(
		(modelId: string) => setLegacyConfigValue("model", modelId),
		[setLegacyConfigValue],
	);

	const setConfigOption = useCallback(
		async (configId: string, value: string) => {
			const s = sessionRef.current;
			if (!s.sessionId) {
				getLogger().debug(
					"Cannot set config option: no active session",
				);
				return;
			}

			const previousConfigOptions = s.configOptions;

			setSession((prev) => {
				if (!prev.configOptions) return prev;
				return {
					...prev,
					configOptions: prev.configOptions.map((opt) =>
						opt.id === configId
							? { ...opt, currentValue: value }
							: opt,
					),
				};
			});

			try {
				const updatedOptions = await agentClient.setSessionConfigOption(
					s.sessionId,
					configId,
					value,
				);
				setSession((prev) => ({
					...prev,
					configOptions: updatedOptions,
				}));

				const changedOption = updatedOptions.find(
					(o) => o.id === configId,
				);
				if (changedOption?.category === "model" && s.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModels: {
							...currentSettings.lastUsedModels,
							[s.agentId]: value,
						},
					});
				}
				if (changedOption?.category === "mode" && s.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModes: {
							...currentSettings.lastUsedModes,
							[s.agentId]: value,
						},
					});
				}
			} catch (error) {
				getLogger().error("Failed to set config option:", error);
				if (previousConfigOptions) {
					setSession((prev) => ({
						...prev,
						configOptions: previousConfigOptions,
					}));
				}
			}
		},
		[agentClient, settingsAccess],
	);

	// Propagate cached initialize() capabilities into session state
	// WITHOUT creating a session. Lets a fresh lazy tab enable
	// capability-gated affordances (image paste) after eager-init
	// completes but before the user types / connects (I54).
	const applyInitCapabilities = useCallback(() => {
		const init = agentClient.getInitializeResult();
		if (!init) return;
		setSession((prev) => ({
			...prev,
			promptCapabilities:
				init.promptCapabilities ?? prev.promptCapabilities,
			agentCapabilities:
				init.agentCapabilities ?? prev.agentCapabilities,
			capabilities: init.capabilities ?? prev.capabilities,
		}));
	}, [agentClient]);

	// ============================================================
	// Return
	// ============================================================

	return {
		session,
		isReady,
		createSession,
		restartSession,
		closeSession,
		forceRestartAgent,
		reloadSession,
		cancelOperation,
		getAvailableAgents,
		setAgentWithoutSession,
		updateSessionFromLoad,
		applyInitCapabilities,
		setMode,
		setModel,
		setConfigOption,
		handleSessionUpdate,
	};
}
