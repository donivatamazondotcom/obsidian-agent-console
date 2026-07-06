import { describe, it, expect, vi } from "vitest";

import { runCompletionNotificationClick } from "../notification-click";

describe("runCompletionNotificationClick", () => {
	it("switches to the producing tab, then reveals its owning leaf (in order)", () => {
		const calls: string[] = [];
		const onSwitchToTab = vi.fn((_id: string) => calls.push("switch"));
		const revealOwningLeaf = vi.fn(() => calls.push("reveal"));

		runCompletionNotificationClick({
			tabId: "tab-abc123",
			onSwitchToTab,
			revealOwningLeaf,
		});

		expect(onSwitchToTab).toHaveBeenCalledWith("tab-abc123");
		expect(revealOwningLeaf).toHaveBeenCalledTimes(1);
		// Ordering matters: the tab must be active before the leaf is surfaced,
		// so the correct tab is shown when the owning window comes forward.
		expect(calls).toEqual(["switch", "reveal"]);
	});

	it("still reveals the owning leaf when there is no tab to switch to (floating chat)", () => {
		const revealOwningLeaf = vi.fn();

		runCompletionNotificationClick({
			tabId: "tab-x",
			revealOwningLeaf,
		});

		expect(revealOwningLeaf).toHaveBeenCalledTimes(1);
	});
});
