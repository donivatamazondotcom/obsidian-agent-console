/**
 * A2UI-I01 reproduce-first — refocus timing.
 *
 * The composer refocus after a button activation must fire at DISPATCH, not
 * behind the send promise: ACP `session/prompt` resolves only when the whole
 * streamed turn ends (the I173 class), so an awaited refocus lands minutes
 * late. Round-1 fix awaited `sendDetached` and failed the human re-check.
 *
 * The test models the failure precisely: a send whose promise NEVER resolves
 * (a turn that streams forever). Refocus must still have fired synchronously.
 */
import { describe, expect, it, vi } from "vitest";
import { activateA2uiButton } from "../activate";
import type { SessionDispatchPort } from "../../session-dispatch-port";
import type { A2uiButton } from "../action";

const BUTTON: A2uiButton = {
	kind: "button",
	id: "minimal",
	child: "minimal-label",
	label: "Minimal fix",
	event: { name: "choose_scope", context: { scope: "minimal" } },
};

function makePort(overrides: Partial<SessionDispatchPort> = {}): {
	port: SessionDispatchPort;
	sent: string[];
} {
	const sent: string[] = [];
	return {
		sent,
		port: {
			canSendNow: () => true,
			sendDetached: (text: string) => {
				sent.push(text);
				return new Promise<boolean>(() => {}); // never resolves — turn streams forever
			},
			notify: () => {},
			...overrides,
		},
	};
}

describe("activateA2uiButton — refocus at dispatch (A2UI-I01)", () => {
	it("refocuses the composer synchronously, before the send promise settles", () => {
		const { port, sent } = makePort();
		const refocus = vi.fn();
		void activateA2uiButton({
			port,
			surfaceId: "migration-scope-7f3a",
			button: BUTTON,
			now: () => "2026-07-16T13:50:00.000Z",
			refocusComposer: refocus,
		});
		// The send never resolves; the refocus must already have fired.
		expect(refocus).toHaveBeenCalledTimes(1);
		expect(sent).toHaveLength(1);
		expect(sent[0].startsWith("Selected: Minimal fix")).toBe(true);
	});

	it("does not refocus when the port refuses the send (cannot send now)", () => {
		const { port } = makePort({
			canSendNow: () => false,
			sendDetached: () => Promise.resolve(false),
		});
		const refocus = vi.fn();
		void activateA2uiButton({
			port,
			surfaceId: "s-1a2b",
			button: BUTTON,
			now: () => "2026-07-16T13:50:00.000Z",
			refocusComposer: refocus,
		});
		expect(refocus).not.toHaveBeenCalled();
	});

	it("returns the port's result for the pending/answered lifecycle (T11)", async () => {
		const { port } = makePort({
			sendDetached: () => Promise.resolve(false),
		});
		await expect(
			activateA2uiButton({
				port,
				surfaceId: "s-1a2b",
				button: BUTTON,
				now: () => "2026-07-16T13:50:00.000Z",
				refocusComposer: () => {},
			}),
		).resolves.toBe(false);
	});
});
