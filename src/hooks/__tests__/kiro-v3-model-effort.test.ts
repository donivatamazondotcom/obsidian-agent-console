/**
 * Kiro CLI V3 S2 (spec T5): model and effort go through config options, and
 * `session/set_model` is never sent.
 *
 * V3 sends no legacy `models` field and rejects `session/set_model` with
 * "Internal error". Model and effort are config options:
 *   - `model` (category "model")
 *   - `effortLevel` (category "thought_level"), which exists ONLY while the
 *     selected model supports effort (absent on "auto"). Verified live on
 *     kiro-cli 2.34.2-nightly.1, 2026-10-26.
 *
 * So restore must set the model first and the effort second, and the effort
 * pick must be remembered per agent like the model pick is.
 *
 * These tests enter at the public hook API with only the ACP client port
 * mocked (R2, R4) and assert the session state and persisted settings the UI
 * reads (R3). Red-first (R1): the effort-persist and effort-restore cases fail
 * before the S2 change; the never-set_model cases pin today's behavior.
 *
 * Spec: [[Kiro CLI V3 Support]] § T5.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { SessionConfigOption } from "../../types/session";

const AGENT = "test-agent";

const modeOption: SessionConfigOption = {
	id: "mode",
	name: "Mode",
	category: "mode",
	type: "select",
	currentValue: "test-mode",
	options: [{ value: "test-mode", name: "Test mode" }],
};

function modelOption(current: string): SessionConfigOption {
	return {
		id: "model",
		name: "Model",
		category: "model",
		type: "select",
		currentValue: current,
		options: [
			{ value: "auto", name: "Auto" },
			{ value: "test-model-effort", name: "Test model (effort)" },
		],
	};
}

function effortOption(current: string): SessionConfigOption {
	return {
		id: "effortLevel",
		name: "Effort",
		category: "thought_level",
		type: "select",
		currentValue: current,
		options: [
			{ value: "low", name: "Low" },
			{ value: "medium", name: "Medium" },
			{ value: "high", name: "High" },
		],
	};
}

/**
 * A fake V3 server: holds config state and answers set_config_option with the
 * full option list, adding/removing `effortLevel` as the model changes.
 */
function makeV3Server(initialModel = "auto") {
	let model = initialModel;
	let effort = "medium";
	const options = (): SessionConfigOption[] => [
		modeOption,
		modelOption(model),
		...(model === "auto" ? [] : [effortOption(effort)]),
	];
	const calls: Array<[string, string]> = [];
	const setSessionConfigOption = vi.fn(
		async (_sid: string, configId: string, value: string) => {
			calls.push([configId, value]);
			if (configId === "model") model = value;
			else if (configId === "effortLevel") {
				if (model === "auto") throw new Error("no effortLevel on auto");
				effort = value;
			}
			return options();
		},
	);
	const setSessionModel = vi.fn(async () => {
		throw new Error("Internal error");
	});
	const agentClient = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(),
		newSession: vi.fn(async () => ({
			sessionId: "s1",
			modes: undefined,
			models: undefined, // V3 never sends legacy models
			configOptions: options(),
		})),
		getInitializeResult: () => null,
		setSessionConfigOption,
		setSessionModel,
		setSessionMode: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return { agentClient, calls, setSessionConfigOption, setSessionModel };
}

function makeSettingsAccess(saved: {
	model?: string;
	effort?: string;
} = {}) {
	let settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [
			{
				id: AGENT,
				displayName: "Test Agent",
				command: "kiro-cli",
				args: ["acp"],
				env: [],
				engine: "v3",
			},
		],
		lastUsedModels: saved.model ? { [AGENT]: saved.model } : {},
		lastUsedModes: {},
		lastUsedThoughtLevels: saved.effort ? { [AGENT]: saved.effort } : {},
	};
	const access = {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async (patch: Record<string, unknown>) => {
			settings = { ...settings, ...patch };
		}),
	};
	return {
		access: access as unknown as ISettingsAccess,
		snapshot: () => settings,
	};
}

function renderSession(agentClient: AcpClient, access: ISettingsAccess) {
	return renderHook(() =>
		useAgentSession(agentClient, access, "/cwd", () => {}, AGENT),
	);
}

function optionIds(opts: SessionConfigOption[] | undefined): string[] {
	return (opts ?? []).map((o) => o.id);
}

describe("Kiro V3 S2: model and effort via config options (T5)", () => {
	it("switching the model uses set_config_option, never set_model, and surfaces the effort picker", async () => {
		const server = makeV3Server("auto");
		const { access } = makeSettingsAccess();
		const { result } = renderSession(server.agentClient, access);

		await act(async () => {
			await result.current.createSession();
		});
		expect(optionIds(result.current.session.configOptions)).not.toContain(
			"effortLevel",
		);

		await act(async () => {
			await result.current.setConfigOption("model", "test-model-effort");
		});

		expect(server.setSessionModel).not.toHaveBeenCalled();
		expect(server.calls).toEqual([["model", "test-model-effort"]]);
		// The effort picker appears because the server added the option.
		expect(optionIds(result.current.session.configOptions)).toContain(
			"effortLevel",
		);

		// Switching back to auto removes it again.
		await act(async () => {
			await result.current.setConfigOption("model", "auto");
		});
		expect(optionIds(result.current.session.configOptions)).not.toContain(
			"effortLevel",
		);
		expect(server.setSessionModel).not.toHaveBeenCalled();
	});

	it("an effort pick is remembered for the agent (lastUsedThoughtLevels)", async () => {
		const server = makeV3Server("test-model-effort");
		const { access, snapshot } = makeSettingsAccess();
		const { result } = renderSession(server.agentClient, access);

		await act(async () => {
			await result.current.createSession();
		});
		await act(async () => {
			await result.current.setConfigOption("effortLevel", "high");
		});

		expect(
			(snapshot().lastUsedThoughtLevels as Record<string, string>)[AGENT],
		).toBe("high");
		expect(server.setSessionModel).not.toHaveBeenCalled();
	});

	it("a new session restores the saved model first, then the saved effort", async () => {
		const server = makeV3Server("auto");
		const { access } = makeSettingsAccess({
			model: "test-model-effort",
			effort: "high",
		});
		const { result } = renderSession(server.agentClient, access);

		await act(async () => {
			await result.current.createSession();
		});

		// Order matters: effortLevel does not exist until the model is set.
		expect(server.calls).toEqual([
			["model", "test-model-effort"],
			["effortLevel", "high"],
		]);
		const effort = result.current.session.configOptions?.find(
			(o) => o.id === "effortLevel",
		);
		expect(effort?.currentValue).toBe("high");
		expect(server.setSessionModel).not.toHaveBeenCalled();
	});

	it("a saved effort is skipped when the restored model has no effort option", async () => {
		const server = makeV3Server("auto");
		const { access } = makeSettingsAccess({ model: "auto", effort: "high" });
		const { result } = renderSession(server.agentClient, access);

		await act(async () => {
			await result.current.createSession();
		});

		expect(server.calls).toEqual([]);
		expect(result.current.session.state).toBe("ready");
		expect(server.setSessionModel).not.toHaveBeenCalled();
	});
});
