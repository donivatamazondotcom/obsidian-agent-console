/**
 * I74: decision logic for the "Toggle active note in context" command
 * (command id `toggle-auto-mention`, kept stable so the user's hotkey survives).
 *
 * Active-note-scoped membership toggle: grab the active editor note into the
 * context strip, or ungrab it if already present. Scoping to the active note
 * keeps the target unambiguous when multiple pills exist.
 *
 * "Present" = the active note is committed OR currently showing as the dashed
 * provisional (auto-default) pill. Counting the provisional pill means a fresh
 * session's first press removes the note that already appears, rather than
 * grabbing/committing it.
 *
 * Pure branch/notice logic; the caller performs the add/remove side effects
 * and, on ungrab, also suppresses the per-chat auto-default so the ungrab sticks.
 */
import { MAX_CONTEXT_NOTES, type ContextNote } from "../types/context";

export type GrabToggleAction =
	| { kind: "none"; notice: string }
	| { kind: "full"; notice: string }
	| { kind: "grab"; path: string; notice: string }
	| { kind: "ungrab"; path: string; notice: string };

export function decideGrabToggle(args: {
	activeNotePath: string | null;
	activeNoteName: string | null;
	/** Committed pills (contextNotes.notes). */
	committed: ContextNote[];
	/** Active note shown as the provisional auto-default pill, or null. */
	provisionalPath: string | null;
}): GrabToggleAction {
	const { activeNotePath, activeNoteName, committed, provisionalPath } = args;
	const name = activeNoteName ?? "active note";

	if (!activeNotePath) {
		return { kind: "none", notice: "[Agent Console] No active note to grab" };
	}

	const isPresent =
		committed.some((n) => n.path === activeNotePath) ||
		provisionalPath === activeNotePath;

	// Ungrab is always allowed, even at the cap.
	if (isPresent) {
		return {
			kind: "ungrab",
			path: activeNotePath,
			notice: `[Agent Console] Removed "${name}" from context`,
		};
	}
	if (committed.length >= MAX_CONTEXT_NOTES) {
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
