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

/**
 * - `engine-unsupported`: a V3 launch an older CLI rejected (D3).
 * - `engine-flag-unknown`: a V2 launch an older CLI rejected for the
 *   `--agent-engine` pin (I270). That CLI only has V2, so the client
 *   relaunches once without the flag.
 */
export type KiroStartupFailure = "engine-unsupported" | "engine-flag-unknown";

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
 * Narrow match for the V2 relaunch (I270): only clap's unknown-argument
 * error, in clap 4 wording (`unexpected argument '--agent-engine' found`,
 * measured for D3) or clap 3 wording (`Found argument '--agent-engine'
 * which wasn't expected`, not measured on kiro-cli). An unpinned launch is
 * the condition that caused I270, so it runs only when the CLI says it
 * doesn't know the flag at all; `invalid value … for '--agent-engine'`
 * (a CLI that knows the flag) never matches.
 */
const ENGINE_FLAG_UNKNOWN =
	/unexpected argument '--agent-engine'|Found argument '--agent-engine' which wasn't expected/;

/**
 * `engine-unsupported` only for a V3 launch that exited non-zero with stderr
 * naming `--agent-engine`; `engine-flag-unknown` only for a V2 launch that
 * exited 2 with clap's unknown-argument error. Everything else is null.
 */
export function classifyKiroStartupFailure(
	input: KiroStartupFailureInput,
): KiroStartupFailure | null {
	if (input.launchedEngine === "v2") {
		return input.exitCode === 2 && ENGINE_FLAG_UNKNOWN.test(input.stderr)
			? "engine-flag-unknown"
			: null;
	}
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
