import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLazySession } from "../useLazySession";

/**
 * Reproduce-first for the "Restart agent stuck on Connecting" regression
 * (studio smoke (g), 2026-06-25).
 *
 * Restart routes through closeSession (nulls the session) + acquireNow. But the
 * I53 `existingSid` reuse-guard in ChatPanel.acquireNewSession read a STALE
 * `agent.session.sessionId` (pre-render), saw the just-closed session's id, and
 * short-circuited "reuse" — so createSession never ran, the agent never
 * respawned, and the tab hung on "Connecting". A fresh (never-connected) tab
 * had no id, so the guard didn't fire and restart worked — exactly the
 * established-vs-fresh split the user reported.
 *
 * Contract: acquireNow ALWAYS creates a fresh session. The fix removes the
 * reuse-guard (the original eager+lazy double-session/new source it guarded
 * against was already removed in the switch/new-chat unification, so the guard
 * is now both redundant and harmful).
 */
function makeAcquire(opts: {
	withStaleGuard: boolean;
	staleSource: { id: string | null };
}) {
	let n = 0;
	return vi.fn(async () => {
		// The harmful guard: reuse whatever the (possibly stale) session source
		// reports instead of creating fresh.
		if (opts.withStaleGuard && opts.staleSource.id) {
			return { ok: true as const, sessionId: opts.staleSource.id };
		}
		n += 1;
		const sid = `fresh-${n}`;
		opts.staleSource.id = sid;
		return { ok: true as const, sessionId: sid };
	});
}

function mount(acquireNewSession: ReturnType<typeof vi.fn>) {
	return renderHook(() =>
		useLazySession({
			acquireNewSession,
			loadExistingSession: vi.fn(async () => ({
				ok: true as const,
				sessionId: "unused",
			})),
			sendPrompt: vi.fn(async () => {}),
			debounceMs: 0,
		}),
	);
}

describe("Restart respawn creates a fresh session (no stale reuse)", () => {
	it("RED: with the stale existingSid guard, acquireNow reuses the dead session — the bug", async () => {
		// Session was established, then closeSession nulled it — but the
		// acquireNewSession closure reads a STALE non-null id.
		const staleSource = { id: "established-1" };
		const acquireNewSession = makeAcquire({
			withStaleGuard: true,
			staleSource,
		});
		const { result } = mount(acquireNewSession);

		await act(async () => {
			await result.current.acquireNow();
		});

		// BUG: reused the stale (dead) session instead of respawning fresh.
		expect(result.current.sessionId).toBe("established-1");
	});

	it("GREEN: without the guard, acquireNow always creates a fresh session — the fix", async () => {
		const staleSource = { id: "established-1" };
		const acquireNewSession = makeAcquire({
			withStaleGuard: false,
			staleSource,
		});
		const { result } = mount(acquireNewSession);

		await act(async () => {
			await result.current.acquireNow();
		});

		expect(result.current.sessionId).toBe("fresh-1");
		expect(result.current.state).toBe("ready");
		expect(acquireNewSession).toHaveBeenCalledTimes(1);
	});
});
