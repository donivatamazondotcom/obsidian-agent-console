/**
 * Pure builder for the system notification fired when an agent finishes a turn.
 *
 * Extracted from ChatPanel's turn-end effect so the title/body/tag logic is
 * unit-testable (the `Notification` effect itself is awkward to exercise in
 * jsdom). See [[Agent Console Rich Completion Notifications]].
 *
 * Title carries the tab label so a user running several tabs in parallel sees
 * WHICH tab finished without scanning the tab strip. The tab label already
 * reflects the AI-suggested title / custom rename via the tab-label pipeline
 * (see [[ACP AI Session Rename]]).
 */

import { t } from "../i18n";

export interface CompletionNotificationInput {
	/**
	 * Displayed label of the tab that finished. Undefined for a floating chat
	 * (no tab) — the title falls back to the plugin name.
	 */
	tabLabel?: string;
	/** Human-readable agent label, e.g. "Claude Code". */
	agentLabel: string;
	/**
	 * Stable per-tab id. Used as the Notification `tag` so two tabs finishing
	 * back-to-back produce distinct notifications instead of the OS coalescing
	 * them into one.
	 */
	tabId: string;
}

export interface CompletionNotificationContent {
	title: string;
	body: string;
	tag: string;
}

/** Fallback title when there is no tab label (e.g. a floating chat). */
export const COMPLETION_NOTIFICATION_FALLBACK_TITLE = "Agent Console";

export function buildCompletionNotificationContent(
	input: CompletionNotificationInput,
): CompletionNotificationContent {
	const label = input.tabLabel?.trim();
	const title =
		label && label.length > 0
			? label
			: COMPLETION_NOTIFICATION_FALLBACK_TITLE;
	return {
		title,
		body: t("chat.notifications.responseComplete", {
			agent: input.agentLabel,
		}),
		tag: input.tabId,
	};
}
