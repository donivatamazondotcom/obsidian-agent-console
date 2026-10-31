/**
 * Quick prompt agent/mode — the new tab's first session starts in the
 * prompt's mode, applied before the session is marked ready, without
 * changing the agent's remembered default (`lastUsedModes`).
 *
 * Spec: [[Agent Console Quick Prompt Agent and Mode]] T06, T07 (hook halves).
 * Entered at the public hook API with only the ACP client port mocked;
 * asserts session state, ACP calls and persisted settings.
 * Red-first: every case fails before `initialModeRequest` exists.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { SessionConfigOption, SessionModeState } from "../../types/session";

const AGENT = "test-agent";

const modeOption = (current: string): SessionConfigOption => ({
	id: "mode",
	name: "Mode",
	category: "mode",
	type: "select",
	currentValue: current,
	options: [
		{ value: "vibe", name: "Default" },
		{ value: "spec", name: "Spec" },
	],
});
const legacyModes = (current: string): SessionModeState => ({
	currentModeId: current,
	availableModes: [
		{ id: "default", name: "Default" },
		{ id: "plan", name: "Plan Mode" },
	],
});

function makeSettings(savedMode?: string) {
	let settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [
			{ id: AGENT, displayName: "Test Agent", command: "test-cli", args: [], env: [] },
		],
		lastUsedModels: {},
		lastUsedModes: savedMode ? { [AGENT]: savedMode } : {},
		lastUsedThoughtLevels: {},
	};
	const updateSettings = vi.fn(async (patch: Record<string, unknown>) => {
		settings = { ...settings, ...patch };
	});
	return {
		access: { getSnapshot: () => settings, updateSettings } as unknown as ISettingsAccess,
		updateSettings,
		snapshot: () => settings,
	};
}

function makeClient(response: {
	configOptions?: SessionConfigOption[];
	modes?: SessionModeState;
}) {
	let server = response.configOptions;
	const setSessionConfigOption = vi.fn(async (_s: string, id: string, value: string) => {
		server = (server ?? []).map((o) => (o.id === id ? { ...o, currentValue: value } : o));
		return server;
	});
	const setSessionMode = vi.fn(async () => {});
	const newSession = vi.fn(async () => ({
		sessionId: "s1",
		modes: response.modes,
		models: undefined,
		configOptions: response.configOptions,
	}));
	const client = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(),
		acceptsInitialConfigPicks: () => false,
		newSession,
		getInitializeResult: () => null,
		setSessionConfigOption,
		setSessionModel: vi.fn(async () => {}),
		setSessionMode,
	} as unknown as AcpClient;
	return { client, newSession, setSessionConfigOption, setSessionMode };
}

const currentMode = (configOptions?: SessionConfigOption[]) =>
	configOptions?.find((o) => o.id === "mode")?.currentValue;

describe("initialModeRequest — config-option agents (Kiro V3 shape)", () => {
	it("applies the requested mode by display name before ready, and does not save it as the default", async () => {
		const c = makeClient({ configOptions: [modeOption("vibe")] });
		const s = makeSettings();
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "Spec"),
		);

		await act(async () => {
			await result.current.createSession();
		});

		expect(c.setSessionConfigOption).toHaveBeenCalledWith("s1", "mode", "spec");
		expect(result.current.session.state).toBe("ready");
		expect(currentMode(result.current.session.configOptions)).toBe("spec");
		expect(result.current.session.unmetModeRequest).toBeUndefined();
		expect(s.snapshot().lastUsedModes).toEqual({});
		expect(s.updateSettings).not.toHaveBeenCalledWith(
			expect.objectContaining({ lastUsedModes: expect.anything() }),
		);
	});

	it("wins over the agent's saved mode for this session only", async () => {
		const c = makeClient({ configOptions: [modeOption("vibe")] });
		const s = makeSettings("vibe");
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "spec"),
		);

		await act(async () => {
			await result.current.createSession();
		});

		expect(currentMode(result.current.session.configOptions)).toBe("spec");
		expect(s.snapshot().lastUsedModes).toEqual({ [AGENT]: "vibe" });
	});

	it("is one-shot: a later session start falls back to the saved mode", async () => {
		const c = makeClient({ configOptions: [modeOption("vibe")] });
		const s = makeSettings();
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "spec"),
		);

		await act(async () => {
			await result.current.createSession();
		});
		c.setSessionConfigOption.mockClear();
		await act(async () => {
			await result.current.createSession();
		});

		expect(c.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("records an unmet request when the session doesn't offer the mode, and applies nothing", async () => {
		const c = makeClient({ configOptions: [modeOption("vibe")] });
		const s = makeSettings();
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "yolo"),
		);

		await act(async () => {
			await result.current.createSession();
		});

		expect(result.current.session.state).toBe("ready");
		expect(result.current.session.unmetModeRequest).toBe("yolo");
		expect(c.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("clears an unmet request when the next session starts", async () => {
		const c = makeClient({ configOptions: [modeOption("vibe")] });
		const s = makeSettings();
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "yolo"),
		);

		await act(async () => {
			await result.current.createSession();
		});
		await act(async () => {
			await result.current.createSession();
		});

		expect(result.current.session.unmetModeRequest).toBeUndefined();
	});
});

describe("initialModeRequest — legacy-modes agents", () => {
	it("applies the requested mode via set_mode before ready, without saving it", async () => {
		const c = makeClient({ modes: legacyModes("default") });
		const s = makeSettings();
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "Plan Mode"),
		);

		await act(async () => {
			await result.current.createSession();
		});

		expect(c.setSessionMode).toHaveBeenCalledWith("s1", "plan");
		expect(result.current.session.modes?.currentModeId).toBe("plan");
		expect(result.current.session.unmetModeRequest).toBeUndefined();
		expect(s.snapshot().lastUsedModes).toEqual({});
	});

	it("records an unmet request when the agent has no modes at all", async () => {
		const c = makeClient({});
		const s = makeSettings();
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "plan"),
		);

		await act(async () => {
			await result.current.createSession();
		});

		expect(result.current.session.unmetModeRequest).toBe("plan");
	});
});

describe("no initialModeRequest", () => {
	it("leaves the saved-mode restore unchanged", async () => {
		const c = makeClient({ configOptions: [modeOption("vibe")] });
		const s = makeSettings("spec");
		const { result } = renderHook(() =>
			useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT),
		);

		await act(async () => {
			await result.current.createSession();
		});

		expect(c.setSessionConfigOption).toHaveBeenCalledWith("s1", "mode", "spec");
		expect(result.current.session.unmetModeRequest).toBeUndefined();
	});
});
