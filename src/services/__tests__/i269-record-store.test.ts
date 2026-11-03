/**
 * I269 — the store keyed by record id: the single writer (SessionStore) over
 * the real SessionStorage upsert, its write-edge validator and its message
 * file resolution. Only the vault adapter and settings snapshot are fakes.
 */
import { describe, expect, it, vi } from "vitest";

import { SessionStorage } from "../session-storage";
import { SessionStore } from "../session-store";
import { DEFAULT_SETTINGS, normalizeRawSettings } from "../settings-normalizer";
import type { AgentClientPluginSettings } from "../../plugin";
import type AgentClientPlugin from "../../plugin";
import type { SavedSessionInfo } from "../../types/session";
import type { ChatMessage } from "../../types/chat";

const DIR = ".obsidian/plugins/agent-console/sessions";

function rec(
	recordId: string,
	sessionId: string,
	extra: Partial<SavedSessionInfo> = {},
): SavedSessionInfo {
	return {
		recordId,
		sessionId,
		agentId: "kiro",
		cwd: "/vault",
		title: `t-${recordId}`,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		...extra,
	};
}

const MSGS: ChatMessage[] = [
	{
		id: "u1",
		role: "user",
		content: [{ type: "text", text: "Remember the number 7." }],
		timestamp: new Date("2026-11-02T10:00:00Z"),
	},
];

function make(seed: SavedSessionInfo[] = []) {
	const files = new Map<string, string>();
	let state = { savedSessions: seed } as unknown as AgentClientPluginSettings;
	const adapter = {
		exists: async (p: string) => files.has(p) || p === DIR,
		mkdir: async () => {},
		read: async (p: string) => {
			const v = files.get(p);
			if (v === undefined) throw new Error("ENOENT");
			return v;
		},
		write: async (p: string, d: string) => void files.set(p, d),
		remove: async (p: string) => void files.delete(p),
	};
	const plugin = {
		app: { vault: { configDir: ".obsidian", adapter } },
		manifest: { id: "agent-console" },
	} as unknown as AgentClientPlugin;
	const storage = new SessionStorage(plugin, {
		getSnapshot: () => state,
		updateSettings: async (u) => {
			state = { ...state, ...u };
		},
	});
	const store = new SessionStore({
		getSavedSessions: () => storage.getSavedSessions(),
		saveSession: (i) => storage.saveSession(i),
	});
	return { storage, store, files, records: () => state.savedSessions };
}

describe("SessionStorage keyed by record id", () => {
	it("upserts by recordId, so a rebound session id updates in place", async () => {
		const { storage, records } = make([rec("r1", "s1")]);
		await storage.saveSession(rec("r1", "s2"));
		expect(records()).toEqual([rec("r1", "s2")]);
	});

	it("refuses a write that would duplicate another record's session id", async () => {
		const { storage, records } = make([rec("r1", "s1")]);
		await expect(storage.saveSession(rec("r2", "s1"))).rejects.toThrow(
			"duplicate sessionId s1",
		);
		expect(records()).toEqual([rec("r1", "s1")]);
		// The lock chain survives a refused write.
		await storage.saveSession(rec("r3", "s3"));
		expect(records()).toHaveLength(2);
	});

	it("an agent id resolves its file only through a record's sessionId", async () => {
		// r1 started as x and was rebound to y; the legacy file is x.json.
		const { storage } = make([rec("x", "y")]);
		await storage.saveSessionMessages("x", "kiro", MSGS);
		expect((await storage.loadSessionMessages("y"))?.length).toBe(1);
		expect(await storage.loadSessionMessages("x")).toBeNull();
		expect((await storage.loadSessionMessages("x", "x"))?.length).toBe(1);
		// No record claims it either way: the legacy file is read.
		await storage.saveSessionMessages("agent-only", "kiro", MSGS);
		expect((await storage.loadSessionMessages("agent-only"))?.length).toBe(1);
	});

	it("delete removes the record and the file named by its record id", async () => {
		const { storage, files, records } = make([rec("x", "y")]);
		await storage.saveSessionMessages("x", "kiro", MSGS);
		await storage.deleteSession("y");
		expect(records()).toEqual([]);
		expect(files.has(`${DIR}/x.json`)).toBe(false);
	});
});

describe("SessionStore writes by record id", () => {
	it("a turn save with no bound record adopts the one holding its session id", async () => {
		const { store, records } = make([rec("r1", "s1", { title: "Kept" })]);
		const id = await store.recordTurnSave({
			sessionId: "s1",
			agentId: "kiro",
			cwd: "/vault",
			messages: MSGS,
		});
		expect(id).toBe("r1");
		expect(records()).toHaveLength(1);
		expect(records()[0]?.title).toBe("Kept");
	});

	it("a turn save moves the record's session id and agent; a rename doesn't", async () => {
		const { store, records } = make([rec("r1", "s1")]);
		await store.recordTurnSave({
			recordId: "r1",
			sessionId: "s2",
			agentId: "kiro",
			cwd: "/vault",
			messages: MSGS,
			kiroEngine: "v2",
		});
		expect(records()[0]).toMatchObject({ sessionId: "s2", kiroEngine: "v2" });
		await store.renameSession({
			recordId: "r1",
			sessionId: "stale",
			agentId: "claude-code-acp",
			cwd: "",
			title: "Renamed",
			createIfMissing: false,
		});
		expect(records()[0]).toMatchObject({
			recordId: "r1",
			sessionId: "s2",
			agentId: "kiro",
			title: "Renamed",
		});
	});

	it("rebind moves the session id and engine and never creates", async () => {
		const { store, records } = make([rec("r1", "s1")]);
		expect(
			await store.rebindSession({ recordId: "r1", sessionId: "s2", kiroEngine: "v3" }),
		).toBe("r1");
		expect(records()[0]).toMatchObject({ sessionId: "s2", kiroEngine: "v3", title: "t-r1" });
		expect(await store.rebindSession({ recordId: "nope", sessionId: "s9" })).toBeNull();
		expect(records()).toHaveLength(1);
	});

	it("a bound record that no longer exists is recreated under the same id", async () => {
		const { store, records } = make();
		await store.recordTurnSave({
			recordId: "r-gone",
			sessionId: "s1",
			agentId: "kiro",
			cwd: "/vault",
			messages: MSGS,
		});
		expect(records().map((r) => r.recordId)).toEqual(["r-gone"]);
	});

	it("no messages, no record (decision a)", async () => {
		const { store, records } = make();
		expect(
			await store.recordTurnSave({
				sessionId: "s1",
				agentId: "kiro",
				cwd: "/vault",
				messages: [],
			}),
		).toBeNull();
		expect(records()).toEqual([]);
	});
});

describe("migration at load (normalizeRawSettings)", () => {
	it("gives old records a record id and logs dropped entries through the injected logger", () => {
		const warn = vi.fn();
		const out = normalizeRawSettings(
			{
				savedSessions: [
					{
						sessionId: "s1",
						agentId: "kiro",
						cwd: "/vault",
						title: "Old",
						createdAt: "a",
						updatedAt: "b",
					},
					{ sessionId: 3 },
				],
			},
			DEFAULT_SETTINGS,
			() => "",
			warn,
		);
		expect(out.savedSessions).toEqual([
			{
				recordId: "s1",
				sessionId: "s1",
				agentId: "kiro",
				cwd: "/vault",
				title: "Old",
				createdAt: "a",
				updatedAt: "b",
			},
		]);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
