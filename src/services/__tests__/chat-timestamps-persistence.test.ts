/**
 * Chat Timestamps PR 1 — the new time fields survive a save and load, and
 * the load edge turns a value it can't trust into "unknown" (null).
 *
 * Seam (R2): the public `saveSessionMessages` / `loadSessionMessages` pair
 * that restore uses, with only the vault adapter faked (R4, in-memory
 * files). Assertions are on the loaded messages (R3).
 *
 * Spec: [[Agent Console Chat Timestamps]] § Time fields → Persistence.
 */
import { describe, expect, it, vi } from "vitest";

import { SessionStorage } from "../session-storage";
import type { ChatMessage } from "../../types/chat";

const T0 = Date.UTC(2026, 10, 15, 17, 0, 0);

function makeStorage() {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	const adapter = {
		exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
		mkdir: vi.fn(async (p: string) => {
			dirs.add(p);
		}),
		write: vi.fn(async (p: string, data: string) => {
			files.set(p, data);
		}),
		read: vi.fn(async (p: string) => {
			const v = files.get(p);
			if (v === undefined) throw new Error(`not found: ${p}`);
			return v;
		}),
		remove: vi.fn(async (p: string) => {
			files.delete(p);
		}),
	};
	const plugin = {
		app: { vault: { adapter, configDir: "test-config" } },
		manifest: { id: "agent-console" },
	};
	const settingsAccess = { getSnapshot: vi.fn(), updateSettings: vi.fn() };
	const storage = new SessionStorage(
		plugin as unknown as ConstructorParameters<typeof SessionStorage>[0],
		settingsAccess,
	);
	return { storage, files };
}

function transcript(): ChatMessage[] {
	return [
		{
			id: "p1",
			role: "user",
			content: [{ type: "text", text: "go" }],
			timestamp: new Date(T0),
			sentAt: T0,
			turnEndedAt: T0 + 300_000,
			turnEndKind: "stopped",
			turnWaitMs: 60_000,
			turnMs: 240_000,
		},
		{
			id: "a1",
			role: "assistant",
			content: [
				{ type: "text", text: "ok", arrivedAt: T0 + 5_000, gapBefore: false },
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "in_progress",
					arrivedAt: T0 + 6_000,
					gapBefore: false,
					startedAt: T0 + 6_000,
					endedAt: T0 + 300_000,
					requestedAt: T0 + 7_000,
					waitMs: 60_000,
					interrupted: true,
				},
			],
			timestamp: new Date(T0 + 5_000),
		},
	];
}

describe("time fields across a save and load", () => {
	it("come back with the same values", async () => {
		const { storage } = makeStorage();
		await storage.saveSessionMessages("s1", "agent", transcript());
		const loaded = await storage.loadSessionMessages("s1");
		expect(loaded?.[0]).toMatchObject({
			sentAt: T0,
			turnEndedAt: T0 + 300_000,
			turnEndKind: "stopped",
			turnWaitMs: 60_000,
			turnMs: 240_000,
		});
		expect(loaded?.[1].content[1]).toMatchObject({
			startedAt: T0 + 6_000,
			endedAt: T0 + 300_000,
			requestedAt: T0 + 7_000,
			waitMs: 60_000,
			interrupted: true,
		});
		expect(loaded?.[1].content[0].arrivedAt).toBe(T0 + 5_000);
	});

	it("an unknown time is written and comes back unknown", async () => {
		const { storage } = makeStorage();
		const m = transcript();
		m[0].sentAt = null;
		m[1].content[0].arrivedAt = Number.NaN;
		await storage.saveSessionMessages("s1", "agent", m);
		const loaded = await storage.loadSessionMessages("s1");
		expect(loaded?.[0].sentAt).toBeNull();
		expect(loaded?.[1].content[0].arrivedAt).toBeNull();
	});

	it("a value it can't trust is loaded as unknown, and the rest of the message stays", async () => {
		const { storage, files } = makeStorage();
		await storage.saveSessionMessages("s1", "agent", transcript());
		const [path, raw] = [...files.entries()][0];
		const data = JSON.parse(raw);
		data.messages[0].sentAt = "yesterday";
		data.messages[0].turnEndKind = "exploded";
		// JSON can't hold Infinity, but the literal 1e400 parses to it.
		data.messages[0].turnMs = "__INF__";
		data.messages[1].content[1].startedAt = { at: 1 };
		data.messages[1].content[1].interrupted = "yes";
		files.set(path, JSON.stringify(data).replace('"__INF__"', "1e400"));
		const loaded = await storage.loadSessionMessages("s1");
		expect(loaded?.[0]).toMatchObject({ id: "p1", sentAt: null, turnMs: null });
		expect(loaded?.[0].turnEndKind ?? null).toBeNull();
		const t = loaded?.[1].content[1];
		expect(t).toMatchObject({ type: "tool_call", toolCallId: "tc1", startedAt: null });
		expect(t && "interrupted" in t ? t.interrupted : undefined).toBeUndefined();
		expect(loaded?.[0].content[0]).toMatchObject({ text: "go" });
	});

	it("a moment no formatter can print, or one before 2020, is loaded as unknown", async () => {
		const { storage, files } = makeStorage();
		await storage.saveSessionMessages("s1", "agent", transcript());
		const [path, raw] = [...files.entries()][0];
		const data = JSON.parse(raw);
		data.messages[0].sentAt = 1e20;
		data.messages[0].turnEndedAt = 0;
		data.messages[1].content[0].arrivedAt = 1_000;
		files.set(path, JSON.stringify(data));
		const loaded = await storage.loadSessionMessages("s1");
		expect(loaded?.[0]).toMatchObject({ sentAt: null, turnEndedAt: null, turnMs: 240_000 });
		expect(loaded?.[1].content[0].arrivedAt).toBeNull();
	});
});
