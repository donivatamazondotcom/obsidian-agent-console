/**
 * I282: tell "the agent rejected this session" apart from "the connection
 * failed", at the `acp/` edge so SDK error types never leave it.
 *
 * Agents answer a load of a session they don't have with a JSON-RPC error:
 * Kiro V2 and Codex `-32603`, Claude Code `-32002` (I264 probe, 2026-11-02).
 * The SDK rejects the request with a `RequestError` carrying that code. A
 * closed connection, a timeout or a spawn failure is a plain Error.
 */
import { describe, expect, it } from "vitest";
import { RequestError } from "@agentclientprotocol/sdk";
import { classifyLoadError } from "../load-error";

describe("I282 classifyLoadError", () => {
	it("an agent's not-found answer is a rejection", () => {
		expect(classifyLoadError(new RequestError(-32603, "Session not found"))).toBe(
			"rejected",
		);
		expect(classifyLoadError(new RequestError(-32002, "Resource not found"))).toBe(
			"rejected",
		);
		expect(classifyLoadError(new RequestError(-32602, "Invalid params"))).toBe(
			"rejected",
		);
	});

	it("auth, cancel and a closed connection are not a rejection", () => {
		expect(
			classifyLoadError(new RequestError(-32000, "Authentication required")),
		).toBe("transport");
		expect(classifyLoadError(new RequestError(-32800, "Request cancelled"))).toBe(
			"transport",
		);
		expect(classifyLoadError(new Error("ACP connection closed"))).toBe(
			"transport",
		);
		expect(classifyLoadError("weird")).toBe("transport");
	});
});
