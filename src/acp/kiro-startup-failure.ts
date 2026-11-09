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
 * - `engine-flag-unknown`: the CLI doesn't know `--agent-engine` at all
 *   (clap's unknown-argument error, exit 2), on either engine. That CLI only
 *   has V2. A V2 launch relaunches once without the flag (I270); so does a
 *   V3 launch that follows the Default engine (I302). A V3 launch the user
 *   chose by name shows D3's error instead.
 * - `engine-v3-missing`: a V3 launch on a CLI that knows `--agent-engine`
 *   but lists no `v3` (clap's `invalid value 'v3'`, exit 2; kiro-cli 2.7.1,
 *   measured 2026-11-09). The Default engine relaunches pinned on V2 (I302).
 * - `engine-unsupported`: any other V3 launch the CLI rejected naming
 *   `--agent-engine` (D3).
 */
export type KiroStartupFailure =
	| "engine-unsupported"
	| "engine-flag-unknown"
	| "engine-v3-missing";

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
 * Narrow match for the unpinned relaunch (I270, I302): only clap's unknown-argument
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
 * A CLI that knows the flag and has no V3: clap lists the engines it has,
 * and a CLI with V3 never calls `v3` an invalid value (I302).
 */
const ENGINE_V3_MISSING = /invalid value 'v3' for '--agent-engine/;

/**
 * `engine-flag-unknown` for a Kiro launch (either engine) that exited 2
 * with clap's unknown-argument error; `engine-v3-missing` for a V3 launch
 * that exited 2 because the CLI lists no `v3`; `engine-unsupported` for any
 * other V3 launch that exited non-zero with stderr naming `--agent-engine`.
 * Everything else is null.
 */
export function classifyKiroStartupFailure(
	input: KiroStartupFailureInput,
): KiroStartupFailure | null {
	if (input.launchedEngine !== "v2" && input.launchedEngine !== "v3") {
		return null;
	}
	if (input.exitCode === 2 && ENGINE_FLAG_UNKNOWN.test(input.stderr)) {
		return "engine-flag-unknown";
	}
	if (input.launchedEngine === "v2") return null;
	if (input.exitCode === 2 && ENGINE_V3_MISSING.test(input.stderr)) {
		return "engine-v3-missing";
	}
	if (input.exitCode === null || input.exitCode === 0) return null;
	if (!ENGINE_FLAG_REJECTED.test(input.stderr)) return null;
	return "engine-unsupported";
}

/**
 * What the chat shows when the V2 relaunch of an agent on the Default engine
 * also exits before answering (I302). Same title and message as D3, but
 * update-only advice: switching to V2 (legacy) can't help, this CLI just
 * failed on V2.
 */
export function kiroOldCliFailedInfo(): ErrorInfo {
	return {
		title: t("chat.acpErrors.kiroEngineUnsupportedTitle"),
		message: t("chat.acpErrors.kiroEngineUnsupported"),
		suggestion: t("chat.acpErrors.kiroOldCliFailedSuggestion"),
	};
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
