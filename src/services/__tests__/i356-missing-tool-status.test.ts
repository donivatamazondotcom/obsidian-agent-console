/**
 * I356 — a tool-call update with no status turned a finished row back to
 * pending.
 *
 * ACP makes `status` optional on `tool_call_update`. AcpHandler and
 * message-state both turned a missing status into `pending`, and the merge
 * took it over `completed` or `failed`. Codex sends a status-less update per
 * output chunk, PermissionManager sends one when a permission is answered
 * and when the next request activates, and Kiro V3 re-sends terminal content.
 *
 * Seam (R2): the handler's `sessionUpdate` as the SDK calls it, and
 * `applySingleUpdate`, the one place updates enter message state. Only the
 * SDK connection is stubbed (R4). Assertions are on the emitted update and
 * the row's status, and on the sign-in banner decision (R3).
 *
 * Spec: [[I356 A tool-call update with no status turns a finished row back to pending]].
 */
import { describe, expect, it, vi } from "vitest";

import { AcpClient } from "../../acp/acp-client";
import { applySingleUpdate, createStreamContinuity } from "../message-state";
import { decideMcpAuthAffordance } from "../../utils/mcp-auth-affordance";
import type AgentClientPlugin from "../../plugin";
import type { ChatMessage, MessageContent } from "../../types/chat";
import type { SessionUpdate } from "../../types/session";
import type { PendingMcpAuth } from "../../types/mcp-auth";

const tool = (
	type: "tool_call" | "tool_call_update",
	fields: Record<string, unknown> = {},
): SessionUpdate =>
	({ type, sessionId: "s1", toolCallId: "tc1", ...fields }) as SessionUpdate;

function run(updates: SessionUpdate[]): ChatMessage[] {
	const index = new Map<string, number>();
	const continuity = createStreamContinuity();
	let messages: ChatMessage[] = [];
	for (const u of updates) messages = applySingleUpdate(messages, u, index, continuity);
	return messages;
}

type ToolItem = Extract<MessageContent, { type: "tool_call" }>;

function theTool(messages: ChatMessage[]): ToolItem {
	const t = messages.flatMap((m) => m.content).find((c) => c.type === "tool_call");
	if (!t || t.type !== "tool_call") throw new Error("no tool call");
	return t;
}

describe("I356: an update with no status keeps the row's status", () => {
	it("completed, then a status-less update: still completed", () => {
		const m = run([
			tool("tool_call", { status: "in_progress" }),
			tool("tool_call_update", { status: "completed" }),
			tool("tool_call_update", { content: [{ type: "terminal", terminalId: "t1" }] }),
		]);
		expect(theTool(m).status).toBe("completed");
	});

	it("failed, then a content-only update: still failed, sign-in banner kept", () => {
		const m = run([
			tool("tool_call", { status: "in_progress", title: "Running: @sheets/get" }),
			tool("tool_call_update", { status: "failed" }),
			tool("tool_call_update", { rawOutput: { note: "more" } }),
		]);
		const t = theTool(m);
		expect(t.status).toBe("failed");
		const pending = [{ serverName: "sheets", oauthUrl: "https://x" }] as PendingMcpAuth[];
		expect(decideMcpAuthAffordance(t, pending).kind).toBe("sign_in");
	});

	it("a status-less update for an unseen id creates a pending row", () => {
		const m = run([tool("tool_call_update", { title: "x" })]);
		expect(theTool(m).status).toBe("pending");
	});

	it("AcpHandler passes a missing status through as missing", async () => {
		const plugin = {
			settings: { autoAllowPermissions: false },
			manifest: { version: "0.0.0-test" },
		} as unknown as AgentClientPlugin;
		const client = new AcpClient(plugin);
		(client as unknown as { currentSessionId: string }).currentSessionId = "s1";
		const handler = (
			client as unknown as { handler: { sessionUpdate: (p: unknown) => Promise<void> } }
		).handler;
		vi.spyOn(
			client as unknown as { requireConnection: () => unknown },
			"requireConnection",
		).mockReturnValue({ agent: {} });
		const seen: SessionUpdate[] = [];
		client.onSessionUpdate((u) => seen.push(u));
		await handler.sessionUpdate({
			sessionId: "s1",
			update: { sessionUpdate: "tool_call_update", toolCallId: "t1", content: [] },
		});
		const u = seen.find((x) => x.type === "tool_call_update");
		expect(u).toBeDefined();
		expect(u && "status" in u ? u.status : "absent").toBeUndefined();
	});
});
