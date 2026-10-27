/**
 * I217: on Kiro CLI V3 the saved model was not restored when the `model`
 * option arrived late.
 *
 * V3 sometimes leaves `model` out of the `session/new` response and pushes it
 * later in a `config_option_update`, after it refreshes the model catalog over
 * the network (V3 server models registry, kiro-cli 2.34.2-nightly.1). Restore
 * read only the response, so it found nothing to set. A fixed wait would race
 * the network, so the fix uses the documented V3 session inputs instead
 * (`_meta.kiro.modelId` / `effortLevel` on `session/new`, migration guide
 * 2026-10-09): the server applies the picks itself.
 *
 * The server does not check the model id, so every config snapshot is checked:
 * a model the server reports but doesn't offer is reset to the first offered
 * value, once per session, with a notice.
 *
 * Entered at the public hook API with only the ACP client port mocked (R2,
 * R4); asserts session state, persisted settings and the notice (R3).
 * Red-first (R1): both cases fail before the I217 change.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Notice } from "obsidian";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { SessionConfigOption } from "../../types/session";

const AGENT = "test-agent";

const mode: SessionConfigOption = {
	id: "mode", name: "Mode", category: "mode", type: "select",
	currentValue: "test-mode", options: [{ value: "test-mode", name: "Test mode" }],
};
const model = (current: string): SessionConfigOption => ({
	id: "model", name: "Model", category: "model", type: "select",
	currentValue: current,
	options: [
		{ value: "auto", name: "Auto" },
		{ value: "test-model-effort", name: "Test model (effort)" },
	],
});
const effort = (current: string): SessionConfigOption => ({
	id: "effortLevel", name: "Effort", category: "thought_level", type: "select",
	currentValue: current,
	options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }],
});

function makeSettings(saved: { model?: string; effort?: string }) {
	let settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [{ id: AGENT, displayName: "Test Agent", command: "kiro-cli", args: ["acp"], env: [], engine: "v3" }],
		lastUsedModels: saved.model ? { [AGENT]: saved.model } : {},
		lastUsedModes: {},
		lastUsedThoughtLevels: saved.effort ? { [AGENT]: saved.effort } : {},
	};
	return {
		access: {
			getSnapshot: () => settings,
			updateSettings: vi.fn(async (patch: Record<string, unknown>) => {
				settings = { ...settings, ...patch };
			}),
		} as unknown as ISettingsAccess,
		snapshot: () => settings,
	};
}

/** A V3-like client: accepts picks as session inputs and applies them itself. */
function makeV3Client(initial: SessionConfigOption[]) {
	// Answers with the full snapshot, like V3: a model switch returns the
	// option list with the new model selected.
	let server = initial;
	const setSessionConfigOption = vi.fn(async (_s: string, id: string, value: string) => {
		server =
			id === "model"
				? [...server.filter((o) => o.id !== "model"), model(value)]
				: server.map((o) => (o.id === id ? { ...o, currentValue: value } : o));
		return server;
	});
	/** Server-side state change pushed to the client (a config_option_update). */
	const setServerState = (next: SessionConfigOption[]) => {
		server = next;
	};
	const newSession = vi.fn(async (_cwd: string, _picks?: { modelId?: string; effortLevel?: string }) => ({
		sessionId: "s1",
		modes: undefined,
		models: undefined,
		configOptions: initial,
	}));
	const client = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(),
		acceptsInitialConfigPicks: () => true,
		newSession,
		getInitializeResult: () => null,
		setSessionConfigOption,
		setSessionModel: vi.fn(async () => { throw new Error("Internal error"); }),
		setSessionMode: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return { client, newSession, setSessionConfigOption, setServerState };
}

beforeEach(() => {
	(Notice as unknown as { instances: unknown[] }).instances = [];
});

describe("I217: saved picks go to V3 as session/new inputs", () => {
	it("model option missing from the response, arriving later: picks were already sent, no client-side restore calls", async () => {
		// The response has no model option yet (it arrives in a later update).
		const v3 = makeV3Client([mode]);
		const { access } = makeSettings({ model: "test-model-effort", effort: "high" });
		const { result } = renderHook(() => useAgentSession(v3.client, access, "/cwd", () => {}, AGENT));

		await act(async () => {
			await result.current.createSession();
		});

		expect(v3.newSession).toHaveBeenCalledWith("/cwd", {
			modelId: "test-model-effort",
			effortLevel: "high",
		});
		expect(v3.setSessionConfigOption).not.toHaveBeenCalled();

		// The late update reflects the picks the server applied.
		act(() =>
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "config_option_update",
				configOptions: [mode, model("test-model-effort"), effort("high")],
			}),
		);
		const byId = Object.fromEntries(
			(result.current.session.configOptions ?? []).map((o) => [o.id, o.currentValue]),
		);
		expect(byId).toMatchObject({ model: "test-model-effort", effortLevel: "high" });
		expect(v3.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("a saved model the server doesn't offer is reset to the first offered model, once, with a notice", async () => {
		const v3 = makeV3Client([mode]);
		const { access, snapshot } = makeSettings({ model: "retired-model" });
		const { result } = renderHook(() => useAgentSession(v3.client, access, "/cwd", () => {}, AGENT));

		await act(async () => {
			await result.current.createSession();
		});
		// The server took the unknown id as current (seen live) and pushes it.
		v3.setServerState([mode, model("retired-model")]);
		await act(async () => {
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "config_option_update",
				configOptions: [mode, model("retired-model")],
			});
		});
		// A second identical snapshot must not trigger a second reset.
		await act(async () => {
			result.current.handleSessionUpdate({
				sessionId: "s1",
				type: "config_option_update",
				configOptions: [mode, model("retired-model")],
			});
		});

		expect(v3.setSessionConfigOption).toHaveBeenCalledTimes(1);
		expect(v3.setSessionConfigOption).toHaveBeenCalledWith("s1", "model", "auto");
		expect((snapshot().lastUsedModels as Record<string, string>)[AGENT]).toBe("auto");
		expect((Notice as unknown as { instances: unknown[] }).instances).toHaveLength(1);
	});

	// Kiro V3 drops _meta.kiro.effortLevel on a cold start (model list still
	// loading) and uses the model default – reproduced 3x on 2.34.2-nightly.1.
	// The client knows what it asked for, so it corrects from the snapshots.

	it("effort in the response but not the saved value: corrected before the session is ready", async () => {
		const v3 = makeV3Client([mode, model("test-model-effort"), effort("medium")]);
		const { access } = makeSettings({ model: "test-model-effort", effort: "high" });
		const { result } = renderHook(() => useAgentSession(v3.client, access, "/cwd", () => {}, AGENT));

		await act(async () => {
			await result.current.createSession();
		});

		// Model already matches (server applied it), so only effort is set.
		expect(v3.setSessionConfigOption.mock.calls).toEqual([["s1", "effortLevel", "high"]]);
		expect(result.current.session.state).toBe("ready");
		const eff = result.current.session.configOptions?.find((o) => o.id === "effortLevel");
		expect(eff?.currentValue).toBe("high");
	});

	it("effort arrives only in a later update with the default: corrected once when it shows up", async () => {
		const v3 = makeV3Client([mode]);
		const { access } = makeSettings({ model: "test-model-effort", effort: "high" });
		const { result } = renderHook(() => useAgentSession(v3.client, access, "/cwd", () => {}, AGENT));

		await act(async () => {
			await result.current.createSession();
		});
		expect(v3.setSessionConfigOption).not.toHaveBeenCalled();

		const late = [mode, model("test-model-effort"), effort("medium")];
		v3.setServerState(late);
		await act(async () => {
			result.current.handleSessionUpdate({ sessionId: "s1", type: "config_option_update", configOptions: late });
		});
		// A repeat of the same snapshot (V3 refreshes the catalog) must not
		// re-apply the saved pick – after the first correction it's the
		// user's to change.
		await act(async () => {
			result.current.handleSessionUpdate({ sessionId: "s1", type: "config_option_update", configOptions: late });
		});

		expect(v3.setSessionConfigOption.mock.calls).toEqual([["s1", "effortLevel", "high"]]);
	});

	it("a config_option_update that lands while the session is still initializing is not overwritten by the older response", async () => {
		// The real I217 trigger seen in smoke: the server pushes the model
		// catalog (with effort dropped to the default) before createSession
		// finishes, and createSession then wrote its older response snapshot
		// – without a model option – over it.
		const v3 = makeV3Client([mode]);
		const { access } = makeSettings({ model: "test-model-effort", effort: "high" });
		const hook: { current?: ReturnType<typeof useAgentSession> } = {};
		const late = [mode, model("test-model-effort"), effort("medium")];
		v3.newSession.mockImplementation(async () => {
			// Delivered after the response is parsed, before createSession resumes.
			queueMicrotask(() => {
				v3.setServerState(late);
				hook.current?.handleSessionUpdate({ sessionId: "s1", type: "config_option_update", configOptions: late });
			});
			return { sessionId: "s1", modes: undefined, models: undefined, configOptions: [mode] };
		});
		const { result } = renderHook(() => {
			const r = useAgentSession(v3.client, access, "/cwd", () => {}, AGENT);
			hook.current = r;
			return r;
		});

		await act(async () => {
			await result.current.createSession();
		});
		await act(async () => {
			await Promise.resolve();
		});

		const byId = Object.fromEntries(
			(result.current.session.configOptions ?? []).map((o) => [o.id, o.currentValue]),
		);
		expect(byId.model).toBe("test-model-effort");
		// And the dropped effort is put back.
		expect(v3.setSessionConfigOption.mock.calls).toEqual([["s1", "effortLevel", "high"]]);
	});
});

