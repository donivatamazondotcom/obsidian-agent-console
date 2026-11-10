/**
 * I258: the chat header keeps the old model after a config-option model switch.
 *
 * Symptom: an agent that sends BOTH a legacy `models` list and a `model`
 * config option (Antigravity `agy acp` 1.5.1, probed raw 11/09) is switched
 * through the model picker. The switch reaches the agent, but the header
 * still names the old model.
 *
 * Root cause: the picker writes only `configOptions` (`setConfigOption`).
 * `deriveHeaderModelName` preferred `confirmedModelId`, then the legacy
 * `models.currentModelId`, both of which stay at the old value.
 *
 * Fix: the confirmed model counts only while the current selection still
 * equals the selection it was confirmed under (`confirmedUnder`, stamped by
 * the single `model_update` writer), and the `model` config option beats the
 * legacy list, matching the picker and `deriveHeaderAgent`.
 *
 * These tests enter at the public hook API (the session's single writer) and
 * assert what the header resolver derives from the resulting session (R2, R3).
 * Fixtures are neutral per the no-internal-agent-ids tripwire.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import { deriveHeaderModelName } from "../../resolvers/header-agent";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type {
	ChatSession,
	SessionConfigOption,
	SessionModelState,
} from "../../types/session";

// Shape of agy's session/new: the legacy list folds effort into the id,
// the config option keeps effort in a separate thought_level option.
const legacyModels: SessionModelState = {
	currentModelId: "model-a-high",
	availableModels: [
		{ modelId: "model-a-high", name: "Model A (High)" },
		{ modelId: "model-b", name: "Model B (Thinking)" },
	],
};
const modelOption = (current: string): SessionConfigOption => ({
	id: "model",
	name: "Model",
	category: "model",
	type: "select",
	currentValue: current,
	options: [
		{ value: "model-a", name: "Model A" },
		{ value: "model-b", name: "Model B (Thinking)" },
	],
});

function makeSettings() {
	return {
		defaultAgentId: "test-agent",
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		antigravity: { id: "antigravity-acp", displayName: "Antigravity CLI", command: "agy", args: ["acp"], env: [], apiKeySecretId: "" },
		customAgents: [
			{
				id: "test-agent",
				displayName: "Test Agent",
				command: "test-agent-bin",
				args: ["acp"],
				env: [],
			},
		],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
}

function makeClient() {
	return {
		isInitialized: () => true,
		getCurrentAgentId: () => "test-agent",
		initialize: vi.fn(),
		newSession: vi.fn(async () => ({
			sessionId: "s1",
			modes: undefined,
			models: legacyModels,
			configOptions: [modelOption("model-a")],
		})),
		getInitializeResult: () => null,
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
		setSessionConfigOption: vi.fn(
			async (_sid: string, _id: string, value: string) => [modelOption(value)],
		),
	} as unknown as AcpClient;
}

const settingsAccess = {
	getSnapshot: () => makeSettings(),
	updateSettings: vi.fn(async () => {}),
} as unknown as ISettingsAccess;

const header = (s: ChatSession) =>
	deriveHeaderModelName({
		confirmedModelId: s.confirmedModelId,
		confirmedUnder: s.confirmedUnder,
		models: s.models,
		configOptions: s.configOptions,
	});

function mount(client: AcpClient) {
	return renderHook(() =>
		useAgentSession(client, settingsAccess, "/cwd", () => {}, "test-agent"),
	);
}

describe("I258: the header follows a config-option model switch", () => {
	it("legacy list + config option: switching through the picker updates the header", async () => {
		const { result } = mount(makeClient());
		await act(async () => {
			await result.current.createSession();
		});

		await act(async () => {
			await result.current.setConfigOption("model", "model-b");
		});

		expect(result.current.session.models?.currentModelId).toBe("model-a-high");
		expect(header(result.current.session)).toBe("Model B (Thinking)");
	});

	it("a confirmed model stops counting once the selection changes", async () => {
		const { result } = mount(makeClient());
		await act(async () => {
			await result.current.createSession();
		});
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "model_update",
				modelId: "model-a-routed",
			}),
		);
		// Confirmed under the unchanged selection: the confirmed model wins.
		expect(header(result.current.session)).toBe("model-a-routed");

		await act(async () => {
			await result.current.setConfigOption("model", "model-b");
		});

		expect(header(result.current.session)).toBe("Model B (Thinking)");
	});

	it("a model_update after the switch wins again", async () => {
		const { result } = mount(makeClient());
		await act(async () => {
			await result.current.createSession();
		});
		await act(async () => {
			await result.current.setConfigOption("model", "model-b");
		});
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "model_update",
				modelId: "model-b-routed",
			}),
		);

		expect(header(result.current.session)).toBe("model-b-routed");
	});

	it("a failed switch rolls back: the confirmed model counts again", async () => {
		const client = makeClient();
		(client.setSessionConfigOption as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("rejected"),
		);
		const { result } = mount(client);
		await act(async () => {
			await result.current.createSession();
		});
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "model_update",
				modelId: "model-a-routed",
			}),
		);
		await act(async () => {
			await result.current.setConfigOption("model", "model-b");
		});

		expect(header(result.current.session)).toBe("model-a-routed");
	});

	it("an agent-pushed config_option_update model change updates the header", async () => {
		const { result } = mount(makeClient());
		await act(async () => {
			await result.current.createSession();
		});
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "model_update",
				modelId: "model-a-routed",
			}),
		);
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "config_option_update",
				configOptions: [modelOption("model-b")],
			}),
		);

		expect(header(result.current.session)).toBe("Model B (Thinking)");
	});

	it("an agent switch clears the stamp with the confirmation", async () => {
		const { result } = mount(makeClient());
		await act(async () => {
			await result.current.createSession();
		});
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "model_update",
				modelId: "model-a-routed",
			}),
		);
		expect(result.current.session.confirmedUnder).toBe("model-a");

		act(() => result.current.setAgentWithoutSession("test-agent"));

		expect(result.current.session.confirmedModelId).toBeUndefined();
		expect(result.current.session.confirmedUnder).toBeUndefined();
	});

	it("restore: a loaded session whose config option differs from the legacy list shows the config option", async () => {
		const { result } = mount(makeClient());
		await act(async () => {
			await result.current.updateSessionFromLoad(
				"s1",
				undefined,
				legacyModels,
				[modelOption("model-b")],
			);
		});

		expect(header(result.current.session)).toBe("Model B (Thinking)");
	});
});
