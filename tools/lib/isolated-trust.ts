/**
 * The trust step of an isolated Obsidian instance: click "Trust author and
 * enable plugins", wait for Agent Console's ribbon icon, and close the
 * settings window Obsidian opens after the trust click (while it is open,
 * every modal, prompt and notice mounts there, off the workspace page).
 *
 * Shared by the screenshot driver (tools/screenshots/run.ts) and the smoke
 * driver (tools/smoke-test/st.ts). Specs: [[Agent Console Isolated Screenshot
 * Capture]], [[Isolated smoke-test instances]].
 */

/** The slice of a Playwright `Page` the trust step uses. */
export interface TrustPage {
	getByRole(role: "button", o: { name: RegExp }): { waitFor(o: { timeout: number }): Promise<unknown>; click(): Promise<unknown> };
	waitForSelector(selector: string, o: { timeout: number }): Promise<unknown>;
	evaluate<T>(fn: () => T): Promise<T>;
}

export const RIBBON_SELECTOR = ".agent-console-ribbon-icon";

/**
 * Trust the vault and wait until Agent Console loads (two attempts). Returns
 * the settings tab it closed, if any. Throws when the plugin never loads.
 */
export async function trustAndLoad(page: TrustPage): Promise<{ closedSettingsTab: string | null }> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const trust = page.getByRole("button", { name: /Trust author and enable plugins/i });
		await trust.waitFor({ timeout: 30_000 }).then(() => trust.click()).catch(() => {});
		if (await page.waitForSelector(RIBBON_SELECTOR, { timeout: 20_000 }).then(() => true, () => false)) break;
		if (attempt === 1) throw new Error("Agent Console didn't load in the isolated Obsidian");
	}
	const closedSettingsTab = await page.evaluate(() => {
		const w = window as unknown as { activeDocument?: Document; app: { setting: { activeTab?: { id?: string } | null; close(): void } } };
		if (!w.activeDocument || w.activeDocument === document) return null;
		const id = w.app.setting.activeTab?.id ?? "unknown";
		w.app.setting.close();
		return id;
	});
	return { closedSettingsTab };
}
