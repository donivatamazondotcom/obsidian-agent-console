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
	 * SAME session id. Resolves to the id the agent resumed. Throws if resume
	 * fails at any step.
	 */
	resumeSameSession: (sessionId: string) => Promise<string>;
	/**
	 * Disconnect the subprocess and create a brand-new session (fresh harness).
	 * Used both when the agent cannot resume and as the fallback when a resume
	 * attempt throws. The on-screen transcript stays visible (local history).
	 * Resolves to the new session id, or null when none could be created.
	 */
	freshSession: () => Promise<string | null>;
	/**
	 * Suppress the agent's history replay while resuming. Set `true` before the
	 * resume (which calls `loadSession`, emitting the conversation as
	 * `session/update` events) and `false` after, so the replay does not
	 * duplicate the preserved on-screen transcript. Optional — mirrors the
	 * `setIgnoreUpdates` suppress/release pattern in `loadExistingSessionFlow`.
	 * (I86)
	 */
	setIgnoreUpdates?: (ignore: boolean) => void;
	/**
	 * Called with the error when a resume attempt throws, before the fresh
	 * fallback. Lets the caller log it; the flow itself stays I/O-free. (I230)
	 */
	onResumeError?: (error: unknown) => void;
}

/**
 * Every result carries the live `sessionId` after the reload (the resumed id,
 * the fallback's new id, or null when no session could be created), so the
 * lazy-session owner can bind it without reading a stale React snapshot. (I229)
 *
 * - `resumed: true` — the same session came back.
 * - `reason: "unsupported"` — no session to resume, or the agent can't load
 *   one; a fresh session was created by design.
 * - `reason: "resume-failed"` — the agent CAN resume but this attempt threw;
 *   a fresh session was created as a fallback. Not a capability gap. (I230)
 */
export type ReloadSessionFlowResult =
	| { resumed: true; sessionId: string }
	| {
			resumed: false;
			reason: "unsupported" | "resume-failed";
			sessionId: string | null;
	  };

/**
 * Run the soft-reload flow. The result says whether the session resumed and,
 * if not, why, so the caller can surface the right notice.
 */
export async function reloadSessionFlow(
	args: ReloadSessionFlowArgs,
): Promise<ReloadSessionFlowResult> {
	const {
		sessionId,
		canResume,
		resumeSameSession,
		freshSession,
		setIgnoreUpdates,
		onResumeError,
	} = args;

	// Resume only when there is a session AND the agent can load it.
	if (sessionId && canResume) {
		// Suppress the agent's history replay (the `session/update` events
		// emitted by `loadSession`) for the duration of the resume so it does
		// not duplicate the transcript that is intentionally kept on screen.
		// Release in `finally`, mirroring `loadExistingSessionFlow`. (I86)
		setIgnoreUpdates?.(true);
		try {
			const resumedId = await resumeSameSession(sessionId);
			return { resumed: true, sessionId: resumedId };
		} catch (error) {
			// Resume failed mid-flight → degrade to a fresh session, keeping
			// the transcript on screen (mirrors the lazy loadSession fallback).
			onResumeError?.(error);
			const freshId = await freshSession();
			return { resumed: false, reason: "resume-failed", sessionId: freshId };
		} finally {
			setIgnoreUpdates?.(false);
		}
	}

	// No session, or agent can't resume → fresh session under a fresh harness.
	const freshId = await freshSession();
	return { resumed: false, reason: "unsupported", sessionId: freshId };
}

/**
 * Map a soft-reload result to the lazy-session owner's acquisition result
 * (I229): a live session id means the tab is ready again; no id means the
 * reload left the tab without a session (→ `error`).
 */
export function reloadResultToAcquisition(
	result: ReloadSessionFlowResult,
): { ok: true; sessionId: string } | { ok: false; error: Error } {
	return result.sessionId
		? { ok: true, sessionId: result.sessionId }
		: { ok: false, error: new Error("Soft reload created no session") };
}
