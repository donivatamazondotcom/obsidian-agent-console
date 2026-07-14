/**
 * Domain events for MCP server authentication, normalized from kiro-cli's
 * `_kiro.dev/mcp/*` ACP extension notifications at the acp/ boundary.
 *
 * These are connection-scoped (not transcript-scoped): they flow through a
 * dedicated listener channel on AcpClient/AcpHandler, NOT through
 * emitSessionUpdate — the session-id filter there (I108) would drop an
 * oauth_request that arrives before `session/new` resolves.
 *
 * Wire contract (verified against live kiro-cli 2.12.2, 2026-07-13):
 * - `_kiro.dev/mcp/oauth_request`      { sessionId, serverName, oauthUrl }
 * - `_kiro.dev/mcp/server_initialized` { sessionId, serverName }
 *
 * See 04-initiatives/Agent Console/MCP OAuth Prompt Surfacing.md.
 */
export type McpAuthEvent =
	| {
			kind: "oauth_request";
			sessionId: string;
			serverName: string;
			/** Full authorization URL (PKCE + state baked in by kiro-cli). */
			oauthUrl: string;
	  }
	| {
			kind: "server_initialized";
			sessionId: string;
			serverName: string;
	  };

/** A server currently waiting for the user to complete sign-in. */
export interface PendingMcpAuth {
	serverName: string;
	oauthUrl: string;
	/** Hostname of the authorization URL, shown for informed consent. */
	host: string;
	/** Epoch ms when the sign-in request arrived. */
	receivedAt: number;
}
