/**
 * Declarative settings pilot — Obsidian 1.13 `getSettingDefinitions()`.
 *
 * Spike coverage (see vault note [[Agent Console Declarative Settings
 * Migration]] § Revisit path):
 *  T1  getSettingDefinitions returns the Tabs group with both toggles,
 *      keyed to REAL settings properties (guards key typos — declarative
 *      controls bind by string key, so a typo silently binds to nothing)
 *  T2  setControlValue routes through settingsService.updateSettings
 *      (the settings single writer) — never a direct settings mutation
 *
 * R1: both tests fail against pre-spike code (no getSettingDefinitions /
 *     setControlValue overrides on the subclass; base-class mock has none).
 * R2: enters at the public PluginSettingTab API surface Obsidian calls.
 * R3: asserts definition shape + the persisted-write call, not internals.
 * R4: mocks only the obsidian module + the settings-service port.
 * R5: expected values are literals, not recomputed from production code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => {
	class PluginSettingTab {
		app: unknown;
		plugin: unknown;
		containerEl = document.createElement("div");
		constructor(app: unknown, plugin: unknown) {
			this.app = app;
			this.plugin = plugin;
		}
	}
	class Comp {
		setName() {
			return this;
		}
		setDesc() {
			return this;
		}
		setHeading() {
			return this;
		}
		addToggle() {
			return this;
		}
		addText() {
			return this;
		}
		addDropdown() {
			return this;
		}
		addButton() {
			return this;
		}
		addExtraButton() {
			return this;
		}
		addTextArea() {
			return this;
		}
		setClass() {
			return this;
		}
		setTooltip() {
			return this;
		}
	}
	return {
		PluginSettingTab,
		Setting: Comp,
		DropdownComponent: Comp,
		SecretComponent: Comp,
		Modal: class {
			contentEl = document.createElement("div");
			open() {}
			close() {}
		},
		Notice: class {},
		FileSystemAdapter: class {},
		Platform: { isMacOS: true, isWin: false, isLinux: false },
		App: class {},
	};
});

import { AgentClientSettingTab } from "../SettingsTab";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";
import type AgentClientPlugin from "../../plugin";

type ToggleDef = {
	name: string;
	desc?: string;
	control: { type: string; key: string };
};
type GroupDef = { type: string; heading?: string; items: ToggleDef[] };

function makeTab(updateSettings = vi.fn().mockResolvedValue(undefined)) {
	const plugin = {
		settings: { ...DEFAULT_SETTINGS },
		settingsService: { updateSettings },
		saveData: vi.fn(),
	} as unknown as AgentClientPlugin;
	const tab = new AgentClientSettingTab(
		{} as never,
		plugin as never,
	) as AgentClientSettingTab & {
		getSettingDefinitions: () => GroupDef[];
		setControlValue: (key: string, value: unknown) => Promise<void>;
	};
	return { tab, updateSettings, plugin };
}

describe("declarative settings pilot (Obsidian 1.13)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("T1: exposes the Tabs group with both toggles bound to real settings keys", () => {
		const { tab } = makeTab();
		const defs = tab.getSettingDefinitions();

		expect(defs).toHaveLength(1);
		const group = defs[0] as unknown as GroupDef;
		expect(group.type).toBe("group");
		expect(group.heading).toBeTruthy();

		const keys = group.items.map((i: ToggleDef) => i.control.key);
		expect(keys).toEqual([
			"restoreTabsOnStartup",
			"confirmCloseWithMultipleTabs",
		]);
		// Every declarative key must exist on the real settings object —
		// controls bind by string key, so a typo binds to nothing, silently.
		for (const key of keys) {
			expect(DEFAULT_SETTINGS).toHaveProperty(key);
			expect(
				typeof DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS],
			).toBe("boolean");
		}
		for (const item of group.items) {
			expect(item.control.type).toBe("toggle");
			expect(item.name).toBeTruthy();
		}
	});

	it("T2: setControlValue persists via the settings single writer, not saveData", async () => {
		const { tab, updateSettings, plugin } = makeTab();

		await tab.setControlValue("restoreTabsOnStartup", false);

		expect(updateSettings).toHaveBeenCalledTimes(1);
		expect(updateSettings).toHaveBeenCalledWith({
			restoreTabsOnStartup: false,
		});
		// The base-class default mutates plugin.settings + calls saveData —
		// that path must NOT be taken (single writer of record).
		expect(
			(plugin as unknown as { saveData: ReturnType<typeof vi.fn> })
				.saveData,
		).not.toHaveBeenCalled();
	});
});
