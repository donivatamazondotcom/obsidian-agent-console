/**
 * Kiro CLI V3 S3 (spec T6): sessions survive a mount → persist → unmount →
 * remount through `session/load`, and a loaded V3 session keeps its own
 * model, effort and mode.
 *
 * Verified live on kiro-cli 2.34.2-nightly.1 (2026-10-26):
 *   - `session/load` replays the conversation (`_meta.kiro.replay`) and
 *     sends a `config_option_update` with the same values as its response
 *   - V3 stores model and effort per session: a session saved on Sonnet 5.5 /
 *     Max reloads on Sonnet 5.5 / Max in a fresh process
 * So the plugin must NOT re-apply the user's last-used picks on load for V3
 * (decision a1); it would silently change a past conversation's model.
 *
 * The test uses the real AcpClient and its update handler with only the wire
 * stubbed (R2, R4): the client must route replayed chunks to the remounted
 * hook (handler registered before load), send cwd + mcpServers on load and
 * fork, and leave the loaded session's config alone (R3).
 * Red-first (R1): the "keeps its own model" assertions fail before S3; the
 * request-shape and replay assertions pin today's behavior.
 *
 * Spec: [[Kiro CLI V3 Support]] § T6.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { loadExistingSessionFlow } from "../loadExistingSessionFlow";
import { AcpClient } from "../../acp/acp-client";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { SessionConfigOption } from "../../types/session";

const AGENT = "test-agent";
const CWD = "/vault";

const opt = (id: string, category: string | undefined, current: string, values: string[]): SessionConfigOption => ({
	id,
	name: id,
	category,
	type: "select",
	currentValue: current,
	options: values.map((v) => ({ value: v, name: v })),
});
const snapshot = (model: string, effort: string): SessionConfigOption[] => [
	opt("mode", "mode", "test-mode", ["test-mode", "other-mode"]),
	opt("model", "model", model, ["auto", "test-model-a", "test-model-b"]),
	opt("effortLevel", "thought_level", effort, ["low", "medium", "high", "max"]),
];

function makeSettings() {
	const settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [
			{ id: AGENT, displayName: "Test Agent", command: "kiro-cli", args: ["acp"], env: [], engine: "v3" },
		],
		// The user's last-used picks differ from what the past session used.
		lastUsedModels: { [AGENT]: "test-model-a" },
		lastUsedModes: { [AGENT]: "other-mode" },
		lastUsedThoughtLevels: { [AGENT]: "high" },
	};
	return {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
}

/** A real AcpClient on the V3 engine whose wire is a scripted fake server. */
function makeV3Client(
	onRequest: (client: AcpClient, method: string, params: Record<string, unknown>) => unknown,
) {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const internals = client as unknown as {
		currentConfig: unknown;
		requireConnection: () => unknown;
	};
	internals.currentConfig = {
		id: AGENT, displayName: "Test Agent", command: "kiro-cli", args: ["acp"],
		workingDirectory: CWD, kiroEngine: "v3",
	};
	vi.spyOn(client, "isInitialized").mockReturnValue(true);
	vi.spyOn(client, "getCurrentAgentId").mockReturnValue(AGENT);
	const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
	const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
		requests.push({ method, params });
		return onRequest(client, method, params);
	});
	vi.spyOn(internals, "requireConnection").mockReturnValue({ agent: { request } });
	return { client, requests };
}

/** Deliver a server notification through the client's real update handler. */
function notify(client: AcpClient, sessionId: string, update: Record<string, unknown>) {
	const handler = (client as unknown as { handler: { sessionUpdate: (p: unknown) => Promise<void> } }).handler;
	void handler.sessionUpdate({ sessionId, update });
}

const vault = {} as IVaultAccess & IMentionService;

describe("Kiro V3 S3: session lifecycle (T6)", () => {
	it("mount → persist → unmount → remount: load sends cwd + mcpServers, replays history, keeps the session's own config", async () => {
		// 1. First process: a session that ended on test-model-b / max.
		// (The first process's own restore is out of scope here; its server
		// just answers with the session's state.)
		const first = makeV3Client((_c, method) =>
			method === "session/new"
				? { sessionId: "s1", configOptions: snapshot("test-model-b", "max") }
				: method === "session/set_config_option"
					? { configOptions: snapshot("test-model-b", "max") }
					: {},
		);
		const settings = makeSettings();
		const mount1 = renderHook(() => useAgent(first.client, settings, vault, CWD, AGENT));
		await act(async () => {
			await mount1.result.current.createSession();
		});
		// 2. Persist what tab persistence keeps across a restart.
		const persisted = { sessionId: mount1.result.current.session.sessionId };
		expect(persisted.sessionId).toBe("s1");
		mount1.unmount();

		// 3. Fresh process: load replays the conversation, sends a config
		//    update with the session's stored values, then responds.
		const second = makeV3Client((client, method, params) => {
			if (method !== "session/load") return {};
			const sid = params.sessionId as string;
			notify(client, sid, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Reply with only the word PONG" } });
			notify(client, sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "PONG" } });
			notify(client, sid, { sessionUpdate: "config_option_update", configOptions: snapshot("test-model-b", "max") });
			return { configOptions: snapshot("test-model-b", "max") };
		});
		const setConfig = vi.spyOn(second.client, "setSessionConfigOption");
		const mount2 = renderHook(() => useAgent(second.client, settings, vault, CWD, AGENT));

		// 4. Remount: restored tab reconnects (no local history → replay shows).
		let outcome: Awaited<ReturnType<typeof loadExistingSessionFlow>> | undefined;
		await act(async () => {
			outcome = await loadExistingSessionFlow({
				sessionId: persisted.sessionId as string,
				cwd: CWD,
				haveLocalHistory: false,
				loadSession: (id, cwd) => second.client.loadSession(id, cwd),
				onLoaded: (r) =>
					void mount2.result.current.updateSessionFromLoad(r.sessionId, r.modes, r.models, r.configOptions),
				setIgnoreUpdates: mount2.result.current.setIgnoreUpdates,
			});
		});
		expect(outcome).toEqual({ ok: true, sessionId: "s1" });

		// Load re-sends the client-owned inputs (migration guide §3).
		const load = second.requests.find((r) => r.method === "session/load");
		expect(load?.params).toEqual({ sessionId: "s1", cwd: CWD, mcpServers: [] });

		// Replayed messages reached the remounted hook: the update handler was
		// live before the load request.
		await waitFor(() => {
			const text = mount2.result.current.messages
				.flatMap((m) => m.content)
				.map((c) => ("text" in c ? c.text : ""))
				.join(" ");
			expect(text).toContain("PONG");
		});

		// a1: the loaded session keeps its own model, effort and mode.
		await waitFor(() => expect(mount2.result.current.session.state).toBe("ready"));
		const byId = Object.fromEntries(
			(mount2.result.current.session.configOptions ?? []).map((o) => [o.id, o.currentValue]),
		);
		expect(byId).toEqual({ mode: "test-mode", model: "test-model-b", effortLevel: "max" });
		expect(setConfig).not.toHaveBeenCalled();
	});

	it("fork sends cwd + mcpServers and the fork keeps the source session's config", async () => {
		const v3 = makeV3Client((_c, method) =>
			method === "session/fork"
				? { sessionId: "s2", configOptions: snapshot("test-model-b", "max") }
				: {},
		);
		const setConfig = vi.spyOn(v3.client, "setSessionConfigOption");
		const mounted = renderHook(() => useAgent(v3.client, makeSettings(), vault, CWD, AGENT));

		await act(async () => {
			const r = await v3.client.forkSession("s1", CWD);
			await mounted.result.current.updateSessionFromLoad(r.sessionId, r.modes, r.models, r.configOptions);
		});

		const fork = v3.requests.find((r) => r.method === "session/fork");
		expect(fork?.params).toEqual({ sessionId: "s1", cwd: CWD, mcpServers: [] });
		expect(mounted.result.current.session.sessionId).toBe("s2");
		expect(setConfig).not.toHaveBeenCalled();
	});
});
