import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useOwnedNotifications } from "../useOwnedNotifications";
import {
	NOTIFICATION_QUIET_MS,
	initNotifications,
	__getRetainedNotificationCountForTests,
	__resetNotificationRegistryForTests,
} from "../../services/notification-registry";

interface Made {
	title: string;
	options?: NotificationOptions;
	onclick: ((ev: Event) => unknown) | null;
	close: ReturnType<typeof vi.fn>;
}

/**
 * The hook ChatPanel uses to post its notifications (I52 rounds 8–9). It owns
 * construction, so the tag the OS receives is always fresh (round 9 root
 * cause), and closing a tab marks the tab's notifications for removal after
 * the app-wide quiet period instead of removing them on the spot.
 */
describe("useOwnedNotifications (I52 rounds 8–9)", () => {
	let made: Made[];
	let timers: Array<{ id: number; at: number; fn: () => void }>;
	let seq: number;
	let t: number;
	const remove = vi.fn();

	function advance(ms: number) {
		const end = t + ms;
		for (;;) {
			timers.sort((a, b) => a.at - b.at);
			const next = timers[0];
			if (!next || next.at > end) break;
			timers.shift();
			t = next.at;
			next.fn();
		}
		t = end;
	}

	beforeEach(() => {
		made = [];
		timers = [];
		seq = 0;
		t = 1_000_000;
		remove.mockReset();
		class Ctor {
			onclick: ((ev: Event) => unknown) | null = null;
			onclose = null;
			onerror = null;
			close = vi.fn();
			constructor(
				public title: string,
				public options?: NotificationOptions,
			) {
				made.push(this as unknown as Made);
			}
		}
		__resetNotificationRegistryForTests({
			NotificationCtor: () =>
				Ctor as unknown as new (
					title: string,
					options?: NotificationOptions,
				) => Notification,
			store: () => null,
			schedule: (fn, ms) => {
				const id = ++seq;
				timers.push({ id, at: t + ms, fn });
				return id;
			},
			cancel: (id) => {
				timers = timers.filter((x) => x.id !== id);
			},
			now: () => t,
			raiseOwningWindow: () => {},
			log: () => {},
		});
		initNotifications({ statics: { remove }, origin: "app://obsidian.md" });
	});

	it("posts with a fresh, panel-owned tag for every notification", () => {
		const { result } = renderHook(() => useOwnedNotifications("tab-1"));
		result.current("Done", { body: "b" }, vi.fn());
		result.current("Done", { body: "b" }, vi.fn());

		expect(made).toHaveLength(2);
		expect(made[0].options?.tag).toMatch(/^tab-1:/);
		expect(made[0].options?.tag).not.toBe(made[1].options?.tag);
		expect(__getRetainedNotificationCountForTests()).toBe(2);
	});

	it("routes the click to the handler while the panel is mounted", () => {
		const { result } = renderHook(() => useOwnedNotifications("tab-1"));
		const onClick = vi.fn();
		result.current("Done", {}, onClick);
		made[0].onclick?.(new Event("click"));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("on unmount, removes the panel's notifications only after the quiet period", () => {
		const closing = renderHook(() => useOwnedNotifications("tab-closing"));
		const staying = renderHook(() => useOwnedNotifications("tab-staying"));
		closing.result.current("A", {}, vi.fn());
		staying.result.current("B", {}, vi.fn());

		closing.unmount();
		expect(made[0].close).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();

		advance(NOTIFICATION_QUIET_MS);
		expect(made[0].close).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledWith(
			`n#app://obsidian.md#${made[0].options?.tag}`,
		);
		expect(made[1].close).not.toHaveBeenCalled();
		expect(__getRetainedNotificationCountForTests()).toBe(1);
	});

	it("a closed tab's notification does not run the tab switch when clicked", () => {
		const { result, unmount } = renderHook(() =>
			useOwnedNotifications("tab-closed"),
		);
		const onClick = vi.fn();
		result.current("A", {}, onClick);
		unmount();
		made[0].onclick?.(new Event("click"));
		expect(onClick).not.toHaveBeenCalled();
	});
});
