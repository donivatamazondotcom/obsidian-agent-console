/**
 * I55: Queued message stuck because acquireNewSession reads sessionId from a
 * stale closure after `await agent.createSession()`.
 *
 * Root cause: `createSession` returns void, so the caller (ChatPanel's
 * acquireNewSession) reads `agent.session.sessionId` from a closure captured
 * in a prior render — which is still null immediately after the await. That
 * makes acquireNewSession return {ok:false}, the lazy state machine goes to
 * `error` instead of `ready`, and the ChatPanel queue-flush effect (gated on
 * state === "ready") never fires → the message stays stuck in "Sending…".
 *
 * Fix: createSession returns the created sessionId so the caller uses the
 * return value instead of stale state.
 *
 * Test gate per SDLC § Stack-Trace Patch Anti-Pattern:
 * - PRE-FIX: createSession returns undefined → FAILS
 * - POST-FIX: returns "sess-created-1" → PASSES
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";

function makeSettings() {
	return {
		defaultAgentId: "test-agent",
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [
			{
				id: "test-agent",
				displayName: "Test Agent",
				command: "kiro-cli",
				args: ["acp"],
				env: [],
			},
		],
		lastUsedModels: {},
		lastUsedModes: {},
	};
}

describe("I55: createSession returns the created sessionId", () => {
	it("returns the sessionId from newSession so callers don't depend on stale session state", async () => {
		const agentClient = {
			isInitialized: () => true,
			getCurrentAgentId: () => "test-agent",
			initialize: vi.fn(),
			newSession: vi.fn(async () => ({
				sessionId: "sess-created-1",
				modes: undefined,
				models: undefined,
				configOptions: undefined,
			})),
			getInitializeResult: () => null,
			setSessionModel: vi.fn(async () => {}),
			setSessionMode: vi.fn(async () => {}),
		} as unknown as AcpClient;
		const settingsAccess = {
			getSnapshot: () => makeSettings(),
		} as unknown as ISettingsAccess;

		const { result } = renderHook(() =>
			useAgentSession(agentClient, settingsAccess, "/cwd", () => {}, "test-agent"),
		);

		let returned: unknown;
		await act(async () => {
			returned = await result.current.createSession("test-agent");
		});

		// The fix: createSession returns the created sessionId.
		// Pre-fix it returns undefined → red bar.
		expect(returned).toBe("sess-created-1");
		// State is updated too (sanity).
		expect(result.current.session.sessionId).toBe("sess-created-1");
	});
});
