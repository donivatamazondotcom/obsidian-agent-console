/**
 * Vertical tab rail – piano-key flyout state machine
 * ([[Agent Console Vertical Tab Rail]] § Hover flyout state machine).
 *
 * The first hover on the rail waits ~250ms; after that every key shows its
 * flyout at once, until the pointer has been off the rail for ~400ms.
 * Keyboard focus shows the flyout at once. Escape hides it while the pointer
 * or focus stays on that key.
 *
 * `(state, event) → { state, effects }` with declarative effects, like
 * queue-orchestration-reducer: the component owns the timers and dispatches
 * `warmElapsed` / `coolElapsed` back. Starting a timer replaces any pending
 * timer of the same kind. Pure and total: every state × event pair is
 * defined (pinned by the table test), never throws.
 */

import { showsCloseButton, RAIL_CLOSE_OVERLAY_PX } from "./tab-rail-width";

export const RAIL_WARM_MS = 250;
export const RAIL_COOL_MS = 400;

export type RailHoverVia = "pointer" | "focus";

export type RailHoverState =
	| { kind: "cold" }
	| { kind: "warming"; key: string }
	| { kind: "showing"; key: string; via: RailHoverVia }
	| { kind: "warm" }
	| { kind: "dismissed"; key: string; via: RailHoverVia };

export type RailHoverEvent =
	| { type: "pointerEnterKey"; key: string }
	| { type: "pointerLeaveKey" }
	| { type: "pointerLeaveRail" }
	| { type: "pointerEnterRail" }
	| { type: "warmElapsed" }
	| { type: "coolElapsed" }
	| { type: "focusKey"; key: string }
	/** `pointerInside`: whether the pointer is over the rail right now. */
	| { type: "blurKey"; pointerInside: boolean }
	| { type: "escape" }
	| { type: "listScrolled" }
	| { type: "dragStarted" }
	| { type: "menuOpened" }
	| { type: "keysChanged"; keys: readonly string[] };

export type RailHoverEffect =
	| { type: "startWarm"; ms: number }
	| { type: "cancelWarm" }
	| { type: "startCool"; ms: number }
	| { type: "cancelCool" }
	| { type: "reposition" };

export interface RailHoverResult {
	state: RailHoverState;
	effects: RailHoverEffect[];
}

const COLD: RailHoverState = { kind: "cold" };
const WARM: RailHoverState = { kind: "warm" };
const startWarm: RailHoverEffect = { type: "startWarm", ms: RAIL_WARM_MS };
const cancelWarm: RailHoverEffect = { type: "cancelWarm" };
const startCool: RailHoverEffect = { type: "startCool", ms: RAIL_COOL_MS };
const cancelCool: RailHoverEffect = { type: "cancelCool" };

const to = (state: RailHoverState, ...effects: RailHoverEffect[]): RailHoverResult => ({
	state,
	effects,
});

function keyOf(s: RailHoverState): string | null {
	return s.kind === "warming" || s.kind === "showing" || s.kind === "dismissed"
		? s.key
		: null;
}

export function nextRailHover(
	s: RailHoverState,
	e: RailHoverEvent,
): RailHoverResult {
	const stay = to(s);
	switch (e.type) {
		case "pointerEnterKey": {
			const same = keyOf(s) === e.key;
			switch (s.kind) {
				case "cold":
					return to({ kind: "warming", key: e.key }, startWarm);
				case "warming":
					return same ? stay : to({ kind: "warming", key: e.key }, startWarm);
				case "showing":
					if (same && s.via === "pointer") return stay;
					return to({ kind: "showing", key: e.key, via: "pointer" });
				case "warm":
					return to({ kind: "showing", key: e.key, via: "pointer" }, cancelCool);
				case "dismissed":
					return same ? stay : to({ kind: "showing", key: e.key, via: "pointer" });
			}
			return stay;
		}
		case "pointerLeaveKey":
			if (s.kind === "warming") return to(COLD, cancelWarm);
			if (s.kind === "showing" && s.via === "pointer") return to(WARM);
			if (s.kind === "dismissed" && s.via === "pointer") return to(WARM);
			return stay;
		case "pointerLeaveRail":
			if (s.kind === "warming") return to(COLD, cancelWarm);
			if (s.kind === "showing" && s.via === "pointer") return to(WARM, startCool);
			if (s.kind === "warm") return to(WARM, startCool);
			if (s.kind === "dismissed") return to(WARM, startCool);
			return stay;
		case "pointerEnterRail":
			return s.kind === "warm" ? to(WARM, cancelCool) : stay;
		case "warmElapsed":
			return s.kind === "warming"
				? to({ kind: "showing", key: s.key, via: "pointer" })
				: stay;
		case "coolElapsed":
			return s.kind === "warm" ? to(COLD) : stay;
		case "focusKey": {
			const same = keyOf(s) === e.key;
			const shown: RailHoverState = { kind: "showing", key: e.key, via: "focus" };
			switch (s.kind) {
				case "cold":
					return to(shown);
				case "warming":
					return to(shown, cancelWarm);
				case "showing":
					return same && s.via === "focus" ? stay : to(shown);
				case "warm":
					return to(shown, cancelCool);
				case "dismissed":
					return same ? stay : to(shown);
			}
			return stay;
		}
		case "blurKey": {
			const leaving =
				(s.kind === "showing" || s.kind === "dismissed") && s.via === "focus";
			if (!leaving) return stay;
			return e.pointerInside ? to(WARM) : to(WARM, startCool);
		}
		case "escape":
			if (s.kind === "warming") return to(COLD, cancelWarm);
			if (s.kind === "showing") {
				return to({ kind: "dismissed", key: s.key, via: s.via });
			}
			return stay;
		case "listScrolled":
			if (s.kind === "warming") return to(COLD, cancelWarm);
			if (s.kind === "showing") {
				return s.via === "pointer" ? to(WARM) : to(s, { type: "reposition" });
			}
			return stay;
		case "dragStarted":
		case "menuOpened":
			if (s.kind === "warming") return to(COLD, cancelWarm);
			if (s.kind === "showing") return to(WARM);
			return stay;
		case "keysChanged": {
			const k = keyOf(s);
			if (k === null || e.keys.includes(k)) return stay;
			if (s.kind === "warming") return to(COLD, cancelWarm);
			return to(WARM);
		}
	}
	return stay;
}

/** The key whose flyout is visible, or null. */
export function flyoutKey(s: RailHoverState): string | null {
	return s.kind === "showing" ? s.key : null;
}

/**
 * Icon-only rails always show the flyout; a rail wide enough for names shows
 * it only for a name that is cut off.
 */
export function shouldShowFlyout({
	mode,
	truncated,
}: {
	mode: "icons" | "names";
	truncated: boolean;
}): boolean {
	return mode === "icons" || truncated;
}

/**
 * Whether a key's name counts as cut off for the flyout (I301). Cut off at
 * rest, or – while the hover-only close button covers the end of it – cut off
 * by the overlay. CSS `:hover` shows the ×, so only a pointer-opened flyout
 * at a width that has one (`showsCloseButton`) subtracts the overlay; a
 * keyboard-focus flyout never does.
 */
export function isLabelCut({
	scrollWidth,
	clientWidth,
	via,
	width,
}: {
	scrollWidth: number;
	clientWidth: number;
	via: RailHoverVia;
	width: number;
}): boolean {
	const covered =
		via === "pointer" && showsCloseButton(width) ? RAIL_CLOSE_OVERLAY_PX : 0;
	return scrollWidth > clientWidth - covered;
}
