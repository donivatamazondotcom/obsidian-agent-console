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
 * `deriveHeaderEngine` — the tooltip's Engine line: Kiro CLI V2 or V3 for a
 * kiro-cli process (`session.kiroCli`), else what the agent reported in
 * `agentInfo`, else nothing (I247). The engine is the one the tab's
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

export type HeaderEngine =
	| { kind: "kiroCli"; engine: "v2" | "v3" }
	| { kind: "reported"; label: string }
	| { kind: "unknown" };

export interface HeaderEngineInput {
	/** The process is kiro-cli (`session.kiroCli`, decided at the acp/ edge). */
	kiroCli?: boolean;
	/** Engine the running process was launched with (`session.kiroEngine`). */
	kiroEngine?: "v2" | "v3";
	agentInfo?: { name: string; title?: string; version?: string };
}

/**
 * Engine line for the header tooltip. Pure and total. Kiro names the engine
 * it was launched with (V2 or V3; neither sends `agentInfo`). Any other agent
 * names what it reported in `agentInfo`, else nothing. `kiroEngine` alone
 * never means Kiro: it is "v2" for Claude too (I247).
 */
export function deriveHeaderEngine(input: HeaderEngineInput): HeaderEngine {
	if (input.kiroCli && input.kiroEngine) {
		return { kind: "kiroCli", engine: input.kiroEngine };
	}
	const info = input.agentInfo;
	if (info?.name) {
		const name = info.title || info.name;
		return { kind: "reported", label: info.version ? `${name} ${info.version}` : name };
	}
	return { kind: "unknown" };
}

/** Effort line: the current `thought_level` option's name, or null. */
export function deriveHeaderEffort(input: {
	configOptions?: SessionConfigOption[];
}): string | null {
	const option = input.configOptions?.find(
		(o) => o.id === "thought_level" || o.category === "thought_level",
	);
	if (!option) return null;
	const current = flattenConfigSelectOptions(option.options).find(
		(o) => o.value === option.currentValue,
	);
	return current?.name || option.currentValue || null;
}

/**
 * Mode line: the current mode's name, or null. On Kiro the mode IS the agent,
 * which the Agent line (and the I207 status line) already shows, so Kiro gets
 * no Mode line.
 */
export function deriveHeaderMode(input: {
	kiroCli?: boolean;
	modes?: SessionModeState;
	configOptions?: SessionConfigOption[];
}): string | null {
	if (input.kiroCli) return null;
	return readSessionModes(input)?.current.name ?? null;
}

function trimSeparators(path: string): string {
	return path.replace(/[\\/]+$/, "");
}

/** Folder line: the tab's folder when it isn't the vault folder, or null. */
export function deriveHeaderFolder(input: {
	cwd?: string;
	vaultRoot: string;
}): string | null {
	if (!input.cwd) return null;
	return trimSeparators(input.cwd) === trimSeparators(input.vaultRoot)
		? null
		: input.cwd;
}
