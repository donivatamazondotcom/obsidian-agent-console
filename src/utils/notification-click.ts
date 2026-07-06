/**
 * Pure orchestrator for a completion-notification click.
 *
 * Extracted from ChatPanel's turn-end effect so the click routing is
 * unit-testable (the `Notification` object and its `onclick` fire outside React
 * and are awkward to exercise in jsdom).
 *
 * Behavior: switch to the tab that produced the notification, then foreground
 * that tab's owning leaf/window via the Obsidian-sanctioned `revealLeaf` path
 * (injected as `revealOwningLeaf`). This resolves the I52 recurrence
 * (2026-07-06) where the click intermittently landed on the wrong vault window
 * because the only foregrounding mechanism was the race-prone Electron
 * `BrowserWindow.focus()`. See
 * [[I52 Notification click focuses wrong vault window]].
 */

export interface CompletionNotificationClickDeps {
	/** Stable id of the tab that produced the notification (ChatPanel viewId). */
	tabId: string;
	/** Switch to the producing tab. Absent for a floating chat (no tabs). */
	onSwitchToTab?: (tabId: string) => void;
	/**
	 * Foreground the owning leaf/window via Obsidian's `revealLeaf` +
	 * `setActiveLeaf({ focus: true })`. Runs after the tab switch so the correct
	 * tab is active when the leaf surfaces.
	 */
	revealOwningLeaf: () => void;
}

export function runCompletionNotificationClick(
	deps: CompletionNotificationClickDeps,
): void {
	deps.onSwitchToTab?.(deps.tabId);
	deps.revealOwningLeaf();
}
