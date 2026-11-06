/**
 * `historyLaunchKey` — which agent launch Session history reads capability
 * and server rows for (I270). One decision, so the Agent pill and the rows
 * it gates can never come from different launches.
 *
 * A process that is up answers for itself: its live launch key (the config
 * it launched with, never settings edited since), and its live capabilities
 * once it has reported them. With no process up, the launch a connect would
 * make answers instead, because that engine is the one that would open a
 * row. One agent id can launch differently (Kiro V2 can't list sessions, V3
 * can), so this is keyed by launch, never by agent id.
 *
 * Pure and total (the next-launch input is a lookup, called at most once).
 * I261's cross-agent picker calls it with no live process.
 */
import type { SessionState } from "../types/session";

export type HistoryLaunch =
	/** A process is up; `useLiveCapabilities` once it has reported them. */
	| { kind: "live"; key: string; useLiveCapabilities: boolean }
	/**
	 * A ready process with no launch key: an unpinned Kiro relaunch on an
	 * older CLI, whose engine isn't verified. Its own capabilities answer;
	 * no cache is read or written for it.
	 */
	| { kind: "unkeyed"; key: null; useLiveCapabilities: true }
	/** No process up: the launch a connect would make. */
	| { kind: "next"; key: string; useLiveCapabilities: false }
	/** No process and the agent isn't configured. */
	| { kind: "none"; key: null; useLiveCapabilities: false };

export interface HistoryLaunchInput {
	/** `AcpClient.getLaunchKey()`: null with no process or an unpinned Kiro launch. */
	liveLaunchKey: string | null;
	/** The tab's session state. */
	sessionState: SessionState;
	/**
	 * The launch a connect would make (`resolveAgentLaunchKey(settings,
	 * agentId)`). Called only when no process is up, so a live tab pays
	 * nothing for it on each render.
	 */
	nextLaunchKey: () => string | null;
}

const PROCESS_UP: ReadonlySet<SessionState> = new Set([
	"initializing",
	"authenticating",
	"ready",
	"busy",
]);
const REPORTED: ReadonlySet<SessionState> = new Set(["ready", "busy"]);

export function historyLaunchKey(input: HistoryLaunchInput): HistoryLaunch {
	if (input.liveLaunchKey && PROCESS_UP.has(input.sessionState)) {
		return {
			kind: "live",
			key: input.liveLaunchKey,
			useLiveCapabilities: REPORTED.has(input.sessionState),
		};
	}
	if (!input.liveLaunchKey && REPORTED.has(input.sessionState)) {
		return { kind: "unkeyed", key: null, useLiveCapabilities: true };
	}
	const next = input.nextLaunchKey();
	if (next) {
		return { kind: "next", key: next, useLiveCapabilities: false };
	}
	return { kind: "none", key: null, useLiveCapabilities: false };
}
