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
		refreshDomState() {}
		update() {}
	}
	class SettingPage {
		rootEl = document.createElement("div");
		titlebarEl = document.createElement("div");
		containerEl = document.createElement("div");
		title = "";
		hide() {}
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
		requireApiVersion: () => true,
		PluginSettingTab,
		SettingPage,
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
	const rescan = vi.fn();
	const updateAllAutoAllow = vi.fn();
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		settingsService: { updateSettings },
		saveData: vi.fn(),
		quickPromptLibrary: { rescan },
		updateAllAutoAllow,
		ensureDefaultAgentId: vi.fn(),
		openImportSettingsModal: vi.fn(),
		app: { vault: { adapter: {} } },
	} as unknown as AgentClientPlugin;
	const tab = new AgentClientSettingTab(
		{} as never,
		plugin as never,
	) as AgentClientSettingTab & {
		getSettingDefinitions: () => GroupDef[];
		setControlValue: (key: string, value: unknown) => Promise<void>;
	};
	return { tab, updateSettings, plugin, rescan, updateAllAutoAllow };
}

describe("declarative settings pilot (Obsidian 1.13)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("T1: exposes the Tabs group with both toggles bound to real settings keys", () => {
		const { tab } = makeTab();
		const defs = tab.getSettingDefinitions();

		expect(defs).toHaveLength(10);
		const group = defs.find(
			(g) => (g as unknown as GroupDef).items?.some((i) => i.control?.key === "restoreTabsOnStartup"),
		) as unknown as GroupDef;
		expect(group).toBeTruthy();
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

	// ── Slice 2 ──────────────────────────────────────────────────────────

	function collectControls(defs: unknown[]): { key: string }[] {
		const out: { key: string }[] = [];
		for (const d of defs as Array<Record<string, unknown>>) {
			if (d.control) out.push(d.control as { key: string });
			if (Array.isArray(d.items)) out.push(...collectControls(d.items));
		}
		return out;
	}

	it("T3: every declarative control key (incl. dot paths) resolves on DEFAULT_SETTINGS", () => {
		const { tab } = makeTab();
		const controls = collectControls(
			tab.getSettingDefinitions() as unknown as unknown[],
		);
		expect(controls.length).toBeGreaterThanOrEqual(20);
		for (const { key } of controls) {
			let v: unknown = DEFAULT_SETTINGS;
			for (const part of key.split(".")) {
				expect(
					v != null && typeof v === "object" && part in (v as object),
					`key "${key}" (part "${part}") missing on DEFAULT_SETTINGS`,
				).toBe(true);
				v = (v as Record<string, unknown>)[part];
			}
		}
	});

	it("T4: image-location rows gate on includeImages / imageLocation", () => {
		const { tab, plugin } = makeTab();
		const p = plugin as unknown as {
			settings: typeof DEFAULT_SETTINGS;
		};
		const defs = tab.getSettingDefinitions() as unknown as Array<
			Record<string, unknown>
		>;
		const flat: Array<Record<string, unknown>> = [];
		for (const d of defs)
			flat.push(d, ...((d.items as Array<Record<string, unknown>>) ?? []));
		const byKey = (k: string) =>
			flat.find(
				(d) => (d.control as { key?: string } | undefined)?.key === k,
			)!;
		const imageLocation = byKey("exportSettings.imageLocation");
		const customFolder = byKey("exportSettings.imageCustomFolder");

		p.settings.exportSettings.includeImages = false;
		expect((imageLocation.visible as () => boolean)()).toBe(false);
		expect((customFolder.visible as () => boolean)()).toBe(false);

		p.settings.exportSettings.includeImages = true;
		expect((imageLocation.visible as () => boolean)()).toBe(true);
		p.settings.exportSettings.imageLocation = "custom";
		expect((customFolder.visible as () => boolean)()).toBe(true);
	});

	it("T5: dot-path setControlValue merges the nested partial through the single writer", async () => {
		const { tab, updateSettings, plugin } = makeTab();
		const before = (plugin as unknown as { settings: typeof DEFAULT_SETTINGS })
			.settings.exportSettings;

		await tab.setControlValue("exportSettings.includeImages", true);

		expect(updateSettings).toHaveBeenCalledWith({
			exportSettings: { ...before, includeImages: true },
		});
	});

	it("T6: side effects fire after persist (autoAllow propagation, quick-prompt rescan + trim)", async () => {
		const { tab, updateSettings, rescan, updateAllAutoAllow } = makeTab();

		await tab.setControlValue("autoAllowPermissions", true);
		expect(updateAllAutoAllow).toHaveBeenCalledWith(true);

		await tab.setControlValue("quickPromptsFolder", "  prompts/  ");
		expect(updateSettings).toHaveBeenCalledWith({
			quickPromptsFolder: "prompts/",
		});
		expect(rescan).toHaveBeenCalledTimes(1);
	});

	// ── Slice 3 ──────────────────────────────────────────────────────────

	it("T7: agent sections are pages; custom agents map to pages with add action", () => {
		const { tab, plugin } = makeTab();
		(plugin as unknown as {
			settings: { customAgents: unknown[] };
		}).settings.customAgents = [
			{ id: "my-agent", displayName: "My Agent", command: "x", args: [], env: [] },
		];
		const defs = tab.getSettingDefinitions() as unknown as Array<
			Record<string, unknown>
		>;
		expect(defs).toHaveLength(10);

		const builtIn = defs[1] as { items: Array<{ type?: string; name: string }> };
		const pageNames = builtIn.items.map((i) => i.name);
		expect(builtIn.items.every((i) => i.type === "page")).toBe(true);
		expect(pageNames).toEqual([
			"Claude Code",
			"Codex",
			"Gemini CLI",
			"Kiro CLI",
			"OpenCode",
		]);

		const custom = defs[2] as {
			items: Array<{ type?: string; name: string; action?: unknown; visible?: () => boolean }>;
		};
		const customPages = custom.items.filter((i) => i.type === "page");
		expect(customPages.map((i) => i.name)).toEqual(["My Agent"]);
		expect(custom.items.some((i) => typeof i.action === "function")).toBe(true);
		const emptyState = custom.items.find((i) => i.visible && !i.type && !i.action);
		expect(emptyState!.visible!()).toBe(false);
	});

	it("T8: rerender routes to update() on 1.13 and never calls display()", () => {
		const { tab } = makeTab();
		const target = tab as unknown as {
			rerender: () => void;
			update: () => void;
			display: () => void;
		};
		const update = vi.spyOn(target, "update");
		const display = vi.spyOn(target, "display").mockImplementation(() => {});
		target.rerender();
		expect(update).toHaveBeenCalledTimes(1);
		expect(display).not.toHaveBeenCalled();
	});

	it("T9: import def placement gates on hasCompletedSetup", () => {
		const { tab, plugin } = makeTab();
		const p = plugin as unknown as {
			settings: { hasCompletedSetup: boolean };
		};
		const defs = tab.getSettingDefinitions() as unknown as Array<{
			items?: Array<{ name: string; visible?: () => boolean }>;
		}>;
		const find = (groupIdx: number) =>
			defs[groupIdx].items!.find((i) => i.visible && i.name)!;
		const topMatter = defs[0].items![0];
		const advanced = defs[8].items!.at(-1)!;

		p.settings.hasCompletedSetup = false;
		expect(topMatter.visible!()).toBe(true);
		expect(advanced.visible!()).toBe(false);

		p.settings.hasCompletedSetup = true;
		expect(topMatter.visible!()).toBe(false);
		expect(advanced.visible!()).toBe(true);
		void find;
	});
});
