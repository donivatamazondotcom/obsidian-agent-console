import { describe, it, expect, vi } from "vitest";

import {
	runNotificationClick,
	NOTIFICATION_REASSERT_DELAY_MS,
	type NotificationClickDeps,
} from "../notification-click";

/**
 * Fake scheduler: records (fn, ms) and lets the test fire the callback
 * deterministically — no fake timers needed.
 */
function fakeScheduler() {
	const scheduled: Array<{ fn: () => void; ms: number }> = [];
	return {
		scheduled,
		schedule: (fn: () => void, ms: number) => {
			scheduled.push({ fn, ms });
		},
	};
}

function makeDeps(
	overrides: Partial<NotificationClickDeps> = {},
): NotificationClickDeps & { calls: string[] } {
	const calls: string[] = [];
	const sched = fakeScheduler();
	return {
		calls,
		tabId: "tab-abc123",
		onSwitchToTab: vi.fn((_id: string) => calls.push("switch")),
		revealOwningLeaf: vi.fn(() => calls.push("reveal")),
		owningWindowHasFocus: () => true,
		schedule: sched.schedule,
		...overrides,
	};
}

describe("runNotificationClick — immediate path", () => {
	it("switches to the producing tab, then reveals its owning leaf (in order)", () => {
		const deps = makeDeps();
		runNotificationClick(deps);
		expect(deps.onSwitchToTab).toHaveBeenCalledWith("tab-abc123");
		expect(deps.revealOwningLeaf).toHaveBeenCalledTimes(1);
		// Ordering matters: the tab must be active before the leaf is surfaced,
		// so the correct tab is shown when the owning window comes forward.
		expect(deps.calls).toEqual(["switch", "reveal"]);
	});

	it("still reveals the owning leaf when there is no tab to switch to (floating chat / permission)", () => {
		const deps = makeDeps({ onSwitchToTab: undefined });
		runNotificationClick(deps);
		expect(deps.revealOwningLeaf).toHaveBeenCalledTimes(1);
	});
});

describe("runNotificationClick — bounded post-activation re-assert (I52 recurrence 2026-07-14)", () => {
	// The macOS notification-click app activation asynchronously foregrounds
	// the most-recently-active window AFTER our synchronous handlers ran, so
	// a single reveal can lose the race. One bounded recheck after the
	// activation settles re-asserts the reveal only if we lost.

	it("schedules exactly one recheck at the default delay", () => {
		const sched = fakeScheduler();
		const deps = makeDeps({ schedule: sched.schedule });
		runNotificationClick(deps);
		expect(sched.scheduled).toHaveLength(1);
		expect(sched.scheduled[0].ms).toBe(NOTIFICATION_REASSERT_DELAY_MS);
	});

	it("re-asserts the reveal when the owning window lost the focus race", () => {
		const sched = fakeScheduler();
		const deps = makeDeps({
			schedule: sched.schedule,
			owningWindowHasFocus: () => false,
		});
		runNotificationClick(deps);
		expect(deps.revealOwningLeaf).toHaveBeenCalledTimes(1);
		sched.scheduled[0].fn(); // OS activation has settled; we lost.
		expect(deps.revealOwningLeaf).toHaveBeenCalledTimes(2);
	});

	it("does NOT re-assert when the owning window won the race", () => {
		const sched = fakeScheduler();
		const deps = makeDeps({
			schedule: sched.schedule,
			owningWindowHasFocus: () => true,
		});
		runNotificationClick(deps);
		sched.scheduled[0].fn();
		expect(deps.revealOwningLeaf).toHaveBeenCalledTimes(1);
	});

	it("is bounded: the recheck never schedules another recheck", () => {
		const sched = fakeScheduler();
		const deps = makeDeps({
			schedule: sched.schedule,
			owningWindowHasFocus: () => false,
		});
		runNotificationClick(deps);
		sched.scheduled[0].fn();
		expect(sched.scheduled).toHaveLength(1);
	});

	it("honors a custom re-assert delay", () => {
		const sched = fakeScheduler();
		const deps = makeDeps({
			schedule: sched.schedule,
			reassertDelayMs: 500,
		});
		runNotificationClick(deps);
		expect(sched.scheduled[0].ms).toBe(500);
	});

	it("does not re-assert the tab switch on recheck (window raise only)", () => {
		const sched = fakeScheduler();
		const deps = makeDeps({
			schedule: sched.schedule,
			owningWindowHasFocus: () => false,
		});
		runNotificationClick(deps);
		sched.scheduled[0].fn();
		// The user may have deliberately switched tabs in the 300 ms window;
		// only the window raise is re-asserted, never the tab selection.
		expect(deps.onSwitchToTab).toHaveBeenCalledTimes(1);
	});
});
