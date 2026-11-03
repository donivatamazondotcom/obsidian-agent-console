/**
 * I202: cap eviction must not orphan transcript files.
 *
 * Enters at SessionStorage's public methods (saveSession,
 * saveSessionMessages, deleteSession, applyMaxSavedSessions, the cleanup
 * pair) against an in-memory vault adapter whose trashSystem / trashLocal
 * move files into a trash map. Every test asserts what is on disk and in the
 * trash, never that a mock was called.
 */
import { describe, expect, it } from "vitest";
import { SessionStorage } from "../session-storage";
import type { AgentClientPluginSettings } from "../../plugin";
import type AgentClientPlugin from "../../plugin";
import type { ChatMessage } from "../../types/chat";
import type { SavedSessionInfo } from "../../types/session";
import type { PerLeafTabState } from "../../types/tab";

const DIR = ".obsidian/plugins/agent-console/sessions";
const DAY = 24 * 60 * 60 * 1000;

function makeVault(opts: { systemTrash?: boolean } = {}) {
	const files = new Map<string, { data: string; mtime: number }>();
	const dirs = new Set<string>();
	const systemTrash = new Map<string, string>();
	const localTrash = new Map<string, string>();
	const adapter = {
		async exists(p: string) {
			return files.has(p) || dirs.has(p);
		},
		async mkdir(p: string) {
			dirs.add(p);
		},
		async write(p: string, data: string) {
			files.set(p, { data, mtime: Date.now() });
		},
		async read(p: string) {
			const f = files.get(p);
			if (!f) throw new Error(`ENOENT ${p}`);
			return f.data;
		},
		async remove(p: string) {
			files.delete(p);
		},
		async list(p: string) {
			return {
				files: [...files.keys()].filter((k) =>
					k.startsWith(`${p}/`),
				),
				folders: [],
			};
		},
		async stat(p: string) {
			const f = files.get(p);
			return f
				? { type: "file", ctime: f.mtime, mtime: f.mtime, size: f.data.length }
				: null;
		},
		async trashSystem(p: string) {
			if (opts.systemTrash === false) return false;
			const f = files.get(p);
			if (!f) return false;
			systemTrash.set(p, f.data);
			files.delete(p);
			return true;
		},
		async trashLocal(p: string) {
			const f = files.get(p);
			if (!f) return;
			localTrash.set(p, f.data);
			files.delete(p);
		},
	};
	const plugin = {
		app: { vault: { configDir: ".obsidian", adapter } },
		manifest: { id: "agent-console" },
	} as unknown as AgentClientPlugin;
	return {
		plugin,
		files,
		systemTrash,
		localTrash,
		age(sessionId: string, ms: number) {
			const f = files.get(path(sessionId));
			if (f) f.mtime = Date.now() - ms;
		},
	};
}

function makeSettings(initial: Partial<AgentClientPluginSettings>) {
	let state = {
		savedSessions: [],
		...initial,
	} as unknown as AgentClientPluginSettings;
	return {
		getSnapshot: () => state,
		async updateSettings(u: Partial<AgentClientPluginSettings>) {
			state = { ...state, ...u };
		},
	};
}

function path(sessionId: string) {
	return `${DIR}/${sessionId}.json`;
}

function info(sessionId: string, updatedAt: string): SavedSessionInfo {
	return {
		sessionId,
		agentId: "claude-code-acp",
		cwd: "/vault",
		title: sessionId,
		createdAt: updatedAt,
		updatedAt,
	};
}

const msg: ChatMessage[] = [
	{
		id: "m1",
		role: "user",
		content: [{ type: "text", text: "hello" }],
		timestamp: new Date("2026-11-01T00:00:00Z"),
	} as ChatMessage,
];

function tabsFor(...ids: string[]): PerLeafTabState[] {
	return [
		{
			leafId: "leaf-1",
			activeTabId: "t0",
			tabs: ids.map((sessionId, i) => ({
				tabId: `t${i}`,
				agentId: "claude-code-acp",
				label: sessionId,
				sessionId,
				tabOrder: i,
				scrollPosition: 0,
			})),
		},
	];
}

/** Save `n` chats with transcripts, oldest first (day 1, day 2, …). */
async function seed(storage: SessionStorage, ids: string[]) {
	for (const [i, id] of ids.entries()) {
		await storage.saveSessionMessages(id, "claude-code-acp", msg);
		await storage.saveSession(
			info(id, new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString()),
		);
	}
}

describe("I202 cap eviction keeps record and transcript together", () => {
	it("moves the evicted chat's transcript to the trash and leaves no orphan", async () => {
		const vault = makeVault();
		const settings = makeSettings({ maxSavedSessions: 3 });
		const storage = new SessionStorage(vault.plugin, settings);

		await seed(storage, ["s1", "s2", "s3", "s4"]);

		const ids = settings.getSnapshot().savedSessions.map((s) => s.sessionId);
		expect(ids.sort()).toEqual(["s2", "s3", "s4"]);
		expect(vault.files.has(path("s1"))).toBe(false);
		expect(vault.systemTrash.has(path("s1"))).toBe(true);
		for (const id of ids) expect(vault.files.has(path(id))).toBe(true);
	});

	it("never evicts a chat a persisted tab uses; the next eligible one goes", async () => {
		const vault = makeVault();
		const settings = makeSettings({
			maxSavedSessions: 3,
			perLeafTabStates: tabsFor("s1"),
		});
		const storage = new SessionStorage(vault.plugin, settings);

		await seed(storage, ["s1", "s2", "s3", "s4"]);

		const ids = settings.getSnapshot().savedSessions.map((s) => s.sessionId);
		expect(ids.sort()).toEqual(["s1", "s3", "s4"]);
		expect(vault.files.has(path("s1"))).toBe(true);
		expect(vault.files.has(path("s2"))).toBe(false);
		expect(vault.systemTrash.has(path("s2"))).toBe(true);
	});

	it("evicts the least recently updated chat, not the last one in the list", async () => {
		const vault = makeVault();
		const settings = makeSettings({ maxSavedSessions: 3 });
		const storage = new SessionStorage(vault.plugin, settings);
		await seed(storage, ["s1", "s2", "s3"]);

		// s1 is continued today: updated in place, so it stays at the list's
		// tail while being the most recent.
		await storage.saveSession(info("s1", "2026-11-03T00:00:00Z"));
		await storage.saveSessionMessages("s4", "claude-code-acp", msg);
		await storage.saveSession(info("s4", "2026-11-03T01:00:00Z"));

		const ids = settings.getSnapshot().savedSessions.map((s) => s.sessionId);
		expect(ids.sort()).toEqual(["s1", "s3", "s4"]);
		expect(vault.files.has(path("s1"))).toBe(true);
		expect(vault.systemTrash.has(path("s2"))).toBe(true);
	});

	it("falls back to the vault trash when the system trash is off", async () => {
		const vault = makeVault({ systemTrash: false });
		const settings = makeSettings({ maxSavedSessions: 1 });
		const storage = new SessionStorage(vault.plugin, settings);

		await seed(storage, ["s1", "s2"]);

		expect(vault.files.has(path("s1"))).toBe(false);
		expect(vault.localTrash.has(path("s1"))).toBe(true);
	});

	it("never evicts when the cap is unlimited", async () => {
		const vault = makeVault();
		const settings = makeSettings({ maxSavedSessions: null });
		const storage = new SessionStorage(vault.plugin, settings);
		const ids = Array.from({ length: 120 }, (_, i) => `s${i}`);

		await seed(storage, ids);

		expect(settings.getSnapshot().savedSessions).toHaveLength(120);
		expect(vault.systemTrash.size).toBe(0);
	});

	it("uses the default cap of 100 when the setting is missing", async () => {
		const vault = makeVault();
		const settings = makeSettings({});
		const storage = new SessionStorage(vault.plugin, settings);

		await seed(storage, Array.from({ length: 101 }, (_, i) => `s${i}`));

		expect(settings.getSnapshot().savedSessions).toHaveLength(100);
		expect(vault.systemTrash.has(path("s0"))).toBe(true);
	});

	it("reports evictions once per load", async () => {
		const vault = makeVault();
		const settings = makeSettings({ maxSavedSessions: 1 });
		const notices: number[] = [];
		const storage = new SessionStorage(vault.plugin, settings, {
			onFirstEviction: (cap) => notices.push(cap),
		});

		await seed(storage, ["s1", "s2", "s3"]);

		expect(notices).toEqual([1]);
	});
});

describe("I202 lowering the cap", () => {
	it("counts and then trashes exactly the unreferenced least recently updated chats", async () => {
		const vault = makeVault();
		const settings = makeSettings({
			maxSavedSessions: null,
			perLeafTabStates: tabsFor("s1"),
		});
		const storage = new SessionStorage(vault.plugin, settings);
		await seed(storage, ["s1", "s2", "s3", "s4", "s5"]);

		expect(storage.countEvictionsForCap(2)).toBe(3);
		await storage.applyMaxSavedSessions(2);

		const snap = settings.getSnapshot();
		expect(snap.maxSavedSessions).toBe(2);
		// s1 is the oldest but open in a tab, so it stays and the three
		// oldest unprotected chats go instead.
		expect(snap.savedSessions.map((s) => s.sessionId).sort()).toEqual([
			"s1",
			"s5",
		]);
		expect(vault.files.has(path("s1"))).toBe(true);
		for (const id of ["s2", "s3", "s4"]) {
			expect(vault.files.has(path(id))).toBe(false);
			expect(vault.systemTrash.has(path(id))).toBe(true);
		}
	});

	it("leaves records and files alone when the cap is raised", async () => {
		const vault = makeVault();
		const settings = makeSettings({ maxSavedSessions: 25 });
		const storage = new SessionStorage(vault.plugin, settings);
		await seed(storage, ["s1", "s2"]);

		expect(storage.countEvictionsForCap(null)).toBe(0);
		await storage.applyMaxSavedSessions(null);

		expect(settings.getSnapshot().savedSessions).toHaveLength(2);
		expect(vault.systemTrash.size).toBe(0);
	});
});

describe("I202 explicit delete goes to the trash", () => {
	it("moves the deleted chat's transcript to the trash", async () => {
		const vault = makeVault();
		const settings = makeSettings({});
		const storage = new SessionStorage(vault.plugin, settings);
		await seed(storage, ["s1"]);

		await storage.deleteSession("s1");

		expect(settings.getSnapshot().savedSessions).toHaveLength(0);
		expect(vault.files.has(path("s1"))).toBe(false);
		expect(vault.systemTrash.has(path("s1"))).toBe(true);
	});
});

describe("I202 cleanup of unused chat files", () => {
	it("finds and trashes only unreferenced files older than a day", async () => {
		const vault = makeVault();
		const settings = makeSettings({ perLeafTabStates: tabsFor("tab-only") });
		const storage = new SessionStorage(vault.plugin, settings);
		await seed(storage, ["kept"]);
		for (const id of ["orphan", "tab-only", "brand-new"]) {
			await storage.saveSessionMessages(id, "claude-code-acp", msg);
		}
		for (const id of ["kept", "orphan", "tab-only"]) vault.age(id, 2 * DAY);

		const found = await storage.findUnusedSessionFiles();
		expect(found.map((f) => f.stem)).toEqual(["orphan"]);
		expect(found[0].size).toBeGreaterThan(0);

		const result = await storage.trashUnusedSessionFiles();
		expect(result.count).toBe(1);
		expect(vault.systemTrash.has(path("orphan"))).toBe(true);
		for (const id of ["kept", "tab-only", "brand-new"]) {
			expect(vault.files.has(path(id))).toBe(true);
		}
	});
});
