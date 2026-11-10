/**
 * I259 smoke finding: a tab's unmount teardown (`useAgentSession.closeSession`)
 * must not kill the process while the close handler's `session/delete` is in
 * flight, and must not wait past that delete's own 1 s deadline.
 *
 * Seam (R2): the public `useAgentSession` hook over a REAL AcpClient. Only the
 * ACP connection is faked (R4); the outcome is the agent-side order of
 * `session/delete`'s answer and the disconnect (R3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as acp from "@agentclientprotocol/sdk";

import { useAgentSession } from "../useAgentSession";
import { AcpClient } from "../../acp/acp-client";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";

const access = {
	getSnapshot: () => ({
		defaultAgentId: "kiro-cli",
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro-cli", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		antigravity: { id: "antigravity-acp", displayName: "Antigravity CLI", command: "agy", args: ["acp"], env: [], apiKeySecretId: "" },
		customAgents: [],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	}),
	updateSettings: vi.fn(async () => undefined),
} as unknown as ISettingsAccess;

function makeClient() {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const seams = client as unknown as { connection: unknown };
	const log: string[] = [];
	let answerDelete: () => void = () => undefined;
	seams.connection = {
		agent: {
			request: vi.fn(async (method: string) => {
				if (method === acp.methods.agent.session.new) return { sessionId: "sess_1" };
				if (method === acp.methods.agent.session.delete) {
					return new Promise((r) => {
						answerDelete = () => {
							log.push("delete answered");
							r({});
						};
					});
				}
				return {};
			}),
			notify: vi.fn(async () => undefined),
		},
	};
	vi.spyOn(client, "disconnect").mockImplementation(() => {
		log.push("disconnect");
		return Promise.resolve();
	});
	return { client, log, answer: () => answerDelete() };
}

afterEach(() => vi.useRealTimers());

describe("I259 — closeSession waits for an in-flight delete", () => {
	it("disconnects only after the delete answers", async () => {
		const { client, log, answer } = makeClient();
		await client.newSession("/tmp");
		const { result } = renderHook(() =>
			useAgentSession(client, access, "/cwd", () => {}, "kiro-cli"),
		);
		const deleting = client.deleteUnsentSession("sess_1");
		const closing = act(() => result.current.closeSession());
		await Promise.resolve();
		expect(log).toEqual([]);
		answer();
		await deleting;
		await closing;
		expect(log).toEqual(["delete answered", "disconnect"]);
	});

	it("a hung delete holds the teardown no longer than its own 1 s deadline", async () => {
		vi.useFakeTimers();
		const { client, log } = makeClient();
		await client.newSession("/tmp");
		const { result } = renderHook(() =>
			useAgentSession(client, access, "/cwd", () => {}, "kiro-cli"),
		);
		void client.deleteUnsentSession("sess_1").catch(() => undefined);
		// The retirement executor already waited 800 ms of that second.
		await vi.advanceTimersByTimeAsync(800);
		const closing = result.current.closeSession();
		await vi.advanceTimersByTimeAsync(199);
		expect(log).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		await closing;
		expect(log).toEqual(["disconnect"]);
	});
});
