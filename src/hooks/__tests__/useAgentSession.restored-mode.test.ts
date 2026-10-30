/**
 * I231: a restored tab reconnects in ITS OWN mode, not the agent's saved
 * default. The persisted per-tab mode replaces the saved mode for the load's
 * pre-ready re-apply only — never written to `lastUsedModes`, never blocks a
 * send when the mode is gone (silent fallback to the saved pick).
 *
 * [[I231 Restored tab loses a quick prompt's mode]].
 * Entered at the public hook API with only the ACP client port mocked.
 * Red-first: fails before `restoredModeId` exists.
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
		{ value: "default", name: "Manual" },
		{ value: "plan", name: "Plan Mode" },
	],
});
const legacyModes = (current: string): SessionModeState => ({
	currentModeId: current,
	availableModes: [
		{ id: "default", name: "Manual" },
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
		snapshot: () => settings,
	};
}

function makeClient(keepsOwnConfig = false) {
	let server: SessionConfigOption[] = [modeOption("default")];
	const setSessionConfigOption = vi.fn(async (_s: string, id: string, value: string) => {
		server = server.map((o) => (o.id === id ? { ...o, currentValue: value } : o));
		return server;
	});
	const setSessionMode = vi.fn(async () => {});
	const client = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(),
		acceptsInitialConfigPicks: () => false,
		storesSessionConfig: () => keepsOwnConfig,
		newSession: vi.fn(),
		getInitializeResult: () => null,
		setSessionConfigOption,
		setSessionModel: vi.fn(async () => {}),
		setSessionMode,
	} as unknown as AcpClient;
	return { client, setSessionConfigOption, setSessionMode };
}

const modeOf = (o?: SessionConfigOption[]) => o?.find((x) => x.id === "mode")?.currentValue;

function mount(c: ReturnType<typeof makeClient>, s: ReturnType<typeof makeSettings>, restoredModeId?: string) {
	return renderHook(() =>
		useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, undefined, restoredModeId),
	);
}

describe("I231: restored tab re-applies its own mode on load", () => {
	it("config-option agent: applies the tab's mode, not the saved default, and doesn't save it", async () => {
		const c = makeClient();
		const s = makeSettings("default");
		const { result } = mount(c, s, "plan");

		await act(async () => {
			await result.current.updateSessionFromLoad("s1", undefined, undefined, [modeOption("default")]);
		});

		expect(c.setSessionConfigOption).toHaveBeenCalledWith("s1", "mode", "plan");
		expect(modeOf(result.current.session.configOptions)).toBe("plan");
		expect(s.snapshot().lastUsedModes).toEqual({ [AGENT]: "default" });
	});

	it("legacy-modes agent: applies the tab's mode via set_mode", async () => {
		const c = makeClient();
		const s = makeSettings();
		const { result } = mount(c, s, "plan");

		await act(async () => {
			await result.current.updateSessionFromLoad("s1", legacyModes("default"));
		});

		expect(c.setSessionMode).toHaveBeenCalledWith("s1", "plan");
		expect(result.current.session.modes?.currentModeId).toBe("plan");
		expect(s.snapshot().lastUsedModes).toEqual({});
	});

	it("falls back silently to the saved mode when the tab's mode is gone", async () => {
		const c = makeClient();
		const s = makeSettings("default");
		const { result } = mount(c, s, "retired-mode");

		await act(async () => {
			await result.current.updateSessionFromLoad("s1", undefined, undefined, [modeOption("plan")]);
		});

		expect(c.setSessionConfigOption).toHaveBeenCalledWith("s1", "mode", "default");
		expect(result.current.session.unmetModeRequest).toBeUndefined();
	});

	it("agents that keep their own config on the server (Kiro V3) are left alone", async () => {
		const c = makeClient(true);
		const s = makeSettings();
		const { result } = mount(c, s, "plan");

		await act(async () => {
			await result.current.updateSessionFromLoad("s1", undefined, undefined, [modeOption("default")]);
		});

		expect(c.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("is one-shot: a second load uses the saved default", async () => {
		const c = makeClient();
		const s = makeSettings("default");
		const { result } = mount(c, s, "plan");

		await act(async () => {
			await result.current.updateSessionFromLoad("s1", undefined, undefined, [modeOption("default")]);
		});
		c.setSessionConfigOption.mockClear();
		await act(async () => {
			await result.current.updateSessionFromLoad("s2", undefined, undefined, [modeOption("plan")]);
		});

		expect(c.setSessionConfigOption).toHaveBeenCalledWith("s2", "mode", "default");
	});
});
