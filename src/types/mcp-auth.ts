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
 * Kiro CLI V3 (verified against 2.34.3-nightly.3, 2026-10-27):
 * - `_kiro/mcp/status` (notification)  { sessionId, servers[] }, a full
 *   per-session snapshot; normalized to `status_snapshot`
 * - `_kiro/openExternalUrl` (request)  { url, serverName? }; normalized to
 *   `open_external_url`
 *
 * See 04-initiatives/Agent Console/MCP OAuth Prompt Surfacing.md and
 * Kiro CLI V3 Support.md (S4).
 */

/** One server in a V3 `_kiro/mcp/status` snapshot, URLs and `_meta` dropped. */
export interface KiroMcpServerStatus {
	name: string;
	/** `unknown` is a status this build doesn't know; never acted on. */
	status: "connecting" | "connected" | "failed" | "disabled" | "unknown";
	/** True when the server failed because it needs the user to sign in. */
	failedAuthorization: boolean;
	/** Server-written reason for a failure. Shown to the user; never logged. */
	errorMessage?: string;
}

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
	  }
	| {
			kind: "status_snapshot";
			sessionId: string;
			servers: KiroMcpServerStatus[];
	  }
	| {
			kind: "open_external_url";
			/** Fresh authorization URL. Never logged. */
			url: string;
			serverName?: string;
	  };

/** A server currently waiting for the user to complete sign-in. */
export interface PendingMcpAuth {
	serverName: string;
	/**
	 * Authorization URL. Absent on V3 until the server sends one
	 * (`_kiro/openExternalUrl`); Sign in then starts it through resetServer.
	 */
	oauthUrl?: string;
	/** Hostname of the authorization URL, shown for informed consent. */
	host: string;
	/** Epoch ms when the sign-in request arrived. */
	receivedAt: number;
	/** V3: resetServer failed, so in-app sign-in isn't possible for this server. */
	signInUnavailable?: boolean;
}
