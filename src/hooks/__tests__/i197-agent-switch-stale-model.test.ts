/**
 * I197: Agent switch leaves the previous agent's model in the header.
 *
 * Symptom (concrete instance in the I197 note): on a tab whose agent has
 * reported a model (confirmedModelId set via a `model_update`), switching the
 * agent updates the agent label but the header keeps showing the PREVIOUS
 * agent's model — the header reads "<new agent> · <old agent's model>", a model
 * the new agent doesn't even offer.
 *
 * Root cause: `confirmedModelId` is set ONLY by the `model_update` handler and
 * is never cleared. `setAgentWithoutSession` (the single writer for an idle
 * agent switch) clears `models`/`modes`/`capabilities` but NOT
 * `confirmedModelId`; `createSession`'s initializing reset likewise omits it.
 * The header derives its model segment from
 * `session.confirmedModelId ?? legacyModel ?? null` (ChatPanel.tsx), so a stale
 * `confirmedModelId` renders the old model under the new agent's name. Same
 * family as I131 (a reset path that doesn't re-resolve a per-agent value).
 *
 * These tests enter at the public hook API — the single writer of session
 * state, the exact seam the runtime uses — and assert the persisted state field
 * the header reads (R2 boundary honesty, R3 outcome assertion). Fixtures are
 * neutral per the no-internal-agent-ids tripwire.
 *
 * Test gate (R1 red-first): both assertions FAIL against current code
 * (confirmedModelId stays the old model) and PASS once the writer clears it.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";

const OLD_MODEL = "test-model-legacy";

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
			{
				id: "test-agent-2",
				displayName: "Test Agent 2",
				command: "kiro-cli",
				args: ["acp"],
				env: [],
			},
		],
		lastUsedModels: {},
		lastUsedModes: {},
	};
}

describe("I197: agent switch clears the previous agent's confirmed model", () => {
	it("setAgentWithoutSession clears confirmedModelId so the header re-resolves the new agent", () => {
		const agentClient = {
			getInitializeResult: () => null,
		} as unknown as AcpClient;
		const settingsAccess = {
			getSnapshot: () => makeSettings(),
		} as unknown as ISettingsAccess;

		const { result } = renderHook(() =>
			useAgentSession(
				agentClient,
				settingsAccess,
				"/cwd",
				() => {},
				"test-agent",
			),
		);

		// Tab connected to the first agent; the agent reported its model.
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "model_update",
				modelId: OLD_MODEL,
			}),
		);
		// Precondition: the header would show this model.
		expect(result.current.session.confirmedModelId).toBe(OLD_MODEL);

		// Idle-switch to a different agent (the single-writer switch path).
		act(() => result.current.setAgentWithoutSession("test-agent-2"));

		// Agent identity re-resolved to the newly selected agent...
		expect(result.current.session.agentId).toBe("test-agent-2");
		// ...and the model must NOT stay the previous agent's. The header reads
		// session.confirmedModelId directly, so leaving it stale renders
		// "<new agent> · <old model>". RED pre-fix (still the old model).
		expect(result.current.session.confirmedModelId).toBeUndefined();
	});

	it("createSession's reset clears a stale confirmedModelId (recreate path)", async () => {
		const agentClient = {
			isInitialized: () => true,
			getCurrentAgentId: () => "test-agent",
			initialize: vi.fn(),
			newSession: vi.fn(async () => ({
				sessionId: "s2",
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
			useAgentSession(
				agentClient,
				settingsAccess,
				"/cwd",
				() => {},
				"test-agent",
			),
		);

		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "model_update",
				modelId: OLD_MODEL,
			}),
		);
		expect(result.current.session.confirmedModelId).toBe(OLD_MODEL);

		// A recreate acquires a fresh session; its model is unconfirmed until the
		// new agent emits its own model_update, so the header must not carry the
		// previous model through the "initializing" window.
		await act(async () => {
			await result.current.createSession();
		});

		expect(result.current.session.confirmedModelId).toBeUndefined();
	});
});
