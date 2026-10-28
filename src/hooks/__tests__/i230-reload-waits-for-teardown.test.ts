/**
 * I230 — reproduce-first: a soft reload must not resume before the old
 * process tree has exited.
 *
 * Measured on Kiro V2 (2026-10-27, kiro-cli 2.34.3-nightly.3): since I211,
 * `disconnect()` returns immediately and tears the old tree down in the
 * background. The old `kiro-cli-chat` still holds the session lock for ~2 s,
 * so a `session/load` sent right after re-initialize is rejected with
 * "Session is active in another process", and the reload silently falls back
 * to a NEW session. Every reload with a gap under 2.2 s failed; every one
 * over 2.9 s resumed.
 *
 * Seam: the public `useAgentSession` hook (`createSession`, `reloadSession`)
 * with only the ACP client port faked (R2, R4). The fake models the session
 * lock: it is held from `disconnect()` until the teardown settles
 * (`whenTornDown()`), and `loadSession` rejects with V2's real error while it
 * is held. Assertions are on the resumed session id and the reload result
 * (R3). Spec: [[I230 Kiro V2 soft reload silently falls back to a new session]].
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";

const AGENT = "test-agent";

/** V2's real rejection while the old process still holds the session. */
function lockedError(pid: number): Error {
	const err = new Error("Internal error") as Error & {
		code: number;
		data: string;
	};
	err.code = -32603;
	err.data = `Failed to start session: Session is active in another process (PID ${pid})`;
	return err;
}

function makeLockingClient() {
	const calls: string[] = [];
	let lockHeld = false;
	let pendingTeardown: Promise<void> | null = null;
	let sessionCounter = 0;

	const agentClient = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(async () => {
			calls.push("initialize");
			return {};
		}),
		newSession: vi.fn(async () => {
			sessionCounter += 1;
			calls.push(`newSession:s${sessionCounter}`);
			return {
				sessionId: `s${sessionCounter}`,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
			};
		}),
		loadSession: vi.fn(async (sid: string) => {
			calls.push(`loadSession:${sid}`);
			if (lockHeld) throw lockedError(4242);
			return {
				sessionId: sid,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
			};
		}),
		disconnect: vi.fn(async () => {
			calls.push("disconnect");
			lockHeld = true;
			// The old tree exits on its own a little later (background teardown).
			pendingTeardown = new Promise<void>((resolve) => {
				window.setTimeout(() => {
					lockHeld = false;
					calls.push("tree-exited");
					resolve();
				}, 30);
			});
		}),
		whenTornDown: vi.fn(() => pendingTeardown ?? Promise.resolve()),
		getInitializeResult: () => ({
			capabilities: {
				restoresViaLoad: true,
				restoresViaResume: false,
			},
		}),
		setSessionConfigOption: vi.fn(async () => []),
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
	} as unknown as AcpClient;

	return { agentClient, calls };
}

function makeSettingsAccess(): ISettingsAccess {
	const settings: Record<string, unknown> = {
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

describe("I230: soft reload waits for the old tree to exit before resuming", () => {
	it("resumes the SAME session instead of silently falling back to a new one", async () => {
		const { agentClient, calls } = makeLockingClient();
		const { result } = renderHook(() =>
			useAgentSession(
				agentClient,
				makeSettingsAccess(),
				"/cwd",
				() => {},
				AGENT,
			),
		);

		await act(async () => {
			await result.current.createSession();
		});
		expect(result.current.session.sessionId).toBe("s1");
		calls.length = 0;

		let reload: { resumed: boolean } | undefined;
		await act(async () => {
			reload = await result.current.reloadSession();
		});

		expect(reload?.resumed).toBe(true);
		expect(result.current.session.sessionId).toBe("s1");
		// No second session was created behind the user's back.
		expect(calls.filter((c) => c.startsWith("newSession"))).toEqual([]);
		// Order: kill old tree → wait for it to exit → fresh harness → resume.
		expect(calls).toEqual([
			"disconnect",
			"tree-exited",
			"initialize",
			"loadSession:s1",
		]);
	});
});
