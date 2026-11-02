/**
 * I267 — Settings search can't find rows inside a built-in agent's page.
 *
 * Obsidian 1.13 indexes only DECLARED setting definitions for search. Agent
 * pages used a `page` factory (imperative body rendered on open), so search
 * saw the page row's name and nothing inside. These tests assert each
 * built-in agent page declares its rows as searchable `items`.
 *
 * R1: fails on main @ e24f21f (agent pages carry `page`, no `items`).
 * R2: enters at the public getSettingDefinitions() surface Obsidian indexes.
 * R5: expected names are English literals, not recomputed from t().
 */
import { describe, it, expect, vi } from "vitest";

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

type Def = {
	type?: string;
	name?: string;
	heading?: string;
	items?: Def[];
	page?: unknown;
	render?: unknown;
	searchable?: boolean | (() => boolean);
	visible?: boolean | (() => boolean);
};

function makeTab() {
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		settingsService: { updateSettings: vi.fn().mockResolvedValue(undefined) },
		saveData: vi.fn(),
		quickPromptLibrary: { rescan: vi.fn() },
		updateAllAutoAllow: vi.fn(),
		ensureDefaultAgentId: vi.fn(),
		openImportSettingsModal: vi.fn(),
		app: { vault: { adapter: {} } },
	} as unknown as AgentClientPlugin;
	return new AgentClientSettingTab({} as never, plugin as never) as unknown as {
		getSettingDefinitions: () => Def[];
	};
}

function findPage(defs: Def[], name: string): Def | undefined {
	for (const d of defs) {
		if (d.type === "page" && d.name === name) return d;
		if (Array.isArray(d.items)) {
			const hit = findPage(d.items, name);
			if (hit) return hit;
		}
	}
	return undefined;
}

const isOn = (v: boolean | (() => boolean) | undefined) =>
	v === undefined ? true : typeof v === "function" ? v() : v;

function searchableNames(page: Def): string[] {
	return (page.items ?? [])
		.filter((i) => isOn(i.searchable) && isOn(i.visible))
		.map((i) => i.name ?? "");
}

const EXPECTED: Record<string, string[]> = {
	"Claude Code": ["API key", "Path", "Arguments", "Environment variables", "Working directory"],
	Codex: ["API key", "Path", "Arguments", "Environment variables", "Working directory"],
	"Gemini CLI": ["API key", "Path", "Arguments", "Environment variables", "Working directory"],
	"Kiro CLI": ["Authentication", "Path", "Kiro CLI engine", "Arguments", "Environment variables", "Working directory"],
	OpenCode: ["Setup", "Path", "Arguments", "Environment variables", "Working directory"],
};

describe("I267: built-in agent page rows are searchable", () => {
	for (const [pageName, rows] of Object.entries(EXPECTED)) {
		it(`${pageName} page declares its rows as searchable items`, () => {
			const page = findPage(makeTab().getSettingDefinitions(), pageName);
			expect(page, `page "${pageName}" not found`).toBeTruthy();
			// A `page` factory is invisible to search; rows must be `items`.
			expect(page!.page).toBeUndefined();
			expect(searchableNames(page!)).toEqual(rows);
		});
	}

	it('searching "Kiro CLI engine" matches a row on the Kiro CLI page', () => {
		const page = findPage(makeTab().getSettingDefinitions(), "Kiro CLI");
		expect(searchableNames(page ?? {})).toContain("Kiro CLI engine");
	});
});
