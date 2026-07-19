import React, { useEffect, useState } from "react";

import type AgentClientPlugin from "../plugin";
import type { MessageContent } from "../types/chat";
import { decideMcpAuthAffordance } from "../utils/mcp-auth-affordance";
import { t } from "../i18n";

interface McpAuthBannerProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
}

/**
 * Inline re-auth affordance under an auth-failed tool call — the
 * moment-of-need bridge between "this tool failed" and "here's how to fix
 * it". Same interactive-transcript shape as PermissionBanner.
 *
 * Renders nothing unless decideMcpAuthAffordance says otherwise.
 * See MCP OAuth Prompt Surfacing spec (UX review finding: moment of need).
 */
export function McpAuthBanner({ content, plugin }: McpAuthBannerProps) {
	const manager = plugin.mcpAuthManager;
	const [pending, setPending] = useState(() => manager.getPending());

	useEffect(() => {
		return manager.onChange(() => setPending(manager.getPending()));
	}, [manager]);

	const affordance = decideMcpAuthAffordance(content, pending);
	if (affordance.kind === "none") return null;

	if (affordance.kind === "sign_in") {
		const { entry } = affordance;
		return (
			<div className="agent-client-mcp-auth-banner">
				<div className="agent-client-mcp-auth-banner-text">
					<div className="agent-client-mcp-auth-banner-title">
						{t("notices.mcpNeedsSignInTitle", { server: entry.serverName })}
					</div>
					<div className="agent-client-mcp-auth-banner-detail">
						{entry.host
							? t("chat.mcpBanner.toolFailedOpens", {
									host: entry.host,
								})
							: t("chat.mcpBanner.toolFailed")}
					</div>
				</div>
				<button
					type="button"
					className="mod-cta"
					onClick={() => manager.openSignIn(entry)}
				>
					{t("notices.mcpSignIn")}
				</button>
			</div>
		);
	}

	return (
		<div className="agent-client-mcp-auth-banner">
			<div className="agent-client-mcp-auth-banner-text">
				<div className="agent-client-mcp-auth-banner-title">
					{t("chat.mcpBanner.looksLikeSignIn")}
				</div>
				<div className="agent-client-mcp-auth-banner-detail">
					{t("chat.mcpBanner.mayNeedSignIn")}
				</div>
			</div>
			<button
				type="button"
				className="mod-cta"
				onClick={() => plugin.openMcpReauthentication()}
			>
				{t("chat.mcpBanner.reauthenticate")}
			</button>
		</div>
	);
}
