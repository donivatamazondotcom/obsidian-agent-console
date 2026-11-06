/**
 * D1 (Agent Console v2.5.0): Kiro CLI V3 becomes the default engine.
 *
 * - The stored setting has three states: "default", "v2", "v3".
 * - "default" resolves to V3 at one point (resolveKiroEngine), so launch code
 *   keeps receiving "v2" | "v3".
 * - A one-time migration resets a stored built-in "v2" (a placeholder: no
 *   released version shipped the setting) to "default", and never again.
 * - Custom agents follow Default only when their command is kiro-cli.
 *
 * Entry points are the ones the runtime uses: normalizeRawSettings (load and
 * import), buildAgentConfigWithApiKey (every launch), and the plugin's own
 * loadSettings with Obsidian's loadData/saveData stubbed.
 */
import { describe, it, expect, vi } from "vitest";

// plugin.ts pulls in the whole UI graph, whose Obsidian classes the shared stub
// doesn't define. Keep every real stub export and give anything missing an
// empty class: the Obsidian boundary is the only thing mocked here.
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
	normalizeRawSettings,
	DEFAULT_SETTINGS,
} from "../settings-normalizer";
import { buildAgentConfigWithApiKey } from "../session-helpers";
import { resolveLaunchArgs } from "../../acp/kiro-v3";
import AgentClientPlugin from "../../plugin";

const idKey = (_d: string, _f: string, current: string) => current;
const load = (raw: Record<string, unknown>) =>
	normalizeRawSettings(raw, DEFAULT_SETTINGS, idKey);

const kiroCustom = {
	id: "auto-sa",
	displayName: "Auto SA",
	command: "/Users/x/.toolbox/bin/kiro-cli",
	args: ["acp", "--agent", "auto-sa"],
	env: [],
};
const claudeCustom = {
	id: "my-claude",
	displayName: "My Claude",
	command: "claude-code-acp",
	args: ["--verbose"],
	env: [],
};

describe("D1 migration: stored built-in v2 becomes Default once", () => {
	it("an old data.json with engine v2 and no flag loads as Default, flag set", () => {
		const s = load({ kiro: { engine: "v2" } });
		expect(s.kiro.engine).toBe("default");
		expect(s.kiroEngineDefaultMigrated).toBe(true);
	});

	it("an old explicit v3 stays v3", () => {
		expect(load({ kiro: { engine: "v3" } }).kiro.engine).toBe("v3");
	});

	it("a fresh install starts on Default", () => {
		const s = load({});
		expect(s.kiro.engine).toBe("default");
		expect(s.kiroEngineDefaultMigrated).toBe(true);
	});

	it("a V2 chosen after the migration is kept on every later load", () => {
		const first = load({ kiro: { engine: "v2" } });
		// The user picks V2 in settings; the whole settings object is saved.
		const saved = JSON.parse(
			JSON.stringify({ ...first, kiro: { ...first.kiro, engine: "v2" } }),
		) as Record<string, unknown>;
		const second = load(saved);
		expect(second.kiro.engine).toBe("v2");
		expect(load(JSON.parse(JSON.stringify(second))).kiro.engine).toBe("v2");
	});

	it("an unknown stored value reads as Default", () => {
		expect(
			load({ kiro: { engine: "bogus" }, kiroEngineDefaultMigrated: true }).kiro
				.engine,
		).toBe("default");
	});
});

describe("D1 round-trip: every state survives save and load", () => {
	it.each(["default", "v2", "v3"] as const)("built-in %s", (engine) => {
		const s = load({ kiro: { engine }, kiroEngineDefaultMigrated: true });
		const again = load(JSON.parse(JSON.stringify(s)));
		expect(again.kiro.engine).toBe(engine);
	});

	it("a custom agent keeps an explicit V2 and omits the field for Default", () => {
		const s = load({
			customAgents: [
				{ ...kiroCustom, engine: "v2" },
				{ ...kiroCustom, id: "k2" },
			],
		});
		const again = load(JSON.parse(JSON.stringify(s)));
		expect(again.customAgents[0].engine).toBe("v2");
		expect(again.customAgents[1]).not.toHaveProperty("engine");
	});
});

describe("D1 resolution: Default launches V3", () => {
	it("the built-in agent on Default gets the V3 launch", () => {
		const s = load({});
		const c = buildAgentConfigWithApiKey(s, s.kiro, s.kiro.id, "/vault");
		expect(c.kiroEngine).toBe("v3");
		expect(resolveLaunchArgs(c)).toEqual(["acp", "--agent-engine=v3"]);
	});

	it("the built-in agent on V2 is pinned to V2 (I270)", () => {
		const s = load({ kiro: { engine: "v2" }, kiroEngineDefaultMigrated: true });
		const c = buildAgentConfigWithApiKey(s, s.kiro, s.kiro.id, "/vault");
		expect(c.kiroEngine).toBe("v2");
		expect(resolveLaunchArgs(c)).toEqual(["acp", "--agent-engine=v2"]);
	});

	it("a kiro-cli custom agent with no engine follows Default (V3)", () => {
		const s = load({ customAgents: [kiroCustom] });
		const c = buildAgentConfigWithApiKey(s, s.customAgents[0], "auto-sa", "/vault");
		expect(c.kiroEngine).toBe("v3");
	});

	it("a kiro-cli custom agent set to V2 stays on V2", () => {
		const s = load({ customAgents: [{ ...kiroCustom, engine: "v2" }] });
		const c = buildAgentConfigWithApiKey(s, s.customAgents[0], "auto-sa", "/vault");
		expect(c.kiroEngine).toBe("v2");
		expect(resolveLaunchArgs(c)).toContain("--agent-engine=v2");
	});

	it("a non-kiro custom agent never gets the Kiro V3 rewrite", () => {
		const s = load({ customAgents: [claudeCustom] });
		const c = buildAgentConfigWithApiKey(s, s.customAgents[0], "my-claude", "/vault");
		expect(c.kiroEngine).toBeUndefined();
		expect(resolveLaunchArgs(c)).toEqual(["--verbose"]);
	});
});

describe("D1 loadSettings persists the migration once", () => {
	async function runLoad(raw: Record<string, unknown>) {
		const plugin = Object.create(
			AgentClientPlugin.prototype,
		) as AgentClientPlugin & {
			loadData: () => Promise<unknown>;
			saveData: (d: unknown) => Promise<void>;
		};
		const saveData = vi.fn(async (_d: unknown) => {});
		plugin.loadData = async () => raw;
		plugin.saveData = saveData;
		await plugin.loadSettings();
		return { plugin, saveData };
	}

	it("writes the reset Default and the flag when the flag is missing", async () => {
		const { saveData } = await runLoad({ kiro: { engine: "v2" } });
		expect(saveData).toHaveBeenCalledTimes(1);
		const written = saveData.mock.calls[0][0] as {
			kiro: { engine: string };
			kiroEngineDefaultMigrated: boolean;
		};
		expect(written.kiro.engine).toBe("default");
		expect(written.kiroEngineDefaultMigrated).toBe(true);
	});

	it("does not write when the migration already ran", async () => {
		const { saveData, plugin } = await runLoad({
			kiro: { engine: "v2" },
			kiroEngineDefaultMigrated: true,
			migrationNoticeShown: true,
		});
		expect(saveData).not.toHaveBeenCalled();
		expect(plugin.settings.kiro.engine).toBe("v2");
	});
});
