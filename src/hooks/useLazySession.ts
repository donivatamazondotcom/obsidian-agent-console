/**
 * `useLazySession` — single owner of eager and interaction-triggered ACP
 * session acquisition for [[ACP Tab Persistence Across Restarts]].
 *
 * Composes Slice 2's `useTabSessionState` with origin-aware triggers:
 * deliberately fresh tabs may acquire once readiness is known, while restored
 * tabs stay idle until typing/send intent. Every path converges on the same
 * `fireAcquisition` pipeline.
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
 *   - **Send-while-connecting:** the hook does NOT queue internally. The
 *     consumer's queue-orchestration reducer holds the one pending message
 *     and flushes it (via the consumer's raw send) on the
 *     (connecting|idle)->ready transition. This hook only drives acquisition
 *     and reports `state`/`sessionId`; if acquisition fails the consumer's
 *     composer keeps the text and the user re-clicks send to retry.
 *
 *   - **Sticky session:** once `ready`, subsequent `onSendClick`s reuse
 *     the same sessionId.
 *
 *   - **Idle release (I209, supersedes Decision #4's "no idle GC"):**
 *     `release()` moves the live sessionId into the restored-id slot and
 *     goes `ready → released`. The id is kept, not forgotten: the next
 *     keystroke or send takes the restored-tab path (`loadExistingSession`,
 *     falling back to new plus transcript), so a released tab behaves like a
 *     tab restored from disk. `keptSessionId` keeps the id persistable
 *     while no session is live. The caller decides WHEN (decideProcessHold)
 *     and kills the process; this hook only moves the id and the state.
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
 *   `isAcquiringRef`, `debounceTimerRef`, and
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
import { useTabSessionState, type TabSessionState } from "./useTabSessionState";

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
	| { ok: true; sessionId: string; lossy?: boolean }
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
	loadExistingSession: (
		sessionId: string,
	) => Promise<SessionAcquisitionResult>;

	/**
	 * Session to FORK from on first acquisition (Track C — restore/fork in a
	 * new tab). `null` / `undefined` → not a fork tab. When set (and
	 * `forkExistingSession` is provided), the first acquisition branches a NEW
	 * session from this id instead of loading or creating one. Takes precedence
	 * over `restoredSessionId`. No load/new fallback — a failed fork surfaces
	 * as `connectFailed` so the seeded transcript stays visible for retry.
	 */
	forkFromSessionId?: string | null;

	/**
	 * Fork an existing session into a new branch. Wraps
	 * `acpClient.forkSession(id, cwd)`; the result carries the NEW branch
	 * sessionId. Required only when `forkFromSessionId` is set.
	 */
	forkExistingSession?: (
		sessionId: string,
	) => Promise<SessionAcquisitionResult>;

	/**
	 * Acquire eagerly once readiness is known. Used for deliberately fresh
	 * tabs and forks; restored/read-only tabs leave this false. The request is
	 * consumed once so reset() does not accidentally make agent switching eager.
	 */
	eagerAcquire?: boolean;

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
	 * The id held for the next acquisition: the restored id, or the id kept by
	 * `release()` (I209). Null for a fresh tab that never released, and after
	 * reset or a lossy fallback. The consumer passes THIS as the persisted id
	 * to `resolveSessionIdForSave` instead of its mount-time snapshot, so a
	 * fresh tab that released still survives a restart. (Not `sessionId ??
	 * kept`: that would persist a fresh eager tab before its first message.)
	 */
	keptSessionId: string | null;

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

	/**
	 * Explicitly acquire the restored session on demand (I72). Backs the
	 * "history not stored locally — reload from agent" affordance for a
	 * restored tab whose local message file was missing: triggers
	 * loadExistingSession so the agent replays the transcript. No-op when a
	 * session is already live or acquisition is in flight. Does not change
	 * the lazy default — fires only on the user's click.
	 */
	recoverHistory: () => void;
	/**
	 * Explicitly acquire a FRESH session immediately, through the single
	 * owner. Resets any prior session/queue/restored id, then fires
	 * acquisition without waiting for a keystroke. Backs the explicit
	 * "respawn now" intents (Restart agent / hard reload), so the agent
	 * comes back without the user having to type — while keeping
	 * useLazySession the sole caller of session/new (design D3). The caller
	 * tears down the subprocess (disconnect) first so the acquisition
	 * re-initializes a fresh harness.
	 */
	acquireNow: () => Promise<void>;
	/**
	 * Soft reload through the single owner (I229). Runs `run` (which tears
	 * the subprocess down, re-initializes and resumes — or falls back to a
	 * new session) as an acquisition: `ready → connecting → ready`, so the
	 * queue's connect-flush edge delivers any message sent during the reload.
	 * Unlike `acquireNow` it does NOT reset — the restored id and transcript
	 * stay. Binds the id `run` returns (it changes on a fallback). No-op when
	 * no session is bound or an acquisition is already in flight. A throwing
	 * `run` ends in `error` and rethrows to the caller.
	 */
	reloadNow: (run: () => Promise<SessionAcquisitionResult>) => Promise<void>;
	/** Reset to `idle`, release sessionId, clear fallback flag. */
	reset: () => void;
	/**
	 * Whether the tab continues a session that already exists: a restored id
	 * that is still bound (load pending or succeeded) or a pending fork. False
	 * after a failed load fell back to a new session, and after reset().
	 * Read at send time to decide "first message" (I241).
	 */
	continuesExistingSession: () => boolean;

	/**
	 * Idle release (I209): `ready → released`, keeping the id for the next
	 * acquisition. Returns false (and changes nothing) unless the tab is
	 * `ready`, a session is bound, and no acquisition or typing debounce is
	 * pending. Does not touch the process — the caller tears it down.
	 *
	 * `keepSessionId: false` (I237) drops the id instead: a tab with no
	 * history has nothing to resume, so the next acquisition is a plain new
	 * session (no load attempt, no restored-from-history notice). Default true.
	 */
	release: (opts?: { keepSessionId?: boolean }) => boolean;

	/**
	 * Reconnect a released tab now on its kept id (I209): a picker change
	 * before typing, or a soft reload. No-op unless the tab is `released` and
	 * nothing is acquiring. Resolves when the acquisition settles.
	 */
	reconnectNow: () => Promise<void>;

	/**
	 * An acquisition is in flight or about to fire (the typing debounce is
	 * armed). Read as the `acquiring` busy signal by decideProcessHold.
	 */
	isAcquisitionPending: () => boolean;

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
		forkFromSessionId = null,
		forkExistingSession,
		eagerAcquire = false,
		sendPrompt,
		debounceMs = DEFAULT_DEBOUNCE_MS,
	} = options;

	// State machine from Slice 2 — single source of truth for state value.
	const tabState = useTabSessionState();

	// Public state (drives consumer renders).
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [isFallbackRecovery, setIsFallbackRecovery] = useState(false);
	// Latest bound sessionId for async/ref-called entry points (reloadNow is
	// invoked through a ref from useChatActions, so its closure may be stale).
	const sessionIdRef = useRef<string | null>(null);
	sessionIdRef.current = sessionId;

	// Imperative state (read inside async callbacks; refs avoid stale closures).
	const debounceTimerRef = useRef<number | null>(null);
	const isAcquiringRef = useRef(false);
	// Monotonic acquisition generation. reset() bumps it; an acquisition
	// captures the generation at its start and, on resolve, discards its result
	// when the generation has moved on (a reset / agent-swap happened while it
	// was in flight). Without this guard a mid-flight acquisition against the
	// prior agent would bind after the swap, leaving the tab persisted as the
	// new agent while its live session belongs to the old one (I175).
	const acquisitionGenerationRef = useRef(0);
	const restoredSessionIdRef = useRef<string | null>(restoredSessionId);
	// Init-once (NOT re-synced every render) — mirrors restoredSessionIdRef.
	// reset() clears this; a per-render resync would immediately undo that,
	// letting a new-chat on a fork tab re-fork (caught by the reset test).
	const forkFromSessionIdRef = useRef<string | null>(forkFromSessionId);
	// Eager acquisition is a one-shot mount/readiness request. reset() must not
	// silently re-fire it (agent switching deliberately remains lazy).
	const eagerAcquireHandledRef = useRef(false);

	// Stable refs to the latest callbacks. Recreating useCallbacks on every
	// callback identity change would invalidate timer cleanup; refs sidestep.
	const acquireNewSessionRef = useRef(acquireNewSession);
	const loadExistingSessionRef = useRef(loadExistingSession);
	const forkExistingSessionRef = useRef(forkExistingSession);
	const sendPromptRef = useRef(sendPrompt);
	acquireNewSessionRef.current = acquireNewSession;
	loadExistingSessionRef.current = loadExistingSession;
	forkExistingSessionRef.current = forkExistingSession;
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
		// Snapshot the generation for this run. A reset() (e.g. an agent swap)
		// while we await below bumps the ref; on resolve we compare and discard
		// a stale result rather than binding it (I175).
		const generation = acquisitionGenerationRef.current;

		tabStateRef.current.startConnect();

		// Acquisition source, in precedence order: fork > restore > new.
		let result: SessionAcquisitionResult;
		const forkId = forkFromSessionIdRef.current;
		const restoredId = restoredSessionIdRef.current;
		if (forkId && forkExistingSessionRef.current) {
			// Fork branch: mint a NEW session branched from forkId. The callback
			// performs a server-side fork (agent retains context) OR a local
			// branch (fresh session seeded with the transcript) and persists
			// the branch to history. A local branch has no server-side history,
			// so the callback returns `lossy` and we raise isFallbackRecovery
			// to show the same "working from a transcript" notice as a disk-only
			// restore (RC-2 transparency). No load/new fallback here — a failed
			// fork surfaces as connectFailed; the seeded transcript stays
			// visible so the user can retry.
			result = await forkExistingSessionRef.current(forkId);
			if (result.ok) {
				forkFromSessionIdRef.current = null;
				if (result.lossy) {
					setIsFallbackRecovery(true);
				}
			}
		} else if (restoredId) {
			result = await loadExistingSessionRef.current(restoredId);
			if (!result.ok) {
				// Fallback: forget the restored ID (so a future retry goes
				// straight to new) and create a fresh session. The replay
				// context block lives in the consumer; we just signal the
				// fallback path was taken.
				setIsFallbackRecovery(true);
				result = await acquireNewSessionRef.current();
				// Cleared only after the new session settles, so the kept id
				// stays persistable while it is in flight (I209: the consumer
				// persists keptSessionId). Not cleared if a reset superseded us.
				if (generation === acquisitionGenerationRef.current) {
					restoredSessionIdRef.current = null;
				}
			}
		} else {
			result = await acquireNewSessionRef.current();
		}

		// Superseded mid-flight (reset / agent swap). Discard the result — do
		// not bind a session that belongs to a prior generation (I175). The
		// reset already drove the machine to idle and cleared isAcquiringRef,
		// so leave both untouched.
		if (generation !== acquisitionGenerationRef.current) {
			return;
		}

		if (result.ok) {
			setSessionId(result.sessionId);
			tabStateRef.current.connectSucceeded();
			// Queue delivery is owned by the consumer's queue-orchestration
			// reducer (connect-flush on the connecting|idle->ready transition),
			// not by this hook — so there is no internal queued message to
			// flush here. The hook's job ends at "session is ready".
		} else {
			tabStateRef.current.connectFailed();
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
			// The queue-orchestration reducer owns the pending-message slot;
			// this method's sole remaining job is to TRIGGER lazy acquisition
			// (idle/error) so the reducer's connect-flush can deliver once the
			// session is ready. It no longer queues anything internally.

			// Ready → nothing to acquire. The no-op sendPrompt is kept only for
			// backward compat with any direct caller; the consumer sends ready
			// messages via the raw path, not here.
			if (sessionId !== null) {
				void sendPromptRef.current(sessionId, message);
				return;
			}

			// Connecting → acquisition already in flight; the reducer holds the
			// pending message and flushes it on the ready transition.
			if (isAcquiringRef.current) {
				return;
			}

			// Idle or error → initiate acquisition. Cancel any pending
			// typing-debounce timer so we don't double-fire.
			if (debounceTimerRef.current !== null) {
				window.clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
			void fireAcquisition();
		},
		[sessionId, fireAcquisition],
	);

	// ============================================================================
	// recoverHistory — explicit on-demand load of the restored session (I72)
	// ============================================================================

	const recoverHistory = useCallback(() => {
		// Already live, or acquisition in flight — nothing to recover.
		if (sessionId !== null) return;
		if (isAcquiringRef.current) return;
		// Cancel any pending typing debounce so we don't double-fire.
		if (debounceTimerRef.current !== null) {
			window.clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		// fireAcquisition takes the restored-session path when a
		// restoredSessionId is present (loadExistingSession → replay, since
		// the consumer reports haveLocalHistory=false for fileless tabs).
		// Nothing auto-connects; this fires only on the user's click,
		// preserving the lazy default (Decision #2).
		void fireAcquisition();
	}, [sessionId, fireAcquisition]);

	// ============================================================================
	// reset — back to idle
	// ============================================================================

	const reset = useCallback(() => {
		if (debounceTimerRef.current !== null) {
			window.clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		isAcquiringRef.current = false;
		// Supersede any in-flight acquisition so its resolve is discarded
		// instead of binding a session from before this reset (I175).
		acquisitionGenerationRef.current += 1;
		// Forget any restored / fork-pending sessionId — "new chat" means brand
		// new from now on.
		restoredSessionIdRef.current = null;
		forkFromSessionIdRef.current = null;
		setSessionId(null);
		setIsFallbackRecovery(false);
		tabStateRef.current.reset();
	}, []);

	// ============================================================================
	// release — idle release, keeping the id (I209)
	// ============================================================================

	const release = useCallback((opts?: { keepSessionId?: boolean }): boolean => {
		const id = sessionIdRef.current;
		if (id === null) return false;
		if (isAcquiringRef.current) return false;
		if (debounceTimerRef.current !== null) return false;
		if (tabStateRef.current.state !== "ready") return false;
		// Keep the id where the restored-tab path reads it, so the next
		// fireAcquisition loads it instead of creating a new session. Without
		// history there is nothing to resume: forget it (I237).
		restoredSessionIdRef.current = opts?.keepSessionId === false ? null : id;
		sessionIdRef.current = null;
		// Supersede anything still resolving against the released process.
		acquisitionGenerationRef.current += 1;
		setSessionId(null);
		tabStateRef.current.release();
		return true;
	}, []);

	const isAcquisitionPending = useCallback(
		() => isAcquiringRef.current || debounceTimerRef.current !== null,
		[],
	);

	// ============================================================================
	// acquireNow — explicit eager acquisition through the single owner
	// ============================================================================

	const acquireNow = useCallback(() => {
		// Reset any prior session/queue/restored-id state, then immediately
		// fire a fresh acquisition — no keystroke, no queued message. The
		// "respawn now" intents (Restart agent / hard reload) route through
		// here so they don't call createSession directly (design D3); the
		// caller disconnects the subprocess first so this re-initializes.
		// Returns the acquisition promise so callers can await readiness.
		reset();
		return fireAcquisition();
	}, [reset, fireAcquisition]);

	// ============================================================================
	// reloadNow — soft reload as an acquisition through the single owner (I229)
	// ============================================================================

	const reconnectNow = useCallback(async () => {
		if (tabStateRef.current.state !== "released") return;
		if (isAcquiringRef.current) return;
		if (debounceTimerRef.current !== null) {
			window.clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		return fireAcquisition();
	}, [fireAcquisition]);

	const reloadNow = useCallback(
		async (run: () => Promise<SessionAcquisitionResult>) => {
			// I209: a released tab has no process to tear down, so a reload is
			// the normal reconnect on the kept id — that IS a fresh harness.
			if (tabStateRef.current.state === "released") {
				return reconnectNow();
			}
			// Nothing to reload, or the owner is already acquiring (a first
			// send, reconnect or another reload) — one acquisition at a time.
			if (sessionIdRef.current === null) return;
			if (isAcquiringRef.current) return;
			isAcquiringRef.current = true;
			const generation = acquisitionGenerationRef.current;
			if (debounceTimerRef.current !== null) {
				window.clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}

			tabStateRef.current.startConnect();

			let result: SessionAcquisitionResult;
			try {
				result = await run();
			} catch (error) {
				if (generation === acquisitionGenerationRef.current) {
					tabStateRef.current.connectFailed();
					isAcquiringRef.current = false;
				}
				throw error;
			}

			// Superseded mid-flight (reset / agent swap): discard (I175).
			if (generation !== acquisitionGenerationRef.current) return;

			if (result.ok) {
				setSessionId(result.sessionId);
				tabStateRef.current.connectSucceeded();
			} else {
				tabStateRef.current.connectFailed();
			}
			isAcquiringRef.current = false;
		},
		[reconnectNow],
	);

	const continuesExistingSession = useCallback(
		() =>
			restoredSessionIdRef.current !== null ||
			forkFromSessionIdRef.current !== null,
		[],
	);

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

	// One-shot eager acquisition for any explicitly eager origin. The
	// consumer gates this on agent initialization; fireAcquisition retains the
	// shared fork > restore > fresh precedence. Mark handled before firing so
	// rerenders, capability updates, and reset() cannot duplicate session/new.
	useEffect(() => {
		if (!eagerAcquire || eagerAcquireHandledRef.current) return;
		eagerAcquireHandledRef.current = true;
		// A user may type while initialize is still resolving, before the consumer
		// can enable eagerAcquire. Cancel that older lazy timer so it cannot fire
		// a second session/new after this eager request completes.
		if (debounceTimerRef.current !== null) {
			window.clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		if (sessionId === null && !isAcquiringRef.current) {
			void fireAcquisition();
		}
	}, [eagerAcquire, sessionId, fireAcquisition]);

	return {
		state: tabState.state,
		sessionId,
		// Read at render: release(), reset() and a settled fallback all
		// re-render, so the ref is current when this is read.
		keptSessionId: restoredSessionIdRef.current,
		isFallbackRecovery,
		onComposerChange,
		onSendClick,
		recoverHistory,
		acquireNow,
		reloadNow,
		continuesExistingSession,
		reset,
		release,
		reconnectNow,
		isAcquisitionPending,
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
