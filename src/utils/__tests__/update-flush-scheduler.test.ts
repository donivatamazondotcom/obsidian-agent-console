import { describe, it, expect, vi } from "vitest";
import {
	createUpdateFlushScheduler,
	createDomFlushSchedulerDeps,
	type FlushSchedulerWindow,
} from "../update-flush-scheduler";

/**
 * Deterministic fake platform: rAF and macrotask callbacks are captured and
 * fired manually; rAF callbacks can be "frozen" (never fired) to model a
 * hidden window — the I168 condition.
 */
function fakeDeps(initialVisibility: DocumentVisibilityState = "visible") {
	let visibility = initialVisibility;
	const rafQueue: Array<() => void> = [];
	const macroQueue: Array<() => void> = [];
	const visListeners: Array<() => void> = [];
	return {
		deps: {
			raf: (cb: () => void) => rafQueue.push(cb),
			postMacrotask: (cb: () => void) => macroQueue.push(cb),
			getVisibility: () => visibility,
			subscribeVisibility: (l: () => void) => {
				visListeners.push(l);
				return () => visListeners.splice(visListeners.indexOf(l), 1);
			},
		},
		fireRaf: () => rafQueue.splice(0).forEach((cb) => cb()),
		fireMacrotasks: () => macroQueue.splice(0).forEach((cb) => cb()),
		setVisibility: (v: DocumentVisibilityState) => {
			visibility = v;
			visListeners.slice().forEach((l) => l());
		},
		counts: () => ({ raf: rafQueue.length, macro: macroQueue.length }),
		listenerCount: () => visListeners.length,
	};
}

describe("createUpdateFlushScheduler", () => {
	it("visible: schedules via rAF and flushes once when the frame fires", () => {
		const flush = vi.fn();
		const f = fakeDeps("visible");
		const s = createUpdateFlushScheduler(flush, f.deps);
		s.schedule();
		expect(f.counts()).toEqual({ raf: 1, macro: 0 });
		f.fireRaf();
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it("hidden: schedules via macrotask, never rAF (I168 — rAF does not fire in hidden windows)", () => {
		const flush = vi.fn();
		const f = fakeDeps("hidden");
		const s = createUpdateFlushScheduler(flush, f.deps);
		s.schedule();
		expect(f.counts()).toEqual({ raf: 0, macro: 1 });
		f.fireMacrotasks();
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it("coalesces: multiple schedule() calls before the flush produce one flush", () => {
		const flush = vi.fn();
		const f = fakeDeps("visible");
		const s = createUpdateFlushScheduler(flush, f.deps);
		s.schedule();
		s.schedule();
		s.schedule();
		f.fireRaf();
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it("scheduled-then-hidden race: a flush parked on a frozen rAF is drained via macrotask on visibilitychange", () => {
		const flush = vi.fn();
		const f = fakeDeps("visible");
		const s = createUpdateFlushScheduler(flush, f.deps);
		s.schedule(); // parked on rAF
		f.setVisibility("hidden"); // window hides; the rAF will never fire
		expect(f.counts().macro).toBe(1); // drained to macrotask
		f.fireMacrotasks();
		expect(flush).toHaveBeenCalledTimes(1);
		// The stale rAF eventually fires on refocus — must not double-flush.
		f.fireRaf();
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it("re-schedules cleanly after a drain (next burst flushes again)", () => {
		const flush = vi.fn();
		const f = fakeDeps("visible");
		const s = createUpdateFlushScheduler(flush, f.deps);
		s.schedule();
		f.setVisibility("hidden");
		f.fireMacrotasks();
		s.schedule(); // now hidden → macrotask path
		f.fireMacrotasks();
		expect(flush).toHaveBeenCalledTimes(2);
	});

	it("dispose: unsubscribes and pending flushes become no-ops", () => {
		const flush = vi.fn();
		const f = fakeDeps("visible");
		const s = createUpdateFlushScheduler(flush, f.deps);
		s.schedule();
		s.dispose();
		f.fireRaf();
		expect(flush).not.toHaveBeenCalled();
		expect(f.listenerCount()).toBe(0);
	});
});

describe("createDomFlushSchedulerDeps", () => {
	/**
	 * Popout contract: the factory must use the window it is GIVEN, never an
	 * ambient global. A window object implementing only the two members
	 * `FlushSchedulerWindow` declares proves it — had the implementation
	 * reached for a global `MessageChannel` / `requestAnimationFrame`, these
	 * spies would stay cold.
	 *
	 * `SpyChannel extends MessageChannel` keeps real ports (so `postMacrotask`
	 * genuinely round-trips) while counting construction, and satisfies
	 * `FlushSchedulerWindow` with no cast — which is the point of narrowing the
	 * parameter type to the members actually used.
	 */
	function fakeWin({ slowDelivery = false }: { slowDelivery?: boolean } = {}) {
		let constructed = 0;
		const rafCallbacks: FrameRequestCallback[] = [];
		class SpyChannel extends MessageChannel {
			constructor() {
				super();
				constructed += 1;
				if (slowDelivery) {
					// Defer the port message strictly past one `setTimeout(…, 0)`
					// tick, reproducing the loaded-runner ordering deterministically
					// (I182). The ports stay real, so the round-trip is still real.
					const realPost = this.port2.postMessage.bind(this.port2);
					this.port2.postMessage = (message: unknown) => {
						setTimeout(() => setTimeout(() => realPost(message), 0), 0);
					};
				}
			}
		}
		const win: FlushSchedulerWindow = {
			MessageChannel: SpyChannel,
			requestAnimationFrame: (cb) => {
				rafCallbacks.push(cb);
				return rafCallbacks.length;
			},
		};
		return {
			win,
			constructedCount: () => constructed,
			fireRaf: () => rafCallbacks.splice(0).forEach((cb) => cb(0)),
			rafCount: () => rafCallbacks.length,
		};
	}

	/**
	 * A spy plus a promise that settles when the spy runs.
	 *
	 * Waiting on the delivery ITSELF is what keeps these tests off task-source
	 * ordering. A `MessagePort` message and a `setTimeout(…, 0)` are separate
	 * task sources and the spec orders neither against the other, so awaiting one
	 * timer tick and then asserting delivery encodes a guarantee the platform
	 * never made — it passes locally and fails on a loaded runner (I182).
	 */
	function deliverySpy() {
		let signalDelivered!: () => void;
		const delivered = new Promise<void>((resolve) => {
			signalDelivered = resolve;
		});
		return { cb: vi.fn(() => signalDelivered()), delivered };
	}

	it("constructs its channel from the injected window, not an ambient global", () => {
		const f = fakeWin();
		expect(f.constructedCount()).toBe(0);
		createDomFlushSchedulerDeps(f.win, document);
		expect(f.constructedCount()).toBe(1);
	});

	it("routes raf through the injected window's requestAnimationFrame", () => {
		const f = fakeWin();
		const deps = createDomFlushSchedulerDeps(f.win, document);
		const cb = vi.fn();
		deps.raf(cb);
		expect(f.rafCount()).toBe(1);
		expect(cb).not.toHaveBeenCalled();
		f.fireRaf();
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("reads visibility from the injected document", () => {
		const f = fakeWin();
		const deps = createDomFlushSchedulerDeps(f.win, document);
		expect(deps.getVisibility()).toBe(document.visibilityState);
	});

	it("subscribes and unsubscribes visibilitychange on the injected document", () => {
		const f = fakeWin();
		const add = vi.spyOn(document, "addEventListener");
		const remove = vi.spyOn(document, "removeEventListener");
		const deps = createDomFlushSchedulerDeps(f.win, document);
		const unsubscribe = deps.subscribeVisibility(() => {});
		expect(add).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
		unsubscribe();
		expect(remove).toHaveBeenCalledWith(
			"visibilitychange",
			expect.any(Function),
		);
		add.mockRestore();
		remove.mockRestore();
	});

	it("postMacrotask delivers the callback as a macrotask via the channel", async () => {
		const f = fakeWin();
		const deps = createDomFlushSchedulerDeps(f.win, document);
		const { cb, delivered } = deliverySpy();
		deps.postMacrotask(cb);
		expect(cb).not.toHaveBeenCalled(); // macrotask, not synchronous
		await delivered;
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("postMacrotask still delivers when the port lands after a timer tick", async () => {
		// Regression guard for I182. The previous version of the test above
		// awaited a single `setTimeout(…, 0)` and then asserted delivery, which
		// is an ordering between two independent task sources that nothing
		// guarantees; on a loaded CI runner the timer won and the suite went red
		// with "expected spy to be called 1 times, but got 0 times". Delaying the
		// port past a timer tick makes that ordering deterministic, so this test
		// fails against the old wait and passes against the delivery-signal wait.
		const f = fakeWin({ slowDelivery: true });
		const deps = createDomFlushSchedulerDeps(f.win, document);
		const { cb, delivered } = deliverySpy();
		deps.postMacrotask(cb);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(cb).not.toHaveBeenCalled(); // one timer tick is NOT sufficient
		await delivered;
		expect(cb).toHaveBeenCalledTimes(1);
	});
});
