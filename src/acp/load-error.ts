import { RequestError } from "@agentclientprotocol/sdk";

/**
 * I282: did the agent answer a `session/load` by rejecting the session, or
 * did the request never get a real answer?
 *
 * - `rejected`: the agent replied with a JSON-RPC error that means "I can't
 *   open that session". Kiro V2 and Codex send `-32603`, Claude Code `-32002`
 *   (I264 probe, 2026-11-02); `-32602` is a malformed or unknown id.
 * - `transport`: anything else: a closed connection, a timeout, an auth or
 *   cancel error, or a non-Error value. The session may still exist.
 *
 * Lives at the `acp/` edge so the SDK's error type never leaves it; callers
 * get a domain value.
 */
export type LoadErrorKind = "rejected" | "transport";

const SESSION_REJECTION_CODES: ReadonlySet<number> = new Set([
	-32603, -32602, -32002,
]);

export function classifyLoadError(error: unknown): LoadErrorKind {
	if (error instanceof RequestError && SESSION_REJECTION_CODES.has(error.code)) {
		return "rejected";
	}
	return "transport";
}
