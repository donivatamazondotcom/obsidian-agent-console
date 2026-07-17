/**
 * SessionDispatchPort (D8/D13) — the minimal detached-send seam for
 * agent-emitted interactive prompts (and, later, anything else that needs a
 * composer-independent send).
 *
 * WHY NOT THE QUICK-PROMPT BRIDGE
 * `QuickPromptComposerBridge.fireOrQueue` clears the composer on send and
 * SEEDS it on queue (the queue's Edit flow treats the composer as source of
 * truth) — reusing it for A2UI actions would clobber unsent drafts or dump
 * action JSON into the composer. This port has no composer dependencies at
 * the type level, so that hazard is unrepresentable. The bridge's send leg
 * can later be refactored ONTO this port without behavior change (optional
 * hygiene per the spec's § Quick Prompts bridge).
 *
 * ENABLEMENT (D7)
 * `canSendNow` = the tab is live (ready — not busy/permission/streaming),
 * nothing is queued, and history isn't restoring. Actions never queue and
 * never trigger lazy acquisition: a surface control that cannot dispatch
 * immediately renders disabled with a reason instead
 * (`deriveSurfaceActionAffordance`). Both read the same underlying state so
 * the render-side and dispatch-side decisions cannot drift.
 *
 * Pure over injected thunks — no React, no Obsidian imports.
 */
import type { TabSessionState } from "../hooks/useTabSessionState";
import { t } from "../i18n";

export interface SessionDispatchPortDeps {
	/** Per-tab lazy session state (thunk — always fresh). */
	lazyState: () => TabSessionState;
	/** A turn is currently streaming. */
	isSending: () => boolean;
	/** The queue-of-one slot is occupied. */
	isQueued: () => boolean;
	/** Session history is being restored/loaded. */
	isRestoringSession: () => boolean;
	/** Dispatch text through the tab's normal send path (composer-neutral). */
	sendMessage: (text: string) => Promise<void>;
	/** Show a transient notice. */
	notify: (message: string) => void;
}

export interface SessionDispatchPort {
	/** Can a detached send dispatch immediately? (D7: idle-only, never queue.) */
	canSendNow(): boolean;
	/**
	 * Send `text` to the source session without reading or writing composer
	 * state. Resolves true on successful dispatch, false when refused
	 * (cannot send now) or when the underlying send fails — the caller
	 * re-enables its surface on false (T11).
	 */
	sendDetached(text: string): Promise<boolean>;
	/** Surface a transient message to the user. */
	notify(message: string): void;
}

export function createSessionDispatchPort(
	deps: SessionDispatchPortDeps,
): SessionDispatchPort {
	const canSendNow = (): boolean =>
		deps.lazyState() === "ready" &&
		!deps.isSending() &&
		!deps.isQueued() &&
		!deps.isRestoringSession();

	return {
		canSendNow,
		sendDetached: async (text: string): Promise<boolean> => {
			if (!canSendNow()) {
				deps.notify(t("notices.cantSendNow"));
				return false;
			}
			try {
				await deps.sendMessage(text);
				return true;
			} catch {
				return false;
			}
		},
		notify: (message: string) => deps.notify(message),
	};
}
