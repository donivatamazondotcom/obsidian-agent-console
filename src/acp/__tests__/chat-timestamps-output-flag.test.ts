/**
 * Chat Timestamps PR 3: output updates are flagged where they enter (C3).
 *
 * A `tool_call_update` counts as output only when its `_meta` carries one of
 * codex-acp's output keys (`terminal_output_delta`, `terminal_output`,
 * `mcp_output_delta`). Claude Code's status-less title and content updates
 * (probe P3) carry none, so they never read as output. Nothing outside `acp/`
 * reads `_meta`.
 */
import { describe, expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk";
import { AcpHandler } from "../acp-handler";
import { registerClientHandlers } from "../acp-client";
import type { PermissionManager } from "../permission-handler";
import type { TerminalManager } from "../terminal-handler";
import type { Logger } from "../../utils/logger";
import type { SessionUpdate } from "../../types/session";

function makeHandler() {
	const logger = { log: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
	const handler = new AcpHandler(
		{} as PermissionManager,
		{} as TerminalManager,
		() => "/vault",
		() => "s1",
		logger,
	);
	const received: SessionUpdate[] = [];
	handler.onSessionUpdate((u) => received.push(u));
	return { handler, received };
}

function toolUpdate(meta: unknown, extra: Record<string, unknown> = {}): acp.SessionNotification {
	return {
		sessionId: "s1",
		update: {
			sessionUpdate: "tool_call_update",
			toolCallId: "call-1",
			...(meta === undefined ? {} : { _meta: meta }),
			...extra,
		},
	} as unknown as acp.SessionNotification;
}

function flagOf(received: SessionUpdate[]): unknown {
	const u = received[received.length - 1];
	return u && u.type === "tool_call_update" ? u.carriesOutput : "no update";
}

describe("carriesOutput at the acp/ edge", () => {
	it.each([
		["terminal_output_delta", { terminal_output_delta: { data: "tick\n", terminal_id: "t1" } }],
		["terminal_output", { terminal_output: { data: "tick\n", terminal_id: "t1" } }],
		["mcp_output_delta", { mcp_output_delta: { data: "progress" } }],
	])("sets the flag for Codex's %s key", async (_key, meta) => {
		const { handler, received } = makeHandler();
		await handler.sessionUpdate(toolUpdate(meta));
		expect(flagOf(received)).toBe(true);
	});

	it.each([
		["a Claude Code title update", { claudeCode: { toolName: "Bash" } }, { title: "sleep 30" }],
		["a Kiro update", { kiro: {} }, { status: "in_progress" }],
		["null _meta", null, {}],
		["an array _meta", ["terminal_output_delta"], {}],
		["no _meta", undefined, {}],
	])("leaves %s unflagged", async (_name, meta, extra) => {
		const { handler, received } = makeHandler();
		await expect(handler.sessionUpdate(toolUpdate(meta, extra))).resolves.toBeUndefined();
		expect(flagOf(received)).toBeUndefined();
	});

	it("ignores an output key that only exists on the prototype", async () => {
		const { handler, received } = makeHandler();
		const meta = Object.create({ terminal_output_delta: { data: "x" } }) as object;
		await handler.sessionUpdate(toolUpdate(meta));
		expect(flagOf(received)).toBeUndefined();
	});

	it("never flags a tool_call (only updates stream output)", async () => {
		const { handler, received } = makeHandler();
		await handler.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "call-1",
				title: "ls",
				_meta: { terminal_output_delta: { data: "x" } },
			},
		} as unknown as acp.SessionNotification);
		const u = received[received.length - 1];
		expect(u?.type).toBe("tool_call");
		expect((u as { carriesOutput?: boolean }).carriesOutput).toBeUndefined();
	});

	it("keeps the flag through the SDK's own client dispatch", async () => {
		const { handler, received } = makeHandler();
		let agentSide: acp.AgentContext | undefined;
		const agentApp = acp.agent().onConnect((c) => {
			agentSide = c.client;
		});
		registerClientHandlers(acp.client({ name: "agent-console" }), handler).connect(agentApp);
		await vi.waitFor(() => expect(agentSide).toBeDefined());
		await agentSide!.notify(acp.methods.client.session.update, {
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "call-1",
				_meta: { terminal_output_delta: { data: "tick\n", terminal_id: "t1" } },
			},
		});
		await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
		expect(flagOf(received)).toBe(true);
	});
});
