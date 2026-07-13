import React, { useEffect, useState } from "react";

import type AgentClientPlugin from "../plugin";
import type { MessageContent } from "../types/chat";
import { decideMcpAuthAffordance } from "../utils/mcp-auth-affordance";

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
						{`MCP server "${entry.serverName}" needs sign-in`}
					</div>
					<div className="agent-client-mcp-auth-banner-detail">
						{entry.host
							? `This tool failed because the server is not signed in. Opens ${entry.host}.`
							: "This tool failed because the server is not signed in."}
					</div>
				</div>
				<button
					type="button"
					className="mod-cta"
					onClick={() => manager.openSignIn(entry)}
				>
					Sign in
				</button>
			</div>
		);
	}

	return (
		<div className="agent-client-mcp-auth-banner">
			<div className="agent-client-mcp-auth-banner-text">
				<div className="agent-client-mcp-auth-banner-title">
					This looks like a sign-in problem
				</div>
				<div className="agent-client-mcp-auth-banner-detail">
					An MCP server may need to sign in again. Restart the session
					to get a fresh sign-in prompt.
				</div>
			</div>
			<button
				type="button"
				className="mod-cta"
				onClick={() => plugin.openMcpReauthentication()}
			>
				Re-authenticate
			</button>
		</div>
	);
}
