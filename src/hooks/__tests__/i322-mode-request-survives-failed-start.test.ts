/**
 * I322: a quick prompt's mode request survives a failed first session start,
 * and an agent switch drops it.
 *
 * Root cause: `createSession` read and cleared `pendingModeRequestRef` before
 * any await, and its catch never restored it. The retry (send again, or
 * Restart agent) then started in the agent's saved mode, and the held message
 * went out in that mode, possibly a more permissive one. Separately,
 * `setAgentWithoutSession` didn't clear the request, so switching agents
 * before the first start applied the old agent's mode id to the new agent.
 *
 * [[I322 A quick prompt mode request is lost when the first session start fails]].
 * Entered at the public hook API with only the ACP client port mocked.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { SessionConfigOption } from "../../types/session";

const AGENT = "test-agent";
const OTHER = "other-agent";

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

function makeSettings() {
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
			{ id: OTHER, displayName: "Other Agent", command: "other-cli", args: [], env: [] },
		],
		lastUsedModels: {},
		// Both agents' saved mode is the default one.
		lastUsedModes: { [AGENT]: "default", [OTHER]: "default" },
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

/** `failures` session starts reject before one succeeds. */
function makeClient(failures = 0) {
	let server: SessionConfigOption[] = [modeOption("default")];
	let current = AGENT;
	let left = failures;
	const setSessionConfigOption = vi.fn(async (_s: string, id: string, value: string) => {
		server = server.map((o) => (o.id === id ? { ...o, currentValue: value } : o));
		return server;
	});
	const newSession = vi.fn(async () => {
		if (left > 0) {
			left--;
			throw new Error("agent exited during session/new");
		}
		server = [modeOption("default")];
		return { sessionId: "s1", configOptions: server };
	});
	const client = {
		isInitialized: () => true,
		getCurrentAgentId: () => current,
		initialize: vi.fn(async (config: { id: string }) => {
			current = config.id;
			return null;
		}),
		acceptsInitialConfigPicks: () => false,
		newSession,
		getInitializeResult: () => null,
		setSessionConfigOption,
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return { client, newSession, setSessionConfigOption };
}

const modeOf = (o?: SessionConfigOption[]) => o?.find((x) => x.id === "mode")?.currentValue;

function mount(c: ReturnType<typeof makeClient>, s: ReturnType<typeof makeSettings>) {
	return renderHook(() =>
		useAgentSession(c.client, s.access, "/cwd", () => {}, AGENT, "plan"),
	);
}

describe("I322: a quick prompt's mode request outlives a failed first start", () => {
	it("the retry after a failed first start runs in the requested mode", async () => {
		const c = makeClient(1);
		const s = makeSettings();
		const { result } = mount(c, s);

		await act(async () => {
			await result.current.createSession(AGENT);
		});
		expect(result.current.session.state).toBe("error");

		await act(async () => {
			await result.current.createSession(AGENT);
		});

		expect(result.current.session.state).toBe("ready");
		expect(c.setSessionConfigOption).toHaveBeenCalledWith("s1", "mode", "plan");
		expect(modeOf(result.current.session.configOptions)).toBe("plan");
		expect(result.current.session.unmetModeRequest).toBeUndefined();
		// The request is never saved as the agent's default.
		expect(s.snapshot().lastUsedModes).toEqual({ [AGENT]: "default", [OTHER]: "default" });
	});

	it("survives several failed starts", async () => {
		const c = makeClient(2);
		const s = makeSettings();
		const { result } = mount(c, s);

		for (let i = 0; i < 3; i++) {
			await act(async () => {
				await result.current.createSession(AGENT);
			});
		}

		expect(modeOf(result.current.session.configOptions)).toBe("plan");
	});

	it("stays one-shot once a session is ready", async () => {
		const c = makeClient();
		const s = makeSettings();
		const { result } = mount(c, s);

		await act(async () => {
			await result.current.createSession(AGENT);
		});
		expect(modeOf(result.current.session.configOptions)).toBe("plan");
		await act(async () => {
			await result.current.createSession(AGENT);
		});

		expect(modeOf(result.current.session.configOptions)).toBe("default");
	});

	it("an agent switch before the first start drops the request", async () => {
		const c = makeClient();
		const s = makeSettings();
		const { result } = mount(c, s);

		await act(async () => {
			result.current.setAgentWithoutSession(OTHER);
		});
		await act(async () => {
			await result.current.createSession(OTHER);
		});

		expect(c.setSessionConfigOption).not.toHaveBeenCalledWith("s1", "mode", "plan");
		expect(modeOf(result.current.session.configOptions)).toBe("default");
		expect(result.current.session.unmetModeRequest).toBeUndefined();
	});
});
