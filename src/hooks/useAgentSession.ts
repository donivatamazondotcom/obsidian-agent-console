/**
 * Sub-hook for managing agent session lifecycle and configuration.
 *
 * Handles session creation, restart, close, config/mode/model management,
 * and session-level update processing.
 */

import * as React from "react";
const { useState, useCallback, useRef, useEffect } = React;

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
	restoreConfigOptions,
	CONFIG_PICK_SETTINGS_KEY,
	savedConfigPicks,
	findUnofferedModel,
	reconcilePendingPicks,
	type SavedConfigPicks,
	restoreLegacyConfig,
} from "../services/session-state";
import { resolveModeRequest } from "../resolvers/session-modes";
import { reloadSessionFlow } from "./reloadSessionFlow";
import { t } from "../i18n";
import { Notice } from "obsidian";

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
	/**
	 * Mode a quick prompt asked this tab to start in (id or display name).
	 * One-shot: applied to the first session's pre-ready re-apply only, and
	 * never saved as the agent's default.
	 */
	initialModeRequest?: string,
	/**
	 * A restored tab's own mode id (persisted per tab). One-shot: replaces
	 * the agent's saved mode for the first load's re-apply only; never
	 * saved, and silently ignored when the session no longer offers it (I231).
	 */
	restoredModeId?: string,
): UseAgentSessionReturn {
	const pendingModeRequestRef = useRef<string | undefined>(initialModeRequest);
	const pendingRestoredModeRef = useRef<string | undefined>(restoredModeId);
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
	/** I217: per-session saved picks still waiting for their option to appear. */
	const pendingPicks = useRef<Map<string, SavedConfigPicks>>(new Map());
	/**
	 * I217: newest full config snapshot per session. Config options arrive as
	 * full snapshots from three places (the session/new response, each
	 * config_option_update, each set_config_option result) and the newest
	 * one is the truth. Kiro CLI V3 can push an update while createSession
	 * is still awaiting, so createSession reads from here instead of trusting
	 * its own older response.
	 */
	const configSnapshots = useRef<Map<string, SessionConfigOption[]>>(new Map());
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
					if (update.sessionId) {
						configSnapshots.current.set(
							update.sessionId,
							update.configOptions,
						);
					}
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
				case "model_update":
					setSession((prev) => ({
						...prev,
						confirmedModelId: update.modelId,
					}));
					break;
				case "process_error":
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title:
							update.error.title ||
							t("chat.acpErrors.titleAgent"),
						message:
							update.error.message ||
							t("chat.acpErrors.errorOccurred"),
						suggestion: update.error.suggestion,
					});
					break;

				default:
					// Message-level updates are handled elsewhere; this
					// session-level handler intentionally ignores them.
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
			const modeRequest = pendingModeRequestRef.current;
			pendingModeRequestRef.current = undefined;

			setSession((prev) => ({
				...prev,
				sessionId: null,
				state: "initializing",
				unmetModeRequest: undefined,
				agentId: agentId,
				agentDisplayName: currentAgent.displayName,
				authMethods: [],
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				// Clear the prior session's confirmed model — the new session
				// hasn't confirmed one yet, so the header must not carry the
				// old model through the initializing window (I197).
				confirmedModelId: undefined,
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
						title: t("chat.acpErrors.agentNotFoundTitle"),
						message: t("chat.acpErrors.agentNotFound", {
							agentId,
						}),
						suggestion: t("chat.acpErrors.checkYourAgentConfig"),
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

				// Kiro CLI V3 takes the saved model / effort as session/new
				// inputs and applies them itself, so the restore can't race a
				// model list that arrives after the response (I217).
				const savedPicks = savedConfigPicks(settings, agentId);
				const picksAsInputs =
					typeof agentClient.acceptsInitialConfigPicks === "function" &&
					agentClient.acceptsInitialConfigPicks();
				const sessionResult = picksAsInputs
					? await agentClient.newSession(effectiveCwd, {
							modelId: savedPicks.model,
							effortLevel: savedPicks.thoughtLevel,
						})
					: await agentClient.newSession(effectiveCwd);

				// Pre-compute restored modes/models/configOptions BEFORE
				// marking state as "ready" to avoid a UI race: without this,
				// the dropdowns briefly show the agent's default values and
				// a message sent during the window hits the agent in the
				// wrong mode. With this, the first render after session
				// creation already shows the user's saved selection.
				let finalModes = sessionResult.modes;
				let finalModels = sessionResult.models;
				let finalConfigOptions = sessionResult.configOptions;

				// An update for this brand-new session id can only be newer
				// than the response, so the response is recorded only when no
				// update beat createSession here (I217).
				const sid = sessionResult.sessionId;
				if (sid && sessionResult.configOptions && !configSnapshots.current.has(sid)) {
					configSnapshots.current.set(sid, sessionResult.configOptions);
				}
				const baseConfigOptions = sid
					? configSnapshots.current.get(sid)
					: undefined;

				// A quick prompt's mode (id or display name) replaces the saved
				// mode for this session only. The re-apply below doesn't persist,
				// so `lastUsedModes` keeps the user's own pick.
				const modeTarget = resolveModeRequest(modeRequest, {
					modes: sessionResult.modes,
					configOptions: baseConfigOptions,
					modeListMayArriveLate: picksAsInputs,
				});
				const picks: SavedConfigPicks = modeTarget.modeId
					? { ...savedPicks, mode: modeTarget.modeId }
					: savedPicks;

				if (baseConfigOptions && sessionResult.sessionId) {
					const restoredOptions = await restoreConfigOptions(
						agentClient,
						sessionResult.sessionId,
						baseConfigOptions,
						// Also on V3: the server already applied the inputs, so
						// these are no-ops unless it dropped one (it drops
						// effortLevel on a cold start, I217).
						picks,
					);
					// A set_config_option result is newer than anything
					// delivered before it; a later update replaces it in turn.
					if (restoredOptions !== baseConfigOptions) {
						configSnapshots.current.set(sid, restoredOptions);
					}
					finalConfigOptions =
						configSnapshots.current.get(sid) ?? restoredOptions;
					if (picksAsInputs) {
						// Picks whose option isn't in the response yet are
						// checked when it arrives in a config_option_update.
						pendingPicks.current.set(
							sessionResult.sessionId,
							reconcilePendingPicks(finalConfigOptions, picks)
								.stillPending,
						);
					}
				} else if (sessionResult.sessionId) {
					const restored = await restoreLegacyConfig(
						agentClient,
						sessionResult,
						settings.lastUsedModels[agentId],
						picks.mode,
					);
					finalModes = restored.modes;
					finalModels = restored.models;
				}

				setSession((prev) => ({
					...prev,
					sessionId: sessionResult.sessionId,
					state: "ready",
					unmetModeRequest: modeTarget.unmet,
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
					title: t("chat.acpErrors.sessionCreationFailedTitle"),
					message: t("chat.acpErrors.sessionCreationFailed", {
						message: extractErrorMessage(error),
					}),
					suggestion: t("chat.acpErrors.checkConfigTryAgain"),
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
				// The previous agent's confirmed model must not survive a
				// switch — the header reads confirmedModelId directly, so a
				// stale value renders the old model under the new agent (I197).
				confirmedModelId: undefined,
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

			// I231: the restored tab's own mode wins over the agent's saved
			// mode when the session still offers it; otherwise fall back
			// silently (a restore must never block a send).
			const restoredMode = pendingRestoredModeRef.current;
			pendingRestoredModeRef.current = undefined;
			const savedPicks = savedConfigPicks(settings, agentId);
			const tabMode = restoredMode
				? resolveModeRequest(restoredMode, {
						modes,
						configOptions,
						modeListMayArriveLate: false,
					}).modeId
				: undefined;
			const picks = tabMode ? { ...savedPicks, mode: tabMode } : savedPicks;

			// Kiro CLI V3 stores model, effort and mode per session, so a
			// loaded or forked session keeps its own (S3 decision a1).
			const keepsOwnConfig =
				typeof agentClient.storesSessionConfig === "function" &&
				agentClient.storesSessionConfig();

			if (configOptions && sessionId && keepsOwnConfig) {
				finalConfigOptions = configOptions;
			} else if (configOptions && sessionId) {
				finalConfigOptions = await restoreConfigOptions(
					agentClient,
					sessionId,
					configOptions,
					picks,
				);
			} else if (sessionId && modes) {
				const restored = await restoreLegacyConfig(
					agentClient,
					{ sessionId, modes, models, configOptions: undefined },
					settings.lastUsedModels[agentId],
					picks.mode,
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
				configSnapshots.current.set(s.sessionId, updatedOptions);
				setSession((prev) => ({
					...prev,
					configOptions: updatedOptions,
				}));

				const changedOption = updatedOptions.find(
					(o) => o.id === configId,
				);
				const category = changedOption?.category;
				const persistKey =
					category && category in CONFIG_PICK_SETTINGS_KEY
						? CONFIG_PICK_SETTINGS_KEY[
								category as keyof typeof CONFIG_PICK_SETTINGS_KEY
							]
						: undefined;
				if (persistKey && s.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						[persistKey]: {
							...currentSettings[persistKey],
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

	// I217: a model the agent reports but doesn't offer (Kiro CLI V3 takes an
	// unknown saved model id without checking) would fail the first prompt.
	// Checked on every config snapshot – the session/new response and each
	// config_option_update – and reset once per session to the first offered
	// model, which also replaces the saved pick.
	const recoveredModelSessions = useRef<Set<string>>(new Set());
	// I217: saved picks sent as V3 session inputs whose option arrives late.
	// Resolved once per option, the first time it shows up (see createSession).
	useEffect(() => {
		const sid = session.sessionId;
		if (!sid || session.state !== "ready") return;
		const pending = pendingPicks.current.get(sid);
		if (!pending || Object.keys(pending).length === 0) return;
		const { apply, stillPending } = reconcilePendingPicks(
			session.configOptions,
			pending,
		);
		pendingPicks.current.set(sid, stillPending);
		void (async () => {
			for (const { configId, value } of apply) {
				await setConfigOption(configId, value);
			}
		})();
	}, [session.sessionId, session.state, session.configOptions, setConfigOption]);
	useEffect(() => {
		const sid = session.sessionId;
		if (!sid || session.state !== "ready") return;
		const unoffered = findUnofferedModel(session.configOptions);
		if (!unoffered || recoveredModelSessions.current.has(sid)) return;
		recoveredModelSessions.current.add(sid);
		getLogger().log(
			`Model "${unoffered.rejected}" is not offered; switching to "${unoffered.fallback.value}"`,
		);
		new Notice(
			t("notices.savedModelUnavailable", {
				model: unoffered.rejected,
				fallback: unoffered.fallback.name,
			}),
		);
		void setConfigOption(unoffered.configId, unoffered.fallback.value);
	}, [session.sessionId, session.state, session.configOptions, setConfigOption]);

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
