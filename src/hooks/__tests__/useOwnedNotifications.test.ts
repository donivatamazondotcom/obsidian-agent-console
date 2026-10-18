import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useOwnedNotifications } from "../useOwnedNotifications";
import {
	__getRetainedNotificationCountForTests,
	__resetNotificationRegistryForTests,
} from "../../utils/notification-registry";

function makeFakeNotification(): Notification & {
	close: ReturnType<typeof vi.fn>;
} {
	return {
		onclick: null,
		onclose: null,
		onerror: null,
		close: vi.fn(),
	} as unknown as Notification & { close: ReturnType<typeof vi.fn> };
}

/**
 * I52 round 8: the hook ChatPanel uses to create its notifications. Closing a
 * tab unmounts its ChatPanel; that unmount must close the tab's notifications
 * so none survives into Notification Center with a dead click handler.
 */
describe("useOwnedNotifications (I52 round 8)", () => {
	beforeEach(() => {
		__resetNotificationRegistryForTests();
	});

	it("retains notifications while the panel is mounted", () => {
		const { result } = renderHook(() => useOwnedNotifications("tab-1"));
		const n = makeFakeNotification();

		result.current(n, vi.fn());

		expect(n.close).not.toHaveBeenCalled();
		expect(__getRetainedNotificationCountForTests()).toBe(1);
	});

	it("closes the panel's notifications when it unmounts (tab closed)", () => {
		const closing = renderHook(() => useOwnedNotifications("tab-closing"));
		const staying = renderHook(() => useOwnedNotifications("tab-staying"));
		const mine = makeFakeNotification();
		const theirs = makeFakeNotification();
		closing.result.current(mine, vi.fn());
		staying.result.current(theirs, vi.fn());

		closing.unmount();

		expect(mine.close).toHaveBeenCalledTimes(1);
		expect(theirs.close).not.toHaveBeenCalled();
		expect(__getRetainedNotificationCountForTests()).toBe(1);
	});

	it("still routes the click to the handler while mounted", () => {
		const { result } = renderHook(() => useOwnedNotifications("tab-1"));
		const n = makeFakeNotification();
		const onClick = vi.fn();
		result.current(n, onClick);

		n.onclick?.(new Event("click"));

		expect(onClick).toHaveBeenCalledTimes(1);
		expect(__getRetainedNotificationCountForTests()).toBe(0);
	});
});
