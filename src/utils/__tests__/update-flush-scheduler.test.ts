import { describe, it, expect, vi } from "vitest";
import { createUpdateFlushScheduler } from "../update-flush-scheduler";

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
