import type { MessageContent } from "../types/chat";
import type { PendingMcpAuth } from "../types/mcp-auth";

/**
 * Decide whether a tool-call row gets the inline MCP re-auth affordance.
 *
 * Pure resolver (tagged union, total, never throws) per the repo's resolver
 * pattern. Detection is hint-grade string matching on auth-shaped error text
 * (spec decision 6): a false negative costs nothing — the sign-in Notice and
 * the "Re-authenticate MCP servers" command still exist — so patterns stay
 * conservative to avoid false positives on ordinary failures.
 */
export type McpAuthAffordance =
	| { kind: "none" }
	| {
			/** A sign-in is already pending — offer its URL directly. */
			kind: "sign_in";
			entry: PendingMcpAuth;
	  }
	| {
			/** Auth-shaped failure but no pending sign-in (e.g. expired
			 * token mid-session) — offer the re-authenticate command. */
			kind: "reauthenticate";
	  };

const AUTH_ERROR_PATTERNS: RegExp[] = [
	/auth required/i,
	/authentication (?:required|failed|expired)/i,
	/\bunauthorized\b/i,
	/\bunauthenticated\b/i,
	/token (?:is )?(?:expired|invalid)/i,
	/invalid[_ ]token/i,
	/\bHTTP 401\b/,
	/\(401\)/,
];

type ToolCallContent = Extract<MessageContent, { type: "tool_call" }>;

/** Collect the text surfaces an auth error could appear in. */
function errorText(content: ToolCallContent): string {
	const parts: string[] = [];
	if (content.title) parts.push(content.title);
	if (content.rawOutput) {
		try {
			parts.push(JSON.stringify(content.rawOutput));
		} catch {
			// Circular rawOutput — skip it; the title may still match.
		}
	}
	return parts.join("\n");
}

export function decideMcpAuthAffordance(
	content: ToolCallContent,
	pending: PendingMcpAuth[],
): McpAuthAffordance {
	if (content.status !== "failed") return { kind: "none" };

	const text = errorText(content);
	if (!AUTH_ERROR_PATTERNS.some((p) => p.test(text))) {
		return { kind: "none" };
	}

	// Prefer the pending server whose name appears in the tool title
	// (kiro titles MCP tools like "sheets · read_values").
	const title = content.title ?? "";
	const named = pending.find((p) => title.includes(p.serverName));
	if (named) return { kind: "sign_in", entry: named };

	// Unambiguous single pending sign-in — offer it.
	if (pending.length === 1) return { kind: "sign_in", entry: pending[0] };

	return { kind: "reauthenticate" };
}
