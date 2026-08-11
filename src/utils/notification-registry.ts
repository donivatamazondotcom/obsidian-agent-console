/**
 * Retains OS `Notification` objects so their `onclick` handler survives until
 * the user interacts with (or the OS dismisses) the toast.
 *
 * WHY THIS EXISTS: a `Notification` created as a local `const` inside a React
 * effect has no retained reference once the effect run exits, so the JS engine
 * is free to garbage-collect it — and with it, the `onclick` handler. Electron/
 * Chromium then delivers the click to a dead object, so clicking the toast does
 * nothing. This is worst once the banner auto-dismisses into macOS Notification
 * Center: the click arrives long after the effect ran, by which point GC has
 * almost certainly reclaimed the object. Documented Electron behavior:
 *   - electron/electron#12690 ("[macOS] Click event is not triggered from
 *     notification center if the user waits ~1 minute or more … the notification
 *     object is being garbage-collected … store it somewhere it won't be
 *     destructed")
 *   - electron/electron#16922 (notification lifetime too short)
 *
 * Fix: hold a strong reference in a module-level Set from creation until the
 * notification is clicked, closed, or errors — then release it so the Set does
 * not grow unbounded. Completion/permission notifications fire at most once per
 * turn-end while the app is unfocused, so the live set stays tiny.
 *
 * See [[I52 Notification click focuses wrong vault window]] recurrence
 * 2026-07-09 (the "click does nothing at times" symptom, distinct from the
 * earlier wrong-window symptom that PR #207's revealLeaf fix addressed).
 */

const liveNotifications = new Set<Notification>();

/**
 * Upper bound on retained notifications. Needed because the `close` event
 * NEVER fires on macOS (verified empirically 2026-07-29: not on banner
 * auto-dismiss after 45 s, not even on click) — so release-on-close alone
 * cannot bound the set. Insertion order of the Set gives FIFO eviction; the
 * evicted (oldest) notification is also `close()`d so its Notification Center
 * entry cannot linger as a stale click target.
 */
export const MAX_RETAINED_NOTIFICATIONS = 10;

/**
 * Retain `notification` and wire `onClick` as its click handler. The handler is
 * invoked on click, after which the notification is released from the registry.
 * The notification is also released when it is closed or errors, so an
 * un-clicked notification cannot leak.
 *
 * Call this INSTEAD of assigning `notification.onclick` directly — passing the
 * handler here guarantees the retain/release wiring cannot be clobbered by a
 * later `onclick =` assignment.
 */
export function retainNotification(
	notification: Notification,
	onClick: (event: Event) => void,
): void {
	liveNotifications.add(notification);

	// FIFO cap: evict-and-close the oldest entry once over the bound.
	if (liveNotifications.size > MAX_RETAINED_NOTIFICATIONS) {
		for (const oldest of liveNotifications) {
			liveNotifications.delete(oldest);
			try {
				oldest.close();
			} catch {
				// Closing a long-dead OS entry may throw; eviction must not.
			}
			break;
		}
	}

	const release = () => {
		liveNotifications.delete(notification);
	};

	notification.onclick = (event: Event) => {
		try {
			onClick(event);
		} finally {
			release();
		}
	};
	notification.onclose = release;
	notification.onerror = release;
}

/**
 * Close and release every retained notification. Called from the plugin's
 * `onunload` (I52 round 6, 2026-07-29): a Notification Center entry outlives
 * the JS context that created it across a plugin reload or Obsidian restart,
 * and clicking such an orphan either does nothing (its closures reference an
 * unmounted React tree and a detached leaf) or falls through to macOS default
 * app activation — foregrounding the most-recently-active window, i.e.
 * possibly the wrong vault. Sweeping them at unload makes orphan clicks
 * impossible. `.close()` verifiably removes an NC-resident entry on macOS
 * (probe 2026-07-29). Residual gap: a force-quit/crash skips `onunload`.
 */
export function closeAllNotifications(): void {
	for (const notification of liveNotifications) {
		try {
			notification.close();
		} catch {
			// Never let one bad entry abort the sweep.
		}
	}
	liveNotifications.clear();
}

/**
 * Attach the notification sweep to the window's `beforeunload` (I52 round 7,
 * 2026-08-11). Closing a vault WINDOW does not run plugin `onunload`
 * (verified empirically: a marker-instrumented `onunload` never fired on
 * `window.close()`, while an explicit `disablePlugin` did) — so the round-6
 * unload sweep never runs for closed windows, and their Notification Center
 * entries orphan exactly as in round 6. `beforeunload` DOES fire on window
 * close (and on a hard `Page.reload`), so hanging the sweep off it closes
 * the last graceful-teardown path. The `onunload` sweep stays for the
 * disable/quit paths.
 *
 * The listener is registered through the injected `register` seam so the
 * plugin can pass `registerDomEvent` (auto-detached on plugin unload) and
 * tests can pass a plain `addEventListener`.
 */
export function attachWindowCloseSweep(
	win: Window,
	register: (
		win: Window,
		event: "beforeunload",
		handler: () => void,
	) => void,
): void {
	register(win, "beforeunload", () => {
		closeAllNotifications();
	});
}

/** Test-only: number of notifications currently retained. */
export function __getRetainedNotificationCountForTests(): number {
	return liveNotifications.size;
}

/** Test-only: clear the registry between tests. */
export function __resetNotificationRegistryForTests(): void {
	liveNotifications.clear();
}

// ============================================================
// I52 round 7.5 (2026-08-11): startup sweep for crash / force-quit orphans.
// ============================================================
//
// A force-quit or crash is the ONE teardown path that skips BOTH plugin
// `onunload` (round 6) and window `beforeunload` (round 7), so the
// notifications a crashed session delivered stay in macOS Notification Center
// as orphans. Clicking such an orphan either does nothing (its closures point
// at a dead JS context) or falls through to macOS default app activation,
// foregrounding the most-recently-active window (possibly the wrong vault).
//
// Electron 43 exposes `remote.Notification.getHistory()` / `remove(id)`
// (verified live 2026-08-11), so at plugin `onload` we remove the stale
// entries. We remove ONLY this vault's own notifications — matched by the tab
// ids this vault owns — so another vault window's LIVE notifications (which
// carry different, globally-unique tab ids) are never touched. We never use
// `removeAll()`, which would nuke those live entries.
//
// A delivered notification's id has the form `n#<origin>#<tag>`, and our
// completion/permission notifications set `tag` to the tab id (viewId ===
// tab.tabId). `getHistory()` is an in-memory, per-process list, so after a
// crash + relaunch it is typically EMPTY — it cannot enumerate the dead
// process's orphans. We therefore also RECONSTRUCT the expected id for each
// owned tab id and `remove()` it directly (idempotent no-op if absent); macOS
// removes a delivered notification by identifier regardless of which process
// delivered it. See [[I52 Notification click focuses wrong vault window]]
// § Recurrence 2026-08-11 round 7.5.

/** Scheme prefix of a delivered-notification id: `n#<origin>#<tag>`. */
const NOTIFICATION_ID_PREFIX = "n#";

/**
 * Extract the `tag` embedded in a delivered-notification id of the form
 * `n#<origin>#<tag>`. Returns null for anything that is not an `n#`-scheme id
 * with both an origin and a tag segment. The origin (`app://obsidian.md`)
 * contains no `#`, but trailing segments are rejoined defensively so a tag
 * that ever contained `#` is preserved.
 */
function extractNotificationTag(id: unknown): string | null {
	if (typeof id !== "string" || !id.startsWith(NOTIFICATION_ID_PREFIX)) {
		return null;
	}
	const parts = id.split("#");
	if (parts.length < 3) return null;
	return parts.slice(2).join("#");
}

/** Reconstruct the delivered-notification id our plugin uses for a tab id. */
function notificationIdForTab(origin: string, tabId: string): string {
	return `${NOTIFICATION_ID_PREFIX}${origin}#${tabId}`;
}

export interface OwnedNotificationSweepInput {
	/** Tab ids this vault owns (from restored `perLeafTabStates`). */
	ownedTabIds: readonly string[];
	/** Renderer origin, e.g. `app://obsidian.md` (`window.location.origin`). */
	origin: string;
	/** Ids of the entries currently in `getHistory()` (may be empty). */
	historyIds: readonly string[];
}

export interface OwnedNotificationSweep {
	/**
	 * Deduped ids to `remove()` — reconstructed owned ids ∪ history ids whose
	 * embedded tag is one of ours.
	 */
	idsToRemove: string[];
}

/**
 * Pure planner for the startup sweep. Given this vault's owned tab ids, the
 * renderer origin, and the ids currently in notification history, compute the
 * exact set of ids to remove:
 *
 *   - one RECONSTRUCTED id per owned tab (`n#<origin>#<tabId>`) — covers the
 *     crash case where `getHistory()` is empty in the fresh process; and
 *   - every HISTORY id whose embedded tag is one of our owned tab ids — covers
 *     same-process leftovers and any entry whose origin differs from
 *     `location.origin` (matched by tag, removed by its own exact id).
 *
 * Entries whose tag is NOT ours (another vault window's tab) are excluded, so
 * the sweep can never remove another window's live notification.
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
	for (const tabId of owned) {
		ids.add(notificationIdForTab(input.origin, tabId));
	}
	for (const historyId of input.historyIds) {
		const tag = extractNotificationTag(historyId);
		if (tag !== null && owned.has(tag)) {
			ids.add(historyId);
		}
	}
	return { idsToRemove: [...ids] };
}

/**
 * The subset of Electron's `remote.Notification` statics the sweep needs.
 * `getHistory` and `remove` are async (remote-proxied to the main process).
 */
export interface RemoteNotificationStatics {
	isSupported?: () => boolean;
	getHistory: () => Promise<Array<{ id?: unknown }>>;
	remove: (id: string) => unknown;
}

export interface SweepOwnedNotificationsDeps {
	/**
	 * The `remote.Notification` statics, or null/undefined on hosts that do not
	 * expose them (non-Electron, or older Electron without getHistory/remove).
	 */
	notificationStatics: RemoteNotificationStatics | null | undefined;
	ownedTabIds: readonly string[];
	origin: string;
	/** Optional error sink; sweep failures are non-fatal to startup. */
	onError?: (error: unknown) => void;
}

export interface SweepOwnedNotificationsResult {
	/** False when the guard short-circuited (statics absent / unsupported). */
	ran: boolean;
	/** Number of `remove()` calls that resolved successfully. */
	removed: number;
}

/**
 * Startup sweep: remove this vault's own stale Notification Center entries left
 * by a crashed / force-quit session. Guarded to a no-op when the Electron
 * notification statics are absent or `isSupported()` is false, so it is safe on
 * any host. Never throws into `onload` — all failures route to `onError`.
 */
export async function sweepOwnedNotificationsAtStartup(
	deps: SweepOwnedNotificationsDeps,
): Promise<SweepOwnedNotificationsResult> {
	const statics = deps.notificationStatics;
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

	// A getHistory() failure must NOT abort the reconstructed-id removals (the
	// crash-case path), so treat an empty or failed history as no history.
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
		deps.onError?.(error);
	}

	const { idsToRemove } = buildOwnedNotificationSweep({
		ownedTabIds: deps.ownedTabIds,
		origin: deps.origin,
		historyIds,
	});

	let removed = 0;
	for (const id of idsToRemove) {
		try {
			await statics.remove(id);
			removed++;
		} catch (error) {
			deps.onError?.(error);
		}
	}
	return { ran: true, removed };
}

/**
 * Production accessor for the Electron `remote.Notification` statics used by
 * the startup sweep. Returns null on any host where they are unavailable
 * (non-Electron, older Electron, or a shim missing getHistory/remove) so the
 * sweep degrades to a no-op. The `require("electron")` is lazy (inside this
 * function) so unit tests — which inject fakes — never touch the real module.
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
		// Not an Electron host, or remote unavailable — no-op sweep.
	}
	return null;
}
