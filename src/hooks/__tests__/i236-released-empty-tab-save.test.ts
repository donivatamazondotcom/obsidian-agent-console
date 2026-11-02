/**
 * I236 — a fresh tab with no messages that is released must not persist its
 * session id: there is no saved session or transcript behind it, so after a
 * restart the tab would point at nothing (invariant INV-3).
 *
 * Seam (R2): the real `useLazySession` composed with the production save
 * decision exactly as ChatPanel composes it — `keptIdForSave` feeding
 * `resolveSessionIdForSave`. Only the acquisition callbacks are faked (R4).
 * Assertions on the id that would be persisted (R3). Literals (R5).
 *
 * Spec: [[I236 Released empty tab persists a session id with no saved session]].
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLazySession, type UseLazySessionOptions } from "../useLazySession";
import {
	keptIdForSave,
	resolveSessionIdForSave,
} from "../../services/session-helpers";

function options(over: Partial<UseLazySessionOptions> = {}): UseLazySessionOptions {
	return {
		acquireNewSession: vi.fn().mockResolvedValue({ ok: true, sessionId: "s1" }),
		loadExistingSession: vi
			.fn()
			.mockImplementation(async (id: string) => ({ ok: true, sessionId: id })),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		...over,
	};
}

/** ChatPanel's save: live agent id, the gated kept id, has-messages. */
function persisted(
	liveId: string | null,
	kept: string | null,
	restoredId: string | null,
	hasMessages: boolean,
): string | null {
	return resolveSessionIdForSave(
		liveId,
		keptIdForSave(kept, restoredId, hasMessages),
		hasMessages,
	);
}

async function releasedFreshTab() {
	const hook = renderHook(() => useLazySession(options()));
	await act(async () => {
		await hook.result.current.acquireNow();
	});
	act(() => {
		hook.result.current.release();
	});
	expect(hook.result.current.state).toBe("released");
	return hook;
}

describe("I236 released tab save", () => {
	it("an empty fresh tab that released persists nothing", async () => {
		const { result } = await releasedFreshTab();
		expect(persisted(null, result.current.keptSessionId, null, false)).toBeNull();
	});

	it("a fresh tab with messages that released persists the kept id", async () => {
		const { result } = await releasedFreshTab();
		expect(persisted(null, result.current.keptSessionId, null, true)).toBe("s1");
	});

	it("a restored tab persists its restored id before it has loaded messages", () => {
		const { result } = renderHook(() =>
			useLazySession(options({ restoredSessionId: "r1" })),
		);
		expect(persisted(null, result.current.keptSessionId, "r1", false)).toBe("r1");
	});

	it("a restored tab that reconnected, then released empty, keeps the restored id", async () => {
		const { result } = renderHook(() =>
			useLazySession(options({ restoredSessionId: "r1" })),
		);
		await act(async () => {
			result.current.onSendClick("x");
			await Promise.resolve();
		});
		act(() => {
			result.current.release();
		});
		expect(persisted(null, result.current.keptSessionId, "r1", false)).toBe("r1");
	});
});
