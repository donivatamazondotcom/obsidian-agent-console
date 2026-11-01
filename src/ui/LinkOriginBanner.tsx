import * as React from "react";
import { setIcon } from "obsidian";
import { t } from "../i18n";

/**
 * One-line "Opened by link · Agent: X · Mode: Y" banner for a tab whose agent
 * or mode was chosen by an `obsidian://agent-console` link. The plugin can't
 * tell which of an agent's modes is more permissive, so making the choice
 * visible is the guard. Shown until the user sends or dismisses.
 *
 * Spec: [[Agent Console Quick Prompt URIs]] § Behavior → No silent switch.
 */
export interface LinkOriginBannerProps {
	agentName: string;
	modeName?: string;
	onDismiss: () => void;
}

export function LinkOriginBanner({
	agentName,
	modeName,
	onDismiss,
}: LinkOriginBannerProps) {
	const iconRef = React.useRef<HTMLButtonElement>(null);
	React.useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, "x");
	}, []);

	const parts = [
		t("chat.quickPrompts.linkOrigin"),
		t("chat.quickPrompts.linkOriginAgent", { agent: agentName }),
		...(modeName ? [t("chat.quickPrompts.linkOriginMode", { mode: modeName })] : []),
	];
	const dismissLabel = t("chat.quickPrompts.linkOriginDismiss");

	return (
		<div className="agent-client-link-origin-banner" role="status">
			<span className="agent-client-link-origin-text">{parts.join(" · ")}</span>
			<button
				ref={iconRef}
				type="button"
				className="clickable-icon agent-client-link-origin-dismiss"
				aria-label={dismissLabel}
				onClick={onDismiss}
			/>
		</div>
	);
}
