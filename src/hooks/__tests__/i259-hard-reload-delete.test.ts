/**
 * I259: hard reload on an empty tab deletes the never-sent session before
 * the respawn, and takes its decision before `clearMessages`.
 *
 * Seam (R2): the public `useChatActions.handleReload(true)` with a real
 * `useSessionRetirement` over a REAL AcpClient. The ACP connection is the
 * only fake (R4); the outcome is the method log the agent receives (R3).
 * Other useChatActions collaborators are inert mocks, as in
 * useChatActions-reload.test.ts.
 *
 * Spec: [[I259 Empty Kiro chats pile up in the Agent view]] § Spec 5.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as acp from "@agentclientprotocol/sdk";

import { useChatActions } from "../useChatActions";
import { useSessionRetirement } from "../useSessionRetirement";
import { AcpClient } from "../../acp/acp-client";
import { AcpTypeConverter } from "../../acp/type-converter";
import type AgentClientPlugin from "../../plugin";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, Notice: class {} };
});

type Params = Parameters<typeof useChatActions>;

function deepMock(overrides: Record<string, unknown> = {}): unknown {
	const cache: Record<string, unknown> = { ...overrides };
	return new Proxy(function () {}, {
		get(_t, p: string | symbol) {
			if (typeof p === "symbol") return undefined;
			if (!(p in cache)) cache[p] = deepMock();
			return cache[p];
		},
		apply: () => undefined,
	});
}

async function makeTab(opts: { sendAttempted: boolean }) {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const seams = client as unknown as {
		connection: unknown;
		cachedInitResult: unknown;
	};
	const log: string[] = [];
	seams.connection = {
		agent: {
			request: vi.fn(async (method: string, params: { sessionId?: string }) => {
				log.push(params?.sessionId ? `${method} ${params.sessionId}` : method);
				return method === acp.methods.agent.session.new
					? { sessionId: "sess_1" }
					: {};
			}),
			notify: vi.fn(async () => undefined),
		},
	};
	seams.cachedInitResult = {
		capabilities: AcpTypeConverter.toAgentCapabilities({
			sessionCapabilities: { list: {}, close: {}, delete: {} },
		}),
	};
	const { sessionId } = await client.newSession("/tmp");

	let attempted = opts.sendAttempted;
	const agent = deepMock({
		isSending: false,
		session: { sessionId, agentId: "kiro-cli" },
		// useAgentMessages.clearMessages resets the send attempt (I259).
		clearMessages: vi.fn(() => {
			attempted = false;
		}),
		closeSession: vi.fn(async () => {
			log.push("disconnect");
			await client.disconnect();
		}),
		closeLiveSession: vi.fn(async () => undefined),
	}) as Params[1];

	const retirement = renderHook(() =>
		useSessionRetirement({
			client,
			getSessionId: () => sessionId,
			getMessageCount: () => 0,
			isQueued: () => false,
			hasAttemptedSend: () => attempted,
			getRecordId: () => null,
			warn: vi.fn(),
		}),
	);
	const retirementRef = { current: retirement.result.current };
	const { result } = renderHook(() =>
		useChatActions(
			deepMock() as Params[0],
			agent,
			deepMock() as Params[2],
			deepMock() as Params[3],
			{ sessionId, agentId: "kiro-cli" } as unknown as Params[4],
			[],
			deepMock() as Params[6],
			"",
			{ notes: [], add: vi.fn() } as unknown as Params[8],
			null,
			null,
			false,
			{ current: vi.fn().mockResolvedValue(undefined) } as Params[12],
			"",
			"",
			{ current: vi.fn() } as unknown as Params[15],
			undefined,
			retirementRef,
		),
	);
	return { result, log };
}

describe("I259 — hard reload", () => {
	it("an empty tab: session/delete before the respawn", async () => {
		const { result, log } = await makeTab({ sendAttempted: false });
		await act(() => result.current.handleReload(true));
		expect(log).toEqual(["session/new", "session/delete sess_1", "disconnect"]);
	});

	it("a send still being prepared: no delete, even though clearMessages resets the flag", async () => {
		const { result, log } = await makeTab({ sendAttempted: true });
		await act(() => result.current.handleReload(true));
		expect(log).toEqual(["session/new", "disconnect"]);
	});
});
