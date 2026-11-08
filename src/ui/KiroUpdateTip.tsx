import * as React from "react";
import { useSyncExternalStore } from "react";

import { t } from "../i18n";
import { deriveKiroUpdateTip } from "../resolvers/kiro-update-tip";
import type { KiroEngineFallback } from "../types/session";

/** The slice of SettingsService the tip reads and writes. */
export interface KiroUpdateTipStore {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => { kiroV3UpdateTipDismissed?: boolean };
	updateSettings: (updates: { kiroV3UpdateTipDismissed: boolean }) => Promise<void>;
}

interface KiroUpdateTipProps {
	store: KiroUpdateTipStore;
	fallback: KiroEngineFallback | undefined;
	/** The agent's display name. */
	agentName: string;
}

const BENEFITS = [
	"chat.kiroUpdateTip.benefitAgents",
	"chat.kiroUpdateTip.benefitHooks",
	"chat.kiroUpdateTip.benefitMcp",
	"chat.kiroUpdateTip.benefitNewChat",
	"chat.kiroUpdateTip.benefitAlwaysAllow",
] as const;

/**
 * I302: at the top of a chat whose Default Kiro engine fell back to V2
 * because the kiro-cli is too old for V3. Says what V3 gives after
 * `kiro-cli update`. "Got it" hides it for this install, in every tab.
 *
 * Subscribes to the one flag (a primitive snapshot), so per-turn settings
 * saves don't re-render it inside MessageList's streaming renders.
 *
 * Spec: [[I302 Default Kiro engine on an older kiro-cli errors instead of running V2]] § 4.
 */
export function KiroUpdateTip({ store, fallback, agentName }: KiroUpdateTipProps) {
	const dismissed = useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot().kiroV3UpdateTipDismissed === true,
		() => store.getSnapshot().kiroV3UpdateTipDismissed === true,
	);
	if (deriveKiroUpdateTip({ fallback, dismissed }).kind === "hidden") return null;

	const [before, after] = t("chat.kiroUpdateTip.body", {
		agent: agentName,
		command: "\u0000",
	}).split("\u0000");
	return (
		<div className="agent-client-kiro-update-tip" role="status">
			<div className="agent-client-kiro-update-tip-row">
				<span className="agent-client-kiro-update-tip-title">
					{t("chat.kiroUpdateTip.title")}
				</span>
				<button
					type="button"
					className="agent-client-kiro-update-tip-dismiss"
					onClick={() => {
						void store.updateSettings({ kiroV3UpdateTipDismissed: true });
					}}
				>
					{t("chat.kiroUpdateTip.dismiss")}
				</button>
			</div>
			<p className="agent-client-kiro-update-tip-body">
				{before}
				<code>kiro-cli update</code>
				{after}
			</p>
			<ul>
				{BENEFITS.map((key) => (
					<li key={key}>{t(key)}</li>
				))}
			</ul>
		</div>
	);
}
