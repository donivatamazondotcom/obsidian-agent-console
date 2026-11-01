/**
 * I209 — every resolver that reads `TabSessionState` decides `released`
 * explicitly (spec § 2, "Equality checks the compiler won't catch").
 *
 * - deriveTabState: `released` is its own kind (the quiet ring), whatever the
 *   stale isSending / permission flags say.
 * - deriveSendAffordance: released behaves like idle — send enabled, it
 *   triggers acquisition. isSessionLive is false.
 * - decideQueuedSendKind: a send on a released tab is a pre-ready hold, so the
 *   connect-flush delivers it.
 * - deriveA2uiTabDispatch: released reconnects, then delivers.
 * - Queue flush edges: the reconnect reaches `ready` through `connecting`, so
 *   the connect-flush fires; `released → connecting` itself flushes nothing.
 *
 * Expected values are literals (R5).
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { describe, expect, it } from "vitest";
import { deriveTabState } from "../tab-state";
import { deriveSendAffordance, isSessionLive } from "../send-affordance";
import { deriveA2uiTabDispatch } from "../a2ui-dispatch";
import {
	decideConnectFlush,
	decideQueuedSendKind,
	shouldFlushOnReady,
} from "../../services/message-queue-logic";

describe("I209 released mappings", () => {
	it.each([
		[false, false],
		[true, false],
		[false, true],
		[true, true],
	])(
		"deriveTabState(released, isSending=%s, permission=%s) → released",
		(isSending, hasActivePermission) => {
			expect(
				deriveTabState({ lifecycle: "released", isSending, hasActivePermission }),
			).toBe("released");
		},
	);

	it("send affordance: released with content is sendable", () => {
		expect(
			deriveSendAffordance({
				lazyState: "released",
				isSending: false,
				isQueued: false,
				hasContent: true,
				isRestoringSession: false,
			}),
		).toEqual({ canSend: true, buttonDisabled: false, reason: "ready" });
	});

	it("a released session is not live", () => {
		expect(isSessionLive("released")).toBe(false);
	});

	it("a queued send on a released tab waits for the reconnect", () => {
		expect(decideQueuedSendKind("released")).toBe("sendWhilePreReady");
	});

	it("an A2UI action on a released tab reconnects, then delivers", () => {
		expect(
			deriveA2uiTabDispatch({
				sessionState: "released",
				isSending: false,
				isQueued: false,
				isRestoringSession: false,
			}),
		).toEqual({ kind: "acquireAndSend" });
	});

	it("released → connecting flushes nothing and is not a failed acquisition", () => {
		expect(
			decideConnectFlush({
				prevState: "released",
				state: "connecting",
				hasSessionId: false,
				awaitingSessionId: false,
			}),
		).toEqual({
			dispatchAcquisitionComplete: false,
			dispatchAcquisitionFailed: false,
			awaitingSessionId: false,
		});
	});

	it("the reconnect's connecting → ready edge flushes the held send", () => {
		expect(
			shouldFlushOnReady({
				prevState: "connecting",
				state: "ready",
				hasSessionId: true,
				isQueued: true,
			}),
		).toBe(true);
		expect(
			decideConnectFlush({
				prevState: "connecting",
				state: "ready",
				hasSessionId: true,
				awaitingSessionId: false,
			}).dispatchAcquisitionComplete,
		).toBe(true);
	});

	it("ready → released is not an acquisition edge", () => {
		expect(
			shouldFlushOnReady({
				prevState: "ready",
				state: "released",
				hasSessionId: false,
				isQueued: true,
			}),
		).toBe(false);
	});
});
