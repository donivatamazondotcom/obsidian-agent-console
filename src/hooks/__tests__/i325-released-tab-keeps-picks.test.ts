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

function makeClient(
	freshProcess: SessionConfigOption[] = config("m-b", "low", "default"),
	opts: { picksAsInputs?: boolean; failNewSession?: number } = {},
) {
	let server: SessionConfigOption[] = freshProcess;
	let failures = opts.failNewSession ?? 0;
	const setSessionConfigOption = vi.fn(async (_s: string, id: string, value: string) => {
		server = server.map((o) => (o.id === id ? { ...o, currentValue: value } : o));
		return server;
	});
	const client = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(),
		acceptsInitialConfigPicks: () => opts.picksAsInputs === true,
		storesSessionConfig: () => false,
		newSession: vi.fn(async (_cwd: string, _inputs?: { modelId?: string; effortLevel?: string }) => {
			if (failures > 0) {
				failures--;
				throw new Error("agent exited during session/new");
			}
			server = freshProcess;
			return { sessionId: "s-new", configOptions: server };
		}),
		getInitializeResult: () => null,
		setSessionConfigOption,
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
		cancel: vi.fn(async () => {}),
		disconnect: vi.fn(async () => {}),
		whenTornDown: vi.fn(async () => {}),
		whenDeletesSettled: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return {
		client,
		setSessionConfigOption,
		/** Server-side state change, as a config_option_update reports it. */
		setServer: (next: SessionConfigOption[]) => {
			server = next;
		},
		newSession: client.newSession as ReturnType<typeof vi.fn>,
		setSessionModel: client.setSessionModel as ReturnType<typeof vi.fn>,
		setSessionMode: client.setSessionMode as ReturnType<typeof vi.fn>,
	};
}

const valueOf = (o: SessionConfigOption[] | undefined, category: string) =>
	o?.find((x) => x.category === category)?.currentValue;

const TAB: Picks = { model: "m-a", thought: "high", mode: "plan" };
const OTHER_TAB: Picks = { model: "m-b", thought: "low", mode: "default" };

function mount(
	c: ReturnType<typeof makeClient>,
	s: ReturnType<typeof makeSettings>,
	restoredModeId?: string,
) {
	return renderHook(() =>
		useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, undefined, restoredModeId),
	);
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
	it("a retry after a failed fallback still starts in the tab's picks", async () => {
		const c = makeClient(undefined, { failNewSession: 1 });
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await connectThenOtherTabPicks(c, s, result);

		await act(async () => {
			await result.current.releaseSession();
		});
		await act(async () => {
			await result.current.createSession(AGENT);
		});
		expect(result.current.session.state).toBe("error");
		await act(async () => {
			await result.current.createSession(AGENT);
		});

		expect(valueOf(result.current.session.configOptions, "mode")).toBe("plan");
		expect(valueOf(result.current.session.configOptions, "model")).toBe("m-a");
	});

	it("a hard reload of a released tab starts from the saved picks, as on a live tab", async () => {
		const c = makeClient();
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await connectThenOtherTabPicks(c, s, result);

		await act(async () => {
			await result.current.releaseSession();
		});
		// Hard reload and Restart agent: closeSession, then a fresh session.
		await act(async () => {
			await result.current.closeSession();
		});
		await act(async () => {
			await result.current.createSession(AGENT);
		});

		expect(valueOf(result.current.session.configOptions, "mode")).toBe("default");
		expect(c.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("legacy API: a failed reconnect's new session starts in the tab's mode and model", async () => {
		const c = makeClient();
		(c.newSession as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
			sessionId: "s-new",
			modes: legacyModes("default"),
			models: legacyModels("m-b"),
		}));
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
			await result.current.createSession(AGENT);
		});

		expect(c.setSessionMode).toHaveBeenLastCalledWith("s-new", "plan");
		expect(c.setSessionModel).toHaveBeenLastCalledWith("s-new", "m-a");
	});

	it("V3-style inputs: the fallback sends the tab's picks and never saves a late option", async () => {
		// The respawned process reports no effort option yet.
		const noEffort = [option("model", "m-b", ["m-a", "m-b"]), option("mode", "default", ["default", "plan"])];
		const c = makeClient(noEffort, { picksAsInputs: true });
		const s = makeSettings(TAB);
		const { result } = mount(c, s);
		await connectThenOtherTabPicks(c, s, result);

		await act(async () => {
			await result.current.releaseSession();
		});
		await act(async () => {
			await result.current.createSession(AGENT);
		});
		expect(c.newSession).toHaveBeenLastCalledWith("/cwd", { modelId: "m-a", effortLevel: "high" });

		// The effort option arrives late.
		const withEffort = [...noEffort, option("thought_level", "low", ["low", "high"])];
		c.setServer(withEffort);
		await act(async () => {
			result.current.handleSessionUpdate({
				type: "config_option_update",
				sessionId: "s-new",
				configOptions: withEffort,
			});
		});
		await vi.waitFor(() =>
			expect(c.setSessionConfigOption).toHaveBeenCalledWith("s-new", "thought_level", "high"),
		);
		// Let the late apply finish, including any settings save after it.
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		// Another tab's saved picks stay as they were.
		expect(s.updateSettings).not.toHaveBeenCalled();
	});
});

describe("I325: a restored tab's own mode (I231) and the release", () => {
	it("a restored tab whose load fails starts its new session in its own mode", async () => {
		const c = makeClient();
		const s = makeSettings(OTHER_TAB);
		const { result } = mount(c, s, "plan");

		await act(async () => {
			await result.current.createSession(AGENT);
		});

		expect(valueOf(result.current.session.configOptions, "mode")).toBe("plan");
		expect(s.updateSettings).not.toHaveBeenCalled();
	});

	it("a mode picked after the restore wins over the restored mode at the reconnect", async () => {
		const c = makeClient();
		const s = makeSettings(OTHER_TAB);
		const { result } = mount(c, s, "plan");
		// Restored tab's load failed: a new session in its own mode.
		await act(async () => {
			await result.current.createSession(AGENT);
		});
		// The user picks Manual in this tab (saved as the agent's default too).
		await act(async () => {
			await result.current.setConfigOption("mode", "default");
		});
		s.pick({ ...OTHER_TAB, mode: "plan" });

		await act(async () => {
			await result.current.releaseSession();
		});
		await act(async () => {
			await result.current.updateSessionFromLoad("s-new", undefined, undefined, config("m-b", "low", "plan"));
		});

		expect(valueOf(result.current.session.configOptions, "mode")).toBe("default");
	});

	it("New chat on a restored tab uses the saved mode, not the restored one", async () => {
		const c = makeClient();
		const s = makeSettings(OTHER_TAB);
		const { result } = mount(c, s, "plan");

		await act(async () => {
			result.current.setAgentWithoutSession(AGENT);
		});
		await act(async () => {
			await result.current.createSession(AGENT);
		});

		expect(valueOf(result.current.session.configOptions, "mode")).toBe("default");
	});
});
