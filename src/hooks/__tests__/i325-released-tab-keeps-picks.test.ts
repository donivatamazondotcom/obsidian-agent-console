/**
 * I325: a tab freed by the idle release (I209) reconnects in its own mode,
 * model and effort, not in the agent's saved picks, which may have been
 * chosen in another tab since.
 *
 * Root cause: `releaseSession` kept the session's modes and models for
 * display but re-armed nothing, so the reconnect (`updateSessionFromLoad`)
 * and its fallback (`createSession`) both re-applied `lastUsedModes`,
 * `lastUsedModels` and `lastUsedThoughtLevels`.
 *
 * [[I325 A released tab reconnects in the agent's saved mode instead of its own]].
 * Entered at the public hook API with only the ACP client port mocked.
 * Red-first: the reconnect and fallback cases fail before the release re-arms
 * the tab's picks.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type {
	SessionConfigOption,
	SessionModeState,
	SessionModelState,
} from "../../types/session";

const AGENT = "test-agent";

const option = (
	category: "model" | "thought_level" | "mode",
	current: string,
	values: string[],
): SessionConfigOption => ({
	id: category,
	name: category,
	category,
	type: "select",
	currentValue: current,
	options: values.map((value) => ({ value, name: value })),
});

/** A config-option agent's full snapshot. */
const config = (model: string, thought: string, mode: string) => [
	option("model", model, ["m-a", "m-b"]),
	option("thought_level", thought, ["low", "high"]),
	option("mode", mode, ["default", "plan"]),
];

const legacyModes = (current: string): SessionModeState => ({
	currentModeId: current,
	availableModes: [
		{ id: "default", name: "Manual" },
		{ id: "plan", name: "Plan Mode" },
	],
});
const legacyModels = (current: string): SessionModelState => ({
	currentModelId: current,
	availableModels: [
		{ modelId: "m-a", name: "Model A" },
		{ modelId: "m-b", name: "Model B" },
	],
});

interface Picks {
	model: string;
	thought: string;
	mode: string;
}

function makeSettings(picks: Picks) {
	let settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		antigravity: { id: "antigravity-acp", displayName: "Antigravity CLI", command: "agy", args: ["acp"], env: [], apiKeySecretId: "" },
		customAgents: [
			{ id: AGENT, displayName: "Test Agent", command: "test-cli", args: [], env: [] },
		],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	/** The agent's saved picks, as another tab would leave them. */
	const pick = (p: Picks) => {
		settings = {
			...settings,
			lastUsedModels: { [AGENT]: p.model },
			lastUsedThoughtLevels: { [AGENT]: p.thought },
			lastUsedModes: { [AGENT]: p.mode },
		};
	};
	pick(picks);
	const updateSettings = vi.fn(async (patch: Record<string, unknown>) => {
		settings = { ...settings, ...patch };
	});
	return {
		access: { getSnapshot: () => settings, updateSettings } as unknown as ISettingsAccess,
		pick,
		updateSettings,
	};
}

function makeClient(freshProcess: SessionConfigOption[] = config("m-b", "low", "default")) {
	let server: SessionConfigOption[] = freshProcess;
	const setSessionConfigOption = vi.fn(async (_s: string, id: string, value: string) => {
		server = server.map((o) => (o.id === id ? { ...o, currentValue: value } : o));
		return server;
	});
	const client = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(),
		acceptsInitialConfigPicks: () => false,
		storesSessionConfig: () => false,
		newSession: vi.fn(async () => {
			server = freshProcess;
			return { sessionId: "s-new", configOptions: server };
		}),
		getInitializeResult: () => null,
		setSessionConfigOption,
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
		disconnect: vi.fn(async () => {}),
		whenTornDown: vi.fn(async () => {}),
		whenDeletesSettled: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return {
		client,
		setSessionConfigOption,
		setSessionModel: client.setSessionModel as ReturnType<typeof vi.fn>,
		setSessionMode: client.setSessionMode as ReturnType<typeof vi.fn>,
	};
}

const valueOf = (o: SessionConfigOption[] | undefined, category: string) =>
	o?.find((x) => x.category === category)?.currentValue;

const TAB: Picks = { model: "m-a", thought: "high", mode: "plan" };
const OTHER_TAB: Picks = { model: "m-b", thought: "low", mode: "default" };

function mount(c: ReturnType<typeof makeClient>, s: ReturnType<typeof makeSettings>) {
	return renderHook(() => useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT));
}

/** Connect the tab in TAB's picks, then let another tab change the saved picks. */
async function connectThenOtherTabPicks(
	c: ReturnType<typeof makeClient>,
	s: ReturnType<typeof makeSettings>,
	result: ReturnType<typeof mount>["result"],
) {
	await act(async () => {
		await result.current.updateSessionFromLoad("s1", undefined, undefined, config("m-a", "high", "plan"));
	});
	expect(valueOf(result.current.session.configOptions, "mode")).toBe("plan");
	s.pick(OTHER_TAB);
	c.setSessionConfigOption.mockClear();
}

describe("I325: a released tab reconnects in its own picks", () => {
	it("config-option agent: the reconnect re-applies the tab's model, effort and mode", async () => {
		const c = makeClient();
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await connectThenOtherTabPicks(c, s, result);

		await act(async () => {
			await result.current.releaseSession();
		});
		await act(async () => {
			// The respawned process reports its own defaults.
			await result.current.updateSessionFromLoad("s1", undefined, undefined, config("m-b", "low", "default"));
		});

		const opts = result.current.session.configOptions;
		expect(valueOf(opts, "model")).toBe("m-a");
		expect(valueOf(opts, "thought_level")).toBe("high");
		expect(valueOf(opts, "mode")).toBe("plan");
		// The tab's picks are re-applied, never saved as the agent's default.
		expect(s.updateSettings).not.toHaveBeenCalled();
	});

	it("legacy mode and model API: the reconnect re-applies the tab's mode and model", async () => {
		const c = makeClient();
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await act(async () => {
			await result.current.updateSessionFromLoad("s1", legacyModes("plan"), legacyModels("m-a"));
		});
		s.pick(OTHER_TAB);

		await act(async () => {
			await result.current.releaseSession();
		});
		await act(async () => {
			await result.current.updateSessionFromLoad("s1", legacyModes("default"), legacyModels("m-b"));
		});

		expect(c.setSessionMode).toHaveBeenLastCalledWith("s1", "plan");
		expect(c.setSessionModel).toHaveBeenLastCalledWith("s1", "m-a");
		expect(result.current.session.modes?.currentModeId).toBe("plan");
		expect(result.current.session.models?.currentModelId).toBe("m-a");
	});

	it("a failed reconnect's new session also starts in the tab's picks", async () => {
		const c = makeClient();
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await connectThenOtherTabPicks(c, s, result);

		await act(async () => {
			await result.current.releaseSession();
		});
		// The load failed, so the lazy owner falls back to a new session.
		await act(async () => {
			await result.current.createSession(AGENT);
		});

		const opts = result.current.session.configOptions;
		expect(valueOf(opts, "model")).toBe("m-a");
		expect(valueOf(opts, "thought_level")).toBe("high");
		expect(valueOf(opts, "mode")).toBe("plan");
	});

	it("New chat after a release uses the agent's saved picks, as on a live tab", async () => {
		const c = makeClient();
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await connectThenOtherTabPicks(c, s, result);

		await act(async () => {
			await result.current.releaseSession();
		});
		await act(async () => {
			result.current.setAgentWithoutSession(AGENT);
		});
		await act(async () => {
			await result.current.createSession(AGENT);
		});

		const opts = result.current.session.configOptions;
		expect(valueOf(opts, "model")).toBe("m-b");
		expect(valueOf(opts, "mode")).toBe("default");
		expect(c.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("is one-shot: a later load without a release uses the saved picks", async () => {
		const c = makeClient();
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await connectThenOtherTabPicks(c, s, result);

		await act(async () => {
			await result.current.releaseSession();
		});
		await act(async () => {
			await result.current.updateSessionFromLoad("s1", undefined, undefined, config("m-b", "low", "default"));
		});
		await act(async () => {
			await result.current.updateSessionFromLoad("s2", undefined, undefined, config("m-a", "high", "plan"));
		});

		const opts = result.current.session.configOptions;
		expect(valueOf(opts, "model")).toBe("m-b");
		expect(valueOf(opts, "mode")).toBe("default");
	});
});
