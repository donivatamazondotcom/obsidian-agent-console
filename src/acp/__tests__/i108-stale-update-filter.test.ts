/**
 * T-I108 — reproduce-first test for the stale-update leak after hard reload.
 *
 * Bug: `AcpHandler.emitSessionUpdate` guards `if (currentId && update.sessionId
 * !== currentId)`. During hard-reload teardown, `disconnect()` sets
 * currentSessionId = null, so the guard short-circuits (currentId falsy) and a
 * LATE stream chunk from the cancelled turn (carrying the OLD sessionId) is
 * emitted — flushed onto the just-cleared transcript = leftover text (I108).
 *
 * Fix: drop when the update carries a non-empty sessionId that doesn't match
 * the current one, even when current is null — while still surfacing
 * process_error (emitted with an empty sessionId).
 *
 * Verified RED (stale chunk leaks when current is null) → GREEN after the guard
 * change. Spec: [[I108 Spurious leftover stream text after hard reload]].
 */
import { describe, it, expect, vi } from "vitest";
import { AcpHandler } from "../acp-handler";
import type { SessionUpdate } from "../../types/session";

function makeHandler(getCurrentSessionId: () => string | null) {
	const logger = {
		log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
	} as unknown as ConstructorParameters<typeof AcpHandler>[4];
	const handler = new AcpHandler(
		{} as unknown as ConstructorParameters<typeof AcpHandler>[0],
		{} as unknown as ConstructorParameters<typeof AcpHandler>[1],
		() => "",
		getCurrentSessionId,
		logger,
	);
	const received: SessionUpdate[] = [];
	handler.onSessionUpdate((u) => received.push(u));
	return { handler, received };
}

const chunk = (sessionId: string): SessionUpdate =>
	({ type: "agent_message_chunk", sessionId, text: "leftover" } as unknown as SessionUpdate);
const procErr = (sessionId: string): SessionUpdate =>
	({ type: "process_error", sessionId, error: { title: "x", message: "y" } } as unknown as SessionUpdate);

describe("AcpHandler.emitSessionUpdate — I108 stale-update filtering", () => {
	it("drops a late stream chunk (old sessionId) when there is no current session", () => {
		// Teardown window: disconnect() has set currentSessionId = null.
		const { handler, received } = makeHandler(() => null);
		handler.emitSessionUpdate(chunk("old-session-id"));
		// The stale chunk must NOT reach listeners (else it paints the cleared transcript).
		expect(received).toHaveLength(0);
	});

	it("still surfaces process_error during teardown (empty sessionId, current null)", () => {
		const { handler, received } = makeHandler(() => null);
		handler.emitSessionUpdate(procErr(""));
		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("process_error");
	});

	it("emits updates that match the current session", () => {
		const { handler, received } = makeHandler(() => "A");
		handler.emitSessionUpdate(chunk("A"));
		expect(received).toHaveLength(1);
	});

	it("drops updates for a different session (unchanged behavior)", () => {
		const { handler, received } = makeHandler(() => "A");
		handler.emitSessionUpdate(chunk("B"));
		expect(received).toHaveLength(0);
	});
});
