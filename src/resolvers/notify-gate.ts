/**
 * `shouldNotifySystem` — the single pure resolver deciding whether a
 * system (OS) notification should fire for a backgrounded chat panel.
 *
 * WHY THIS EXISTS (I168)
 * Both notification sites in ChatPanel (turn-completion and permission-request)
 * gated on a single instantaneous read: `!activeDocument.hasFocus()`. That read
 * is unreliable in a backgrounded Obsidian window: around React commit moments
 * `document.hasFocus()` can transiently report `true` even though the window is
 * genuinely hidden (`visibilityState === "hidden"`). The permission
 * notification lost this race repeatedly — the transition to `hasActivePermission`
 * coincides with permission-banner mount + programmatic composer focus, so the
 * gate read `true` and suppressed the notification, while the completion
 * notification (turn-end, no coincident focus flip) survived the same gate. The
 * symptom looked permission-specific but the defect is the gate. (See
 * [[I168 Permission-request notification not firing]].)
 *
 * DESIGN
 * `visibilityState === "hidden"` is the robust, OS-backed signal that the window
 * is not on screen — it does not flip around focus/commit churn the way
 * `hasFocus()` does. A hidden window should ALWAYS notify. `hasFocus` remains as
 * the secondary branch for the visible-but-unfocused case (two windows visible
 * side by side, this one not focused). Notify when EITHER says the user isn't
 * looking:
 *
 *   notify  ⇔  visibilityState === "hidden"  ||  !hasFocus
 *
 * Pure and total: no DOM reads inside, both inputs injected by the caller from
 * the owning document (`document.visibilityState`, `document.hasFocus()`), so it
 * is exhaustively unit-testable and shared by both notification sites.
 */
export interface SystemNotifyInput {
	/** The owning document's `visibilityState` at the moment of the decision. */
	visibilityState: DocumentVisibilityState;
	/** The owning document's `hasFocus()` at the moment of the decision. */
	hasFocus: boolean;
	/** The user's `enableSystemNotifications` setting. */
	enabled: boolean;
}

export function shouldNotifySystem(input: SystemNotifyInput): boolean {
	if (!input.enabled) return false;
	// A hidden window always notifies — the robust OS signal, immune to the
	// hasFocus() commit-time race (I168). Otherwise fall back to focus for the
	// visible-but-unfocused side-by-side case.
	return input.visibilityState === "hidden" || !input.hasFocus;
}
