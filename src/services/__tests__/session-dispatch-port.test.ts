/**
 * D8/D13 — SessionDispatchPort: the minimal detached-send seam A2UI actions
 * dispatch through. By construction it has NO composer dependencies (no
 * getComposerText/setComposerText/insertAtCursor thunks exist on its deps
 * type), so a detached send can never clobber an unsent draft — the verified
 * fireOrQueue hazard the spec's § Quick Prompts bridge documents.
 *
 * canSendNow routes through the established send-affordance resolver
 * (deriveSendAffordance + isSessionLive) with the action-specific D7
 * constraints on top: actions never queue, so a non-live session or an
 * occupied queue slot means "cannot send now" — not "queue it".
 */
import { describe, expect, it, vi } from "vitest";
import { createSessionDispatchPort } from "../session-dispatch-port";
import type { SessionDispatchPortDeps } from "../session-dispatch-port";
import type { TabSessionState } from "../../hooks/useTabSessionState";

function makeDeps(
	overrides: Partial<{
		lazyState: TabSessionState;
		isSending: boolean;
		isQueued: boolean;
		isRestoringSession: boolean;
		sendMessage: (text: string) => Promise<void>;
	}> = {},
): SessionDispatchPortDeps & {
	sent: string[];
	notices: string[];
} {
	const sent: string[] = [];
	const notices: string[] = [];
	return {
		sent,
		notices,
		lazyState: () => overrides.lazyState ?? "ready",
		isSending: () => overrides.isSending ?? false,
		isQueued: () => overrides.isQueued ?? false,
		isRestoringSession: () => overrides.isRestoringSession ?? false,
		sendMessage:
			overrides.sendMessage ??
			(async (text: string) => {
				sent.push(text);
			}),
		notify: (message: string) => {
			notices.push(message);
		},
	};
}

describe("createSessionDispatchPort — canSendNow", () => {
	it("is true on a live, idle tab with an empty queue slot", () => {
		expect(createSessionDispatchPort(makeDeps()).canSendNow()).toBe(true);
	});

	it.each<TabSessionState>(["idle", "connecting", "error"])(
		"is false when the session is not live (%s) — actions never lazily acquire",
		(lazyState) => {
			expect(
				createSessionDispatchPort(makeDeps({ lazyState })).canSendNow(),
			).toBe(false);
		},
	);

	it("is false while a turn is streaming", () => {
		expect(
			createSessionDispatchPort(makeDeps({ isSending: true })).canSendNow(),
		).toBe(false);
	});

	it("is false while the queue slot is occupied — actions never queue", () => {
		expect(
			createSessionDispatchPort(makeDeps({ isQueued: true })).canSendNow(),
		).toBe(false);
	});

	it("is false while session history is restoring", () => {
		expect(
			createSessionDispatchPort(
				makeDeps({ isRestoringSession: true }),
			).canSendNow(),
		).toBe(false);
	});

	it("reads live state through thunks (never goes stale)", () => {
		let sending = true;
		const deps = makeDeps();
		deps.isSending = () => sending;
		const port = createSessionDispatchPort(deps);
		expect(port.canSendNow()).toBe(false);
		sending = false;
		expect(port.canSendNow()).toBe(true);
	});
});

describe("createSessionDispatchPort — sendDetached", () => {
	it("dispatches the text through the send path and resolves true", async () => {
		const deps = makeDeps();
		const port = createSessionDispatchPort(deps);
		await expect(port.sendDetached("Selected: X")).resolves.toBe(true);
		expect(deps.sent).toEqual(["Selected: X"]);
	});

	it("refuses when it cannot send now: no dispatch, notifies, resolves false", async () => {
		const deps = makeDeps({ isQueued: true });
		const port = createSessionDispatchPort(deps);
		await expect(port.sendDetached("Selected: X")).resolves.toBe(false);
		expect(deps.sent).toEqual([]);
		expect(deps.notices.length).toBe(1);
	});

	it("resolves false when the underlying send rejects (T11 seed)", async () => {
		const deps = makeDeps({
			sendMessage: () => Promise.reject(new Error("session gone")),
		});
		const port = createSessionDispatchPort(deps);
		await expect(port.sendDetached("Selected: X")).resolves.toBe(false);
	});

	it("never throws on a synchronously-throwing send", async () => {
		const deps = makeDeps({
			sendMessage: () => {
				throw new Error("boom");
			},
		});
		const port = createSessionDispatchPort(deps);
		await expect(port.sendDetached("x")).resolves.toBe(false);
	});
});

describe("createSessionDispatchPort — notify passthrough", () => {
	it("forwards notifications", () => {
		const deps = makeDeps();
		createSessionDispatchPort(deps).notify("hello");
		expect(deps.notices).toEqual(["hello"]);
	});

	it("has no composer surface (compile-time contract)", () => {
		// The deps type has no composer thunks; this assertion documents the
		// D8 guarantee at runtime for reviewers reading test output.
		const port = createSessionDispatchPort(makeDeps());
		expect(Object.keys(port).sort()).toEqual([
			"canSendNow",
			"notify",
			"sendDetached",
		]);
	});
});

// Deliberate vi import usage guard (mock budget R4: no mocks needed at all —
// the port is pure over injected thunks).
void vi;
