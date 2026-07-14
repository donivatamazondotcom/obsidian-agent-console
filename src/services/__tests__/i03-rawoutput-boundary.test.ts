/**
 * I03 — rawOutput dropped at the ACP boundary.
 *
 * Found in smoke (failgone): a failed tool_call_update carrying
 * rawOutput.error never produced the re-authenticate banner because
 * AcpHandler's tool_call emit omitted rawOutput, the SessionUpdate union
 * lacked the field, and message-state never merged it. The resolver's
 * text-fallback path can therefore never fire for ANY agent.
 *
 * Repro chain: handler forwards rawOutput -> applySingleUpdate merges it
 * into MessageContent -> a later update WITHOUT rawOutput preserves it.
 */
import { describe, expect, it, vi } from "vitest";

import { AcpHandler } from "../../acp/acp-handler";
import { applySingleUpdate } from "../message-state";
import type { ChatMessage } from "../../types/chat";
import type { SessionUpdate } from "../../types/session";

function makeHandler(): {
	handler: AcpHandler;
	events: SessionUpdate[];
} {
	const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const handler = new AcpHandler(
		{} as never,
		{} as never,
		() => "/tmp",
		() => "sess-1",
		logger as never,
	);
	const events: SessionUpdate[] = [];
	handler.onSessionUpdate((u) => events.push(u));
	return { handler, events };
}

describe("I03: rawOutput flows from ACP boundary to message content", () => {
	it("AcpHandler forwards rawOutput on tool_call_update", async () => {
		const { handler, events } = makeHandler();
		await handler.sessionUpdate({
			sessionId: "sess-1",
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "tc-1",
				title: "Running: @drive/get_spreadsheet",
				status: "failed",
				rawOutput: { error: "HTTP 401 unauthorized" },
			},
		} as never);

		expect(events).toHaveLength(1);
		const evt = events[0] as Extract<SessionUpdate, { type: "tool_call_update" }>;
		expect(evt.rawOutput).toEqual({ error: "HTTP 401 unauthorized" });
	});

	it("applySingleUpdate merges rawOutput into the tool-call content", () => {
		const index = new Map<string, number>();
		let messages: ChatMessage[] = [];
		messages = applySingleUpdate(
			messages,
			{
				type: "tool_call",
				sessionId: "sess-1",
				toolCallId: "tc-1",
				title: "Running: @drive/get_spreadsheet",
				status: "in_progress",
			} as SessionUpdate,
			index,
		);
		messages = applySingleUpdate(
			messages,
			{
				type: "tool_call_update",
				sessionId: "sess-1",
				toolCallId: "tc-1",
				status: "failed",
				rawOutput: { error: "HTTP 401 unauthorized" },
			} as SessionUpdate,
			index,
		);

		const toolCall = messages
			.flatMap((m) => m.content)
			.find((c) => c.type === "tool_call");
		expect(toolCall).toBeDefined();
		expect(
			(toolCall as { rawOutput?: Record<string, unknown> }).rawOutput,
		).toEqual({ error: "HTTP 401 unauthorized" });
	});

	it("a later update without rawOutput preserves the existing value", () => {
		const index = new Map<string, number>();
		let messages: ChatMessage[] = [];
		messages = applySingleUpdate(
			messages,
			{
				type: "tool_call",
				sessionId: "sess-1",
				toolCallId: "tc-1",
				status: "failed",
				rawOutput: { error: "HTTP 401 unauthorized" },
			} as SessionUpdate,
			index,
		);
		messages = applySingleUpdate(
			messages,
			{
				type: "tool_call_update",
				sessionId: "sess-1",
				toolCallId: "tc-1",
				status: "failed",
				title: "Running: @drive/get_spreadsheet",
			} as SessionUpdate,
			index,
		);

		const toolCall = messages
			.flatMap((m) => m.content)
			.find((c) => c.type === "tool_call");
		expect(
			(toolCall as { rawOutput?: Record<string, unknown> }).rawOutput,
		).toEqual({ error: "HTTP 401 unauthorized" });
	});
});
