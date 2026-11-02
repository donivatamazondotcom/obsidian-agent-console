/**
 * D3: tell an older kiro-cli (no V3 engine) apart from other startup failures.
 *
 * An old CLI rejects `acp --agent-engine=v3` the way clap rejects any unknown
 * flag: it prints `error: unexpected argument '--agent-engine' found` on
 * stderr and exits 2 before answering `initialize` (measured 2026-11-02, see
 * [[Kiro CLI V3 Support]] § Known Issues). A current CLI given a bad value
 * prints `invalid value '…' for '--agent-engine <ENGINE>'`, the same class.
 *
 * Detection reads the exit code and stderr, never a version string: the CLI
 * tells us it doesn't know the flag, which is the fact that matters.
 */

import type { ErrorInfo } from "../types/errors";
import { t } from "../i18n";

export type KiroStartupFailure = "engine-unsupported";

export interface KiroStartupFailureInput {
	/** Engine the process was launched with. */
	launchedEngine: "v2" | "v3" | undefined;
	/** Exit code, or null when the process hadn't exited (or was signalled). */
	exitCode: number | null;
	/** Stderr the process wrote before it exited. */
	stderr: string;
}

/** Stderr from clap naming the engine flag: unknown argument or bad value. */
const ENGINE_FLAG_REJECTED = /--agent-engine/;

/**
 * `engine-unsupported` only for a V3 launch that exited non-zero with stderr
 * naming `--agent-engine`. Everything else is not D3 (null).
 */
export function classifyKiroStartupFailure(
	input: KiroStartupFailureInput,
): KiroStartupFailure | null {
	if (input.launchedEngine !== "v3") return null;
	if (input.exitCode === null || input.exitCode === 0) return null;
	if (!ENGINE_FLAG_REJECTED.test(input.stderr)) return null;
	return "engine-unsupported";
}

/**
 * What the chat shows for an older kiro-cli. Names the agent as well as the
 * D1 setting labels: the built-in Kiro CLI agent and every kiro-cli custom
 * agent each have a "Kiro CLI engine" setting, so "this agent" was ambiguous
 * (D3 smoke H3: the user switched the built-in agent instead).
 */
export function kiroEngineUnsupportedInfo(agentName: string): ErrorInfo {
	return {
		title: t("chat.acpErrors.kiroEngineUnsupportedTitle"),
		message: t("chat.acpErrors.kiroEngineUnsupported"),
		suggestion: t("chat.acpErrors.kiroEngineUnsupportedSuggestion", {
			setting: t("settings.kiroEngine.name"),
			option: t("settings.kiroEngine.v2"),
			agent: agentName,
		}),
	};
}
