/**
 * D2 — a chat remembers the Kiro engine it ran on, and a V3 chat reopened on
 * V2 starts fresh with a notice that says why ([[Kiro CLI V3 Support]] §
 * Decisions, 2026-11-01 D2; [[Agent Console v2.5.0]] D2).
 *
 * Live check (2026-11-01): a V2 chat loads on V3; a V3 chat sent to V2 fails
 * with `Internal error`. Before D2 nothing recorded the engine, so a restored
 * V3 chat sent its V3 id to the V2 server and fell back with the generic
 * notice.
 *
 * Seams (R2):
 * - `reconnectExistingSession`: what ChatPanel's `loadExistingSession` calls.
 *   Only the ACP client port is faked (R4).
 * - `useLazySession`: the single acquisition owner, real hook.
 * - `SessionStore.recordTurnSave`: the single writer of `savedSessions`,
 *   against an in-memory port.
 * - `reloadSessionFlow` + `assertEngineCanResume`: the soft-reload seam.
 * - `LossyFallbackNotice`: the rendered copy.
 * - Lifecycle harness: persist on V3 → JSON round-trip (the disk) → the one
 *   validator → reconnect on V2 through the real owner.
 *
 * Assertions are on results, wire calls and rendered text (R3). Literals only
 * (R5).
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import {
	reconnectExistingSession,
	type ReconnectClientPort,
} from "../loadExistingSessionFlow";
import { useLazySession } from "../useLazySession";
import {
	assertEngineCanResume,
	EngineChangedError,
	reloadSessionFlow,
} from "../reloadSessionFlow";
import { SessionStore, type SessionStorePort } from "../../services/session-store";
import {
	parseSessionEngine,
	resolveStoredSessionEngine,
} from "../../resolvers/session-engine";
import { LossyFallbackNotice } from "../../ui/LossyFallbackNotice";
import {
	NO_AGENT_CAPABILITIES,
	type SavedSessionInfo,
	type SessionResult,
} from "../../types/session";
import type { ChatMessage } from "../../types/chat";
import { t } from "../../i18n";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** ACP client port running `engine`. The V2 fake rejects V3 ids like Kiro does. */
function fakeClient(engine: "v2" | "v3") {
	const calls: string[] = [];
	let initialized = false;
	const client: ReconnectClientPort = {
		isInitialized: () => initialized,
		getInitializeResult: () =>
			initialized
				? {
						capabilities: {
							...NO_AGENT_CAPABILITIES,
							restoresViaLoad: true,
						},
						kiroEngine: engine,
					}
				: null,
		loadSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			calls.push(`load:${sid}`);
			if (engine === "v2" && sid.startsWith("v3-")) {
				throw new Error("Internal error");
			}
			return { sessionId: sid };
		}),
		resumeSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			calls.push(`resume:${sid}`);
			return { sessionId: sid };
		}),
	};
	const initialize = vi.fn(async () => {
		calls.push("initialize");
		initialized = true;
	});
	return { client, initialize, calls };
}

function reconnect(
	c: ReturnType<typeof fakeClient>,
	sessionId: string,
	storedEngine: "v2" | "v3" | undefined,
) {
	return reconnectExistingSession({
		sessionId,
		cwd: "/vault",
		client: c.client,
		initialize: c.initialize,
		haveLocalHistory: () => true,
		onLoaded: () => {},
		setIgnoreUpdates: () => {},
		storedEngine,
	});
}

class FakePort implements SessionStorePort {
	sessions: SavedSessionInfo[] = [];
	getSavedSessions(): SavedSessionInfo[] {
		return this.sessions;
	}
	saveSession = async (info: SavedSessionInfo): Promise<void> => {
		const i = this.sessions.findIndex((s) => s.sessionId === info.sessionId);
		if (i >= 0) this.sessions[i] = info;
		else this.sessions.unshift(info);
	};
}

function userMsg(text: string): ChatMessage {
	return {
		id: "m1",
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date("2026-11-01T10:00:00Z"),
	};
}

// ---------------------------------------------------------------------------
// reconnect seam
// ---------------------------------------------------------------------------

describe("D2 reconnectExistingSession: engine check after initialize", () => {
	it("a V3 chat on a V2 agent never reaches the V2 server", async () => {
		const c = fakeClient("v2");
		const out = await reconnect(c, "v3-abc", "v3");
		expect(out.ok).toBe(false);
		expect(out.ok === false && out.fallbackReason).toBe("engine-changed");
		// Initialized (to learn the running engine), then nothing else.
		expect(c.calls).toEqual(["initialize"]);
	});

	it("a V2 chat on a V3 agent still loads", async () => {
		const c = fakeClient("v3");
		expect(await reconnect(c, "v2-abc", "v2")).toEqual({
			ok: true,
			sessionId: "v2-abc",
		});
		expect(c.calls).toEqual(["initialize", "load:v2-abc"]);
	});

	it("an old record with no engine still tries to load", async () => {
		const c = fakeClient("v3");
		expect(await reconnect(c, "old-1", undefined)).toEqual({
			ok: true,
			sessionId: "old-1",
		});
		expect(c.calls).toEqual(["initialize", "load:old-1"]);
	});

	it("an unknown engine whose load fails reports no engine reason", async () => {
		const c = fakeClient("v2");
		const out = await reconnect(c, "v3-old", undefined);
		expect(out.ok).toBe(false);
		expect(out.ok === false && out.fallbackReason).toBeUndefined();
		expect(c.calls).toEqual(["initialize", "load:v3-old"]);
	});
});

// ---------------------------------------------------------------------------
// lazy owner
// ---------------------------------------------------------------------------

describe("D2 useLazySession: the fallback says why", () => {
	it("an engine change falls back to a new session with reason engine-changed", async () => {
		const acquireNewSession = vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "new-1" });
		const { result } = renderHook(() =>
			useLazySession({
				restoredSessionId: "v3-abc",
				acquireNewSession,
				loadExistingSession: vi.fn().mockResolvedValue({
					ok: false,
					error: new Error("engine changed"),
					fallbackReason: "engine-changed",
				}),
				sendPrompt: vi.fn(),
				debounceMs: 0,
			}),
		);
		await act(async () => {
			result.current.onSendClick("hi");
		});
		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current.sessionId).toBe("new-1");
		expect(result.current.isFallbackRecovery).toBe(true);
		expect(result.current.fallbackReason).toBe("engine-changed");
	});

	it("a plain load failure keeps the generic reason", async () => {
		const { result } = renderHook(() =>
			useLazySession({
				restoredSessionId: "s1",
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "new-1" }),
				loadExistingSession: vi
					.fn()
					.mockResolvedValue({ ok: false, error: new Error("gone") }),
				sendPrompt: vi.fn(),
				debounceMs: 0,
			}),
		);
		await act(async () => {
			result.current.onSendClick("hi");
		});
		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current.fallbackReason).toBe("unavailable");
	});

	it("reset clears the reason", async () => {
		const { result } = renderHook(() =>
			useLazySession({
				restoredSessionId: "v3-abc",
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "new-1" }),
				loadExistingSession: vi.fn().mockResolvedValue({
					ok: false,
					error: new Error("engine changed"),
					fallbackReason: "engine-changed",
				}),
				sendPrompt: vi.fn(),
				debounceMs: 0,
			}),
		);
		await act(async () => {
			result.current.onSendClick("hi");
		});
		await waitFor(() => expect(result.current.state).toBe("ready"));
		act(() => result.current.reset());
		expect(result.current.fallbackReason).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// single writer of savedSessions
// ---------------------------------------------------------------------------

describe("D2 SessionStore.recordTurnSave records the engine", () => {
	const base = {
		sessionId: "s1",
		agentId: "kiro-cli",
		cwd: "/vault",
		messages: [userMsg("hello there")],
	};

	it("writes the engine on create", async () => {
		const port = new FakePort();
		await new SessionStore(port).recordTurnSave({ ...base, kiroEngine: "v3" });
		expect(port.sessions[0].kiroEngine).toBe("v3");
	});

	it("updates it to the engine of the latest turn", async () => {
		const port = new FakePort();
		const store = new SessionStore(port);
		await store.recordTurnSave({ ...base, kiroEngine: "v2" });
		await store.recordTurnSave({ ...base, kiroEngine: "v3" });
		expect(port.sessions[0].kiroEngine).toBe("v3");
	});

	it("keeps the stored engine when a save has none", async () => {
		const port = new FakePort();
		const store = new SessionStore(port);
		await store.recordTurnSave({ ...base, kiroEngine: "v3" });
		await store.recordTurnSave(base);
		expect(port.sessions[0].kiroEngine).toBe("v3");
	});

	it("never writes an invalid engine", async () => {
		const port = new FakePort();
		await new SessionStore(port).recordTurnSave({
			...base,
			kiroEngine: "V3" as unknown as "v3",
		});
		expect("kiroEngine" in port.sessions[0]).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// soft reload
// ---------------------------------------------------------------------------

describe("D2 soft reload after the engine changed", () => {
	it("assertEngineCanResume throws only for a V3 session on V2", () => {
		expect(() => assertEngineCanResume("v3", "v2")).toThrow(EngineChangedError);
		expect(() => assertEngineCanResume("v2", "v3")).not.toThrow();
		expect(() => assertEngineCanResume(undefined, "v2")).not.toThrow();
	});

	it("goes straight to a fresh session with reason engine-changed", async () => {
		const onResumeError = vi.fn();
		const freshSession = vi.fn().mockResolvedValue("new-1");
		const out = await reloadSessionFlow({
			sessionId: "v3-abc",
			canResume: true,
			resumeSameSession: async () => {
				assertEngineCanResume("v3", "v2");
				return "v3-abc";
			},
			freshSession,
			onResumeError,
		});
		expect(out).toEqual({
			resumed: false,
			reason: "engine-changed",
			sessionId: "new-1",
		});
		expect(freshSession).toHaveBeenCalledTimes(1);
		expect(onResumeError).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// notice copy
// ---------------------------------------------------------------------------

describe("D2 LossyFallbackNotice says why it started fresh", () => {
	it("renders the engine copy for an engine change", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery reason="engine-changed" />,
		);
		const text = container.textContent ?? "";
		expect(text).toContain(t("chat.lossyFallback.engineChanged.title"));
		expect(text).toContain(t("chat.lossyFallback.engineChanged.body"));
		expect(text).toContain("V3");
		expect(text).not.toContain(t("chat.lossyFallback.title"));
	});

	it("keeps the generic copy otherwise", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery reason="unavailable" />,
		);
		expect(container.textContent).toContain(t("chat.lossyFallback.title"));
	});
});

// ---------------------------------------------------------------------------
// lifecycle harness: persist → disk → validate → restore
// ---------------------------------------------------------------------------

/**
 * Persist through the single writers, round-trip through JSON (the disk),
 * read back through the one validator, then restore through the real
 * reconnect seam and lazy owner on an agent running `restoreOn`.
 */
async function persistThenRestore(opts: {
	sessionId: string;
	savedOn: "v2" | "v3" | undefined;
	restoreOn: "v2" | "v3";
}) {
	const port = new FakePort();
	await new SessionStore(port).recordTurnSave({
		sessionId: opts.sessionId,
		agentId: "kiro-cli",
		cwd: "/vault",
		messages: [userMsg("remember the number 7")],
		...(opts.savedOn ? { kiroEngine: opts.savedOn } : {}),
	});
	const tab: Record<string, unknown> = {
		tabId: "T1",
		agentId: "kiro-cli",
		label: "Remember 7",
		sessionId: opts.sessionId,
		tabOrder: 0,
		scrollPosition: 0,
		...(opts.savedOn ? { kiroEngine: opts.savedOn } : {}),
	};
	const disk = JSON.parse(
		JSON.stringify({ savedSessions: port.sessions, tabs: [tab] }),
	) as { savedSessions: Record<string, unknown>[]; tabs: Record<string, unknown>[] };

	const onInvalid = vi.fn();
	const record = disk.savedSessions.find(
		(s) => s.sessionId === opts.sessionId,
	);
	const stored = resolveStoredSessionEngine({
		recordEngine: parseSessionEngine(record?.kiroEngine, onInvalid),
		tabEngine: parseSessionEngine(disk.tabs[0].kiroEngine, onInvalid),
	});

	const c = fakeClient(opts.restoreOn);
	const { result } = renderHook(() =>
		useLazySession({
			restoredSessionId: disk.tabs[0].sessionId as string,
			acquireNewSession: async () => ({ ok: true, sessionId: "new-1" }),
			loadExistingSession: (sid) => reconnect(c, sid, stored),
			sendPrompt: vi.fn(),
			debounceMs: 0,
		}),
	);
	await act(async () => {
		result.current.onSendClick("what number?");
	});
	await waitFor(() => expect(result.current.state).toBe("ready"));
	expect(onInvalid).not.toHaveBeenCalled();
	return { lazy: result.current, calls: c.calls, stored };
}

describe("D2 lifecycle: persist → reload → restore", () => {
	it("a V3 chat restored after switching the agent to V2 starts fresh and says why", async () => {
		const r = await persistThenRestore({
			sessionId: "v3-abc",
			savedOn: "v3",
			restoreOn: "v2",
		});
		expect(r.stored).toBe("v3");
		expect(r.calls).toEqual(["initialize"]);
		expect(r.lazy.sessionId).toBe("new-1");
		expect(r.lazy.fallbackReason).toBe("engine-changed");
		const { container } = render(
			<LossyFallbackNotice
				isFallbackRecovery={r.lazy.isFallbackRecovery}
				reason={r.lazy.fallbackReason ?? undefined}
			/>,
		);
		expect(container.textContent).toContain(
			t("chat.lossyFallback.engineChanged.title"),
		);
	});

	it("a V2 chat restored on V3 still loads its own session", async () => {
		const r = await persistThenRestore({
			sessionId: "v2-abc",
			savedOn: "v2",
			restoreOn: "v3",
		});
		expect(r.calls).toEqual(["initialize", "load:v2-abc"]);
		expect(r.lazy.sessionId).toBe("v2-abc");
		expect(r.lazy.isFallbackRecovery).toBe(false);
		expect(r.lazy.fallbackReason).toBeNull();
	});

	it("an old record with no engine still restores", async () => {
		const r = await persistThenRestore({
			sessionId: "old-1",
			savedOn: undefined,
			restoreOn: "v3",
		});
		expect(r.stored).toBeUndefined();
		expect(r.calls).toEqual(["initialize", "load:old-1"]);
		expect(r.lazy.sessionId).toBe("old-1");
	});
});
