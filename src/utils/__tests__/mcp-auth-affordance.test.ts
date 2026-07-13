/**
 * T06 — inline re-auth affordance resolver.
 * Spec: 04-initiatives/Agent Console/MCP OAuth Prompt Surfacing.md
 */
import { describe, expect, it } from "vitest";

import { decideMcpAuthAffordance } from "../mcp-auth-affordance";
import type { MessageContent } from "../../types/chat";
import type { PendingMcpAuth } from "../../types/mcp-auth";

type ToolCall = Extract<MessageContent, { type: "tool_call" }>;

function toolCall(overrides: Partial<ToolCall>): ToolCall {
	return {
		type: "tool_call",
		toolCallId: "tc-1",
		status: "failed",
		...overrides,
	};
}

const pendingSheets: PendingMcpAuth = {
	serverName: "sheets",
	oauthUrl: "https://accounts.google.com/auth",
	host: "accounts.google.com",
	receivedAt: 0,
};

const pendingDrive: PendingMcpAuth = {
	serverName: "drive",
	oauthUrl: "https://accounts.google.com/auth2",
	host: "accounts.google.com",
	receivedAt: 1,
};

describe("decideMcpAuthAffordance (T06)", () => {
	it("non-failed tool calls never get the affordance", () => {
		const result = decideMcpAuthAffordance(
			toolCall({
				status: "completed",
				rawOutput: { error: "Auth required" },
			}),
			[pendingSheets],
		);
		expect(result.kind).toBe("none");
	});

	it("failed without auth-shaped error text gets none", () => {
		const result = decideMcpAuthAffordance(
			toolCall({ rawOutput: { error: "file not found" } }),
			[pendingSheets],
		);
		expect(result.kind).toBe("none");
	});

	it("auth-shaped failure + pending server named in title → sign_in for that server", () => {
		const result = decideMcpAuthAffordance(
			toolCall({
				title: "sheets \u00B7 read_values",
				rawOutput: { error: "Auth required" },
			}),
			[pendingDrive, pendingSheets],
		);
		expect(result).toEqual({ kind: "sign_in", entry: pendingSheets });
	});

	it("auth-shaped failure + single pending → sign_in even without title match", () => {
		const result = decideMcpAuthAffordance(
			toolCall({
				title: "some_tool",
				rawOutput: { error: "HTTP 401 unauthorized" },
			}),
			[pendingSheets],
		);
		expect(result).toEqual({ kind: "sign_in", entry: pendingSheets });
	});

	it("auth-shaped failure + no pending → reauthenticate (expired-token path)", () => {
		const result = decideMcpAuthAffordance(
			toolCall({ rawOutput: { error: "token expired" } }),
			[],
		);
		expect(result.kind).toBe("reauthenticate");
	});

	it("auth-shaped failure + multiple pending, none named → reauthenticate", () => {
		const result = decideMcpAuthAffordance(
			toolCall({
				title: "unrelated_tool",
				rawOutput: { error: "authentication failed" },
			}),
			[pendingSheets, pendingDrive],
		);
		expect(result.kind).toBe("reauthenticate");
	});

	it("is total: no title, no rawOutput → none, never throws", () => {
		expect(decideMcpAuthAffordance(toolCall({}), []).kind).toBe("none");
	});
});
