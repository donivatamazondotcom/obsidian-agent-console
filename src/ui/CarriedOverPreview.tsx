import * as React from "react";
const { useState } = React;

import type { CarriedOverPreview as CarriedOverPreviewData } from "../services/carried-over-preview";
import { t } from "../i18n";

/**
 * Read-only block rendered at the top of a freshly-switched tab, showing the
 * conversation carried over from the previous agent ([[Agent-Portable
 * Sessions]]). It is NOT part of the message list — it's a distinct affordance
 * so the user can see what the new agent will receive as context on their first
 * send, without those turns counting as real messages.
 *
 * The collapse toggle is a native <button> so it gets the platform focus ring
 * and Enter/Space activation for free (keyboard-first tenet).
 */
export function CarriedOverPreview({ data }: { data: CarriedOverPreviewData }) {
	const [collapsed, setCollapsed] = useState(false);

	return (
		<div
			className="agent-client-carried-over"
			role="region"
			aria-label={t("chat.carriedOver.title", { agent: data.fromAgent })}
		>
			<button
				type="button"
				className="agent-client-carried-over-header"
				aria-expanded={!collapsed}
				onClick={() => setCollapsed((c) => !c)}
			>
				<span className="agent-client-carried-over-title">
					{t("chat.carriedOver.title", { agent: data.fromAgent })}
				</span>
				<span className="agent-client-carried-over-toggle">
					{collapsed ? t("chat.carriedOver.show") : t("chat.carriedOver.hide")}
				</span>
			</button>
			{!collapsed && (
				<div className="agent-client-carried-over-body">
					{data.turns.map((turn, i) => (
						<div
							key={i}
							className="agent-client-carried-over-turn"
						>
							<span className="agent-client-carried-over-role">
								{turn.role === "user"
									? t("chat.carriedOver.you")
									: t("chat.carriedOver.assistant")}
							</span>
							<span className="agent-client-carried-over-text">
								{turn.text}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
