// The trust step shared by screenshots and smoke instances: click "Trust
// author and enable plugins", wait for the ribbon icon, close the settings
// window Obsidian opens after the click. Moved from tools/screenshots/run.ts.
import { describe, it, expect } from "vitest";
import { trustAndLoad, type TrustPage } from "../isolated-trust";

function fakePage(o: { trustVisible?: boolean; ribbonAfterClicks?: number; settingsTab?: string | null }): TrustPage & { clicks: number } {
	const p = {
		clicks: 0,
		getByRole: () => ({
			waitFor: () => (o.trustVisible === false ? Promise.reject(new Error("timeout")) : Promise.resolve()),
			click: () => {
				p.clicks++;
				return Promise.resolve();
			},
		}),
		waitForSelector: () => (p.clicks >= (o.ribbonAfterClicks ?? 1) ? Promise.resolve({}) : Promise.reject(new Error("timeout"))),
		evaluate: () => Promise.resolve(o.settingsTab ?? null),
	};
	return p as unknown as TrustPage & { clicks: number };
}

describe("trustAndLoad", () => {
	it("clicks trust, sees the ribbon, reports the closed settings tab", async () => {
		const page = fakePage({ settingsTab: "community-plugins" });
		expect(await trustAndLoad(page)).toEqual({ closedSettingsTab: "community-plugins" });
		expect(page.clicks).toBe(1);
	});
	it("retries once when the ribbon doesn't appear after the first click", async () => {
		const page = fakePage({ ribbonAfterClicks: 2 });
		expect(await trustAndLoad(page)).toEqual({ closedSettingsTab: null });
		expect(page.clicks).toBe(2);
	});
	it("throws when Agent Console never loads", async () => {
		await expect(trustAndLoad(fakePage({ ribbonAfterClicks: 9 }))).rejects.toThrow("Agent Console didn't load");
	});
	it("succeeds without a click when the vault is already trusted", async () => {
		const page = fakePage({ trustVisible: false, ribbonAfterClicks: 0 });
		expect(await trustAndLoad(page)).toEqual({ closedSettingsTab: null });
		expect(page.clicks).toBe(0);
	});
});
