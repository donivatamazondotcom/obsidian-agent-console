/**
 * I259: AcpClient tracks the sessions it created with `session/new` on this
 * process and never sent to, and deletes one on request.
 *
 * Seam (R2): the real AcpClient public API. Only the ACP connection (the
 * declared `acp/` port, R4) is faked; it records the method log and answers
 * like Kiro V3 (probe 2026-11-07). Literal ids (R5).
 *
 * Spec: [[I259 Empty Kiro chats pile up in the Agent view]] § Spec 1–2.
 */
import { describe, expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk";
import { AcpClient } from "../acp-client";
import { AcpTypeConverter } from "../type-converter";
import type AgentClientPlugin from "../../plugin";

type Seams = {
	connection: unknown;
	currentSessionId: string | null;
	reconcileProcessGone: (proc: unknown) => void;
	agentProcess: unknown;
};

function makeClient(opts: { rejectPrompt?: boolean; rejectDelete?: boolean } = {}) {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const seams = client as unknown as Seams;
	const calls: Array<{ method: string; sessionId?: string }> = [];
	let counter = 0;
	const request = vi.fn(
		async (method: string, params: { sessionId?: string }) => {
			calls.push({ method, sessionId: params?.sessionId });
			switch (method) {
				case acp.methods.agent.session.new:
					counter += 1;
					return { sessionId: `sess_${counter}` };
				case acp.methods.agent.session.prompt:
					if (opts.rejectPrompt) throw new Error("prompt failed");
					return { stopReason: "end_turn" };
				case acp.methods.agent.session.delete:
					if (opts.rejectDelete) throw new Error("Session not found");
					return {};
				case acp.methods.agent.session.load:
					return {};
				case acp.methods.agent.session.fork:
					counter += 1;
					return { sessionId: `sess_${counter}` };
				default:
					return {};
			}
		},
	);
	const notify = vi.fn(async () => undefined);
	seams.connection = { agent: { request, notify } };
	return { client, seams, calls };
}

describe("I259 AcpClient never-sent tracking", () => {
	it("a session/new is unsent until a prompt is sent to it", async () => {
		const { client } = makeClient();
		const { sessionId } = await client.newSession("/tmp");
		expect(client.isUnsentSession(sessionId)).toBe(true);
		await client.sendPrompt(sessionId, [{ type: "text", text: "hi" }]);
		expect(client.isUnsentSession(sessionId)).toBe(false);
	});

	it("a failed send still counts as sent", async () => {
		const { client } = makeClient({ rejectPrompt: true });
		const { sessionId } = await client.newSession("/tmp");
		await client
			.sendPrompt(sessionId, [{ type: "text", text: "hi" }])
			.catch(() => undefined);
		expect(client.isUnsentSession(sessionId)).toBe(false);
	});

	it("loaded, resumed and forked sessions are never unsent", async () => {
		const { client } = makeClient();
		await client.loadSession("sess_loaded", "/tmp");
		await client.resumeSession("sess_resumed", "/tmp");
		const fork = await client.forkSession("sess_loaded", "/tmp");
		expect(client.isUnsentSession("sess_loaded")).toBe(false);
		expect(client.isUnsentSession("sess_resumed")).toBe(false);
		expect(client.isUnsentSession(fork.sessionId)).toBe(false);
	});

	it("loading an unsent id on the same process makes it a loaded session", async () => {
		const { client } = makeClient();
		const { sessionId } = await client.newSession("/tmp");
		await client.loadSession(sessionId, "/tmp");
		expect(client.isUnsentSession(sessionId)).toBe(false);
	});

	it("the AI-rename side session never arms", async () => {
		const { client } = makeClient();
		const res = await client.requestSideTitle("title please", "/tmp");
		expect(client.isUnsentSession(res.sessionId)).toBe(false);
	});

	it("disconnect forgets every unsent id (the process is gone)", async () => {
		const { client } = makeClient();
		const { sessionId } = await client.newSession("/tmp");
		await client.disconnect();
		expect(client.isUnsentSession(sessionId)).toBe(false);
	});

	it("a crash (reconcileProcessGone) forgets every unsent id", async () => {
		const { client, seams } = makeClient();
		const { sessionId } = await client.newSession("/tmp");
		const proc = {};
		seams.agentProcess = proc;
		seams.reconcileProcessGone(proc);
		expect(client.isUnsentSession(sessionId)).toBe(false);
	});

	it("deleteUnsentSession sends session/delete and forgets the id", async () => {
		const { client, calls, seams } = makeClient();
		const { sessionId } = await client.newSession("/tmp");
		await client.deleteUnsentSession(sessionId);
		expect(calls.at(-1)).toEqual({
			method: "session/delete",
			sessionId: "sess_1",
		});
		expect(client.isUnsentSession(sessionId)).toBe(false);
		expect(seams.currentSessionId).toBeNull();
	});

	it("a rejected delete still forgets the id (no retry)", async () => {
		const { client } = makeClient({ rejectDelete: true });
		const { sessionId } = await client.newSession("/tmp");
		await expect(client.deleteUnsentSession(sessionId)).rejects.toThrow(
			"Session not found",
		);
		expect(client.isUnsentSession(sessionId)).toBe(false);
	});
});

describe("I259 deletesSessions capability", () => {
	it("is true when session/delete is advertised (Kiro V3, Claude Code)", () => {
		expect(
			AcpTypeConverter.toAgentCapabilities({
				sessionCapabilities: { list: {}, close: {}, delete: {} },
			}).deletesSessions,
		).toBe(true);
	});

	it("is false when absent (Kiro V2) or null (SDK: not supported)", () => {
		expect(
			AcpTypeConverter.toAgentCapabilities({ sessionCapabilities: {} })
				.deletesSessions,
		).toBe(false);
		const init = AcpTypeConverter.toInitializeResult(
			{
				protocolVersion: 1,
				agentCapabilities: {
					sessionCapabilities: { close: {}, delete: null },
				},
			} as unknown as acp.InitializeResponse,
			{},
		);
		expect(init.capabilities.deletesSessions).toBe(false);
	});
});
