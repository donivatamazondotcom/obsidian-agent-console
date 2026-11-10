import * as React from "react";
import { useRef, useEffect } from "react";
import { setIcon } from "obsidian";
import { useTooltip } from "./useTooltip";
import { t } from "../../i18n";
import type { AttachIntake, I18nText } from "../../resolvers/attach-intake";

type VisibleIntake = Exclude<AttachIntake, { kind: "hidden" }>;

function text(i: I18nText | null): string | null {
	return i === null ? null : t(i.key, i.params);
}

/**
 * The composer's paperclip ([[Agent Console Attachment Button]]).
 *
 * A native `<button class="clickable-icon">` so Obsidian's focus ring and
 * Enter/Space activation come for free. When it can't attach (queued, full)
 * it stays focusable with `aria-disabled` and keeps its reason in its name,
 * instead of the native `disabled` attribute, which would drop it out of the
 * Tab order and hide the reason from keyboard users. Its tooltip and name come
 * from `deriveAttachIntake`; `onActivate` only fires when the intake is open.
 */
export function AttachButton({
	intake,
	onActivate,
}: {
	intake: VisibleIntake;
	onActivate: () => void;
}) {
	const ref = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "paperclip");
	}, []);
	// Opens to the left: below would cover Send (the composer rail sits
	// directly above it).
	useTooltip(ref, {
		visibleLabel: text(intake.tooltip.visibleLabel),
		reason: text(intake.tooltip.reason),
		placement: "left",
	});
	const disabled = intake.kind !== "open";
	return (
		<button
			ref={ref}
			type="button"
			// keep in sync with FOCUS_CLUSTER_ATTR (composer-focus-tracker)
			data-acp-focus-cluster=""
			className={`clickable-icon agent-client-attach-button${disabled ? " agent-client-disabled" : ""}`}
			aria-disabled={disabled ? "true" : undefined}
			onClick={() => {
				if (!disabled) onActivate();
			}}
		/>
	);
}
