/**
 * The plugin's one day store: today's local calendar bounds and time zone.
 *
 * Chat stamps show the date when they aren't from today and the year when they
 * aren't from this year (Decision 7). That has to stay true in an idle chat
 * left open across midnight, after a laptop wakes, and after the time zone
 * changes. One store for the whole plugin keeps every view and popout on the
 * same day and zone, so they can't disagree or flip a shared formatter cache.
 *
 * It is an external store (`subscribe` / `getSnapshot` for
 * `useSyncExternalStore`), not React state, so a native hover listener can
 * re-check and read it synchronously. Its snapshot is a new object only when
 * the day or the zone changed.
 *
 * Re-checks: each registered view's window `focus` and document
 * `visibilitychange` (timers may not count time a laptop spends asleep), tab
 * activation and hover (`recheckIfStale`, two comparisons), and one midnight
 * timeout for the plugin. The timeout always schedules the next one, so a timer
 * that fires early can't stop the refresh.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Ticker and store (the day store).
 */
import type { DaySnapshot } from "../types/chat-time";
import { computeDayBounds, currentZone } from "../utils/time-format";

export type { DaySnapshot } from "../types/chat-time";

export interface LocalDayStore {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => DaySnapshot;
	/** Re-check the zone and the day; swap and notify when either changed. */
	recheck: (now: number) => DaySnapshot;
	/** Cheap form: re-check only when `now` is outside today (no zone read). */
	recheckIfStale: (now: number) => DaySnapshot;
	/** Re-check on this window's focus and this document's visibility changes. */
	register: (win: Window, doc: Document) => () => void;
	/** Clear the timer and every listener (plugin unload). */
	dispose: () => void;
}

/** Fires a little after midnight, so a slightly early timer still lands after it. */
const MIDNIGHT_MARGIN_MS = 1_000;

export function createLocalDayStore(): LocalDayStore {
	let snapshot: DaySnapshot | null = null;
	const listeners = new Set<() => void>();
	const registrations = new Set<() => void>();
	let timer: number | null = null;

	const build = (now: number): DaySnapshot => ({
		bounds: computeDayBounds(now),
		zone: currentZone(),
	});

	const getSnapshot = (): DaySnapshot => {
		if (snapshot === null) snapshot = build(Date.now());
		return snapshot;
	};

	const clearTimer = () => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
	};

	const schedule = () => {
		clearTimer();
		if (registrations.size === 0) return;
		const delay = Math.max(
			MIDNIGHT_MARGIN_MS,
			getSnapshot().bounds.nextDayStart - Date.now() + MIDNIGHT_MARGIN_MS,
		);
		timer = window.setTimeout(onMidnight, delay);
	};

	const recheck = (now: number): DaySnapshot => {
		const current = getSnapshot();
		const zone = currentZone();
		const { dayStart, nextDayStart } = current.bounds;
		if (zone === current.zone && now >= dayStart && now < nextDayStart) {
			return current;
		}
		snapshot = { bounds: computeDayBounds(now), zone };
		for (const listener of [...listeners]) listener();
		schedule();
		return snapshot;
	};

	function onMidnight() {
		timer = null;
		recheck(Date.now());
		schedule();
	}

	const recheckIfStale = (now: number): DaySnapshot => {
		const current = getSnapshot();
		const { dayStart, nextDayStart } = current.bounds;
		if (now >= dayStart && now < nextDayStart) return current;
		return recheck(now);
	};

	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};

	const register = (win: Window, doc: Document) => {
		const onEvent = () => {
			recheck(Date.now());
		};
		win.addEventListener("focus", onEvent);
		doc.addEventListener("visibilitychange", onEvent);
		const unregisterOne = () => {
			win.removeEventListener("focus", onEvent);
			doc.removeEventListener("visibilitychange", onEvent);
		};
		registrations.add(unregisterOne);
		recheck(Date.now());
		if (timer === null) schedule();
		return () => {
			if (!registrations.delete(unregisterOne)) return;
			unregisterOne();
			if (registrations.size === 0) clearTimer();
		};
	};

	const dispose = () => {
		for (const unregisterOne of registrations) unregisterOne();
		registrations.clear();
		clearTimer();
		snapshot = null;
	};

	return { subscribe, getSnapshot, recheck, recheckIfStale, register, dispose };
}

/** The plugin's one day store. */
export const localDayStore: LocalDayStore = createLocalDayStore();
