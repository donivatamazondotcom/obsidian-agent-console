/**
 * I376: the per-panel A2UI turn store and the surface-scoped refusal
 * resolver that decides which hosts read it.
 */
import { describe, expect, it, vi } from "vitest";
import { createA2uiTurnStore, type A2uiTurnState } from "../turn-store";
import { deriveSurfaceActionAffordance } from "../surface-state";
import {
	deriveSurfaceScopedRefusal,
	type A2uiSurfaceStatus,
} from "../../../resolvers/a2ui-surface-refusal";

const IDLE: A2uiTurnState = {
	isSending: false,
	isQueued: false,
	isRestoringSession: false,
	sessionState: "ready",
	heldSurfaceId: null,
};

describe("createA2uiTurnStore", () => {
	it("notifies on a real change and keeps the snapshot on an equal publish", () => {
		const store = createA2uiTurnStore(IDLE);
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);
		const first = store.getSnapshot();

		store.publish({ ...IDLE });
		expect(listener).not.toHaveBeenCalled();
		expect(store.getSnapshot()).toBe(first);

		for (const patch of [
			{ isSending: true },
			{ isQueued: true },
			{ isRestoringSession: true },
			{ sessionState: "busy" as const },
			{ heldSurfaceId: "s" },
		]) {
			listener.mockClear();
			store.publish({ ...IDLE, ...patch });
			expect(listener).toHaveBeenCalledTimes(1);
			store.publish(IDLE);
		}

		unsubscribe();
		listener.mockClear();
		store.publish({ ...IDLE, isSending: true });
		expect(listener).not.toHaveBeenCalled();
	});

	it("copies the initial state, so later mutation of the input can't leak in", () => {
		const input = { ...IDLE };
		const store = createA2uiTurnStore(input);
		input.isSending = true;
		expect(store.getSnapshot().isSending).toBe(false);
	});
});

describe("deriveSurfaceScopedRefusal", () => {
	const statuses: A2uiSurfaceStatus[] = ["unanswered", "pending", "answered"];
	const cases = statuses.flatMap((surfaceStatus) =>
		[false, true].flatMap((isSuperseded) =>
			[false, true].map((isStreamingTurn) => ({
				surfaceStatus,
				isSuperseded,
				isStreamingTurn,
			})),
		),
	);

	it.each(cases)("$surfaceStatus / superseded=$isSuperseded / streaming=$isStreamingTurn", (input) => {
		const expected =
			input.surfaceStatus === "answered"
				? "answered"
				: input.surfaceStatus === "pending"
					? "pending"
					: input.isSuperseded
						? "superseded"
						: input.isStreamingTurn
							? "streaming"
							: null;
		expect(deriveSurfaceScopedRefusal(input)).toBe(expected);
	});

	it("agrees with deriveSurfaceActionAffordance: a scoped refusal never reads tab state", () => {
		for (const input of cases) {
			const refusal = deriveSurfaceScopedRefusal(input);
			if (refusal === null) continue;
			// Any tab state, even a fully ready one, gives the same refusal.
			for (const tab of [
				IDLE,
				{ ...IDLE, isSending: true },
				{ ...IDLE, sessionState: "released" as const },
			]) {
				expect(deriveSurfaceActionAffordance({ ...tab, ...input })).toEqual({
					enabled: false,
					reason: refusal,
					mode: "refuse",
				});
			}
		}
	});
});
