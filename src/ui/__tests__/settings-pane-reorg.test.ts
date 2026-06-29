/**
 * Settings Pane Reorganization — render-level tests.
 *
 *  T1  every control renders in its target intent group, in documented order
 *  T3  relocated controls keep their onChange / live-propagation wiring
 *  T4  Export & Advanced are collapsed, keyboard-first <details>; conditional
 *      child rows still gate
 *  T5  D5 Import placement at the render layer (Top matter vs Advanced)
 *
 * Mounts the REAL `SettingsTab.display()` against a functional `obsidian`
 * mock (records each `new Setting()` into a registry) plus minimal DOM shims
 * for Obsidian's createEl/createDiv/createSpan augmentations. See
 * [[Agent Console Settings Pane Reorganization]] § Test Cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Obsidian DOM augmentation (createEl family + createFragment) ────────────
type ElOpts = {
	cls?: string | string[];
	text?: string;
	href?: string;
	attr?: Record<string, string>;
};
function applyOpts(el: HTMLElement, opts?: ElOpts) {
	if (!opts) return;
	if (opts.cls)
		el.classList.add(...(Array.isArray(opts.cls) ? opts.cls : [opts.cls]));
	if (opts.text != null) el.textContent = opts.text;
	if (opts.href) el.setAttribute("href", opts.href);
	if (opts.attr)
		for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = HTMLElement.prototype as any;
if (!proto.createEl)
	proto.createEl = function (this: HTMLElement, tag: string, opts?: ElOpts) {
		const el = document.createElement(tag);
		applyOpts(el, opts);
		this.appendChild(el);
		return el;
	};
if (!proto.createDiv)
	proto.createDiv = function (this: HTMLElement, opts?: ElOpts) {
		return (
			this as unknown as { createEl: typeof proto.createEl }
		).createEl("div", opts);
	};
if (!proto.createSpan)
	proto.createSpan = function (this: HTMLElement, opts?: ElOpts) {
		return (
			this as unknown as { createEl: typeof proto.createEl }
		).createEl("span", opts);
	};
if (!proto.empty)
	proto.empty = function (this: HTMLElement) {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
if (!proto.addClass)
	proto.addClass = function (this: HTMLElement, ...c: string[]) {
		this.classList.add(...c);
	};
if (!proto.appendText)
	proto.appendText = function (this: HTMLElement, t: string) {
		this.appendChild(document.createTextNode(t));
	};
(
	globalThis as unknown as { createFragment: () => HTMLElement }
).createFragment = () => document.createElement("div");

interface MockSetting {
	name: string;
	isHeading: boolean;
	controlEl: HTMLElement;
	comps: Record<
		string,
		{ onChangeCb: ((v: unknown) => unknown) | null; getValue(): unknown }
	>;
}

// ── obsidian mock: functional Setting that records into a registry ──────────
vi.mock("obsidian", () => {
	const reg: MockSetting[] = [];
	(globalThis as unknown as { __settings: MockSetting[] }).__settings = reg;

	class Comp {
		inputEl = document.createElement("input");
		selectEl = document.createElement("select");
		_value: unknown;
		btnText = "";
		onChangeCb: ((v: unknown) => unknown) | null = null;
		onClickCb: (() => unknown) | null = null;
		setPlaceholder() {
			return this;
		}
		setValue(v: unknown) {
			this._value = v;
			return this;
		}
		getValue() {
			return this._value;
		}
		onChange(cb: (v: unknown) => unknown) {
			this.onChangeCb = cb;
			return this;
		}
		addOption() {
			return this;
		}
		setButtonText(t: string) {
			this.btnText = t;
			return this;
		}
		setTooltip() {
			return this;
		}
		setIcon() {
			return this;
		}
		setCta() {
			return this;
		}
		setDisabled() {
			return this;
		}
		onClick(cb: () => unknown) {
			this.onClickCb = cb;
			return this;
		}
	}
	class SecretComponent {
		constructor(_app: unknown, _el: unknown) {}
		setValue() {
			return this;
		}
		onChange() {
			return this;
		}
	}
	class MockSettingImpl {
		name = "";
		isHeading = false;
		controlEl: HTMLElement;
		comps: Record<string, Comp> = {};
		constructor(public containerEl: HTMLElement) {
			this.controlEl = (
				containerEl as unknown as { createDiv: () => HTMLElement }
			).createDiv();
			reg.push(this as unknown as MockSetting);
		}
		setName(n: string) {
			this.name = n;
			return this;
		}
		setDesc() {
			return this;
		}
		setHeading() {
			this.isHeading = true;
			return this;
		}
		private add(kind: string) {
			const c = new Comp();
			this.comps[kind] = c;
			return c;
		}
		addText(cb: (c: Comp) => void) {
			cb(this.add("text"));
			return this;
		}
		addToggle(cb: (c: Comp) => void) {
			cb(this.add("toggle"));
			return this;
		}
		addDropdown(cb: (c: Comp) => void) {
			cb(this.add("dropdown"));
			return this;
		}
		addButton(cb: (c: Comp) => void) {
			cb(this.add("button"));
			return this;
		}
		addExtraButton(cb: (c: Comp) => void) {
			cb(this.add("extra"));
			return this;
		}
		addTextArea(cb: (c: Comp) => void) {
			cb(this.add("textarea"));
			return this;
		}
		addComponent(cb: (el: HTMLElement) => void) {
			cb(
				(
					this.controlEl as unknown as {
						createDiv: () => HTMLElement;
					}
				).createDiv(),
			);
			return this;
		}
	}
	class PluginSettingTab {
		app: unknown;
		containerEl: HTMLElement = document.createElement("div");
		constructor(app: unknown, _plugin: unknown) {
			this.app = app;
		}
	}
	class App {}
	class Notice {
		constructor(_m?: string) {}
	}
	class FileSystemAdapter {
		getBasePath() {
			return "/vault";
		}
	}
	class Modal {
		contentEl: HTMLElement = document.createElement("div");
		constructor(public app: unknown) {}
		open() {
			(this as unknown as { onOpen?: () => void }).onOpen?.();
		}
		close() {
			(this as unknown as { onClose?: () => void }).onClose?.();
		}
	}
	return {
		App,
		Modal,
		PluginSettingTab,
		Setting: MockSettingImpl,
		DropdownComponent: Comp,
		SecretComponent,
		Notice,
		FileSystemAdapter,
		Platform: { isWin: false, isMobile: false, isDesktop: true },
	};
});

// Mock the folder picker (only invoked on Browse click; keep it inert).
vi.mock("../../utils/folder-picker", () => ({ pickFolder: vi.fn() }));

import { App, FileSystemAdapter } from "obsidian";
import { AgentClientSettingTab } from "../SettingsTab";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";

function makePlugin(
	over: Record<string, unknown> = {},
	opts: { live?: boolean } = {},
) {
	const settings = structuredClone(DEFAULT_SETTINGS) as unknown as Record<
		string,
		unknown
	>;
	Object.assign(settings, over);
	const updateSettings = vi.fn(async (patch?: Record<string, unknown>) => {
		// Opt-in: actually persist the patch so state changes (e.g. mode →
		// "full") propagate through a subsequent display(), letting tests
		// exercise re-render flows. Default is a no-op for call-arg assertions.
		if (opts.live && patch) Object.assign(settings, patch);
	});
	const saveSettingsAndNotify = vi.fn(async () => {});
	const updateAllAutoAllow = vi.fn();
	const adapter = new FileSystemAdapter();
	const plugin = {
		settings,
		settingsService: {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: () => settings,
			updateSettings,
		},
		saveSettingsAndNotify,
		updateAllAutoAllow,
		ensureDefaultAgentId: vi.fn(),
		quickPromptLibrary: { rescan: vi.fn() },
		openImportSettingsModal: vi.fn(),
		app: {
			vault: {
				adapter,
				metadataCache: { getFirstLinkpathDest: () => null },
			},
		},
	};
	return {
		plugin,
		updateSettings,
		saveSettingsAndNotify,
		updateAllAutoAllow,
	};
}

function renderPane(
	over: Record<string, unknown> = {},
	opts: { live?: boolean } = {},
) {
	const ctx = makePlugin(over, opts);
	const reg = (globalThis as unknown as { __settings: MockSetting[] })
		.__settings;
	reg.length = 0;
	const tab = new AgentClientSettingTab(
		new App() as never,
		ctx.plugin as never,
	);
	tab.display();
	return { ...ctx, tab, settings: reg, container: tab.containerEl };
}

const names = (reg: MockSetting[]) => reg.map((s) => s.name);
const headingOrder = (reg: MockSetting[]) =>
	reg.filter((s) => s.isHeading).map((s) => s.name);
const find = (reg: MockSetting[], name: string) =>
	reg.find((s) => s.name === name);
const idx = (reg: MockSetting[], name: string) =>
	reg.findIndex((s) => s.name === name);
const collapsibleTitles = (container: HTMLElement) =>
	Array.from(
		container.querySelectorAll(
			"details.agent-client-agent-section > summary > .agent-client-agent-section-name",
		),
	).map((e) => e.textContent);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("Settings Pane Reorganization — render (T1)", () => {
	it("emits the six intent-group headings in the documented order", () => {
		const { settings } = renderPane();
		expect(headingOrder(settings)).toEqual([
			"Agents",
			"Built-in agents",
			"Custom agents",
			"Chat behavior",
			"Appearance & notifications",
			"Tabs",
			"Permissions",
		]);
	});

	it("drops the old code-accretion headings (Context / Display / Quick prompts / Export)", () => {
		const { settings } = renderPane();
		for (const gone of ["Context", "Display", "Quick prompts", "Export"]) {
			expect(
				settings.find((s) => s.isHeading && s.name === gone),
			).toBeUndefined();
		}
	});

	it("places each relocated control under its target group, in order", () => {
		const { settings } = renderPane();
		// Agents: Default agent → global cwd → built-in
		expect(idx(settings, "Agents")).toBeLessThan(
			idx(settings, "Default agent"),
		);
		expect(idx(settings, "Default agent")).toBeLessThan(
			idx(settings, "Default working directory"),
		);
		expect(idx(settings, "Default working directory")).toBeLessThan(
			idx(settings, "Built-in agents"),
		);
		// Chat behavior order
		expect(idx(settings, "Chat behavior")).toBeLessThan(
			idx(settings, "Active note as default context"),
		);
		expect(idx(settings, "Active note as default context")).toBeLessThan(
			idx(settings, "Session title"),
		);
		expect(idx(settings, "Session title")).toBeLessThan(
			idx(settings, "Quick prompts folder"),
		);
		expect(idx(settings, "Quick prompts folder")).toBeLessThan(
			idx(settings, "Send message shortcut"),
		);
		// Appearance & notifications gathers display + system notifications
		expect(idx(settings, "Appearance & notifications")).toBeLessThan(
			idx(settings, "Sidebar side"),
		);
		expect(idx(settings, "Sidebar side")).toBeLessThan(
			idx(settings, "System notifications"),
		);
		// Tabs / Permissions
		expect(idx(settings, "Tabs")).toBeLessThan(
			idx(settings, "Restore tabs on startup"),
		);
		expect(idx(settings, "Permissions")).toBeLessThan(
			idx(settings, "Auto-allow permissions"),
		);
	});

	it("renders Export and Advanced as collapsible sections", () => {
		const { container } = renderPane();
		expect(collapsibleTitles(container)).toEqual(
			expect.arrayContaining(["Export", "Advanced"]),
		);
	});
});

describe("Settings Pane Reorganization — wiring preserved (T3)", () => {
	it("Auto-allow toggle persists AND live-propagates to all clients", async () => {
		const { settings, updateSettings, updateAllAutoAllow } = renderPane();
		const toggle = find(settings, "Auto-allow permissions")!.comps.toggle;
		await (toggle.onChangeCb as (v: unknown) => unknown)(true);
		expect(updateSettings).toHaveBeenCalledWith({
			autoAllowPermissions: true,
		});
		expect(updateAllAutoAllow).toHaveBeenCalledWith(true);
	});

	it("Default agent dropdown persists the new default", async () => {
		const { settings, saveSettingsAndNotify } = renderPane();
		const dd = find(settings, "Default agent")!.comps.dropdown;
		await (dd.onChangeCb as (v: unknown) => unknown)("codex-acp");
		expect(saveSettingsAndNotify).toHaveBeenCalledWith(
			expect.objectContaining({ defaultAgentId: "codex-acp" }),
		);
	});

	it("Default working directory persists a trimmed value", async () => {
		const { settings, updateSettings } = renderPane();
		const text = find(settings, "Default working directory")!.comps.text;
		await (text.onChangeCb as (v: unknown) => unknown)("  /tmp/work  ");
		expect(updateSettings).toHaveBeenCalledWith({
			defaultWorkingDirectory: "/tmp/work",
		});
	});
});

describe("Settings Pane Reorganization — collapsibles (T4)", () => {
	const detailsByTitle = (container: HTMLElement, title: string) =>
		(
			Array.from(
				container.querySelectorAll(
					"details.agent-client-agent-section",
				),
			) as HTMLDetailsElement[]
		).find(
			(d) =>
				d.querySelector(".agent-client-agent-section-name")
					?.textContent === title,
		);

	it("Export and Advanced are native <details>, collapsed by default", () => {
		const { container } = renderPane();
		const exp = detailsByTitle(container, "Export")!;
		const adv = detailsByTitle(container, "Advanced")!;
		// native <details> + <summary> ⇒ keyboard toggle (Enter/Space) for free
		expect(exp.tagName).toBe("DETAILS");
		expect(exp.querySelector("summary")).toBeTruthy();
		expect(adv.tagName).toBe("DETAILS");
		expect(adv.querySelector("summary")).toBeTruthy();
		// collapsed by default (OQ2)
		expect(exp.open).toBe(false);
		expect(adv.open).toBe(false);
	});

	it("keeps the default agent accordion expanded (per-session state intact)", () => {
		const { container } = renderPane();
		const claude = detailsByTitle(container, "Claude Code")!;
		expect(claude.open).toBe(true);
	});

	it("Export conditional child rows still gate on includeImages", () => {
		const off = renderPane({
			exportSettings: {
				...DEFAULT_SETTINGS.exportSettings,
				includeImages: false,
			},
		});
		expect(find(off.settings, "Image location")).toBeUndefined();

		const on = renderPane({
			exportSettings: {
				...DEFAULT_SETTINGS.exportSettings,
				includeImages: true,
				imageLocation: "custom",
			},
		});
		expect(find(on.settings, "Image location")).toBeDefined();
		expect(find(on.settings, "Custom image folder")).toBeDefined();
	});
});

describe("Settings Pane Reorganization — D5 Import placement (T5 render)", () => {
	const IMPORT = "Import settings from another plugin";

	it("renders Import in Top matter (before the Agents heading) when un-configured", () => {
		const { settings } = renderPane({ hasCompletedSetup: false });
		const importIdx = idx(settings, IMPORT);
		expect(importIdx).toBeGreaterThanOrEqual(0);
		expect(importIdx).toBeLessThan(idx(settings, "Agents"));
	});

	it("renders Import after Permissions (in Advanced) once configured", () => {
		const { settings } = renderPane({ hasCompletedSetup: true });
		expect(idx(settings, IMPORT)).toBeGreaterThan(
			idx(settings, "Permissions"),
		);
	});

	it("renders Import exactly once regardless of configured state", () => {
		for (const configured of [true, false]) {
			const { settings } = renderPane({ hasCompletedSetup: configured });
			expect(names(settings).filter((n) => n === IMPORT).length).toBe(1);
		}
	});
});

describe("Settings Pane Reorganization — Add custom agent (auto-expand + focus)", () => {
	it("auto-expands the new agent's accordion and consumes the focus intent on its first field", async () => {
		const { tab, container, settings } = renderPane();
		const addBtn = settings.find(
			(s) =>
				(s.comps.button as { btnText?: string } | undefined)
					?.btnText === "Add custom agent",
		);
		expect(addBtn).toBeDefined();

		await (
			addBtn!.comps.button as unknown as {
				onClickCb: () => Promise<void>;
			}
		).onClickCb();

		// After the click re-renders the pane, the new custom-agent accordion
		// exists AND is expanded (no extra click needed to open it).
		const newAccordion = Array.from(
			container.querySelectorAll("details.agent-client-agent-section"),
		).find(
			(d) =>
				d.querySelector(".agent-client-agent-section-name")
					?.textContent === "Custom agent",
		) as HTMLDetailsElement | undefined;
		expect(newAccordion).toBeDefined();
		expect(newAccordion!.open).toBe(true);

		// The focus intent was consumed when the Agent ID field rendered
		// (the field schedules an rAF focus; the flag clears synchronously).
		expect(
			(tab as unknown as { pendingFocusAgentId: string | null })
				.pendingFocusAgentId,
		).toBeNull();
	});
});

describe("Obsidian system prompt — 'What gets sent' preview is always present", () => {
	// Issue 1: clicking "Edit full prompt" used to gate the preview out of
	// full mode. The preview must be present in BOTH modes and, in full mode,
	// mirror the hand-edited full-prompt box live.
	const fullModeOverride = {
		obsidianSystemPrompt: {
			blocks: {
				hostIdentity: true,
				rendering: true,
				workingDirectory: true,
				vaultCollaboration: true,
			},
			appendText: "",
			customText: "SEED PROMPT",
			mode: "full" as const,
		},
	};

	it("renders the 'What gets sent' preview in full-edit mode alongside the editable box", () => {
		const { settings } = renderPane(fullModeOverride);
		expect(find(settings, "What gets sent")).toBeDefined();
		expect(find(settings, "Full prompt")).toBeDefined();
	});

	it("preview tracks edits to the full-prompt box live", async () => {
		const { settings } = renderPane(fullModeOverride);
		const fullTa = find(settings, "Full prompt")!.comps.textarea;
		// Simulate the user typing into the editable full-prompt box.
		(fullTa as unknown as { inputEl: HTMLInputElement }).inputEl.value =
			"EDITED LIVE";
		await (fullTa.onChangeCb as (v: unknown) => unknown)("EDITED LIVE");
		const preview = find(settings, "What gets sent")!.comps.textarea;
		expect(preview.getValue()).toBe("EDITED LIVE");
	});

	it("still renders the preview in options mode (no regression)", () => {
		const { settings } = renderPane(); // DEFAULT_SETTINGS → options mode
		expect(find(settings, "What gets sent")).toBeDefined();
	});
});

describe("Obsidian system prompt — Reset confirm gate", () => {
	it("resets immediately (no confirm) at shipped defaults", async () => {
		const { settings, updateSettings } = renderPane();
		const btn = find(settings, "Reset to defaults")!.comps.button;
		await (btn as unknown as { onClickCb: () => Promise<void> }).onClickCb();
		// At defaults there's nothing to lose → reset applied directly.
		expect(updateSettings).toHaveBeenCalledWith(
			expect.objectContaining({ obsidianSystemPrompt: expect.anything() }),
		);
	});

	it("defers the reset to a confirm modal when a block is toggled off", async () => {
		const { settings, updateSettings } = renderPane({
			obsidianSystemPrompt: {
				blocks: {
					hostIdentity: true,
					rendering: true,
					workingDirectory: true,
					vaultCollaboration: false,
				},
				appendText: "",
				customText: "",
				mode: "options",
			},
		});
		const btn = find(settings, "Reset to defaults")!.comps.button;
		await (btn as unknown as { onClickCb: () => Promise<void> }).onClickCb();
		// Non-default (a switch off) → confirm modal opens; not reset yet.
		expect(updateSettings).not.toHaveBeenCalled();
	});

	it("defers the reset to a confirm modal when vault context is set", async () => {
		const { settings, updateSettings } = renderPane({
			obsidianSystemPrompt: {
				blocks: {
					hostIdentity: true,
					rendering: true,
					workingDirectory: true,
					vaultCollaboration: true,
				},
				appendText: "Daily notes live in Journal/.",
				customText: "",
				mode: "options",
			},
		});
		const btn = find(settings, "Reset to defaults")!.comps.button;
		await (btn as unknown as { onClickCb: () => Promise<void> }).onClickCb();
		// Typed text present → a confirm modal opens; reset is NOT applied yet.
		expect(updateSettings).not.toHaveBeenCalled();
	});
});

describe("Obsidian system prompt — focus & no-jump on interaction", () => {
	it("requests focus for the full-prompt box when entering full mode", async () => {
		const { settings } = renderPane({}, { live: true });
		// Spy AFTER the initial render so only the click's rAF is counted.
		const rafSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation(() => 0 as unknown as number);
		try {
			const editBtn = find(settings, "Edit the full prompt")!.comps
				.button;
			await (
				editBtn as unknown as { onClickCb: () => Promise<void> }
			).onClickCb();
			// The full-prompt textarea's render hit the focus branch (proving
			// the focus intent was set on click and consumed on render).
			expect(rafSpy).toHaveBeenCalled();
			expect(find(settings, "Full prompt")).toBeDefined();
		} finally {
			rafSpy.mockRestore();
		}
	});

	it("non-vault toggles refresh the preview without re-rendering; the vault toggle re-renders", async () => {
		const { settings } = renderPane();
		const before = settings.length;
		// A non-vault block toggle must NOT trigger a full re-render (the jump).
		const host = find(settings, "Say it's running in Obsidian")!.comps
			.toggle;
		await (host.onChangeCb as (v: unknown) => unknown)(false);
		expect(settings.length).toBe(before);
		// The vault toggle DOES re-render (its note-hint visibility depends on it).
		const vault = find(settings, "Let it work with your notes")!.comps
			.toggle;
		await (vault.onChangeCb as (v: unknown) => unknown)(false);
		expect(settings.length).toBeGreaterThan(before);
	});
});
