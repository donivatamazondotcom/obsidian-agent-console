/**
 * Working face: the indicator's phase (idle, working, or one of the two
 * exits) and the one timer that ends an exit.
 *
 * The decision is `decideIndicatorTransition` (pure). This hook owns the
 * refs, the timer, and the one DOM read: when a turn ends, it captures what
 * each eye layer shows right now, so the exit animation starts from that face
 * instead of snapping back to the brand face first.
 *
 * Call it above MessageList's inactive-tab early return: it must keep its refs
 * and timer across tab switches, and the face is not mounted on an inactive
 * tab.
 *
 * Spec: [[Agent Console Working Face]] § Exit phases, § Ownership.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
	decideIndicatorTransition,
	INDICATOR_EXIT_MS,
	type IndicatorExit,
} from "../resolvers/working-indicator";
import type { TurnEnd } from "../types/session";

export type IndicatorPhase = "idle" | "working" | IndicatorExit;

const LAYER_SELECTOR = ".agent-client-face-layer";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function isExit(phase: IndicatorPhase): phase is IndicatorExit {
	return phase === "exit-happy" || phase === "exit-close";
}

function prefersReducedMotion(win: Window | null): boolean {
	// jsdom (and any host without matchMedia) counts as no preference.
	if (!win || typeof win.matchMedia !== "function") return false;
	return win.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Write each layer's current opacity and transform as the exit's start.
 * All reads first, then all writes: interleaving them would force a style
 * recalc per layer instead of one. */
function captureFace(face: HTMLElement, win: Window): void {
	const layers = Array.from(face.querySelectorAll<HTMLElement>(LAYER_SELECTOR));
	const looks = layers.map((layer) => {
		const cs = win.getComputedStyle(layer);
		return { opacity: cs.opacity, transform: cs.transform && cs.transform !== "" ? cs.transform : "none" };
	});
	layers.forEach((layer, i) => {
		layer.setCssProps({ "--acf-o": looks[i].opacity, "--acf-t": looks[i].transform });
	});
}

function clearCapture(face: HTMLElement | null): void {
	if (!face) return;
	for (const layer of Array.from(face.querySelectorAll<HTMLElement>(LAYER_SELECTOR))) {
		layer.setCssProps({ "--acf-o": "", "--acf-t": "" });
	}
}

export function useWorkingIndicatorPhase({
	isSending,
	lastTurnEnd,
}: {
	isSending: boolean;
	lastTurnEnd: TurnEnd | null;
}): { phase: IndicatorPhase; faceRef: (el: HTMLElement | null) => void } {
	const [phase, setPhase] = useState<IndicatorPhase>(isSending ? "working" : "idle");
	const phaseRef = useRef(phase);
	phaseRef.current = phase;

	// Both initialised from the mount props, so mounting mid-turn (or after a
	// finished turn) needs no special case and never replays an exit.
	const wasSendingRef = useRef(isSending);
	const prevTurnEndRef = useRef(lastTurnEnd);
	const faceElRef = useRef<HTMLElement | null>(null);
	const timerRef = useRef<{ win: Window; id: number } | null>(null);

	const clearTimer = useCallback(() => {
		const t = timerRef.current;
		if (t) t.win.clearTimeout(t.id);
		timerRef.current = null;
	}, []);

	// Decide only when isSending changed; then update both refs. A
	// lastTurnEnd that changes alone never starts an exit.
	useLayoutEffect(() => {
		const wasSending = wasSendingRef.current;
		const prevTurnEnd = prevTurnEndRef.current;
		wasSendingRef.current = isSending;
		prevTurnEndRef.current = lastTurnEnd;
		if (wasSending === isSending) return;

		const face = faceElRef.current;
		const win = face?.ownerDocument.defaultView ?? null;
		const transition = decideIndicatorTransition({
			wasSending,
			isSending,
			prevTurnEnd,
			lastTurnEnd,
			reducedMotion: prefersReducedMotion(win),
		});
		clearTimer();
		switch (transition) {
			case "none":
				return;
			case "start":
				clearCapture(face);
				setPhase("working");
				return;
			case "hide":
				clearCapture(face);
				setPhase("idle");
				return;
			case "exit-happy":
			case "exit-close": {
				// Inactive tab: no face to animate, nothing to wait for.
				if (!face || !win) {
					setPhase("idle");
					return;
				}
				captureFace(face, win);
				setPhase(transition);
				const id = win.setTimeout(() => {
					timerRef.current = null;
					clearCapture(faceElRef.current);
					setPhase("idle");
				}, INDICATOR_EXIT_MS[transition]);
				timerRef.current = { win, id };
				return;
			}
			default: {
				// A new transition kind must be handled here, not ignored.
				const unhandled: never = transition;
				void unhandled;
				return;
			}
		}
	}, [isSending, lastTurnEnd, clearTimer]);

	useEffect(() => clearTimer, [clearTimer]);

	const faceRef = useCallback(
		(el: HTMLElement | null) => {
			const previous = faceElRef.current;
			faceElRef.current = el;
			// The face remounted mid-exit (tab switched away and back): the
			// captured values are gone, and half an exit has no value. Hide.
			if (el && !previous && isExit(phaseRef.current)) {
				clearTimer();
				clearCapture(el);
				setPhase("idle");
			}
		},
		[clearTimer],
	);

	return { phase, faceRef };
}
