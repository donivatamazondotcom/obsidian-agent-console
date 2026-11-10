/**
 * `deriveAttachIntake` — may the composer take files right now?
 *
 * One decision read by every way a file gets in or out of the composer: the
 * attach button, the drop target, paste's file branch, and the attachment
 * remove buttons ([[Agent Console Attachment Button]] § Resolvers). They must
 * agree, because they disagreed once (I319):
 *
 *   A queued message keeps a copy of the attachments it had when it was
 *   queued, and when it sends, the composer is cleared first. So a file added
 *   while queued showed in the strip, was never sent, and was then deleted;
 *   a file removed while queued left the strip but was sent anyway.
 *   `locked` closes every one of those doors at once.
 *
 * The tooltip halves are part of the decision so the button's accessible
 * name is decided (and tested) here, not at the call site. The button is
 * icon-only, so when it is open its label travels as the reason (an
 * icon-only control's reason IS its name, see `deriveTooltipText`); when it
 * is disabled the label stays as the visible label and the reason explains
 * why.
 *
 * Connection-state independent (tenet: gate on data + intent). Pure, total.
 */
import type { TranslationKey } from "../i18n";

/** A catalog string plus its params; the caller resolves it with `t()`. */
export interface I18nText {
	key: TranslationKey;
	params?: Record<string, string | number>;
}

/** The two halves `deriveTooltipText` composes. */
export interface AttachTooltip {
	visibleLabel: I18nText | null;
	reason: I18nText;
}

export interface AttachIntakeInput {
	/** From `deriveComposerAffordances` — false on the zero-tab landing. */
	showAttachButton: boolean;
	/** A message (or held action) is queued; the composer is locked. */
	isQueued: boolean;
	attachedCount: number;
	maxCount: number;
}

export type AttachIntake =
	/** No attach affordance on this surface. */
	| { kind: "hidden" }
	/** Files may be added and removed. */
	| { kind: "open"; tooltip: AttachTooltip }
	/** Queued: nothing may be added or removed (I319). */
	| { kind: "locked"; tooltip: AttachTooltip }
	/** At the limit: nothing may be added; removing still works. */
	| { kind: "full"; tooltip: AttachTooltip };

const ATTACH_FILES: I18nText = { key: "chat.composer.attachFiles" };

export function deriveAttachIntake(input: AttachIntakeInput): AttachIntake {
	if (!input.showAttachButton) return { kind: "hidden" };
	if (input.isQueued) {
		return {
			kind: "locked",
			tooltip: {
				visibleLabel: ATTACH_FILES,
				reason: { key: "chat.composer.attachLockedReason" },
			},
		};
	}
	if (input.attachedCount >= input.maxCount) {
		return {
			kind: "full",
			tooltip: {
				visibleLabel: ATTACH_FILES,
				reason: {
					key: "chat.composer.attachFullReason",
					params: { count: input.maxCount },
				},
			},
		};
	}
	return {
		kind: "open",
		tooltip: { visibleLabel: null, reason: ATTACH_FILES },
	};
}
