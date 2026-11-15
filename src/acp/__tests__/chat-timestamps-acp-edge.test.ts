/**
 * Chat Timestamps PR 1 — what the `acp/` edge adds to session updates.
 *
 * - Updates that arrive while a `session/load` is replaying history are
 *   tagged `replayed`, so message state gives them no times.
 * - PermissionManager stamps when a permission was asked and answered.
 *
 * Seam (R2): the public `loadSession` and the handler's `sessionUpdate`, with
 * only the SDK connection stubbed (R4, as in i264-replay-count), and the
 * public PermissionManager API. Assertions are on the emitted updates (R3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcpClient } from "../acp-client";
import { PermissionManager } from "../permission-handler";
import type AgentClientPlugin from "../../plugin";
import type { SessionUpdate } from "../../types/session";

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
	const seen: SessionUpdate[] = [];
	client.onSessionUpdate((u) => seen.push(u));
	return { client, handler, seen };
}

const text = (t: string) => ({ type: "text", text: t });

afterEach(() => {
	vi.useRealTimers();
});

describe("replayed updates are tagged where they enter", () => {
	it("updates inside a load are replayed; updates after it are live", async () => {
		const { client, handler, seen } = makeClient([
			{ sessionId: "s1", update: { sessionUpdate: "user_message_chunk", content: text("hi") } },
			{
				sessionId: "s1",
				update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "read", status: "completed" },
			},
			{ sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: text("OK") } },
		]);
		await client.loadSession("s1", "/vault");
		await handler.sessionUpdate({
			sessionId: "s1",
			update: { sessionUpdate: "agent_message_chunk", content: text("live") },
		});
		const conv = seen.filter((u) =>
			["user_message_chunk", "agent_message_chunk", "tool_call"].includes(u.type),
		);
		expect(conv.map((u) => u.replayed === true)).toEqual([true, true, true, false]);
	});
});

describe("PermissionManager stamps the ask and the answer", () => {
	it("request carries requestedAt and respond carries answeredAt", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const T = Date.UTC(2026, 10, 15, 17, 0, 0);
		vi.setSystemTime(T);
		const emitted: SessionUpdate[] = [];
		const pm = new PermissionManager({ onSessionUpdate: (u) => emitted.push(u) }, false);
		const pending = pm.request({
			sessionId: "s1",
			toolCall: { toolCallId: "t1", title: "run" },
			options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }],
		} as Parameters<PermissionManager["request"]>[0]);
		const ask = emitted[0];
		expect(ask).toMatchObject({ type: "tool_call", requestedAt: T });
		const requestId =
			ask.type === "tool_call" ? ask.permissionRequest?.requestId ?? "" : "";
		vi.setSystemTime(T + 600_000);
		pm.respond(requestId, "ok");
		await pending;
		expect(emitted[1]).toMatchObject({ type: "tool_call_update", answeredAt: T + 600_000 });
	});
});
