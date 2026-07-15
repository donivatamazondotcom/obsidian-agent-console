/**
 * `createUpdateFlushScheduler` — visibility-immune scheduling for the
 * session-update flush in `useAgentMessages`.
 *
 * WHY THIS EXISTS (I168 root cause)
 * Message-level session updates (streamed chunks, tool calls, and —
 * critically — permission requests) are batched in a pending queue and
 * flushed to React via `requestAnimationFrame`. Chromium does not fire rAF
 * in a hidden window, so an update arriving while the Obsidian window is
 * backgrounded sat unflushed until the window regained focus. Measured
 * consequence: a permission request raised while the user was away
 * committed 16 ms AFTER refocus — the notification gate then honestly read
 * "window focused" and suppressed the OS notification the user should have
 * received while away. Completion notifications were unaffected because
 * `isSending` is set via direct setState in promise callbacks (microtasks,
 * never throttled) — which made the bug look permission-specific.
 *
 * DESIGN
 * - Window visible → keep rAF: frame-aligned batching is the right cadence
 *   for streaming updates that will paint.
 * - Window hidden → a MessageChannel macrotask: not throttled in hidden
 *   windows (unlike setTimeout, which is clamped and eventually throttled
 *   to once per minute), preserves batching-per-task semantics, nothing
 *   paints anyway.
 * - Scheduled-via-rAF, THEN the window hides before the frame fires → the
 *   `visibilitychange` listener re-posts the flush as a macrotask so it
 *   cannot freeze. The stale rAF callback no-ops via the `pending` guard.
 *
 * Pure DI: all platform seams (`raf`, `postMacrotask`, `getVisibility`,
 * `subscribeVisibility`) are injected so the policy is exhaustively
 * unit-testable. Production deps are provided by
 * {@link createDomFlushSchedulerDeps}.
 *
 * See [[I168 Permission-request notification not firing]].
 */

export interface FlushSchedulerDeps {
	raf: (cb: () => void) => void;
	postMacrotask: (cb: () => void) => void;
	getVisibility: () => DocumentVisibilityState;
	/** Subscribe to visibility changes; returns an unsubscribe function. */
	subscribeVisibility: (listener: () => void) => () => void;
}

export interface UpdateFlushScheduler {
	/** Request a flush. Coalesces: at most one flush per schedule burst. */
	schedule: () => void;
	/** Unsubscribe listeners. Pending flushes become no-ops. */
	dispose: () => void;
}

export function createUpdateFlushScheduler(
	flush: () => void,
	deps: FlushSchedulerDeps,
): UpdateFlushScheduler {
	let pending = false;
	let viaRaf = false;
	let disposed = false;

	const run = () => {
		// Guard: stale rAF firing after a visibilitychange drain (or after
		// dispose) must not double-flush.
		if (!pending || disposed) return;
		pending = false;
		viaRaf = false;
		flush();
	};

	const schedule = () => {
		if (pending || disposed) return;
		pending = true;
		if (deps.getVisibility() === "hidden") {
			viaRaf = false;
			deps.postMacrotask(run);
		} else {
			viaRaf = true;
			deps.raf(run);
		}
	};

	const unsubscribe = deps.subscribeVisibility(() => {
		// The scheduled-then-hidden race: a flush parked on rAF freezes when
		// the window hides. Re-post it as a macrotask; the eventual stale rAF
		// no-ops via the `pending` guard in run().
		if (pending && viaRaf && deps.getVisibility() === "hidden") {
			viaRaf = false;
			deps.postMacrotask(run);
		}
	});

	return {
		schedule,
		dispose: () => {
			disposed = true;
			pending = false;
			unsubscribe();
		},
	};
}

/**
 * Production deps: rAF + a MessageChannel-backed macrotask (visibility-immune)
 * + document visibility. One channel per scheduler instance; `cb` is stored
 * per-post so each post runs exactly one callback.
 */
export function createDomFlushSchedulerDeps(
	win: Window & typeof globalThis,
	doc: Document,
): FlushSchedulerDeps {
	const channel = new win.MessageChannel();
	const queue: Array<() => void> = [];
	channel.port1.onmessage = () => {
		const cb = queue.shift();
		if (cb) cb();
	};
	return {
		raf: (cb) => {
			win.requestAnimationFrame(() => cb());
		},
		postMacrotask: (cb) => {
			queue.push(cb);
			channel.port2.postMessage(null);
		},
		getVisibility: () => doc.visibilityState,
		subscribeVisibility: (listener) => {
			doc.addEventListener("visibilitychange", listener);
			return () => doc.removeEventListener("visibilitychange", listener);
		},
	};
}
