/**
 * I209 — `useIdleRelease` (spec § 4, § 6 test 4).
 *
 * One timer per panel, no polling: the hook reads `decideProcessHold` on
 * every input change, arms one `setTimeout(remainingMs)` on `hold:warm`, and
 * re-evaluates when it fires, so a stale timer never releases. The activity
 * clock resets on deactivation, becoming live (reconnect ready), work ending
 * (turn end, permission resolved, queue flushed, draft cleared) and explicit
 * activity (keystroke, send).
 *
 * Seam: the public hook API (R2) with fake timers and an injected clock; the
 * release callback is the boundary (R4). Assertions are on whether and how
 * often the release runs (R3). Literal times (R5).
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIdleRelease, type UseIdleReleaseArgs } from "../useIdleRelease";
import type { BusySignal } from "../../resolvers/process-hold";

const MIN = 60_000;
const T0 = 1_000_000_000_000;

type Props = Omit<UseIdleReleaseArgs, "release" | "now">;

function setup(initial: Partial<Props> = {}) {
	const recheckResults: boolean[] = [];
	const release = vi.fn(async (recheck: () => boolean) => {
		recheckResults.push(recheck());
	});
	const props: Props = {
		isActive: false,
		origin: "fresh",
		hasForkSource: false,
		liveSession: true,
		busy: [],
		...initial,
	};
	const hook = renderHook(
		(p: Props) => useIdleRelease({ ...p, release, now: () => Date.now() }),
		{ initialProps: props },
	);
	const rerender = (over: Partial<Props>) => {
		Object.assign(props, over);
		hook.rerender({ ...props });
	};
	return { hook, release, recheckResults, rerender, props };
}

async function advance(ms: number) {
	await act(async () => {
		vi.advanceTimersByTime(ms);
		await Promise.resolve();
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});
afterEach(() => {
	vi.useRealTimers();
});

describe("I209 useIdleRelease", () => {
	it("releases once, at the hour, not before", async () => {
		const { release, recheckResults } = setup();
		await advance(59 * MIN);
		expect(release).not.toHaveBeenCalled();
		await advance(1 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
		expect(recheckResults).toEqual([true]);
		await advance(5 * 60 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("does not poll: one timer while warm", async () => {
		setup();
		expect(vi.getTimerCount()).toBe(1);
		await advance(30 * MIN);
		expect(vi.getTimerCount()).toBe(1);
	});

	const SIGNALS: BusySignal[] = [
		"streaming",
		"permission",
		"queued",
		"acquiring",
		"history-loading",
		"ai-rename",
		"terminals",
		"draft",
	];
	it.each(SIGNALS)("busy signal %s holds past the hour", async (signal) => {
		const { release } = setup({ busy: [signal] });
		await advance(3 * 60 * MIN);
		expect(release).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("work ending resets the clock", async () => {
		const { release, rerender } = setup();
		await advance(50 * MIN);
		rerender({ busy: ["streaming"] });
		await advance(40 * MIN);
		rerender({ busy: [] }); // turn end at 90 min
		await advance(59 * MIN);
		expect(release).not.toHaveBeenCalled();
		await advance(1 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("activity re-arms: a keystroke at 50 min pushes release to 110 min", async () => {
		const { hook, release } = setup();
		await advance(50 * MIN);
		act(() => hook.result.current.noteActivity());
		await advance(10 * MIN); // the original timer fires at 60, re-evaluates
		expect(release).not.toHaveBeenCalled();
		await advance(49 * MIN);
		expect(release).not.toHaveBeenCalled();
		await advance(1 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("becoming active cancels; the active tab is never released", async () => {
		const { release, rerender } = setup();
		await advance(30 * MIN);
		rerender({ isActive: true });
		expect(vi.getTimerCount()).toBe(0);
		await advance(5 * 60 * MIN);
		expect(release).not.toHaveBeenCalled();
	});

	it("the clock starts at deactivation, not at the last activity", async () => {
		const { release, rerender } = setup({ isActive: true });
		await advance(3 * 60 * MIN);
		rerender({ isActive: false });
		await advance(59 * MIN);
		expect(release).not.toHaveBeenCalled();
		await advance(1 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("does nothing without a live session", async () => {
		const { release } = setup({ liveSession: false });
		await advance(3 * 60 * MIN);
		expect(release).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reconnect ready resets the clock", async () => {
		const { release, rerender } = setup({ liveSession: false });
		await advance(3 * 60 * MIN);
		rerender({ liveSession: true });
		await advance(59 * MIN);
		expect(release).not.toHaveBeenCalled();
		await advance(1 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("recheck reports false when work started after the decision", async () => {
		let resolveRelease: () => void = () => {};
		const seen: boolean[] = [];
		let recheckFn: () => boolean = () => true;
		const release = vi.fn(
			(recheck: () => boolean) =>
				new Promise<void>((r) => {
					recheckFn = recheck;
					resolveRelease = r;
				}),
		);
		const props: Props = {
			isActive: false,
			origin: "fresh",
			hasForkSource: false,
			liveSession: true,
			busy: [],
		};
		const hook = renderHook(
			(p: Props) => useIdleRelease({ ...p, release, now: () => Date.now() }),
			{ initialProps: props },
		);
		await advance(60 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
		hook.rerender({ ...props, busy: ["streaming"] });
		seen.push(recheckFn());
		expect(seen).toEqual([false]);
		// A second release is not started while the first is in flight.
		hook.rerender({ ...props, busy: [] });
		await advance(2 * 60 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolveRelease();
			await Promise.resolve();
		});
	});

	it("honors a shorter threshold (debug override)", async () => {
		const { release } = setup({ thresholdMs: 2 * MIN });
		await advance(2 * MIN);
		expect(release).toHaveBeenCalledTimes(1);
	});
});
