/**
 * F15 — Rename Tab With AI: side-session isolation.
 *
 * The AI title is generated in a throwaway side session opened on the tab's
 * EXISTING connection. It must never disturb the tab:
 *  - the tab's currentSessionId is untouched,
 *  - side-session updates never reach the tab's listeners and never count
 *    toward the main prompt's silent-failure detection,
 *  - side-session permission requests are auto-denied (never shown in the tab),
 *  - the side session is closed when the agent advertises session/close.
 *
 * Spec: [[F15 Rename Tab With AI]].
 */
import { describe, it, expect, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk";
import { AcpHandler } from "../acp-handler";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";
import type { SessionUpdate } from "../../types/session";

const logger = {
	log: vi.fn(),
	debug: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as ConstructorParameters<typeof AcpHandler>[4];

function makeHandler(permissionRequest = vi.fn()) {
	const handler = new AcpHandler(
		{ request: permissionRequest } as unknown as ConstructorParameters<
			typeof AcpHandler
		>[0],
		{} as unknown as ConstructorParameters<typeof AcpHandler>[1],
		() => "",
		() => "MAIN",
		logger,
	);
	const received: SessionUpdate[] = [];
	handler.onSessionUpdate((u) => received.push(u));
	return { handler, received, permissionRequest };
}

const chunkNotification = (
	sessionId: string,
	text: string,
): acp.SessionNotification =>
	({
		sessionId,
		update: {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text },
		},
	}) as unknown as acp.SessionNotification;

describe("AcpHandler side-session tap", () => {
	it("routes side-session text to the tap, never to tab listeners", async () => {
		const { handler, received } = makeHandler();
		const tap = vi.fn();
		handler.registerSideSession("SIDE", tap);
		await handler.sessionUpdate(chunkNotification("SIDE", "<title>Hi"));
		expect(tap).toHaveBeenCalledWith("<title>Hi");
		expect(received).toHaveLength(0);
	});

	it("does not count side-session updates toward the main prompt", async () => {
		const { handler } = makeHandler();
		handler.registerSideSession("SIDE", vi.fn());
		handler.resetUpdateCount();
		await handler.sessionUpdate(chunkNotification("SIDE", "x"));
		expect(handler.hasReceivedUpdates()).toBe(false);
	});

	it("drops side-session tool calls and thoughts silently", async () => {
		const { handler, received } = makeHandler();
		const tap = vi.fn();
		handler.registerSideSession("SIDE", tap);
		await handler.sessionUpdate({
			sessionId: "SIDE",
			update: {
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "thinking" },
			},
		} as unknown as acp.SessionNotification);
		await handler.sessionUpdate({
			sessionId: "SIDE",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "t1",
				title: "read",
			},
		} as unknown as acp.SessionNotification);
		expect(tap).not.toHaveBeenCalled();
		expect(received).toHaveLength(0);
	});

	it("auto-denies permission requests from a side session", async () => {
		const { handler, permissionRequest } = makeHandler();
		handler.registerSideSession("SIDE", vi.fn());
		const res = await handler.requestPermission({
			sessionId: "SIDE",
		} as unknown as acp.RequestPermissionRequest);
		expect(res.outcome.outcome).toBe("cancelled");
		expect(permissionRequest).not.toHaveBeenCalled();
	});

	it("leaves main-session traffic unchanged", async () => {
		const { handler, received, permissionRequest } = makeHandler();
		handler.registerSideSession("SIDE", vi.fn());
		await handler.sessionUpdate(chunkNotification("MAIN", "hello"));
		expect(received).toHaveLength(1);
		await handler.requestPermission({
			sessionId: "MAIN",
		} as unknown as acp.RequestPermissionRequest);
		expect(permissionRequest).toHaveBeenCalledTimes(1);
	});

	it("stops tapping after unregister", async () => {
		const { handler } = makeHandler();
		const tap = vi.fn();
		const off = handler.registerSideSession("SIDE", tap);
		off();
		await handler.sessionUpdate(chunkNotification("SIDE", "late"));
		expect(tap).not.toHaveBeenCalled();
	});
});

// --- AcpClient.requestSideTitle -------------------------------------------

type ClientSeams = {
	connection: unknown;
	currentSessionId: string | null;
	cachedInitResult: unknown;
	handler: AcpHandler;
};

function makeClient(opts: { canClose: boolean; reply?: string; hang?: boolean }) {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const seams = client as unknown as ClientSeams;
	const calls: string[] = [];
	const request = vi.fn(async (method: string, params: { sessionId?: string }) => {
		calls.push(method);
		if (method === acp.methods.agent.session.new) {
			return { sessionId: "SIDE" };
		}
		if (method === acp.methods.agent.session.prompt) {
			if (opts.hang) return new Promise(() => {});
			await seams.handler.sessionUpdate(
				chunkNotification(params.sessionId ?? "", opts.reply ?? ""),
			);
			return { stopReason: "end_turn" };
		}
		return {};
	});
	const notify = vi.fn(async (method: string) => {
		calls.push(method);
	});
	seams.connection = { agent: { request, notify } };
	seams.currentSessionId = "MAIN";
	seams.cachedInitResult = {
		agentCapabilities: {
			sessionCapabilities: opts.canClose ? { close: {} } : {},
		},
	};
	const received: SessionUpdate[] = [];
	client.onSessionUpdate((u) => received.push(u));
	return { client, seams, calls, received };
}

describe("AcpClient.requestSideTitle", () => {
	it("returns the side reply without touching the tab's session", async () => {
		const { client, seams, received } = makeClient({
			canClose: false,
			reply: "<title>Fix scroll jitter</title>",
		});
		const res = await client.requestSideTitle("prompt", "/tmp");
		expect(res.text).toBe("<title>Fix scroll jitter</title>");
		expect(res.sessionId).toBe("SIDE");
		expect(seams.currentSessionId).toBe("MAIN");
		expect(received).toHaveLength(0);
	});

	it("closes the side session only when the agent supports session/close", async () => {
		const a = makeClient({ canClose: true, reply: "x" });
		await a.client.requestSideTitle("p", "/tmp");
		expect(a.calls).toContain(acp.methods.agent.session.close);

		const b = makeClient({ canClose: false, reply: "x" });
		await b.client.requestSideTitle("p", "/tmp");
		expect(b.calls).not.toContain(acp.methods.agent.session.close);
	});

	it("cancels and rejects on timeout", async () => {
		const { client, calls, seams } = makeClient({ canClose: false, hang: true });
		await expect(
			client.requestSideTitle("p", "/tmp", { timeoutMs: 20 }),
		).rejects.toThrow(/timed out/i);
		expect(calls).toContain(acp.methods.agent.session.cancel);
		expect(seams.currentSessionId).toBe("MAIN");
	});
});
