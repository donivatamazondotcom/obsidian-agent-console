/**
 * T-I109 — queued-send routing must not take the acquire path mid-stream.
 *
 * A message queued while a live session is streaming (`busy`) must be held and
 * flushed on turn-end (`sendWhileStreaming`), NOT routed to the acquire path
 * (`sendWhilePreReady`). The old inline check (`state === "ready"`) misrouted
 * `busy` to the acquire path, so a post-hard-reload sessionId flicker could
 * fire a spurious acquisition whose `acquisitionComplete` flushed the message
 * mid-stream. Spec: [[I109 Queued message inserts mid-stream after hard reload]].
 */
import { describe, it, expect } from "vitest";
import { decideQueuedSendKind } from "../message-queue-logic";

describe("decideQueuedSendKind — I109 queued-send routing", () => {
	it("holds for turn-end while streaming (busy) — the bug: must NOT acquire", () => {
		expect(decideQueuedSendKind("busy")).toBe("sendWhileStreaming");
	});

	it("holds for turn-end on other live-session states (ready, permission)", () => {
		expect(decideQueuedSendKind("ready")).toBe("sendWhileStreaming");
		expect(decideQueuedSendKind("permission")).toBe("sendWhileStreaming");
	});

	it("acquires only when there is no live session (idle / connecting / error)", () => {
		expect(decideQueuedSendKind("idle")).toBe("sendWhilePreReady");
		expect(decideQueuedSendKind("connecting")).toBe("sendWhilePreReady");
		expect(decideQueuedSendKind("error")).toBe("sendWhilePreReady");
	});
});
