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
		containerEl = Object.assign(document.createElement("div"), {
			empty(this: HTMLElement) {
				this.innerHTML = "";
			},
		});
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

	// ── Custom-agent page fixes (found in SF-13 smoke, 2026-07-31) ───────

	const agent = (id: string, displayName: string) => ({
		id,
		displayName,
		command: "x",
		args: [],
		env: [],
	});

	it("T10: duplicate custom-agent display names get unique page names (framework navigates by name)", () => {
		const { tab, plugin } = makeTab();
		(plugin as unknown as { settings: { customAgents: unknown[] } }).settings.customAgents =
			[agent("a1", "My Agent"), agent("a2", "My Agent"), agent("a3", "Other")];
		const defs = tab.getSettingDefinitions() as unknown as Array<{
			items?: Array<{ type?: string; name: string }>;
		}>;
		const pages = defs[2].items!.filter((i) => i.type === "page");
		const names = pages.map((i) => i.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain("My Agent (a1)");
		expect(names).toContain("My Agent (a2)");
		expect(names).toContain("Other");
	});

	it("T11: a custom-agent page body for a deleted agent renders the empty state, not a stale closure", () => {
		const { tab, plugin } = makeTab();
		(plugin as unknown as { settings: { customAgents: unknown[] } }).settings.customAgents =
			[agent("gone-agent", "Doomed")];
		const target = tab as unknown as {
			renderCustomAgentById: (el: HTMLElement, id: string) => void;
		};
		expect(typeof target.renderCustomAgentById).toBe("function");
		// Delete the agent, then render its (still-open) page body by id.
		(plugin as unknown as { settings: { customAgents: unknown[] } }).settings.customAgents = [];
		const el = document.createElement("div");
		expect(() => target.renderCustomAgentById(el, "gone-agent")).not.toThrow();
		expect(el.textContent).toContain("No custom agents");
	});

	it("T12: closing a sub-page schedules a definitions update so renamed labels refresh", () => {
		vi.useFakeTimers();
		try {
			const { tab } = makeTab();
			const target = tab as unknown as {
				update: () => void;
				settingPage: (
					getName: () => string,
					renderBody: (el: HTMLElement) => void,
				) => { page: () => { display: () => void; hide: () => void } };
			};
			const update = vi.spyOn(target, "update").mockImplementation(() => {});
			const def = target.settingPage(() => "P", () => {});
			const page = def.page();
			page.display();
			page.hide();
			expect(update).not.toHaveBeenCalled();
			vi.advanceTimersByTime(400);
			expect(update).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("T13: adding a custom agent navigates into its page (clicks the framework row)", async () => {
		const { tab } = makeTab();
		const target = tab as unknown as {
			addCustomAgent: () => Promise<void>;
			containerEl: HTMLElement;
			update: () => void;
			refreshAgentDropdown?: () => void;
		};
		vi.spyOn(target, "update").mockImplementation(() => {});
		// Simulate the framework-rendered root row for the agent about to be
		// created ("Custom agent" is the first generated display name).
		const row = document.createElement("div");
		row.className = "setting-item mod-navigable";
		const name = document.createElement("div");
		name.className = "setting-item-name";
		name.textContent = "Custom agent";
		row.appendChild(name);
		let navigated = false;
		row.addEventListener("click", () => {
			navigated = true;
		});
		target.containerEl.appendChild(row);

		await target.addCustomAgent();

		expect(navigated).toBe(true);
	});

	it("T14: closeActiveSettingPage clicks the framework back button when a page is open", () => {
		const { tab } = makeTab();
		const target = tab as unknown as {
			closeActiveSettingPage: () => boolean;
		};
		const back = document.createElement("div");
		back.className = "clickable-icon setting-page-back-button";
		let closed = false;
		back.addEventListener("click", () => {
			closed = true;
		});
		document.body.appendChild(back);
		try {
			expect(target.closeActiveSettingPage()).toBe(true);
			expect(closed).toBe(true);
		} finally {
			back.remove();
		}
		// No page open -> false, no throw.
		expect(target.closeActiveSettingPage()).toBe(false);
	});
});
