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
import { Notice } from "obsidian";

type Written = {
	tabDisplay: string;
	tabRailWidth: number;
	defaultAgentId: string;
	lastSeenVersion?: string;
};

type TestPlugin = AgentClientPlugin & {
	loadData: () => Promise<unknown>;
	saveData: (d: unknown) => Promise<void>;
};

async function runLoad(
	raw: Record<string, unknown> | null,
	version = "2.5.0",
) {
	const plugin = Object.create(AgentClientPlugin.prototype) as TestPlugin;
	(plugin as unknown as { manifest: { version: string } }).manifest = {
		version,
	};
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

/**
 * I306: the "found Agent Client settings" toast shows only on a fresh install.
 * An existing data.json without `settingsImportOfferShown` (every install that
 * predates v1.2.0) used to get the offer on its first post-upgrade launch.
 */
describe("I306 the settings-import offer is for fresh installs only", () => {
	type OfferPlugin = {
		createImportSources: () => Array<{
			id: string;
			displayName: string;
			detect: () => Promise<boolean>;
		}>;
		maybeOfferSettingsImport: () => Promise<void>;
		maybeFirstRunOnboarding: () => Promise<void>;
		detectAgents: () => Promise<Set<string>>;
		activateView: () => Promise<void>;
	};

	async function offerAfterLoad(
		raw: Record<string, unknown> | null,
		opts: { onboardingFirst?: boolean; sourcePresent?: boolean } = {},
	) {
		const { plugin, writes } = await runLoad(raw);
		const p = plugin as unknown as OfferPlugin;
		const detect = vi.fn(async () => opts.sourcePresent ?? true);
		p.createImportSources = () => [
			{ id: "agent-client", displayName: "Agent Client", detect },
		];
		p.detectAgents = async () => new Set(["kiro"]);
		p.activateView = async () => {};

		if (opts.onboardingFirst) await p.maybeFirstRunOnboarding();
		const notices = (
			Notice as unknown as {
				instances: Array<{ containerEl: { classes: Set<string> } }>;
			}
		).instances;
		const noticesBefore = notices.length;
		const writesBefore = writes.length;
		await p.maybeOfferSettingsImport();

		const toasts = notices
			.slice(noticesBefore)
			.filter((n) => n.containerEl.classes.has("agent-client-import-notice"));
		const offerWrites = writes.slice(writesBefore) as unknown as Array<{
			settingsImportOfferShown?: boolean;
		}>;
		return { toasts, detect, offerWrites };
	}

	it("an existing data.json without the flag gets no toast, no detection read, and no save", async () => {
		const { toasts, detect, offerWrites } = await offerAfterLoad({});
		expect(toasts).toHaveLength(0);
		expect(detect).not.toHaveBeenCalled();
		expect(offerWrites).toHaveLength(0);
	});

	it("a fresh install with Agent Client data gets the toast and saves the flag", async () => {
		const { toasts, offerWrites } = await offerAfterLoad(null);
		expect(toasts).toHaveLength(1);
		expect(offerWrites.length).toBeGreaterThan(0);
		expect(offerWrites[offerWrites.length - 1].settingsImportOfferShown).toBe(
			true,
		);
	});

	it("a fresh install with no other plugin's data gets no toast and no save", async () => {
		const { toasts, detect, offerWrites } = await offerAfterLoad(null, {
			sourcePresent: false,
		});
		expect(detect).toHaveBeenCalledTimes(1);
		expect(toasts).toHaveLength(0);
		expect(offerWrites).toHaveLength(0);
	});

	it("the offer still appears on a fresh install after onboarding has run", async () => {
		const { toasts } = await offerAfterLoad(null, {
			onboardingFirst: true,
		});
		expect(toasts).toHaveLength(1);
	});
});

/**
 * I300: a fresh install is already "up to date" on what's new, so new users
 * never see the card. An existing data.json without the key is a user who
 * updated and should see it.
 */
describe("I300 fresh installs start with lastSeenVersion set", () => {
	it("applyFreshInstallDefaults stores the release core of the version", () => {
		expect(
			applyFreshInstallDefaults(DEFAULT_SETTINGS, "2.5.0").lastSeenVersion,
		).toBe("2.5.0");
		expect(
			applyFreshInstallDefaults(DEFAULT_SETTINGS, "2.5.0-beta.1")
				.lastSeenVersion,
		).toBe("2.5.0");
	});

	it("an invalid version leaves lastSeenVersion unset", () => {
		expect(
			applyFreshInstallDefaults(DEFAULT_SETTINGS, "nope").lastSeenVersion,
		).toBeUndefined();
	});

	it("a fresh install (no data.json) saves the current version", async () => {
		const { plugin, writes } = await runLoad(null, "2.5.0");
		expect(plugin.settings.lastSeenVersion).toBe("2.5.0");
		expect(writes.length).toBeGreaterThan(0);
		expect(writes[writes.length - 1].lastSeenVersion).toBe("2.5.0");
	});

	it("an existing data.json without the key leaves it unset", async () => {
		const { plugin, writes } = await runLoad({}, "2.5.0");
		expect(plugin.settings.lastSeenVersion).toBeUndefined();
		for (const w of writes) expect(w.lastSeenVersion).toBeUndefined();
	});
});
