/**
 * Pure builder for the title and body of the system notification fired when an
 * agent finishes a turn.
 *
 * Extracted from ChatPanel's turn-end effect so the title/body logic is
 * unit-testable. The notification's tag is not built here: the notification
 * registry assigns a fresh tag to every notification (I52 round 9). See
 * [[Agent Console Rich Completion Notifications]].
 *
 * Title carries the tab label so a user running several tabs in parallel sees
 * WHICH tab finished without scanning the tab strip. The tab label already
 * reflects the AI-suggested title / custom rename via the tab-label pipeline
 * (see [[ACP AI Session Rename]]).
 */

import { t } from "../i18n";

export interface CompletionNotificationInput {
	/**
	 * Displayed label of the tab that finished. When it is missing or blank,
	 * the title falls back to the plugin name.
	 */
	tabLabel?: string;
	/** Human-readable agent label, e.g. "Claude Code". */
	agentLabel: string;
}

export interface CompletionNotificationContent {
	title: string;
	body: string;
}

/** Fallback title when there is no usable tab label. */
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
	};
}
