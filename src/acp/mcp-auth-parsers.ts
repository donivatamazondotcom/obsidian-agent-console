/**
 * Params parsers for kiro-cli's `_kiro.dev/mcp/*` ACP extension
 * notifications. Passed to the SDK's custom-notification overload:
 * `onNotification(method, parser, handler)`.
 *
 * Trust-boundary rule: validate at the deserialize edge, throw on malformed
 * payloads (the SDK drops the notification), never silently coerce.
 */

import type { KiroMcpServerStatus } from "../types/mcp-auth";

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

// ============================================================================
// Kiro CLI V3 (S4)
// ============================================================================

/** V3 notification: a full per-session snapshot of every MCP server. */
export const KIRO_MCP_STATUS_METHOD = "_kiro/mcp/status";

/** V3 agent-to-client request: open a sign-in page. The server awaits it. */
export const KIRO_OPEN_EXTERNAL_URL_METHOD = "_kiro/openExternalUrl";

/**
 * V3 agent method: reconnect a server; `startOAuth` forces a fresh sign-in.
 * Implemented but not listed in `extensionMethods` (K7); called anyway, with a
 * plain-notice fallback if it fails (decision 2026-10-27).
 */
export const KIRO_MCP_RESET_SERVER_METHOD = "_kiro/mcp/resetServer";

export interface KiroMcpStatusParams {
	sessionId: string;
	servers: KiroMcpServerStatus[];
}

export interface OpenExternalUrlParams {
	url: string;
	serverName?: string;
}

const KNOWN_MCP_STATUSES = new Set<KiroMcpServerStatus["status"]>([
	"connecting",
	"connected",
	"failed",
	"disabled",
]);

/**
 * Keeps only what the plugin acts on. `authorizationUrl`, `_meta` (which
 * holds config file paths) and tool lists are dropped here, so they can't
 * reach state or logs. An entry without a usable name is dropped; the rest
 * of the snapshot still applies.
 */
export function parseKiroMcpStatus(params: unknown): KiroMcpStatusParams {
	const obj = asRecord(params, KIRO_MCP_STATUS_METHOD);
	if (typeof obj.sessionId !== "string") {
		throw new Error(
			`Malformed ${KIRO_MCP_STATUS_METHOD} notification: missing or invalid "sessionId"`,
		);
	}
	if (!Array.isArray(obj.servers)) {
		throw new Error(
			`Malformed ${KIRO_MCP_STATUS_METHOD} notification: "servers" is not an array`,
		);
	}
	const servers: KiroMcpServerStatus[] = [];
	for (const raw of obj.servers as unknown[]) {
		if (typeof raw !== "object" || raw === null) continue;
		const entry = raw as Record<string, unknown>;
		if (typeof entry.name !== "string" || entry.name.length === 0) continue;
		const status = KNOWN_MCP_STATUSES.has(entry.status as KiroMcpServerStatus["status"])
			? (entry.status as KiroMcpServerStatus["status"])
			: "unknown";
		servers.push({
			name: entry.name,
			status,
			// An abandoned sign-in times out as failedAuthorization: false but
			// keeps its authorizationUrl (live 2026-10-27): still needs sign-in.
			failedAuthorization:
				entry.failedAuthorization === true ||
				(status === "failed" &&
					typeof entry.authorizationUrl === "string" &&
					entry.authorizationUrl.length > 0),
			...(typeof entry.errorMessage === "string" &&
				entry.errorMessage.length > 0 && { errorMessage: entry.errorMessage }),
		});
	}
	return { sessionId: obj.sessionId, servers };
}

/** Only http(s) URLs; anything else is refused with a JSON-RPC error. */
export function parseOpenExternalUrl(params: unknown): OpenExternalUrlParams {
	const obj = asRecord(params, KIRO_OPEN_EXTERNAL_URL_METHOD);
	const url = requireString(obj, "url", KIRO_OPEN_EXTERNAL_URL_METHOD);
	let protocol: string;
	try {
		protocol = new URL(url).protocol;
	} catch {
		throw new Error(`Malformed ${KIRO_OPEN_EXTERNAL_URL_METHOD} request: "url" is not a URL`);
	}
	if (protocol !== "https:" && protocol !== "http:") {
		throw new Error(`Malformed ${KIRO_OPEN_EXTERNAL_URL_METHOD} request: unsupported URL scheme`);
	}
	return {
		url,
		...(typeof obj.serverName === "string" &&
			obj.serverName.length > 0 && { serverName: obj.serverName }),
	};
}
