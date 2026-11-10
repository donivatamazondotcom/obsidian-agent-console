/**
 * I251 — `useAgentSession.restartForReload`, the restart a reload runs on a
 * tab with no bound session.
 *
 * Seam (R2): the real `useAgentSession` hook. Faked (R4): the ACP client
 * port, with a `session/delete` the test settles by hand and a teardown the
 * test releases by hand. Assertions (R3): the order the client sees, the
 * session state shown meanwhile, and that a reset skips the kill. Literals
 * only (R5).
 *
 * Spec: [[I251 Reload does nothing on a chat restored from history]].
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function makeClient() {
	const calls: string[] = [];
	const deletes = deferred();
	const teardown = deferred();
	const client = {
		isInitialized: () => true,
		getCurrentAgentId: () => "test-agent",
		whenDeletesSettled: vi.fn(async () => {
			calls.push("deletes:wait");
			await deletes.promise;
			calls.push("deletes:settled");
		}),
		disconnect: vi.fn(async () => {
			calls.push("disconnect");
		}),
		whenTornDown: vi.fn(async () => {
			await teardown.promise;
			calls.push("exited");
		}),
		cancel: vi.fn(async () => {
			calls.push("cancel");
		}),
		getInitializeResult: () => null,
	} as unknown as AcpClient;
	return { client, calls, deletes, teardown };
}

function makeSettings(): ISettingsAccess {
	const settings: Record<string, unknown> = {
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
				command: "agent",
				args: [],
				env: [],
			},
		],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	return {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("I251: restartForReload", () => {
	it("waits for a pending never-sent delete, then kills the tree and waits for it to exit", async () => {
		const c = makeClient();
		const setErrorInfo = vi.fn();
		const { result } = renderHook(() =>
			useAgentSession(c.client, makeSettings(), "/cwd", setErrorInfo, "test-agent"),
		);

		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = result.current.restartForReload(() => true);
		});
		// An old "Session Creation Failed" overlay doesn't sit under Connecting.
		expect(setErrorInfo).toHaveBeenLastCalledWith(null);
		await act(settle);
		// Shown as starting up while it waits; the delete hasn't settled.
		expect(result.current.session.state).toBe("initializing");
		expect(result.current.session.sessionId).toBeNull();
		expect(c.calls).toEqual(["deletes:wait"]);

		await act(async () => {
			c.deletes.resolve();
			await settle();
		});
		expect(c.calls).toEqual(["deletes:wait", "deletes:settled", "disconnect"]);

		let resolved = false;
		void done.then(() => {
			resolved = true;
		});
		await act(settle);
		expect(resolved).toBe(false);

		await act(async () => {
			c.teardown.resolve();
			await done;
		});
		expect(c.calls).toEqual([
			"deletes:wait",
			"deletes:settled",
			"disconnect",
			"exited",
		]);
	});

	it("a reset during the wait skips the kill (the new chat's process stays)", async () => {
		const c = makeClient();
		const { result } = renderHook(() =>
			useAgentSession(c.client, makeSettings(), "/cwd", () => {}, "test-agent"),
		);
		let current = true;
		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = result.current.restartForReload(() => current);
		});
		current = false;
		await act(async () => {
			c.deletes.resolve();
			await done;
		});
		expect(c.calls).toEqual(["deletes:wait", "deletes:settled"]);
	});
});
