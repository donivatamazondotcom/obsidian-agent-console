/**
 * I302 §6: a chat recorded on V3, opened on a tab whose kiro-cli is too old
 * for V3 (the Default engine fell back to V2), starts fresh through D2. The
 * user must be told the CLI is too old, not "set this agent back to V3",
 * which on an old CLI gives D3's error.
 *
 * Seams (R2): the real reconnect flow, the real lazy owner, the real reload
 * flow and its acquisition mapper, the pure restore-failure resolver and the
 * rendered notice. Only the ACP client port is faked (R4). Assertions are on
 * results and rendered text (R3), literals only (R5).
 *
 * Red-first (R1): on main the reason is always "engine-changed", so the
 * fallback tab gets "set this agent back to V3".
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
	reloadNoticeKey,
	reloadResultToAcquisition,
	reloadSessionFlow,
} from "../reloadSessionFlow";
import { decideEngineRestore } from "../../resolvers/session-engine";
import { decideRestoreFailure } from "../../resolvers/restore-failure";
import { LossyFallbackNotice } from "../../ui/LossyFallbackNotice";
import { NO_AGENT_CAPABILITIES, type SessionResult } from "../../types/session";
import { t } from "../../i18n";

/** A V2 process that runs because the CLI is too old for the Default V3. */
function fallbackClient() {
	const calls: string[] = [];
	let initialized = false;
	const client: ReconnectClientPort = {
		isInitialized: () => initialized,
		getInitializeResult: () =>
			initialized
				? {
						capabilities: { ...NO_AGENT_CAPABILITIES, restoresViaLoad: true },
						kiroEngine: "v2",
						kiroEngineFallback: "old-cli",
					}
				: null,
		loadSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			calls.push(`load:${sid}`);
			return { sessionId: sid };
		}),
		resumeSession: vi.fn(async (sid: string): Promise<SessionResult> => ({
			sessionId: sid,
		})),
	};
	const initialize = vi.fn(async () => {
		calls.push("initialize");
		initialized = true;
	});
	return { client, initialize, calls };
}

describe("I302 decideEngineRestore: a fallback V2 says the CLI is too old", () => {
	it("V3 chat on a fallback V2 starts fresh with the old-CLI reason", () => {
		expect(
			decideEngineRestore({ stored: "v3", running: "v2", runningFallback: "old-cli" }),
		).toEqual({ kind: "start-fresh", reason: "engine-changed-old-cli", from: "v3", to: "v2" });
	});

	it("V3 chat on a V2 picked by name keeps engine-changed", () => {
		expect(decideEngineRestore({ stored: "v3", running: "v2" })).toMatchObject({
			reason: "engine-changed",
		});
	});

	it("a V2 chat on the fallback loads", () => {
		expect(
			decideEngineRestore({ stored: "v2", running: "v2", runningFallback: "old-cli" }),
		).toEqual({ kind: "load" });
	});
});

describe("I302 decideRestoreFailure: the old-CLI reason always falls back", () => {
	it("even with no local record and nothing on screen", () => {
		expect(
			decideRestoreFailure({
				hasLocalRecord: false,
				haveLocalHistory: false,
				failure: "engine-changed-old-cli",
			}),
		).toEqual({ kind: "fallback", reason: "engine-changed-old-cli" });
	});
});

describe("I302 restore through the real flow and lazy owner", () => {
	it("reconnect reports the old-CLI reason and never sends the V3 id", async () => {
		const c = fallbackClient();
		const out = await reconnectExistingSession({
			sessionId: "v3-abc",
			cwd: "/vault",
			client: c.client,
			initialize: c.initialize,
			haveLocalHistory: () => true,
			onLoaded: () => {},
			setIgnoreUpdates: () => {},
			storedEngine: "v3",
		});
		expect(out.ok).toBe(false);
		expect(out.ok === false && out.fallbackReason).toBe("engine-changed-old-cli");
		expect(out.ok === false && out.failure).toBe("engine-changed-old-cli");
		expect(c.calls).toEqual(["initialize"]);
	});

	it("the lazy owner falls back with the old-CLI reason and the notice says to update", async () => {
		const c = fallbackClient();
		const acquireNewSession = vi.fn().mockResolvedValue({ ok: true, sessionId: "new-1" });
		const { result } = renderHook(() =>
			useLazySession({
				restoredSessionId: "v3-abc",
				acquireNewSession,
				loadExistingSession: (sid: string) =>
					reconnectExistingSession({
						sessionId: sid,
						cwd: "/vault",
						client: c.client,
						initialize: c.initialize,
						haveLocalHistory: () => true,
						onLoaded: () => {},
						setIgnoreUpdates: () => {},
						storedEngine: "v3",
					}),
				sendPrompt: vi.fn(),
				debounceMs: 0,
			}),
		);
		await act(async () => {
			result.current.onSendClick("hi");
		});
		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current.fallbackReason).toBe("engine-changed-old-cli");

		const { container } = render(
			<LossyFallbackNotice
				isFallbackRecovery
				reason={result.current.fallbackReason ?? undefined}
			/>,
		);
		const text = container.textContent ?? "";
		expect(text).toContain(t("chat.lossyFallback.engineChanged.title"));
		expect(text).toContain("kiro-cli update");
		expect(text).not.toContain("set this agent back to V3");
	});
});

describe("I302 soft reload on a fallback tab", () => {
	it("the reload starts fresh with the old-CLI reason and toast", async () => {
		const freshSession = vi.fn().mockResolvedValue("new-1");
		const out = await reloadSessionFlow({
			sessionId: "v3-abc",
			canResume: true,
			resumeSameSession: async () => {
				assertEngineCanResume("v3", "v2", "old-cli");
				return "v3-abc";
			},
			freshSession,
		});
		expect(out).toEqual({
			resumed: false,
			reason: "engine-changed-old-cli",
			sessionId: "new-1",
		});
		expect(reloadResultToAcquisition(out)).toMatchObject({
			ok: true,
			lossy: true,
			fallbackReason: "engine-changed-old-cli",
		});
		if (out.resumed) throw new Error("expected a fresh session");
		expect(reloadNoticeKey(out)).toBe("notices.sessionReloadEngineChangedOldCli");
	});

	it("the other reload outcomes keep their toasts", () => {
		expect(reloadNoticeKey({ resumed: false, reason: "engine-changed", sessionId: "x" })).toBe(
			"notices.sessionReloadEngineChanged",
		);
		expect(reloadNoticeKey({ resumed: false, reason: "resume-failed", sessionId: "x" })).toBe(
			"notices.sessionReloadResumeFailed",
		);
		expect(reloadNoticeKey({ resumed: false, reason: "unsupported", sessionId: "x" })).toBe(
			"notices.sessionReloadedFresh",
		);
	});
});

describe("I272: the engine-changed notice promises nothing it can't do", () => {
	it("drops 'pick up the original session'", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery reason="engine-changed" />,
		);
		expect(container.textContent ?? "").not.toContain("pick up the original session");
	});
});
