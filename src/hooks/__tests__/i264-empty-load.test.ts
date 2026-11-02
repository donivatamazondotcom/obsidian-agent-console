/**
 * I264 — a load that succeeds with no replay, for a chat with a transcript on
 * screen, is treated as a failed load.
 *
 * Kiro V3 answers `session/load` for an id it never created with success and
 * an empty session (probed 2026-11-02; V2, Claude Code and Codex reject it).
 * Before the fix the plugin treated any successful load as "the agent has
 * it", so no fallback ran and the agent had none of the conversation.
 *
 * Seams (R2): `reconnectExistingSession` (what ChatPanel's restored-tab
 * callback calls) and the public `useAgentSession.reloadSession` (soft
 * reload). Only the ACP client port is faked (R4); it reports the replay count
 * the real `AcpClient.loadSession` returns. Assertions are on the result and
 * on what the UI is told (R3). Literals only (R5).
 *
 * Spec: [[I264 A load of a session the agent never had succeeds empty]].
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	reconnectExistingSession,
	type ReconnectClientPort,
} from "../loadExistingSessionFlow";
import { useAgentSession } from "../useAgentSession";
import { reloadResultToAcquisition } from "../reloadSessionFlow";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import {
	NO_AGENT_CAPABILITIES,
	type SessionResult,
} from "../../types/session";

function reconnectClient(replayed: number): ReconnectClientPort {
	return {
		isInitialized: () => true,
		getInitializeResult: () => ({
			capabilities: { ...NO_AGENT_CAPABILITIES, restoresViaLoad: true },
			kiroEngine: "v3",
		}),
		loadSession: vi.fn(
			async (sid: string): Promise<SessionResult> => ({
				sessionId: sid,
				replayedConversationUpdates: replayed,
			}),
		),
		resumeSession: vi.fn(async (sid: string) => ({ sessionId: sid })),
	};
}

async function reconnect(replayed: number, haveLocalHistory: boolean) {
	const onLoaded = vi.fn();
	const result = await reconnectExistingSession({
		sessionId: "v3-unknown",
		cwd: "/vault",
		client: reconnectClient(replayed),
		initialize: vi.fn(async () => {}),
		haveLocalHistory: () => haveLocalHistory,
		onLoaded,
		setIgnoreUpdates: vi.fn(),
		storedEngine: "v3",
	});
	return { result, onLoaded };
}

describe("I264 restored tab: empty load", () => {
	it("a load with no replay and a transcript on screen fails, so the owner falls back", async () => {
		const { result, onLoaded } = await reconnect(0, true);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.fallbackReason ?? "unavailable").toBe("unavailable");
		// The empty session's modes and models are never applied.
		expect(onLoaded).not.toHaveBeenCalled();
	});

	it("a real load (conversation replayed) loads", async () => {
		const { result, onLoaded } = await reconnect(2, true);
		expect(result).toEqual({ ok: true, sessionId: "v3-unknown" });
		expect(onLoaded).toHaveBeenCalledTimes(1);
	});

	it("an empty chat (no transcript on screen) loads; no false fallback", async () => {
		const { result } = await reconnect(0, false);
		expect(result).toEqual({ ok: true, sessionId: "v3-unknown" });
	});
});

// ---------------------------------------------------------------------------
// Soft reload: V3 doesn't advertise resume, so a reload loads the same id.
// ---------------------------------------------------------------------------

const AGENT = "test-agent";

function reloadClient(replayed: number) {
	const calls: string[] = [];
	let n = 0;
	const agentClient = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(async () => ({})),
		newSession: vi.fn(async () => {
			n += 1;
			calls.push(`newSession:s${n}`);
			return { sessionId: `s${n}` };
		}),
		loadSession: vi.fn(async (sid: string) => {
			calls.push(`loadSession:${sid}`);
			return { sessionId: sid, replayedConversationUpdates: replayed };
		}),
		disconnect: vi.fn(async () => {}),
		whenTornDown: vi.fn(() => Promise.resolve()),
		getInitializeResult: () => ({
			capabilities: { restoresViaLoad: true, restoresViaResume: false },
			kiroEngine: "v3",
		}),
		setSessionConfigOption: vi.fn(async () => []),
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return { agentClient, calls };
}

function settingsAccess(): ISettingsAccess {
	const settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [
			{ id: AGENT, displayName: "Test Agent", command: "kiro-cli", args: ["acp"], env: [] },
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

async function softReload(replayed: number, haveLocalHistory: boolean) {
	const { agentClient, calls } = reloadClient(replayed);
	const { result } = renderHook(() =>
		useAgentSession(agentClient, settingsAccess(), "/cwd", () => {}, AGENT),
	);
	await act(async () => {
		await result.current.createSession();
	});
	calls.length = 0;
	let reload: Awaited<ReturnType<typeof result.current.reloadSession>> | undefined;
	await act(async () => {
		reload = await result.current.reloadSession(
			() => {},
			() => haveLocalHistory,
		);
	});
	return { reload: reload!, calls };
}

describe("I264 soft reload: empty load", () => {
	it("an empty load with a transcript on screen starts fresh and reports lossy", async () => {
		const { reload, calls } = await softReload(0, true);
		expect(reload).toEqual({ resumed: false, reason: "resume-failed", sessionId: "s2" });
		expect(calls).toEqual(["loadSession:s1", "newSession:s2"]);
		expect(reloadResultToAcquisition(reload)).toEqual({
			ok: true,
			sessionId: "s2",
			lossy: true,
			fallbackReason: "unavailable",
		});
	});

	it("a real load resumes", async () => {
		const { reload } = await softReload(3, true);
		expect(reload).toEqual({ resumed: true, sessionId: "s1" });
	});

	it("an empty chat resumes; no false fallback", async () => {
		const { reload } = await softReload(0, false);
		expect(reload).toEqual({ resumed: true, sessionId: "s1" });
	});
});
