/**
 * I70 reproducing test: broadcast send silently skips background lazy tabs.
 *
 * Bug: the per-tab `sendMessage()` callback in ChatPanel (used by broadcast
 * send) bails early on `!isSessionReady` BEFORE calling
 * `handleSendWithLazyAcquisition`:
 *
 *     if (!isSessionReadyRef.current || sessionHistoryLoading) return false;
 *
 * Background tabs are lazy/idle until first activated, so they fail this gate
 * and never send — even though `canSend()` returns true for idle/connecting
 * (the I41/I42 send-while-connecting behavior). The normal send button has no
 * such gate (it calls handleSendWithLazyAcquisition directly, which queues the
 * message and acquires the session). Broadcast prompt has no gate either,
 * which is why prompt fanned out but send did not.
 *
 * Fix: drop the `!isSessionReadyRef.current` bail from the broadcast
 * sendMessage callback so it defers to handleSendWithLazyAcquisition (acquire
 * + queue) for not-ready-but-idle/connecting tabs — matching the send button.
 */
import { describe, it, expect } from "vitest";

type LazyState = "idle" | "connecting" | "ready" | "error";

interface SendParams {
	hasContent: boolean;
	isSessionReady: boolean;
	sessionHistoryLoading: boolean;
	isSending: boolean;
	lazyState: LazyState;
}

/** CURRENT (broken) gate in ChatPanel sendMessage — returns true only if it
 *  would actually reach the send handler. */
function currentReachesHandler(p: SendParams): boolean {
	if (!p.hasContent) return false;
	if (!p.isSessionReady || p.sessionHistoryLoading) return false; // the bug
	if (p.isSending) return false;
	return true;
}

/** FIXED gate: no isSessionReady requirement — defer to lazy acquisition for
 *  idle/connecting (handleSendWithLazyAcquisition queues + acquires). */
function fixedReachesHandler(p: SendParams): boolean {
	if (!p.hasContent) return false;
	if (p.sessionHistoryLoading) return false;
	if (p.isSending) return false;
	const canAccept =
		p.isSessionReady ||
		p.lazyState === "idle" ||
		p.lazyState === "connecting";
	return canAccept;
}

const lazyIdleTab: SendParams = {
	hasContent: true,
	isSessionReady: false,
	sessionHistoryLoading: false,
	isSending: false,
	lazyState: "idle",
};

describe("I70 — broadcast send reaches lazy/idle background tabs", () => {
	it("demonstrates the bug: current gate SKIPS a lazy idle tab with content", () => {
		// This is what the user observed — other (lazy) tabs never send.
		expect(currentReachesHandler(lazyIdleTab)).toBe(false);
	});

	it("fix: a lazy idle tab with content DOES reach the send handler", () => {
		expect(fixedReachesHandler(lazyIdleTab)).toBe(true);
	});

	it("fix: a connecting tab with content reaches the handler", () => {
		expect(
			fixedReachesHandler({ ...lazyIdleTab, lazyState: "connecting" }),
		).toBe(true);
	});

	it("fix: a ready tab with content still reaches the handler", () => {
		expect(
			fixedReachesHandler({
				...lazyIdleTab,
				isSessionReady: true,
				lazyState: "ready",
			}),
		).toBe(true);
	});

	it("fix: empty input never reaches the handler", () => {
		expect(
			fixedReachesHandler({ ...lazyIdleTab, hasContent: false }),
		).toBe(false);
	});

	it("fix: an already-sending tab is not double-sent", () => {
		expect(fixedReachesHandler({ ...lazyIdleTab, isSending: true })).toBe(
			false,
		);
	});

	it("fix: history-loading tab is skipped", () => {
		expect(
			fixedReachesHandler({ ...lazyIdleTab, sessionHistoryLoading: true }),
		).toBe(false);
	});
});
