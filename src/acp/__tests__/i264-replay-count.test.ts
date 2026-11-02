/**
 * I264 — `AcpClient.loadSession` reports how many conversation updates the
 * agent replayed while the load was in flight.
 *
 * Seam (R2): the public `loadSession`, with only the SDK connection stubbed
 * (R4). The stub delivers `session/update` notifications through the real
 * handler before the response resolves, as Kiro V3 does (probed 2026-11-02:
 * every conversation chunk of a real load arrives before the response; an
 * unknown id gets only session_info / config_option / available_commands).
 * Assertions are on the returned count (R3).
 */
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";

type Handler = { sessionUpdate: (p: unknown) => Promise<void> };

function makeClient(updatesDuringLoad: { sessionId: string; update: unknown }[]) {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const handler = (client as unknown as { handler: Handler }).handler;
	const request = vi.fn(async () => {
		for (const n of updatesDuringLoad) await handler.sessionUpdate(n);
		return {};
	});
	vi.spyOn(
		client as unknown as { requireConnection: () => unknown },
		"requireConnection",
	).mockReturnValue({ agent: { request } });
	return client;
}

const text = (t: string) => ({ type: "text", text: t });

describe("I264 loadSession counts the replayed conversation", () => {
	it("an unknown id on Kiro V3: metadata only → 0", async () => {
		const client = makeClient([
			{ sessionId: "s1", update: { sessionUpdate: "session_info_update", title: "x" } },
			{
				sessionId: "s1",
				update: { sessionUpdate: "available_commands_update", availableCommands: [] },
			},
			{
				sessionId: "s1",
				update: { sessionUpdate: "config_option_update", configOptions: [] },
			},
		]);
		const r = await client.loadSession("s1", "/vault");
		expect(r.replayedConversationUpdates).toBe(0);
	});

	it("a real load: user, agent, thought and tool-call updates count", async () => {
		const client = makeClient([
			{ sessionId: "s1", update: { sessionUpdate: "user_message_chunk", content: text("Remember 7") } },
			{ sessionId: "s1", update: { sessionUpdate: "agent_thought_chunk", content: text("ok") } },
			{
				sessionId: "s1",
				update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "read", status: "completed" },
			},
			{ sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: text("OK") } },
			{ sessionId: "s1", update: { sessionUpdate: "session_info_update", title: "x" } },
		]);
		const r = await client.loadSession("s1", "/vault");
		expect(r.replayedConversationUpdates).toBe(4);
	});

	it("updates for another session don't count", async () => {
		const client = makeClient([
			{ sessionId: "other", update: { sessionUpdate: "agent_message_chunk", content: text("hi") } },
		]);
		const r = await client.loadSession("s1", "/vault");
		expect(r.replayedConversationUpdates).toBe(0);
	});

	it("a later load starts its count at zero", async () => {
		const client = makeClient([
			{ sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: text("hi") } },
		]);
		expect((await client.loadSession("s1", "/vault")).replayedConversationUpdates).toBe(1);
		expect((await client.loadSession("s1", "/vault")).replayedConversationUpdates).toBe(1);
	});
});
