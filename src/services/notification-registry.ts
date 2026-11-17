/**
 * Owns the lifetime of every OS `Notification` Agent Console posts: creation,
 * click routing, cleanup, teardown, and the startup sweep.
 *
 * History (see [[I52 Notification click focuses wrong vault window]]):
 * - Round 3: a notification held only by a local `const` could be collected
 *   with its `onclick`, so every notification is retained here until it is
 *   clicked or removed.
 * - Rounds 6–8: entries outlived their JS context (plugin reload, window
 *   close, crash, closed tab) and became orphans with dead click handlers;
 *   teardown sweeps, a startup sweep and per-tab ownership were added.
 * - Round 9 (2026-11-13/14, probes on Electron 43.8.3 / macOS): removing a
 *   delivered notification shortly after another one is posted — by our code
 *   or by the OS replacing a same-tag predecessor — makes the newer one lose
 *   its click when the user clicks it from Notification Center after about a
 *   minute. Both creation sites tagged with the tab id, so a tab's second
 *   notification replaced its first at the moment it posted. Now:
 *     1. this registry constructs every notification with a fresh tag
 *        (`<owner>:<suffix>`); a lint rule bans `new Notification` elsewhere;
 *     2. nothing is closed or removed at creation; a cleanup pass runs only
 *        after an app-wide quiet minute (shared clock in `window.localStorage`,
 *        which every vault window shares), deciding via the pure
 *        `resolvers/notification-cleanup.ts`;
 *     3. removal is `close()` plus `remote.Notification.remove(id)`, because
 *        `close()` alone left delivered entries behind 4 of 9 times.
 */

import {
	clampDelay,
	decideNotificationCleanup,
	parseSharedTimestamp,
	type CleanupEntry,
} from "../resolvers/notification-cleanup";
import { getLogger } from "../utils/logger";

// ============================================================================
// Constants
// ============================================================================

/** No removal runs until this long after the latest posting in any window. */
export const NOTIFICATION_QUIET_MS = 60_000;
/** Soft cap on retained notifications, enforced by the cleanup pass. */
export const MAX_RETAINED_NOTIFICATIONS = 10;
/** Removal attempts per superseded / orphaned entry before giving up. */
export const MAX_REMOVAL_RETRIES = 3;
/** App-wide clock: when any vault window last posted a notification. */
export const SHARED_LAST_POSTED_KEY = "agent-console:notifications-last-posted-at";
/** App-wide clock: when any vault window last removed notifications. */
export const SHARED_LAST_REMOVED_KEY =
	"agent-console:notifications-last-removed-at";

/** Scheme prefix of a delivered-notification id: `n#<origin>#<tag>`. */
const NOTIFICATION_ID_PREFIX = "n#";

// ============================================================================
// Types
// ============================================================================

type NotificationConstructorLike = new (
	title: string,
	options?: NotificationOptions,
) => Notification;

/** The subset of `Storage` the shared clock uses. */
export interface SharedClockStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface NotificationRegistryDeps {
	/** Read per call, so a wrapper installed on `window.Notification` is seen. */
	NotificationCtor: () => NotificationConstructorLike;
	/** The shared-clock store, or null when unavailable. */
	store: () => SharedClockStore | null;
	schedule: (fn: () => void, ms: number) => number;
	cancel: (handle: number) => void;
	now: () => number;
	/** Foreground the window that owns this renderer (no tab switch). */
	raiseOwningWindow: () => void;
	log: (message: string, data?: unknown) => void;
}

/** Electron `remote.Notification` statics (subset). */
export interface RemoteNotificationStatics {
	isSupported?: () => boolean;
	getHistory: () => Promise<Array<{ id?: unknown }>>;
	remove: (id: string) => unknown;
}

export interface ShowOwnedNotificationInput {
	/** The panel (tab) id that owns the notification. */
	owner: string;
	title: string;
	/** Any `tag` here is ignored; the registry assigns a fresh one. */
	options?: NotificationOptions;
	onClick: (event: Event) => void;
}

export interface SweepOwnedNotificationsDeps {
	notificationStatics: RemoteNotificationStatics | null | undefined;
	ownedTabIds: readonly string[];
	origin: string;
	onError?: (error: unknown) => void;
}

export interface SweepOwnedNotificationsResult {
	/** False when the guard short-circuited or teardown stopped the sweep. */
	ran: boolean;
	/** Number of `remove()` calls that resolved successfully. */
	removed: number;
}

interface EntryState {
	owner: string;
	tag: string;
	/** The owning panel unmounted (tab closed). */
	orphaned: boolean;
	/** The registry called close(); close/error events never release it. */
	closed: boolean;
	failedRemovals: number;
	/** An async removal is in flight. */
	pending: boolean;
	/** Removal attempt id; a stale settle from an earlier attempt is ignored. */
	attempt: number;
}

type RemovalOutcome = "removed" | "failed" | "pending" | "no-remover";

export interface NotificationRegistry {
	showOwnedNotification(input: ShowOwnedNotificationInput): Notification | null;
	closeNotificationsForOwner(owner: string): void;
	closeAllNotifications(): void;
	disposeNotifications(): void;
	activateNotifications(): void;
	setNotificationRemover(config: {
		statics: Pick<RemoteNotificationStatics, "remove"> | null | undefined;
		origin: string;
	}): void;
	attachWindowCloseSweep(
		win: Window,
		register: (win: Window, event: "beforeunload", handler: () => void) => void,
	): void;
	sweepOwnedNotificationsAtStartup(
		deps: SweepOwnedNotificationsDeps,
	): Promise<SweepOwnedNotificationsResult>;
	/** Reset state in place (tests). Optionally swap the deps. */
	__reset(deps?: NotificationRegistryDeps): void;
	__count(): number;
}

// ============================================================================
// Tag / id helpers
// ============================================================================

/**
 * Extract the `tag` embedded in a delivered-notification id of the form
 * `n#<origin>#<tag>`. Returns null for anything else. Trailing segments are
 * rejoined so a tag containing `#` survives.
 */
function extractNotificationTag(id: unknown): string | null {
	if (typeof id !== "string" || !id.startsWith(NOTIFICATION_ID_PREFIX)) {
		return null;
	}
	const parts = id.split("#");
	if (parts.length < 3) return null;
	return parts.slice(2).join("#");
}

function notificationIdForTag(origin: string, tag: string): string {
	return `${NOTIFICATION_ID_PREFIX}${origin}#${tag}`;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

// ============================================================================
// Startup sweep planner (pure)
// ============================================================================

export interface OwnedNotificationSweepInput {
	/** Tab ids this vault owns (from restored `perLeafTabStates`). */
	ownedTabIds: readonly string[];
	/** Renderer origin, e.g. `app://obsidian.md`. */
	origin: string;
	/** Ids currently in `getHistory()` (may be empty). */
	historyIds: readonly string[];
}

export interface OwnedNotificationSweep {
	idsToRemove: string[];
}

/**
 * Which delivered entries the startup sweep removes: one reconstructed legacy
 * id per owned tab (`n#<origin>#<tabId>`, the pre-round-9 tag, which covers a
 * crash orphan even if history is empty), plus every history id whose tag is
 * an owned tab id (legacy) or starts with `<ownedTabId>:` (round 9). Another
 * window's entries carry other, globally unique tab ids and are never matched.
 */
export function buildOwnedNotificationSweep(
	input: OwnedNotificationSweepInput,
): OwnedNotificationSweep {
	const owned = new Set(
		input.ownedTabIds.filter(
			(id): id is string => typeof id === "string" && id.length > 0,
		),
	);
	const ids = new Set<string>();
	for (const tabId of owned) ids.add(notificationIdForTag(input.origin, tabId));
	for (const historyId of input.historyIds) {
		const tag = extractNotificationTag(historyId);
		if (tag === null) continue;
		if (owned.has(tag)) {
			ids.add(historyId);
			continue;
		}
		for (const tabId of owned) {
			if (tag.startsWith(`${tabId}:`)) {
				ids.add(historyId);
				break;
			}
		}
	}
	return { idsToRemove: [...ids] };
}

// ============================================================================
// Registry
// ============================================================================

export function createNotificationRegistry(
	initialDeps: NotificationRegistryDeps,
): NotificationRegistry {
	let deps = initialDeps;
	let live = new Map<Notification, EntryState>();
	let remover: ((tag: string) => unknown) | null = null;
	let disposed = false;
	/** Bumped on dispose/reset so a suspended sweep can't resume after reactivation. */
	let generation = 0;
	let counter = 0;
	let localLastPostedAt = Number.NEGATIVE_INFINITY;
	let localLastRemovedAt = Number.NEGATIVE_INFINITY;
	let passTimer: number | null = null;
	let sweepTimer: number | null = null;
	let sweepWaiter: ((proceed: boolean) => void) | null = null;
	let storeWarned = false;

	// ---- shared clock (never throws) ----------------------------------------

	function readShared(key: string, now: number): number | null {
		try {
			const raw = deps.store()?.getItem(key);
			return parseSharedTimestamp(raw, now, NOTIFICATION_QUIET_MS);
		} catch {
			return null;
		}
	}

	function writeShared(key: string, now: number): void {
		try {
			deps.store()?.setItem(key, String(now));
		} catch (error) {
			if (!storeWarned) {
				storeWarned = true;
				deps.log("[I52] shared notification clock unavailable", error);
			}
		}
	}

	function effectiveLastPostedAt(now: number): number {
		const shared = readShared(SHARED_LAST_POSTED_KEY, now);
		// After a backward wall-clock step the local value lies in the future;
		// bound it like the shared one so cleanup can't defer by the step size.
		const local =
			localLastPostedAt > now + NOTIFICATION_QUIET_MS
				? Number.NEGATIVE_INFINITY
				: localLastPostedAt;
		return Math.max(local, shared ?? Number.NEGATIVE_INFINITY);
	}

	function quietDelay(now: number): number {
		return clampDelay(
			effectiveLastPostedAt(now) + NOTIFICATION_QUIET_MS - now,
			NOTIFICATION_QUIET_MS,
		);
	}

	// ---- timers --------------------------------------------------------------

	function cancelPass(): void {
		if (passTimer !== null) deps.cancel(passTimer);
		passTimer = null;
	}

	function schedulePass(delayMs: number): void {
		if (disposed) return;
		cancelPass();
		passTimer = deps.schedule(runPass, delayMs);
	}

	/** Arm a pass only when none is pending; never moves a deadline later. */
	function armPassIfIdle(delayMs: number): void {
		if (disposed || passTimer !== null) return;
		schedulePass(delayMs);
	}

	function cancelSweepWait(): void {
		if (sweepTimer !== null) deps.cancel(sweepTimer);
		sweepTimer = null;
		const waiter = sweepWaiter;
		sweepWaiter = null;
		waiter?.(false);
	}

	// ---- entries -------------------------------------------------------------

	function release(notification: Notification): void {
		live.delete(notification);
	}

	/**
	 * close() + remove by id. `releaseOn` "success" keeps the entry when the
	 * removal fails (superseded / orphaned); "always" releases regardless
	 * (FIFO, teardown).
	 */
	function removeEntry(
		notification: Notification,
		state: EntryState,
		releaseOn: "success" | "always",
		reason: string,
	): RemovalOutcome {
		if (!state.closed) {
			// close() fires `close` 3–83 ms later on macOS; it must never
			// release the entry, so detach first and mark closed permanently.
			state.closed = true;
			notification.onclose = null;
			notification.onerror = null;
			try {
				notification.close();
			} catch {
				// A dead OS entry may throw; removal by id still runs.
			}
		}

		const finish = (outcome: RemovalOutcome): RemovalOutcome => {
			deps.log("[I52] notification removal", {
				tag: state.tag,
				reason,
				outcome,
				msSinceEffectiveLastPosted:
					deps.now() - effectiveLastPostedAt(deps.now()),
			});
			if (releaseOn === "always" || outcome === "removed") release(notification);
			return outcome;
		};

		if (!remover) {
			// Spec Design 4: close() is the only removal here, so one attempt
			// exhausts the entry; it stays retained and FIFO evicts it before
			// any live entry.
			if (releaseOn === "success") state.failedRemovals = MAX_REMOVAL_RETRIES;
			return finish("no-remover");
		}

		try {
			const result = remover(state.tag);
			if (isThenable(result)) {
				const attempt = ++state.attempt;
				state.pending = true;
				result.then(
					() => {
						if (state.attempt !== attempt) return;
						state.pending = false;
						if (disposed || !live.has(notification)) return;
						release(notification);
					},
					(error: unknown) => {
						if (state.attempt !== attempt) return;
						state.pending = false;
						if (disposed || !live.has(notification)) return;
						state.failedRemovals++;
						deps.log("[I52] notification remove() rejected", error);
						if (state.failedRemovals < MAX_REMOVAL_RETRIES) {
							armPassIfIdle(NOTIFICATION_QUIET_MS);
						}
					},
				);
				return finish("pending");
			}
		} catch (error) {
			state.pending = false;
			state.failedRemovals++;
			deps.log("[I52] notification remove() threw", error);
			return finish("failed");
		}
		return finish("removed");
	}

	function runPass(): void {
		passTimer = null;
		if (disposed || live.size === 0) return;

		const now = deps.now();
		const snapshot = [...live];
		// A removal still pending a full quiet period later is treated as a
		// failed attempt, so a promise that never settles can't park an entry
		// outside the cap forever.
		for (const [, state] of snapshot) {
			if (!state.pending) continue;
			state.pending = false;
			state.attempt++;
			state.failedRemovals++;
		}
		const entries: CleanupEntry[] = snapshot.map(([, s]) => ({
			tag: s.tag,
			owner: s.owner,
			orphaned: s.orphaned,
			failedRemovals: s.failedRemovals,
			pending: s.pending,
		}));
		const decision = decideNotificationCleanup({
			entries,
			now,
			effectiveLastPostedAt: effectiveLastPostedAt(now),
			quietMs: NOTIFICATION_QUIET_MS,
			cap: MAX_RETAINED_NOTIFICATIONS,
			// Without a remover, a stale entry gets one close() (spec Design 4)
			// and is then exhausted, so FIFO evicts it before any live entry.
			maxRetries: MAX_REMOVAL_RETRIES,
		});

		if (decision.kind === "defer") {
			deps.log("[I52] notification cleanup deferred", {
				deferredMs: decision.delayMs,
			});
			schedulePass(decision.delayMs);
			return;
		}

		const byTag = new Map(snapshot.map(([n, s]) => [s.tag, [n, s] as const]));
		let attempted = 0;
		let retry = false;
		for (const tag of decision.remove) {
			const pair = byTag.get(tag);
			if (!pair) continue;
			attempted++;
			const outcome = removeEntry(pair[0], pair[1], "success", "superseded-or-orphaned");
			if (outcome === "pending") retry = true;
			if (outcome === "failed" && pair[1].failedRemovals < MAX_REMOVAL_RETRIES) {
				retry = true;
			}
		}
		for (const tag of decision.evict) {
			const pair = byTag.get(tag);
			if (!pair) continue;
			attempted++;
			removeEntry(pair[0], pair[1], "always", "fifo");
		}
		if (attempted > 0) {
			localLastRemovedAt = now;
			writeShared(SHARED_LAST_REMOVED_KEY, now);
		}
		// A failed removal was not counted against the cap this pass; once it
		// is exhausted, the next pass evicts it first.
		if (live.size > MAX_RETAINED_NOTIFICATIONS) retry = true;
		if (retry) armPassIfIdle(NOTIFICATION_QUIET_MS);
	}

	// ---- public API ----------------------------------------------------------

	function showOwnedNotification(
		input: ShowOwnedNotificationInput,
	): Notification | null {
		if (disposed) return null;
		const now = deps.now();
		counter++;
		const tag = `${input.owner}:${now.toString(36)}${counter.toString(36)}`;
		const Ctor = deps.NotificationCtor();
		const notification = new Ctor(input.title, { ...input.options, tag });

		const state: EntryState = {
			owner: input.owner,
			tag,
			orphaned: false,
			closed: false,
			failedRemovals: 0,
			pending: false,
			attempt: 0,
		};
		live.set(notification, state);

		notification.onclick = (event: Event) => {
			try {
				// Read the captured entry, not the map: an orphaned entry may
				// already be released (FIFO, error) while its OS entry remains.
				if (state.orphaned) {
					// The owning panel is gone: its handler would switch to a
					// tab id that no longer exists (blank view). Raise only.
					deps.raiseOwningWindow();
				} else {
					input.onClick(event);
				}
			} finally {
				release(notification);
			}
		};
		notification.onclose = () => {
			if (!state.closed) release(notification);
		};
		notification.onerror = () => {
			if (!state.closed) release(notification);
		};

		localLastPostedAt = now;
		writeShared(SHARED_LAST_POSTED_KEY, now);
		schedulePass(NOTIFICATION_QUIET_MS);

		deps.log("[I52] notification posted", {
			tag,
			msSinceLastRemovalLocal: now - localLastRemovedAt,
			msSinceLastRemovalShared:
				now -
				(readShared(SHARED_LAST_REMOVED_KEY, now) ??
					Number.NEGATIVE_INFINITY),
		});
		return notification;
	}

	function closeNotificationsForOwner(owner: string): void {
		let marked = 0;
		for (const state of live.values()) {
			if (state.owner === owner && !state.orphaned) {
				state.orphaned = true;
				marked++;
			}
		}
		if (marked === 0) return;
		armPassIfIdle(quietDelay(deps.now()));
	}

	function closeAllNotifications(): void {
		cancelPass();
		cancelSweepWait();
		if (live.size === 0) return;
		for (const [notification, state] of [...live]) {
			removeEntry(notification, state, "always", "teardown");
		}
		live.clear();
	}

	function disposeNotifications(): void {
		disposed = true;
		generation++;
		cancelPass();
		cancelSweepWait();
		deps.log("[I52] notification registry disposed; no further posts this load");
	}

	function activateNotifications(): void {
		disposed = false;
	}

	function setNotificationRemover(config: {
		statics: Pick<RemoteNotificationStatics, "remove"> | null | undefined;
		origin: string;
	}): void {
		const statics = config.statics;
		if (!statics || typeof statics.remove !== "function") {
			remover = null;
			return;
		}
		remover = (tag: string) =>
			statics.remove(notificationIdForTag(config.origin, tag));
	}

	function attachWindowCloseSweep(
		win: Window,
		register: (win: Window, event: "beforeunload", handler: () => void) => void,
	): void {
		register(win, "beforeunload", () => {
			closeAllNotifications();
		});
	}

	/** Resolves true once the app-wide quiet period has passed, false if cancelled. */
	async function waitForQuiet(): Promise<boolean> {
		for (;;) {
			if (disposed) return false;
			const delay = quietDelay(deps.now());
			if (delay <= 0) return true;
			const proceed = await new Promise<boolean>((resolve) => {
				sweepWaiter = resolve;
				sweepTimer = deps.schedule(() => {
					sweepTimer = null;
					sweepWaiter = null;
					resolve(true);
				}, delay);
			});
			if (!proceed) return false;
		}
	}

	async function sweepOwnedNotificationsAtStartup(
		sweepDeps: SweepOwnedNotificationsDeps,
	): Promise<SweepOwnedNotificationsResult> {
		const statics = sweepDeps.notificationStatics;
		if (
			!statics ||
			typeof statics.getHistory !== "function" ||
			typeof statics.remove !== "function"
		) {
			return { ran: false, removed: 0 };
		}
		if (typeof statics.isSupported === "function") {
			let supported = false;
			try {
				supported = statics.isSupported();
			} catch {
				supported = false;
			}
			if (!supported) return { ran: false, removed: 0 };
		}

		const gen = generation;
		const stopped = () => disposed || gen !== generation;

		// Removing near another window's fresh posting loses its late click
		// (round 9), so wait for the app-wide quiet period first.
		if (!(await waitForQuiet()) || stopped()) return { ran: false, removed: 0 };

		// A getHistory() failure must NOT abort the reconstructed-id removals
		// (the crash-case path), so treat an empty or failed history as none.
		let historyIds: string[] = [];
		try {
			const history = await statics.getHistory();
			if (Array.isArray(history)) {
				historyIds = history
					.map((entry) =>
						entry && typeof entry.id === "string" ? entry.id : null,
					)
					.filter((id): id is string => id !== null);
			}
		} catch (error) {
			sweepDeps.onError?.(error);
		}
		if (stopped()) return { ran: false, removed: 0 };

		const { idsToRemove } = buildOwnedNotificationSweep({
			ownedTabIds: sweepDeps.ownedTabIds,
			origin: sweepDeps.origin,
			historyIds,
		});

		let removed = 0;
		for (const id of idsToRemove) {
			if (stopped()) return { ran: false, removed };
			// A posting during getHistory() or a previous remove() restarts
			// the quiet period: wait again before removing anything.
			if (quietDelay(deps.now()) > 0) {
				if (!(await waitForQuiet()) || stopped()) {
					return { ran: false, removed };
				}
			}
			const tag = extractNotificationTag(id);
			const isLive = [...live.values()].some((s) => s.tag === tag);
			if (isLive) continue;
			try {
				await statics.remove(id);
				removed++;
			} catch (error) {
				sweepDeps.onError?.(error);
			}
		}
		return { ran: true, removed };
	}

	function __reset(nextDeps?: NotificationRegistryDeps): void {
		cancelPass();
		cancelSweepWait();
		if (nextDeps) deps = nextDeps;
		live = new Map();
		remover = null;
		disposed = false;
		generation++;
		counter = 0;
		localLastPostedAt = Number.NEGATIVE_INFINITY;
		localLastRemovedAt = Number.NEGATIVE_INFINITY;
		storeWarned = false;
	}

	return {
		showOwnedNotification,
		closeNotificationsForOwner,
		closeAllNotifications,
		disposeNotifications,
		activateNotifications,
		setNotificationRemover,
		attachWindowCloseSweep,
		sweepOwnedNotificationsAtStartup,
		__reset,
		__count: () => live.size,
	};
}

// ============================================================================
// Production defaults and the module default instance
// ============================================================================

function defaultRaiseOwningWindow(): void {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a runtime-only module provided by Obsidian's host environment
		const { remote } = require("electron") as {
			remote: { getCurrentWindow: () => { focus: () => void } };
		};
		remote.getCurrentWindow().focus();
	} catch {
		window.focus();
	}
}

function defaultDeps(): NotificationRegistryDeps {
	return {
		NotificationCtor: () => window.Notification,
		// The vault-scoped App#saveLocalStorage cannot serve a clock shared
		// across vault windows; window.localStorage is one store per origin
		// (app://obsidian.md), shared by every vault window.
		store: () => {
			try {
				return window.localStorage;
			} catch {
				return null;
			}
		},
		schedule: (fn, ms) => window.setTimeout(fn, ms),
		cancel: (handle) => window.clearTimeout(handle),
		now: () => Date.now(),
		raiseOwningWindow: defaultRaiseOwningWindow,
		log: (message, data) => {
			try {
				getLogger().debug(message, data);
			} catch {
				// Logging must never break notification handling.
			}
		},
	};
}

const defaultRegistry = createNotificationRegistry(defaultDeps());

export function showOwnedNotification(
	input: ShowOwnedNotificationInput,
): Notification | null {
	return defaultRegistry.showOwnedNotification(input);
}

/** The owning panel unmounted (tab closed): remove after the quiet period. */
export function closeNotificationsForOwner(owner: string): void {
	defaultRegistry.closeNotificationsForOwner(owner);
}

/** Teardown sweep (plugin onunload, window beforeunload). */
export function closeAllNotifications(): void {
	defaultRegistry.closeAllNotifications();
}

/** Stop posting (plugin onunload, app quit); cancels pending timers. */
export function disposeNotifications(): void {
	defaultRegistry.disposeNotifications();
}

/** Plugin onload: allow posting and configure removal by id. */
export function initNotifications(config: {
	statics: Pick<RemoteNotificationStatics, "remove"> | null | undefined;
	origin: string;
}): void {
	defaultRegistry.activateNotifications();
	defaultRegistry.setNotificationRemover(config);
}

export function attachWindowCloseSweep(
	win: Window,
	register: (win: Window, event: "beforeunload", handler: () => void) => void,
): void {
	defaultRegistry.attachWindowCloseSweep(win, register);
}

export function sweepOwnedNotificationsAtStartup(
	deps: SweepOwnedNotificationsDeps,
): Promise<SweepOwnedNotificationsResult> {
	return defaultRegistry.sweepOwnedNotificationsAtStartup(deps);
}

/**
 * Production accessor for the Electron `remote.Notification` statics used by
 * the startup sweep and removal by id. Returns null where they are unavailable
 * (non-Electron, older Electron) so both degrade to no-ops. The require is
 * lazy so unit tests, which inject fakes, never touch the real module.
 */
export function getRemoteNotificationStatics(): RemoteNotificationStatics | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a runtime-only module provided by Obsidian's host environment
		const electron = require("electron") as {
			remote?: { Notification?: RemoteNotificationStatics };
		};
		const N = electron?.remote?.Notification;
		if (
			N &&
			typeof N.getHistory === "function" &&
			typeof N.remove === "function"
		) {
			return N;
		}
	} catch {
		// Not an Electron host, or remote unavailable.
	}
	return null;
}

/** Test-only: number of notifications retained by the default instance. */
export function __getRetainedNotificationCountForTests(): number {
	return defaultRegistry.__count();
}

/** Test-only: reset the default instance in place, optionally with fake deps. */
export function __resetNotificationRegistryForTests(
	deps?: NotificationRegistryDeps,
): void {
	defaultRegistry.__reset(deps ?? defaultDeps());
}
