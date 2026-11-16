/**
 * Chat Timestamps — the stamp leaf, its hover ages, and the day-store wiring.
 *
 * `TimeStamp` renders one faint time: under a prompt, at a turn's end, over a
 * gap, or in an agent message's hover row. It is memoized with primitive props
 * and reads the plugin's day store itself, so a streaming flush re-renders no
 * stamp and a day change re-renders only the stamps, not the bubbles.
 *
 * Each stamp carries a static label (`aria-label`, and the same string in
 * `data-stamp-label`) and its time in `data-arrived-at`. One delegated
 * `mouseover` listener per message list adds the age just before Obsidian shows
 * the tooltip (probe P6); a delegated `mouseout` puts the static label back.
 * Ages are mouse-only: stamps are not focusable.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Prompt and turn-end stamps,
 * § Per-output times on hover, § Gap stamps, § Ticker and store.
 */
import * as React from "react";
const { memo, useCallback, useEffect, useRef, useSyncExternalStore } = React;
import { flushSync } from "react-dom";

import { t } from "../i18n";
import { localDayStore } from "../services/local-day-store";
import { deriveStampAge } from "../resolvers/stamp-age";
import { deriveStampDateScope } from "../resolvers/stamp-date-scope";
import type { DaySnapshot } from "../types/chat-time";
import { formatAgeText, formatClock, formatDuration } from "../utils/time-format";
import { attachTooltip, restoreStaticTooltip } from "./shared/useTooltip";

export type StampVariant = "prompt" | "end" | "gap" | "hover";

export interface TimeStampProps {
	/** Epoch ms of the moment the stamp shows. */
	at: number;
	variant: StampVariant;
	/** End stamps only: how the turn ended. */
	endKind?: "done" | "stopped" | "failed";
	/** End stamps only: the turn's duration, when known. */
	durationMs?: number | null;
}

const STAMP_SELECTOR = ".agent-client-stamp";

/** The largest magnitude a JS Date can hold. */
const MAX_DATE_MS = 8.64e15;

/** A stamp's clock text: the time, plus the date or the year when needed (Decision 7). */
export function formatStampTime(ms: number, snapshot: DaySnapshot): string {
	return formatClock(ms, deriveStampDateScope(ms, snapshot.bounds), snapshot.zone);
}

/** How old a stamp is, for its hover tooltip. Never a date. */
export function formatStampAge(thenMs: number, nowMs: number): string {
	return formatAgeText(deriveStampAge(thenMs, nowMs));
}

function composeLabel(
	clock: string,
	endKind: TimeStampProps["endKind"],
	durationMs: number | null | undefined,
): string {
	const stamp =
		endKind === "stopped"
			? t("chat.stamp.stopped", { time: clock })
			: endKind === "failed"
				? t("chat.stamp.failed", { time: clock })
				: clock;
	// A duration under a second reads as noise ("· 0s"); show the time alone.
	if (endKind === "failed" || durationMs === null || durationMs === undefined || durationMs < 1000) {
		return stamp;
	}
	return t("chat.stamp.withDuration", {
		stamp,
		duration: formatDuration(durationMs, "minutes"),
	});
}

export const TimeStamp = memo(function TimeStamp({
	at,
	variant,
	endKind,
	durationMs,
}: TimeStampProps) {
	const day = useSyncExternalStore(localDayStore.subscribe, localDayStore.getSnapshot);
	// Defense in depth behind the load-edge validator: a time a formatter
	// would throw on shows no stamp rather than crash the tab (Decision 8).
	if (!Number.isFinite(at) || Math.abs(at) > MAX_DATE_MS) return null;
	const label = composeLabel(formatStampTime(at, day), endKind, durationMs);
	return (
		<span
			className={`agent-client-stamp agent-client-stamp-${variant}`}
			aria-label={label}
			data-stamp-label={label}
			data-arrived-at={at}
		>
			{label}
		</span>
	);
});

/** The plugin's own stamp under an event target, with a usable time and label. */
function stampAt(
	target: EventTarget | null,
	container: HTMLElement,
): { el: HTMLElement; at: number; label: string } | null {
	// Duck-typed rather than `instanceof Element`, which fails for nodes from
	// a popout window's realm.
	const node = target as Partial<Element> | null;
	if (!node || typeof node.closest !== "function") return null;
	const el = node.closest<HTMLElement>(STAMP_SELECTOR);
	if (!el || !container.contains(el)) return null;
	const at = Number(el.dataset.arrivedAt);
	const label = el.dataset.stampLabel;
	if (!Number.isFinite(at) || !label) return null;
	return { el, at, label };
}

/**
 * Hover ages for every stamp in a message list, through one delegated
 * listener pair on its scroll container. Returns a stable ref callback for that
 * container, to compose with the scroll pin's own ref. Also re-checks the day
 * when the tab becomes active, so a stale day from a missed midnight corrects
 * on return.
 */
export function useStampHoverAges(isActive: boolean): (el: HTMLElement | null) => void {
	useEffect(() => {
		if (isActive) localDayStore.recheckIfStale(Date.now());
	}, [isActive]);

	const attached = useRef<{ el: HTMLElement; detach: () => void } | null>(null);
	useEffect(
		() => () => {
			attached.current?.detach();
			attached.current = null;
		},
		[],
	);

	return useCallback((el: HTMLElement | null) => {
		if (attached.current?.el === el) return;
		attached.current?.detach();
		attached.current = null;
		if (!el) return;
		const container = el;
		const onOver = (e: MouseEvent) => {
			const now = Date.now();
			const before = localDayStore.getSnapshot();
			if (localDayStore.recheckIfStale(now) !== before) {
				// A missed midnight: commit the stamps' new dated labels before
				// reading one, or the age lands on yesterday's label.
				flushSync(() => {});
			}
			const hit = stampAt(e.target, container);
			if (!hit) return;
			attachTooltip(hit.el, { visibleLabel: hit.label, reason: formatStampAge(hit.at, now) });
		};
		const onOut = (e: MouseEvent) => {
			const hit = stampAt(e.target, container);
			if (!hit) return;
			const next = e.relatedTarget as Node | null;
			if (next && hit.el.contains(next)) return;
			restoreStaticTooltip(hit.el, hit.label);
		};
		container.addEventListener("mouseover", onOver);
		container.addEventListener("mouseout", onOut);
		attached.current = {
			el: container,
			detach: () => {
				container.removeEventListener("mouseover", onOver);
				container.removeEventListener("mouseout", onOut);
			},
		};
	}, []);
}

/**
 * Register a view's window and document with the day store for as long as the
 * view is mounted, and follow the view when Obsidian moves it to another window.
 */
export function useDayStoreRegistration(containerEl: HTMLElement): void {
	useEffect(() => {
		const doc = containerEl.ownerDocument;
		let unregister = localDayStore.register(doc.defaultView ?? activeWindow, doc);
		// Obsidian's DOM extension; absent outside Obsidian (tests).
		const stopWatching: (() => void) | null =
			typeof containerEl.onWindowMigrated === "function"
				? containerEl.onWindowMigrated((win: Window) => {
						unregister();
						unregister = localDayStore.register(win, win.document);
					})
				: null;
		return () => {
			stopWatching?.();
			unregister();
		};
	}, [containerEl]);
}
