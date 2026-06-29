import { describe, it, expect } from "vitest";

import { SettingsService } from "../settings-service";
import { DEFAULT_SETTINGS } from "../settings-normalizer";
import type { AgentClientPluginSettings } from "../../plugin";
import type AgentClientPlugin from "../../plugin";
import type { SavedSessionInfo } from "../../types/session";
import type { PerLeafTabState } from "../../types/tab";

/**
 * Reproduce-first lifecycle test for the `data.json` flush race
 * ([[Resolver and Single-Writer Refactors]] single-writer candidate #5).
 *
 * `SettingsService.updateSettings` is safe in memory (the merge + `this.state =
 * next` is synchronous, so a later call always reads the prior committed
 * state), but the DISK flush (`saveSettings` → `saveData`) was unserialized.
 * `sessionLock` and `tabStateLock` are deliberately separate, so a session
 * write and a tab write can be in `saveData` concurrently. `saveData`
 * serializes its argument at call time; if the older payload's write lands
 * LAST, `data.json` on disk loses the newer concern's slice — surfacing only
 * on the next restart.
 *
 * The FakeFlushPlugin models exactly that boundary: `saveSettings()` snapshots
 * `this.settings` at call time and returns a promise whose resolution applies
 * the snapshot to `disk` (last completion wins, like two racing file writes).
 * Completion order is caller-controlled (reverse), forcing the older write to
 * land last. RED on the unserialized writer; GREEN once the flush is serialized
 * (only one write is ever in flight, so reverse completion is a no-op and each
 * flush writes the latest full snapshot).
 */
class FakeFlushPlugin {
	settings: AgentClientPluginSettings;
	disk: AgentClientPluginSettings | null = null;
	private pending: Array<{
		snapshot: AgentClientPluginSettings;
		resolve: () => void;
	}> = [];

	constructor(initial: AgentClientPluginSettings) {
		this.settings = initial;
	}

	// Mirrors plugin.saveSettings(): saveData(this.settings) serializes the
	// settings object synchronously at call time, then writes asynchronously.
	saveSettings(): Promise<void> {
		const snapshot = JSON.parse(
			JSON.stringify(this.settings),
		) as AgentClientPluginSettings;
		return new Promise<void>((resolve) => {
			this.pending.push({ snapshot, resolve });
		});
	}

	get inFlight(): number {
		return this.pending.length;
	}

	/** Complete every in-flight write in REVERSE order: the first-enqueued
	 * write resolves last, so its (older) snapshot is the one that lands on
	 * disk. This is the adversarial ordering the fix must tolerate. */
	completeAllReverse(): void {
		while (this.pending.length > 0) {
			const w = this.pending.pop();
			if (!w) break;
			this.disk = w.snapshot; // last completion wins on disk
			w.resolve();
		}
	}
}

const tick = (): Promise<void> =>
	new Promise<void>((r) => setTimeout(r, 0));

function makeService(): { svc: SettingsService; plugin: FakeFlushPlugin } {
	const initial: AgentClientPluginSettings = {
		...DEFAULT_SETTINGS,
		savedSessions: [],
		perLeafTabStates: [],
	};
	const plugin = new FakeFlushPlugin(initial);
	const svc = new SettingsService(
		initial,
		plugin as unknown as AgentClientPlugin,
	);
	return { svc, plugin };
}

describe("SettingsService data.json flush ordering (single-writer)", () => {
	it("does not drop a concurrent cross-concern slice when disk writes land out of order", async () => {
		const { svc, plugin } = makeService();

		const session: SavedSessionInfo = {
			sessionId: "s1",
			agentId: "claude",
			cwd: "/vault",
			title: "hi",
			createdAt: "2026-06-28T00:00:00.000Z",
			updatedAt: "2026-06-28T00:00:00.000Z",
		};
		const tab: PerLeafTabState = {
			leafId: "leaf-1",
			activeTabId: "tab-1",
			tabs: [
				{
					tabId: "tab-1",
					agentId: "claude",
					label: "hi",
					sessionId: "s1",
					tabOrder: 0,
					scrollPosition: 0,
				},
			],
		};

		// Two independent concerns (sessionLock vs tabStateLock) flush
		// data.json concurrently.
		const a = svc.updateSettings({ savedSessions: [session] });
		const b = svc.updateSettings({ perLeafTabStates: [tab] });

		// Drain: each tick, complete whatever is in flight in reverse order.
		// Unserialized → both writes in flight at once, older (session-only)
		// snapshot lands last and clobbers the tab slice. Serialized → only one
		// write ever in flight, reverse completion is a no-op.
		let settled = false;
		void Promise.allSettled([a, b]).then(() => {
			settled = true;
		});
		for (let i = 0; i < 25; i++) {
			await tick();
			if (plugin.inFlight > 0) plugin.completeAllReverse();
			if (settled && plugin.inFlight === 0) break;
		}
		await Promise.allSettled([a, b]);
		if (plugin.inFlight > 0) plugin.completeAllReverse();
		await Promise.allSettled([a, b]);

		// Disk must converge to BOTH slices, regardless of write completion
		// order.
		expect(plugin.disk).not.toBeNull();
		expect(plugin.disk?.savedSessions).toHaveLength(1);
		expect(plugin.disk?.perLeafTabStates).toHaveLength(1);
	});
});
