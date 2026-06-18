/**
 * Pure orchestration for the header Reload control (soft reload).
 *
 * Spec: `Agent Console Reload Control`. The browser-mirror UX principle maps
 * the header ↻ button to "reload", not "new chat" (the `+` tab owns new):
 *
 *   - Soft reload (plain click, ⌘R analog): resume the SAME session under a
 *     fresh harness (subprocess respawned, MCP reloaded), transcript preserved.
 *   - Hard reload (Shift-click, ⌘⇧R analog): fresh session, handled separately
 *     in `useChatActions.handleReload` via the existing restart path.
 *
 * This function owns only the soft-reload decision + sequencing. All I/O is
 * injected so it is unit-testable without rendering ChatPanel, mirroring
 * `loadExistingSessionFlow`. The agent's resume capability
 * (`agentCapabilities.loadSession`) and the loaded transcript are NOT touched
 * here — the caller keeps the on-screen transcript regardless of outcome.
 */

export interface ReloadSessionFlowArgs {
	/** Current session id, or null when the tab never connected. */
	sessionId: string | null;
	/** Whether the agent advertised `loadSession` (can resume on the wire). */
	canResume: boolean;
	/**
	 * Disconnect the subprocess, re-initialize (fresh harness), and resume the
	 * SAME session id. Throws if resume fails at any step.
	 */
	resumeSameSession: (sessionId: string) => Promise<void>;
	/**
	 * Disconnect the subprocess and create a brand-new session (fresh harness).
	 * Used both when the agent cannot resume and as the fallback when a resume
	 * attempt throws. The on-screen transcript stays visible (local history).
	 */
	freshSession: () => Promise<void>;
	/**
	 * Suppress the agent's history replay while resuming. Set `true` before the
	 * resume (which calls `loadSession`, emitting the conversation as
	 * `session/update` events) and `false` after, so the replay does not
	 * duplicate the preserved on-screen transcript. Optional — mirrors the
	 * `setIgnoreUpdates` suppress/release pattern in `loadExistingSessionFlow`.
	 * (I86)
	 */
	setIgnoreUpdates?: (ignore: boolean) => void;
}

export interface ReloadSessionFlowResult {
	/** True iff the same session was resumed; false iff a fresh session was created. */
	resumed: boolean;
}

/**
 * Run the soft-reload flow. Returns `{ resumed }` so the caller can surface the
 * right notice (resumed vs. degraded-to-fresh).
 */
export async function reloadSessionFlow(
	args: ReloadSessionFlowArgs,
): Promise<ReloadSessionFlowResult> {
	const { sessionId, canResume, resumeSameSession, freshSession, setIgnoreUpdates } =
		args;

	// Resume only when there is a session AND the agent can load it.
	if (sessionId && canResume) {
		// Suppress the agent's history replay (the `session/update` events
		// emitted by `loadSession`) for the duration of the resume so it does
		// not duplicate the transcript that is intentionally kept on screen.
		// Release in `finally`, mirroring `loadExistingSessionFlow`. (I86)
		setIgnoreUpdates?.(true);
		try {
			await resumeSameSession(sessionId);
			return { resumed: true };
		} catch {
			// Resume failed mid-flight → degrade to a fresh session, keeping
			// the transcript on screen (mirrors the lazy loadSession fallback).
			await freshSession();
			return { resumed: false };
		} finally {
			setIgnoreUpdates?.(false);
		}
	}

	// No session, or agent can't resume → fresh session under a fresh harness.
	await freshSession();
	return { resumed: false };
}
