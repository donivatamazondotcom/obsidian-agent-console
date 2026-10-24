import { useEffect, useRef } from "react";
import type { ProcessHoldDecision } from "../resolvers/process-hold";

/**
 * Decision #10 eager initialize, extracted from ChatPanel (I208).
 *
 * Spawns the agent process so slash commands, capabilities and image paste
 * are ready before the user types. The later createSession call (eager or
 * interaction-triggered) sees isInitialized()=true and goes straight to
 * newSession.
 */
export interface UseEagerInitializeArgs {
	/** Output of decideProcessHold for this tab. */
	decision: ProcessHoldDecision;
	isInitialized: () => boolean;
	/** Build the config and initialize the agent. Throwing is non-fatal. */
	initialize: () => Promise<void>;
	onError?: (e: unknown) => void;
}

export function useEagerInitialize(args: UseEagerInitializeArgs): void {
	const argsRef = useRef(args);
	argsRef.current = args;
	// At most one eager attempt per panel. A failure or a later teardown is
	// recovered by the lazy path on first send, not by re-activating the tab.
	const firedRef = useRef(false);
	const mayHold = args.decision.kind === "hold";

	useEffect(() => {
		// I208: a background restored tab stays process-free. The effect
		// re-runs when the tab becomes active (or is otherwise allowed).
		if (!mayHold || firedRef.current) return;
		firedRef.current = true;
		const { isInitialized, initialize, onError } = argsRef.current;
		if (isInitialized()) return;
		initialize().catch((e: unknown) => onError?.(e));
	}, [mayHold]);
}
