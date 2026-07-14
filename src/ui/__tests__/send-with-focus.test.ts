/**
 * sendAndReturnFocus — send → refocus timing seam (I173).
 *
 * Reproduces the I173 regression: the composer must regain focus as soon as a
 * send is dispatched, NOT after the assistant's turn ends. The send chains to
 * the ACP `session/prompt` RPC, which resolves only at turn-end; a send that
 * never resolves models a turn still streaming.
 *
 * Spec: [[I173 Composer focus not returned after send until turn ends]],
 * [[Composer Focus Return After State Change]].
 */
import { describe, it, expect, vi } from "vitest";
import { sendAndReturnFocus } from "../composer-focus";

describe("sendAndReturnFocus (I173)", () => {
	it("returns composer focus at dispatch, before the turn ends (T1)", async () => {
		const focusAfter = vi.fn();
		// A send that never resolves models a turn still streaming — the ACP
		// session/prompt RPC settles only at turn-end.
		const dispatchSend = vi.fn(() => new Promise<void>(() => {}));

		sendAndReturnFocus(dispatchSend, focusAfter);

		// Flush a microtask; refocus must not depend on the send resolving
		// (it never does here). Pre-fix (await-then-focus) this never fires.
		await Promise.resolve();

		expect(focusAfter).toHaveBeenCalledWith("send");
	});

	it("dispatches the send exactly once (T2)", () => {
		const focusAfter = vi.fn();
		const dispatchSend = vi.fn(() => new Promise<void>(() => {}));

		sendAndReturnFocus(dispatchSend, focusAfter);

		expect(dispatchSend).toHaveBeenCalledTimes(1);
	});
});
