/**
 * seedStudio writes the heavy session, a light tab taken from the
 * template's own saved sessions, and the restored-tab state keyed by the
 * vault's chat leaf. Runs against a temp vault on disk.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedStudio, HEAVY_TAB_ID, LIGHT_TAB_ID } from "../seed";

let root: string;
let pluginDir: string;
const CONFIG_DIR = ".obsidian";

function writeJson(p: string, v: unknown): void {
	mkdirSync(path.dirname(p), { recursive: true });
	writeFileSync(p, JSON.stringify(v));
}

function makeVault(opts: { leafType?: string; lightSessionFile?: boolean } = {}): void {
	writeJson(path.join(root, CONFIG_DIR, "workspace.json"), {
		main: {
			type: "split",
			children: [
				{
					id: "leaf-chat",
					type: "leaf",
					state: { type: opts.leafType ?? "agent-console-chat-view" },
				},
			],
		},
	});
	writeJson(path.join(pluginDir, "data.template.json"), {
		restoreTabsOnStartup: false,
		savedSessions: [
			{
				recordId: "seed-light",
				sessionId: "seed-light",
				agentId: "some-agent",
				cwd: "/tmp/notes",
				title: "Light chat",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		],
	});
	if (opts.lightSessionFile !== false) {
		writeJson(path.join(pluginDir, "sessions.seed/seed-light.json"), {
			version: 1,
			messages: [],
		});
	} else {
		mkdirSync(path.join(pluginDir, "sessions.seed"), { recursive: true });
	}
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "profile-seed-"));
	pluginDir = path.join(root, CONFIG_DIR, "plugins/agent-console");
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("seedStudio", () => {
	it("seeds the heavy session and both tabs under the chat leaf", () => {
		makeVault();
		seedStudio(root, CONFIG_DIR);
		const data = JSON.parse(readFileSync(path.join(pluginDir, "data.json"), "utf8")) as {
			restoreTabsOnStartup: boolean;
			savedSessions: { sessionId: string; recordId?: string }[];
			perLeafTabStates: {
				leafId: string;
				activeTabId: string;
				tabs: { tabId: string; sessionId: string; agentId: string }[];
			}[];
		};
		expect(data.restoreTabsOnStartup).toBe(true);
		expect(data.perLeafTabStates).toHaveLength(1);
		const leaf = data.perLeafTabStates[0];
		expect(leaf.leafId).toBe("leaf-chat");
		expect(leaf.activeTabId).toBe(HEAVY_TAB_ID);
		expect(leaf.tabs.map((t) => t.tabId)).toEqual([HEAVY_TAB_ID, LIGHT_TAB_ID]);
		// The light tab comes from the template, not a hard-coded session.
		expect(leaf.tabs[1].sessionId).toBe("seed-light");
		expect(leaf.tabs[1].agentId).toBe("some-agent");
		const heavy = data.savedSessions.find((s) => s.sessionId === leaf.tabs[0].sessionId);
		expect(heavy?.recordId).toBe(heavy?.sessionId);
		expect(existsSync(path.join(pluginDir, `sessions/${leaf.tabs[0].sessionId}.json`))).toBe(true);
		expect(existsSync(path.join(pluginDir, "sessions/seed-light.json"))).toBe(true);
	});

	it("throws when the vault has no chat leaf", () => {
		makeVault({ leafType: "markdown" });
		expect(() => seedStudio(root, CONFIG_DIR)).toThrow(/chat leaf/);
	});

	it("throws when no template session has a session file", () => {
		makeVault({ lightSessionFile: false });
		expect(() => seedStudio(root, CONFIG_DIR)).toThrow(/light tab/);
	});

	it("throws when the vault has no plugin template", () => {
		expect(() => seedStudio(root, CONFIG_DIR)).toThrow(/data\.template\.json/);
	});
});

describe("seedStudio configDir", () => {
	it("uses the vault's own config folder, not an assumed .obsidian", () => {
		const other = mkdtempSync(path.join(tmpdir(), "profile-seed-cfg-"));
		try {
			const dir = path.join(other, ".config-x/plugins/agent-console");
			writeJson(path.join(other, ".config-x/workspace.json"), {
				main: { type: "leaf", id: "L", state: { type: "agent-console-chat-view" } },
			});
			writeJson(path.join(dir, "data.template.json"), {
				savedSessions: [{ sessionId: "s", agentId: "a" }],
			});
			writeJson(path.join(dir, "sessions.seed/s.json"), { version: 1, messages: [] });
			seedStudio(other, ".config-x");
			expect(existsSync(path.join(dir, "data.json"))).toBe(true);
		} finally {
			rmSync(other, { recursive: true, force: true });
		}
	});
});
