/**
 * Fork acquisition prerequisites (I251).
 *
 * A reload on a fork-pending tab restarts the agent before acquiring, and
 * `session/fork` needs a live connection. This initializes a disconnected
 * client the way the restored-load path does (`reconnectExistingSession`),
 * then reports whether the RUNNING agent forks server-side: the restarted
 * process decides, not the capabilities read before the restart.
 */
import type { AgentCapabilities } from "../types/session";

export interface ForkClientPort {
	isInitialized(): boolean;
	getInitializeResult(): { capabilities?: AgentCapabilities } | null;
}

export interface PrepareForkArgs {
	client: ForkClientPort;
	/** Initialize this tab's agent. Throws (or returns false) when it can't start. */
	initialize: () => Promise<boolean>;
	/** Show a startup error and clear the old process's fallback (I302). */
	applyInitFailure: (error: unknown) => void;
	/** Capabilities last seen on this tab, used before any initialize. */
	knownCapabilities: AgentCapabilities | null | undefined;
}

/** Resolves to whether the agent forks server-side; throws if it can't start. */
export async function prepareForkAcquisition(
	args: PrepareForkArgs,
): Promise<{ serverForks: boolean }> {
	if (!args.client.isInitialized()) {
		try {
			if (!(await args.initialize())) {
				throw new Error("No agent configured for this tab");
			}
		} catch (e) {
			args.applyInitFailure(e);
			throw e;
		}
	}
	const caps =
		args.client.getInitializeResult()?.capabilities ?? args.knownCapabilities;
	return { serverForks: caps?.forks ?? false };
}
