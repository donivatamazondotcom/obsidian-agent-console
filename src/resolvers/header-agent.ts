/**
 * Header agent + model resolvers (pure, total).
 *
 * `deriveHeaderAgent` — which agent the header names. The configured label is
 * the "which configuration" signal; when the session runs something else the
 * header must say so instead of claiming the configured agent (I207):
 *   - notLoaded: the requested agent isn't among the modes the server offers,
 *     so it could never have been chosen — render it struck through, followed
 *     by the agent actually running.
 *   - switched: the requested agent is available but another mode is active
 *     (the user switched) — render "label › running".
 *   - configured: everything else, including agents with no requested mode
 *     (non-Kiro) and sessions with no mode info yet (connecting).
 * The mode config option (Kiro CLI V3) wins over the legacy `modes` state.
 *
 * `deriveHeaderModelName` — confirmed model, then legacy `models`, then the
 * `model` config option (Kiro CLI V3 sends only that).
 *
 * `deriveHeaderRuntime` — the tooltip's Runtime line: what the agent reported
 * in `agentInfo`, else "Kiro CLI (V3 engine)" for a process launched on V3
 * (V3 sends no `agentInfo`), else nothing. The engine is the one the tab's
 * process was launched with (`session.kiroEngine`), never the live setting
 * (I235).
 *
 * Spec: [[Kiro CLI V3 Support]].
 */
import {
	flattenConfigSelectOptions,
	type SessionConfigOption,
	type SessionModeState,
	type SessionModelState,
} from "../types/session";
import { readSessionModes } from "./session-modes";

export type HeaderAgent =
	| { kind: "configured"; label: string }
	| { kind: "switched"; label: string; running: string }
	| { kind: "notLoaded"; label: string; running: string };

export interface HeaderAgentInput {
	/** Configured agent display name. */
	label: string;
	/** Mode the configuration asked for (Kiro: the `--agent` value). */
	requestedModeId?: string;
	modes?: SessionModeState;
	configOptions?: SessionConfigOption[];
}

function findOption(
	configOptions: SessionConfigOption[] | undefined,
	kind: "mode" | "model",
): SessionConfigOption | undefined {
	return configOptions?.find((o) => o.id === kind || o.category === kind);
}

export function deriveHeaderAgent(input: HeaderAgentInput): HeaderAgent {
	const { label, requestedModeId } = input;
	const state = readSessionModes(input);
	if (!requestedModeId || !state || state.current.id === requestedModeId) {
		return { kind: "configured", label };
	}
	return state.offered.some((m) => m.id === requestedModeId)
		? { kind: "switched", label, running: state.current.name }
		: { kind: "notLoaded", label, running: state.current.name };
}

export function deriveHeaderModelName(input: {
	confirmedModelId?: string | null;
	models?: SessionModelState | null;
	configOptions?: SessionConfigOption[];
}): string | null {
	if (input.confirmedModelId) return input.confirmedModelId;
	const models = input.models;
	const legacy = models?.availableModels.find(
		(m) => m.modelId === models.currentModelId,
	)?.name;
	if (legacy) return legacy;
	const option = findOption(input.configOptions, "model");
	if (!option) return null;
	const current = flattenConfigSelectOptions(option.options).find(
		(o) => o.value === option.currentValue,
	);
	return current?.name || option.currentValue || null;
}

export type HeaderRuntime =
	| { kind: "reported"; label: string }
	| { kind: "kiroV3" }
	| { kind: "unknown" };

export interface HeaderRuntimeInput {
	agentInfo?: { name: string; title?: string; version?: string };
	/** Engine the running process was launched with (`session.kiroEngine`). */
	kiroEngine?: "v2" | "v3";
}

/** Runtime segment for the header tooltip. Pure and total. */
export function deriveHeaderRuntime(input: HeaderRuntimeInput): HeaderRuntime {
	const info = input.agentInfo;
	if (info?.name) {
		const name = info.title || info.name;
		return { kind: "reported", label: info.version ? `${name} ${info.version}` : name };
	}
	return input.kiroEngine === "v3" ? { kind: "kiroV3" } : { kind: "unknown" };
}
