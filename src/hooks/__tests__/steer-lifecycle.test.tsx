import { describe, it, expect } from "vitest";
import * as React from "react";
import { act, render } from "@testing-library/react";
import { useQueueOrchestration } from "../useQueueOrchestration";

/**
 * Faithful lifecycle harness for steer (#81), guarding two smoke-found bugs:
 *
 *  - I162: one steer must dispatch the redirect EXACTLY once (no double send).
 *  - I165: while the redirect turn processes, `isSending` must be TRUE so the
 *    working animation + Stop button (both gated purely on `isSending`) show.
 *
 * This is NOT a pure-reducer test — it models the LIVE ChatPanel wiring the
 * reducer sits inside: the `isSending` feedback loop AND the ORDERING of
 * `cancelOperation` (`discardPendingTurn` flips isSending false optimistically
 * → the turn-end edge fires MID-cancel → `clearPendingUpdates` flips isSending
 * false AGAIN after the awaited cancel). The fix defers the steer flush to a
 * `steerCancelSettled` event dispatched only after the whole cancel resolves,
 * so the redirect's `isSending=true` is the LAST write and cleanup can't
 * clobber it (learned rule: "test the LIVE wiring, not just the pure fn").
 */

interface HarnessHandle {
	steer: (text: string) => void;
	endTurn: () => void;
	getIsSending: () => boolean;
	sends: string[];
}

function useSteerHarness(handleRef: React.MutableRefObject<HarnessHandle | null>) {
	const [isSending, setIsSending] = React.useState(true); // start mid-turn (streaming)
	const [, setComposer] = React.useState("redirect me");
	const sendsRef = React.useRef<string[]>([]);
	const cancelledRef = React.useRef(false);

	const queue = useQueueOrchestration({
		acquire: () => {},
		flushDispatch: (m) => {
			sendsRef.current.push(m.content);
			// A real send starts the redirect turn (isSending true). In the
			// fixed flow this is the LAST isSending write.
			setIsSending(true);
		},
		clearComposer: () => setComposer(""),
		// Mirror handleStopGeneration → cancelOperation ordering:
		//  1. discardPendingTurn: optimistic isSending false (fires mid-cancel
		//     turn-end, which HOLDS the steer).
		//  2. await session/cancel …
		//  3. clearPendingUpdates: isSending false again.
		//  4. handleStopGeneration resolves → dispatch steerCancelSettled →
		//     flush → send → isSending true (LAST write).
		cancelTurn: () => {
			setIsSending(false); // discardPendingTurn
			queueMicrotask(() => {
				setIsSending(false); // clearPendingUpdates (post-await)
				queue.dispatch({ type: "steerCancelSettled" });
			});
		},
	});

	const prevIsSendingRef = React.useRef(isSending);
	React.useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;
		if (!wasSending && isSending) {
			cancelledRef.current = false;
			return;
		}
		if (wasSending && !isSending) {
			queue.dispatch({
				type: "turnEnded",
				hadError: false,
				wasCancelled: cancelledRef.current,
			});
		}
	}, [isSending, queue.dispatch]);

	handleRef.current = {
		steer: (text: string) => {
			setComposer(text);
			queue.dispatch({
				type: "steerWhileStreaming",
				message: { content: text.trim() },
			});
		},
		endTurn: () => setIsSending(false),
		getIsSending: () => isSending,
		sends: sendsRef.current,
	};

	return { isSending };
}

function Harness({ handleRef }: { handleRef: React.MutableRefObject<HarnessHandle | null> }) {
	useSteerHarness(handleRef);
	return null;
}

describe("steer lifecycle (#81 smoke bugs)", () => {
	it("one steer sends the redirect exactly once AND keeps isSending true on the redirect turn", async () => {
		const handleRef = React.createRef<HarnessHandle>() as React.MutableRefObject<HarnessHandle | null>;
		render(<Harness handleRef={handleRef} />);

		act(() => {
			handleRef.current!.steer("Actually stop — just tell me X");
		});

		// Let the cancel settle (discardPendingTurn → turn-end HOLD →
		// clearPendingUpdates → steerCancelSettled → flush → send).
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// I162: dispatched exactly once.
		expect(handleRef.current!.sends).toEqual([
			"Actually stop — just tell me X",
		]);
		// I165: the redirect turn is streaming — isSending true → working
		// animation + Stop button render (both gated on isSending). The old
		// flush-on-turn-end path left this false (clearPendingUpdates clobber).
		expect(handleRef.current!.getIsSending()).toBe(true);

		// Ending the redirect turn must NOT re-flush (slot already empty).
		act(() => {
			handleRef.current!.endTurn();
		});
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(handleRef.current!.sends).toEqual([
			"Actually stop — just tell me X",
		]);
	});
});
