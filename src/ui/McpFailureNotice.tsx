import * as React from "react";
import { useEffect, useState } from "react";

import type { McpAuthManager } from "../services/mcp-auth-manager";
import { t } from "../i18n";

interface McpFailureNoticeProps {
	manager: McpAuthManager;
	viewId: string;
}

/**
 * Kiro CLI V3 (S4): one notice at the top of a chat listing the MCP servers
 * that failed to connect for a reason other than sign-in, with the server's
 * own reason for each. Driven by `_kiro/mcp/status` snapshots, so it updates
 * in place and disappears when the servers connect. Dismissing hides this set
 * of failures until it changes. Sign-in failures use the sign-in notice.
 *
 * Spec: [[Kiro CLI V3 Support]] § S4.
 */
export function McpFailureNotice({ manager, viewId }: McpFailureNoticeProps) {
	const [failures, setFailures] = useState(() => manager.getFailures(viewId));

	useEffect(() => {
		setFailures(manager.getFailures(viewId));
		return manager.onChange(() => setFailures(manager.getFailures(viewId)));
	}, [manager, viewId]);

	if (failures.length === 0) return null;

	const names = failures.map((f) => f.serverName).join(", ");
	return (
		<div className="agent-client-mcp-failure-notice" role="status">
			<div className="agent-client-mcp-failure-notice-row">
				<span className="agent-client-mcp-failure-notice-title">
					{t("chat.mcpFailures.title", { names })}
				</span>
				<button
					type="button"
					className="agent-client-mcp-failure-notice-dismiss"
					onClick={() => manager.dismissFailures(viewId)}
				>
					{t("chat.mcpFailures.dismiss")}
				</button>
			</div>
			<details>
				<summary>{t("chat.mcpFailures.details")}</summary>
				<ul>
					{failures.map((f) => (
						<li key={f.serverName}>
							<strong>{f.serverName}</strong>
							{f.message ? ` – ${f.message}` : null}
						</li>
					))}
				</ul>
			</details>
		</div>
	);
}
