/**
 * Unit tests for SessionStorage.migrateLegacySessionsDir().
 *
 * Covers [[I68 Session storage dir hardcoded to old agent-client plugin id]]:
 * the fork historically wrote session files into the upstream plugin's
 * directory (`plugins/agent-client/sessions`). getSessionsDir() now
 * resolves to this.plugin.manifest.id (`agent-console`), so a one-time
 * migration copies the live legacy files into the new dir.
 *
 * A naive copy is UNSAFE: an earlier build briefly wrote into
 * `agent-console/sessions` and left stale files there. The live data
 * lives under `agent-client/sessions`. So the migration must prefer the
 * NEWER file on id collisions — never let a stale target clobber a live
 * source, and never let a re-run clobber freshly-written sessions.
 *
 * Invariants under test:
 *   - copies non-colliding legacy files into the new dir
 *   - newer (live) legacy file wins on collision
 *   - never clobbers a target file that is newer-or-equal
 *   - idempotent: no-op once the migration flag is set
 *   - no-op (but flag set) on a fresh install with no legacy dir
 *   - flag-cleared re-run is still safe (newer-or-equal target preserved)
 */

import { describe, it, expect } from "vitest";
import { SessionStorage } from "../session-storage";
import type { AgentClientPluginSettings } from "../../plugin";
import type AgentClientPlugin from "../../plugin";

const CONFIG_DIR = "vault-config";
const LEGACY = `${CONFIG_DIR}/plugins/agent-client/sessions`;
const TARGET = `${CONFIG_DIR}/plugins/agent-console/sessions`;

interface FakeFile {
	content: string;
	mtime: number;
}

/**
 * In-memory DataAdapter fake. `exists` returns true for a directory
 * path when any file lives under it (mirrors Obsidian's adapter, which
 * reports existence for dirs that contain files).
 */
function makeFakeAdapter(seed: Record<string, FakeFile> = {}) {
	const files = new Map<string, FakeFile>(Object.entries(seed));
	const folders = new Set<string>();
	return {
		files,
		async exists(p: string): Promise<boolean> {
			if (files.has(p) || folders.has(p)) return true;
			const prefix = p.endsWith("/") ? p : `${p}/`;
			return [...files.keys()].some((k) => k.startsWith(prefix));
		},
		async mkdir(p: string): Promise<void> {
			folders.add(p);
		},
		async list(
			dir: string,
		): Promise<{ files: string[]; folders: string[] }> {
			const prefix = dir.endsWith("/") ? dir : `${dir}/`;
			const f = [...files.keys()].filter(
				(k) =>
					k.startsWith(prefix) &&
					!k.slice(prefix.length).includes("/"),
			);
			return { files: f, folders: [] };
		},
		async stat(p: string) {
			const e = files.get(p);
			return e
				? {
						type: "file" as const,
						ctime: e.mtime,
						mtime: e.mtime,
						size: e.content.length,
					}
				: null;
		},
		async read(p: string): Promise<string> {
			const e = files.get(p);
			if (!e) throw new Error(`ENOENT: ${p}`);
			return e.content;
		},
		async write(p: string, content: string): Promise<void> {
			files.set(p, { content, mtime: Date.now() });
		},
	};
}

function makePlugin(
	adapter: ReturnType<typeof makeFakeAdapter>,
): AgentClientPlugin {
	return {
		app: { vault: { configDir: CONFIG_DIR, adapter } },
		manifest: { id: "agent-console" },
	} as unknown as AgentClientPlugin;
}

function makeSettings(initial: Partial<AgentClientPluginSettings> = {}) {
	let state = { ...initial } as AgentClientPluginSettings;
	return {
		getSnapshot: (): AgentClientPluginSettings => state,
		async updateSettings(
			u: Partial<AgentClientPluginSettings>,
		): Promise<void> {
			state = { ...state, ...u };
		},
		_get: (): AgentClientPluginSettings => state,
	};
}

describe("SessionStorage.migrateLegacySessionsDir (I68)", () => {
	it("copies non-colliding legacy files into the new dir and sets the flag", async () => {
		const adapter = makeFakeAdapter({
			[`${LEGACY}/a.json`]: { content: "AAA", mtime: 1000 },
			[`${LEGACY}/b.json`]: { content: "BBB", mtime: 2000 },
		});
		const settings = makeSettings();
		const storage = new SessionStorage(makePlugin(adapter), settings);

		await storage.migrateLegacySessionsDir();

		expect(adapter.files.get(`${TARGET}/a.json`)?.content).toBe("AAA");
		expect(adapter.files.get(`${TARGET}/b.json`)?.content).toBe("BBB");
		expect(settings._get().legacySessionsMigrated).toBe(true);
	});

	it("newer (live) legacy file wins on collision with a stale target", async () => {
		const adapter = makeFakeAdapter({
			[`${LEGACY}/a.json`]: { content: "LIVE", mtime: 2000 },
			[`${TARGET}/a.json`]: { content: "STALE", mtime: 1000 },
		});
		const settings = makeSettings();
		const storage = new SessionStorage(makePlugin(adapter), settings);

		await storage.migrateLegacySessionsDir();

		expect(adapter.files.get(`${TARGET}/a.json`)?.content).toBe("LIVE");
	});

	it("never clobbers a target file that is newer than the legacy copy", async () => {
		const adapter = makeFakeAdapter({
			[`${LEGACY}/a.json`]: { content: "OLD", mtime: 1000 },
			[`${TARGET}/a.json`]: { content: "NEWER", mtime: 2000 },
		});
		const settings = makeSettings();
		const storage = new SessionStorage(makePlugin(adapter), settings);

		await storage.migrateLegacySessionsDir();

		expect(adapter.files.get(`${TARGET}/a.json`)?.content).toBe("NEWER");
	});

	it("is a no-op when the migration flag is already set", async () => {
		const adapter = makeFakeAdapter({
			[`${LEGACY}/a.json`]: { content: "AAA", mtime: 1000 },
		});
		const settings = makeSettings({ legacySessionsMigrated: true });
		const storage = new SessionStorage(makePlugin(adapter), settings);

		await storage.migrateLegacySessionsDir();

		// Nothing copied into the new dir.
		expect(adapter.files.has(`${TARGET}/a.json`)).toBe(false);
	});

	it("is a no-op (but sets the flag) on a fresh install with no legacy dir", async () => {
		const adapter = makeFakeAdapter();
		const settings = makeSettings();
		const storage = new SessionStorage(makePlugin(adapter), settings);

		await expect(
			storage.migrateLegacySessionsDir(),
		).resolves.toBeUndefined();
		expect(settings._get().legacySessionsMigrated).toBe(true);
		expect(adapter.files.size).toBe(0);
	});

	it("flag-cleared re-run is still safe when the target is newer-or-equal", async () => {
		// Simulates a second load after the flag was somehow cleared:
		// target already holds the migrated (equal-mtime) copy, so the
		// newer-or-equal rule must skip the overwrite.
		const adapter = makeFakeAdapter({
			[`${LEGACY}/a.json`]: { content: "LEGACY", mtime: 1000 },
			[`${TARGET}/a.json`]: { content: "MIGRATED", mtime: 1000 },
		});
		const settings = makeSettings();
		const storage = new SessionStorage(makePlugin(adapter), settings);

		await storage.migrateLegacySessionsDir();

		expect(adapter.files.get(`${TARGET}/a.json`)?.content).toBe("MIGRATED");
	});
});
