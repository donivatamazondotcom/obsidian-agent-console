import * as React from "react";
import { t } from "../i18n";

/**
 * Lossy-fallback notice for sessions recovered via client-side replay.
 *
 * Per [[ACP Tab Persistence Across Restarts]] § Decisions #7 + #11:
 * when `session/load(sessionId)` fails for a restored tab, the plugin
 * automatically falls through to `session/new` and replays the prior
 * conversation as a synthetic context block. The new session does not
 * have the original session's agent-internal state (tool-state, model
 * memory, internal reasoning) — it only has a transcript.
 *
 * This component renders a one-time inline notice above the agent's
 * first response after such a recovery, telling the user the new
 * session is reconstructed from history and may be lossy. The notice
 * is non-dismissible and is persisted in message history (so re-opens
 * still show it at the original recovery point).
 *
 * Decision #11 (2026-05-24) settled:
 * - Single one-time inline notice (not a persistent UI element)
 * - Callout-style block, info-icon prefixed, bordered styling
 * - Non-dismissible (scrolls away with the conversation naturally)
 * - Persisted in local message history
 * - Tab visual state stays standard `ready` — no `ready-restored` variant
 *
 * Slice 6 of [[ACP Tab Persistence Across Restarts]]. Pure presentational
 * component — no state, no effects. Integration (rendering inside
 * MessageList above the first post-recovery agent message) is the
 * subsequent integration step.
 *
 * Tests: src/ui/__tests__/LossyFallbackNotice.test.tsx (U61–U68).
 */

/**
 * The notice's user-facing copy. Exported so test code imports it as a
 * constant rather than duplicating the string literal — the import IS
 * the verbatim-copy guarantee that U63 demands. Any future copy edit
 * must flow through this single source.
 *
 * Source: spec § Decisions #11 (2026-05-24).
 */
export function lossyFallbackNoticeCopy(): string {
	return `ℹ️ ${t("chat.lossyFallback.title")} — ${t("chat.lossyFallback.body")}`;
}

export interface LossyFallbackNoticeProps {
	/**
	 * True when the parent session was recovered via client-side replay
	 * (the `session/load` failure path). Render the notice in this case
	 * so the user understands the new session is reconstructed.
	 *
	 * False (or absent for normal sessions): render nothing.
	 */
	isFallbackRecovery: boolean;
}

/**
 * Renders the lossy-fallback notice when `isFallbackRecovery` is true.
 * Returns `null` otherwise — the absence of a session-recovery context
 * is the common case and the component should be cheap to mount in
 * every message list.
 *
 * The literal `ℹ️` sigil at the start of the copy serves as the
 * info-icon prefix (matches the spec's "info-icon prefixed" wording
 * without committing to a separate Lucide-icon child). The bordered
 * callout look is delivered via the `agent-client-fallback-notice`
 * className in `styles.css`.
 *
 * The `data-message-type="fallback-notice"` attribute is the stable
 * identity hook the integration layer uses when filtering / persisting
 * the notice in message history (per U67).
 */
export function LossyFallbackNotice({
	isFallbackRecovery,
}: LossyFallbackNoticeProps) {
	if (!isFallbackRecovery) {
		return null;
	}

	return (
		<div
			className="agent-client-fallback-notice"
			data-message-type="fallback-notice"
			role="status"
		>
			{"ℹ️ "}
			<strong>{t("chat.lossyFallback.title")}</strong>
			{` — ${t("chat.lossyFallback.body")}`}
		</div>
	);
}
