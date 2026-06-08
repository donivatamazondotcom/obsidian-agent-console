/**
 * `useLazySession` — typing-as-intent debounced session acquisition for
 * [[ACP Tab Persistence Across Restarts]] § Session Lifecycle.
 *
 * Composes Slice 2's `useTabSessionState` (the per-tab state machine)
 * with the trigger logic that makes opening a tab cheap: no ACP session
 * is acquired until the user signals send-intent by typing in the
 * composer (or clicking send while in `idle`/`error`).
 *
 * Lifecycle (Decisions #2, #6, #7, #8):
 *
 *   - **First sustained keystroke** → after a 200ms debounce, fire
 *     `acquireNewSession` (fresh tab) or `loadExistingSession` (restored
 *     tab). Subsequent keystrokes within the debounce window are
 *     no-ops; they do NOT reset or duplicate the timer. Full-delete back
 *     to empty cancels a pending timer (the user clearly didn't mean it).
 *
 *   - **Restored-tab fallback path:** if `loadExistingSession` resolves
 *     `{ ok: false }`, the hook automatically falls through to
 *     `acquireNewSession` and sets `isFallbackRecovery = true`. The
 *     consumer (ChatPanel) reads this flag to (a) prepend the synthetic
 *     replay-context block built by Slice 1's `buildReplayContextBlock`
 *     to the next prompt, and (b) render the LossyFallbackNotice from
 *     Slice 6. The hook itself does NOT prepend or render — that
 *     separation keeps Slice 3 a pure trigger-and-state hook.
 *
 *   - **Send-while-connecting:** the message is queued internally. When
 *     the in-flight acquisition resolves to `ready`, the queued message
 *     is flushed via `sendPrompt`. If acquisition fails, the queue is
 *     cleared and the consumer's composer keeps the message — the user
 *     re-clicks send to retry.
 *
 *   - **Sticky session:** once `ready`, subsequent `onSendClick`s reuse
 *     the same sessionId; no idle GC in v1 (Decision #4).
 *
 *   - **Reset:** any state → `idle`, sessionId released, fallback flag
 *     cleared. Post-reset, the tab behaves as fresh (the original
 *     restoredSessionId is forgotten — "new chat" means new chat).
 *
 * Mocking boundary (per spec § Unit Tests):
 *
 *   The hook does NOT import `AcpClient`. The integration layer (ChatPanel)
 *   adapts AcpClient → these callbacks:
 *
 *     - `acquireNewSession()`         wraps `acpClient.newSession(cwd)`
 *     - `loadExistingSession(id)`     wraps `acpClient.loadSession(id, cwd)`
 *     - `sendPrompt(sid, message)`    wraps `acpClient.prompt(sid, content)`
 *
 *   This keeps the hook unit-testable as a pure trigger/state machine
 *   with no AcpClient mock object — a vi.fn() per callback is sufficient.
 *
 * Implementation note — refs for in-flight state:
 *
 *   `isAcquiringRef`, `queueRef`, `debounceTimerRef`, and
 *   `restoredSessionIdRef` are all `useRef`s rather than `useState`. The
 *   acquisition pipeline runs across multiple await points; reading
 *   `state` (a useState value) inside an async closure would see the
 *   value at the time the closure was captured, not the current value.
 *   Refs are the canonical React pattern for "read-when-asked, not
 *   read-when-rendered" semantics. The same lesson [[ACP Scroll
 *   Architecture Rework]] reinforced — closures-over-state cascade into
 *   subtle ordering bugs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	useTabSessionState,
	type TabSessionState,
} from "./useTabSessionState";

// ============================================================================
// Public types
// ============================================================================

/**
 * Result type for the hook's session-acquisition callbacks. Discriminated
 * union — never throws. The hook calls `connectFailed()` on `{ ok: false }`
 * and never observes thrown errors. Callers must catch at the AcpClient
 * boundary and translate to this shape.
 */
export type SessionAcquisitionResult =
	| { ok: true; sessionId: string }
	| { ok: false; error: Error };

export interface UseLazySessionOptions {
	/**
	 * Pre-existing sessionId from a restored tab. `null` / `undefined` →
	 * fresh tab (acquisition path uses `acquireNewSession`). Non-null →
	 * restored tab (acquisition path tries `loadExistingSession` first
	 * and falls through to `acquireNewSession` on failure).
	 */
	restoredSessionId?: string | null;

	/** Acquire a brand-new session. Wraps `acpClient.newSession(cwd)`. */
	acquireNewSession: () => Promise<SessionAcquisitionResult>;

	/** Resume an existing session. Wraps `acpClient.loadSession(id, cwd)`. */
	loadExistingSession: (sessionId: string) => Promise<SessionAcquisitionResult>;

	/** Send a prompt against an active session. Used to flush queued messages. */
	sendPrompt: (sessionId: string, message: string) => Promise<void>;

	/**
	 * Debounce window for typing-as-intent. Decision #8: 200ms. Configurable
	 * for testing and future tuning.
	 */
	debounceMs?: number;
}

export interface UseLazySessionApi {
	/** Current state — proxied from useTabSessionState. */
	state: TabSessionState;

	/** Active sessionId. `null` until acquisition succeeds. */
	sessionId: string | null;

	/**
	 * `true` if this session was acquired via `loadExistingSession` →
	 * `acquireNewSession` fallback. Drives the LossyFallbackNotice (Slice 6)
	 * and the consumer's decision to prepend Slice 1's replay-context block.
	 * Cleared by `reset()`.
	 */
	isFallbackRecovery: boolean;

	/**
	 * Notify the hook that the composer text changed. Drives the
	 * typing-as-intent debounce. Full-delete (value === "") cancels any
	 * pending timer.
	 */
	onComposerChange: (value: string) => void;

	/**
	 * Notify the hook that send was clicked.
	 *  - `ready`        → fires `sendPrompt` immediately (sticky session)
	 *  - `connecting`   → queues the message; flushes when ready
	 *  - `idle`/`error` → initiates acquisition AND queues the message
	 *  - `busy`/`permission` → no-op (UI should already prevent these clicks)
	 */
	onSendClick: (message: string) => void;

	/** Reset to `idle`, release sessionId, clear fallback flag. */
	reset: () => void;

	// State machine transitions for busy/permission — driven by ChatPanel
	// in response to agent events (isSending, hasActivePermission).
	/** Agent began processing a prompt. ready → busy. */
	startBusy: () => void;
	/** Agent response complete. busy → ready. */
	endBusy: () => void;
	/** Permission decision required. ready/busy → permission. */
	requestPermission: () => void;
	/** Permission decision made. permission → ready. */
	resolvePermission: () => void;
}

// ============================================================================
// Hook
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 200;

export function useLazySession(
	options: UseLazySessionOptions,
): UseLazySessionApi {
	const {
		restoredSessionId = null,
		acquireNewSession,
		loadExistingSession,
		sendPrompt,
		debounceMs = DEFAULT_DEBOUNCE_MS,
	} = options;

	// State machine from Slice 2 — single source of truth for state value.
	const tabState = useTabSessionState();

	// Public state (drives consumer renders).
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [isFallbackRecovery, setIsFallbackRecovery] = useState(false);

	// Imperative state (read inside async callbacks; refs avoid stale closures).
	const debounceTimerRef = useRef<number | null>(null);
	const queueRef = useRef<string | null>(null);
	const isAcquiringRef = useRef(false);
	const restoredSessionIdRef = useRef<string | null>(restoredSessionId);

	// Stable refs to the latest callbacks. Recreating useCallbacks on every
	// callback identity change would invalidate timer cleanup; refs sidestep.
	const acquireNewSessionRef = useRef(acquireNewSession);
	const loadExistingSessionRef = useRef(loadExistingSession);
	const sendPromptRef = useRef(sendPrompt);
	acquireNewSessionRef.current = acquireNewSession;
	loadExistingSessionRef.current = loadExistingSession;
	sendPromptRef.current = sendPrompt;

	// Stable refs to state-machine transition methods (already stable from
	// Slice 2's useReducer-backed implementation, but the ref pattern keeps
	// the async closures below independent of any future churn).
	const tabStateRef = useRef(tabState);
	tabStateRef.current = tabState;

	// ============================================================================
	// fireAcquisition — the core async pipeline
	// ============================================================================

	const fireAcquisition = useCallback(async () => {
		if (isAcquiringRef.current) return;
		isAcquiringRef.current = true;

		tabStateRef.current.startConnect();

		// Restored tab path: try load first, fall through to new on failure.
		let result: SessionAcquisitionResult;
		const restoredId = restoredSessionIdRef.current;
		if (restoredId) {
			result = await loadExistingSessionRef.current(restoredId);
			if (!result.ok) {
				// Fallback: forget the restored ID (so a future retry goes
				// straight to new) and create a fresh session. The replay
				// context block lives in the consumer; we just signal the
				// fallback path was taken.
				setIsFallbackRecovery(true);
				restoredSessionIdRef.current = null;
				result = await acquireNewSessionRef.current();
			}
		} else {
			result = await acquireNewSessionRef.current();
		}

		if (result.ok) {
			setSessionId(result.sessionId);
			tabStateRef.current.connectSucceeded();

			// Flush queue if a send happened during connecting.
			const queued = queueRef.current;
			queueRef.current = null;
			if (queued !== null) {
				try {
					await sendPromptRef.current(result.sessionId, queued);
				} catch {
					// Send failures are out of scope for the trigger hook.
					// The agent-message stream surfaces them via the state
					// machine's `error` transition or via UI-level handling.
				}
			}
		} else {
			tabStateRef.current.connectFailed();
			// Drop the queued message — user must explicitly re-send.
			// Their composer text is still there (consumer never cleared it).
			queueRef.current = null;
		}

		isAcquiringRef.current = false;
	}, []);

	// ============================================================================
	// onComposerChange — typing-as-intent debounce
	// ============================================================================

	const onComposerChange = useCallback(
		(value: string) => {
			// Sticky-session: once we have a sessionId, typing is just typing.
			if (sessionId !== null) return;
			// Acquisition already in flight: ignore further keystrokes.
			if (isAcquiringRef.current) return;

			// Full-delete cancels any pending debounce.
			if (value === "") {
				if (debounceTimerRef.current !== null) {
					window.clearTimeout(debounceTimerRef.current);
					debounceTimerRef.current = null;
				}
				return;
			}

			// Decision #8: timer is anchored to the FIRST keystroke. Subsequent
			// keystrokes within the window do NOT reset or duplicate it.
			if (debounceTimerRef.current !== null) return;

			debounceTimerRef.current = window.setTimeout(() => {
				debounceTimerRef.current = null;
				void fireAcquisition();
			}, debounceMs);
		},
		[sessionId, fireAcquisition, debounceMs],
	);

	// ============================================================================
	// onSendClick — sticky-send | queue-while-connecting | retry-on-error
	// ============================================================================

	const onSendClick = useCallback(
		(message: string) => {
			// Ready → fire immediately, sticky session.
			if (sessionId !== null) {
				void sendPromptRef.current(sessionId, message);
				return;
			}

			// Connecting → queue for flush on `ready` transition.
			if (isAcquiringRef.current) {
				queueRef.current = message;
				return;
			}

			// Idle or error → initiate acquisition and queue. Cancel any
			// pending typing-debounce timer so we don't double-fire.
			if (debounceTimerRef.current !== null) {
				window.clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
			queueRef.current = message;
			void fireAcquisition();
		},
		[sessionId, fireAcquisition],
	);

	// ============================================================================
	// reset — back to idle
	// ============================================================================

	const reset = useCallback(() => {
		if (debounceTimerRef.current !== null) {
			window.clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		queueRef.current = null;
		isAcquiringRef.current = false;
		// Forget any restored sessionId — "new chat" means brand new from now on.
		restoredSessionIdRef.current = null;
		setSessionId(null);
		setIsFallbackRecovery(false);
		tabStateRef.current.reset();
	}, []);

	// ============================================================================
	// Cleanup pending timer on unmount
	// ============================================================================

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current !== null) {
				window.clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, []);

	return {
		state: tabState.state,
		sessionId,
		isFallbackRecovery,
		onComposerChange,
		onSendClick,
		reset,
		// Expose state machine transitions for busy/permission — driven
		// by ChatPanel in response to agent events (isSending,
		// hasActivePermission). These are stable references from
		// useReducer dispatch (per Slice 2 design).
		startBusy: tabState.startBusy,
		endBusy: tabState.endBusy,
		requestPermission: tabState.requestPermission,
		resolvePermission: tabState.resolvePermission,
	};
}
