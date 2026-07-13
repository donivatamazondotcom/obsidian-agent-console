/**
 * Params parsers for kiro-cli's `_kiro.dev/mcp/*` ACP extension
 * notifications. Passed to the SDK's custom-notification overload:
 * `onNotification(method, parser, handler)`.
 *
 * Trust-boundary rule: validate at the deserialize edge, throw on malformed
 * payloads (the SDK drops the notification), never silently coerce.
 */

/** ACP extension method: an MCP server needs the user to complete OAuth. */
export const MCP_OAUTH_REQUEST_METHOD = "_kiro.dev/mcp/oauth_request";

/** ACP extension method: an MCP server finished initializing. */
export const MCP_SERVER_INITIALIZED_METHOD = "_kiro.dev/mcp/server_initialized";

export interface McpOauthRequestParams {
	sessionId: string;
	serverName: string;
	oauthUrl: string;
}

export interface McpServerInitializedParams {
	sessionId: string;
	serverName: string;
}

function requireString(
	obj: Record<string, unknown>,
	key: string,
	method: string,
): string {
	const value = obj[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(
			`Malformed ${method} notification: missing or invalid "${key}"`,
		);
	}
	return value;
}

function asRecord(params: unknown, method: string): Record<string, unknown> {
	if (typeof params !== "object" || params === null) {
		throw new Error(
			`Malformed ${method} notification: params not an object`,
		);
	}
	return params as Record<string, unknown>;
}

export function parseMcpOauthRequest(params: unknown): McpOauthRequestParams {
	const obj = asRecord(params, MCP_OAUTH_REQUEST_METHOD);
	return {
		sessionId: requireString(obj, "sessionId", MCP_OAUTH_REQUEST_METHOD),
		serverName: requireString(obj, "serverName", MCP_OAUTH_REQUEST_METHOD),
		oauthUrl: requireString(obj, "oauthUrl", MCP_OAUTH_REQUEST_METHOD),
	};
}

export function parseMcpServerInitialized(
	params: unknown,
): McpServerInitializedParams {
	const obj = asRecord(params, MCP_SERVER_INITIALIZED_METHOD);
	return {
		sessionId: requireString(
			obj,
			"sessionId",
			MCP_SERVER_INITIALIZED_METHOD,
		),
		serverName: requireString(
			obj,
			"serverName",
			MCP_SERVER_INITIALIZED_METHOD,
		),
	};
}
