/**
 * I74: decision logic for the "Toggle active note in context" command
 * (command id `toggle-auto-mention`, kept stable so the user's hotkey survives).
 *
 * The hotkey is an active-note-scoped membership toggle: it grabs the active
 * editor note into the context strip, or ungrabs it if already present. Scoping
 * to the active note keeps the target unambiguous when multiple pills exist —
 * the hotkey only ever touches the note currently active in the editor.
 *
 * Pure branch/notice logic; the caller performs the add/remove side effects and,
 * on ungrab, also suppresses the per-chat auto-default so the ungrab sticks.
 */
import { MAX_CONTEXT_NOTES } from "../types/context";

export type GrabToggleAction =
	| { kind: "none"; notice: string }
	| { kind: "full"; notice: string }
	| { kind: "grab"; path: string; notice: string }
	| { kind: "ungrab"; path: string; notice: string };

export function decideGrabToggle(args: {
	activeNotePath: string | null;
	activeNoteName: string | null;
	isPresent: boolean;
	isFull: boolean;
}): GrabToggleAction {
	const { activeNotePath, activeNoteName, isPresent, isFull } = args;
	const name = activeNoteName ?? "active note";

	if (!activeNotePath) {
		return { kind: "none", notice: "[Agent Console] No active note to grab" };
	}
	// Ungrab is always allowed, even at the cap.
	if (isPresent) {
		return {
			kind: "ungrab",
			path: activeNotePath,
			notice: `[Agent Console] Removed "${name}" from context`,
		};
	}
	if (isFull) {
		return {
			kind: "full",
			notice: `[Agent Console] Context is full (${MAX_CONTEXT_NOTES} notes) — remove one to add another`,
		};
	}
	return {
		kind: "grab",
		path: activeNotePath,
		notice: `[Agent Console] Added "${name}" to context`,
	};
}
