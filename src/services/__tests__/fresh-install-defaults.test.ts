/**
 * I299: new installs start on the vertical tab rail, icons only; existing
 * installs keep the top strip.
 *
 * - `applyFreshInstallDefaults` is pure: vertical display, rail width left at
 *   its icon-only default, nothing else touched.
 * - `loadSettings` applies it only on a true fresh install (no data.json),
 *   and the value reaches the data written by its save. A data.json without
 *   the key is an existing user and stays horizontal.
 * - First-run onboarding, which runs later, keeps the fresh-install display.
 *
 * Only the Obsidian boundary and the plugin's loadData/saveData port are
 * stubbed.
 */
import { describe, it, expect, vi } from "vitest";

// plugin.ts pulls in the whole UI graph, whose Obsidian classes the shared stub
// doesn't define. Keep every real stub export and give anything missing an
// empty class.
vi.mock("obsidian", async (importOriginal) => {
	const real = (await importOriginal()) as Record<string | symbol, unknown>;
	return new Proxy(real, {
		get(target, key) {
			if (key in target) return target[key];
			if (typeof key !== "string" || key === "then" || key.startsWith("__"))
				return undefined;
			return class {};
		},
		has: () => true,
	});
});

import {
	applyFreshInstallDefaults,
	DEFAULT_SETTINGS,
} from "../settings-normalizer";
import AgentClientPlugin from "../../plugin";

type Written = { tabDisplay: string; tabRailWidth: number; defaultAgentId: string };

type TestPlugin = AgentClientPlugin & {
	loadData: () => Promise<unknown>;
	saveData: (d: unknown) => Promise<void>;
};

async function runLoad(raw: Record<string, unknown> | null) {
	const plugin = Object.create(AgentClientPlugin.prototype) as TestPlugin;
	// Snapshot each write: onboarding mutates this.settings after the first save.
	const writes: Written[] = [];
	const saveData = vi.fn(async (d: unknown) => {
		writes.push(structuredClone(d) as Written);
	});
	plugin.loadData = async () => raw;
	plugin.saveData = saveData;
	await plugin.loadSettings();
	return { plugin, saveData, writes };
}

describe("I299 applyFreshInstallDefaults", () => {
	it("sets vertical tabs and keeps the icon-only width", () => {
		const out = applyFreshInstallDefaults(DEFAULT_SETTINGS);
		expect(out.tabDisplay).toBe("vertical");
		expect(out.tabRailWidth).toBe(32);
	});

	it("touches nothing else and doesn't mutate its input", () => {
		const input = structuredClone(DEFAULT_SETTINGS);
		const out = applyFreshInstallDefaults(input);
		expect(input.tabDisplay).toBe("horizontal");
		expect({ ...out, tabDisplay: input.tabDisplay }).toEqual(input);
	});
});

describe("I299 loadSettings picks the display by install age", () => {
	it("a fresh install (no data.json) saves vertical, icons only", async () => {
		const { plugin, writes } = await runLoad(null);
		expect(plugin.settings.tabDisplay).toBe("vertical");
		expect(writes.length).toBeGreaterThan(0);
		expect(writes[writes.length - 1].tabDisplay).toBe("vertical");
		expect(writes[writes.length - 1].tabRailWidth).toBe(32);
	});

	it("the second launch reads the first launch's data.json as vertical and isn't a first run", async () => {
		const first = await runLoad(null);
		const second = await runLoad(
			first.writes[first.writes.length - 1] as unknown as Record<string, unknown>,
		);
		expect(second.plugin.settings.tabDisplay).toBe("vertical");
		expect(second.plugin.settings.tabRailWidth).toBe(32);
		expect((second.plugin as unknown as { isFirstRun: boolean }).isFirstRun).toBe(false);
	});

	it("an existing data.json without the key stays horizontal", async () => {
		const { plugin, writes } = await runLoad({});
		expect(plugin.settings.tabDisplay).toBe("horizontal");
		for (const w of writes) expect(w.tabDisplay).toBe("horizontal");
	});

	it("an existing explicit horizontal stays horizontal", async () => {
		const { plugin, writes } = await runLoad({
			tabDisplay: "horizontal",
			kiroEngineDefaultMigrated: true,
		});
		expect(plugin.settings.tabDisplay).toBe("horizontal");
		for (const w of writes) expect(w.tabDisplay).toBe("horizontal");
	});
});

describe("I299 first-run onboarding keeps the fresh-install display", () => {
	it("onboarding's save still carries vertical tabs", async () => {
		const { plugin, writes } = await runLoad(null);
		const p = plugin as unknown as {
			detectAgents: () => Promise<Set<string>>;
			activateView: () => Promise<void>;
			maybeFirstRunOnboarding: () => Promise<void>;
		};
		p.detectAgents = async () => new Set(["kiro"]);
		const activateView = vi.fn(async () => {});
		p.activateView = activateView;
		const before = writes.length;

		await p.maybeFirstRunOnboarding();

		expect(activateView).toHaveBeenCalledTimes(1);
		expect(writes.length).toBe(before + 1);
		const last = writes[writes.length - 1];
		expect(last.tabDisplay).toBe("vertical");
		expect(last.tabRailWidth).toBe(32);
		expect(plugin.settings.tabDisplay).toBe("vertical");
	});
});
